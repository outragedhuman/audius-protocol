const crypto = require('crypto')

const {
  handleResponse,
  successResponse,
  errorResponseBadRequest,
  errorResponseForbidden,
  errorResponseServerError
} = require('../apiHelpers')
const txRelay = require('../relay/txRelay')
const captchaMiddleware = require('../captchaMiddleware')
const { detectAbuse } = require('../utils/antiAbuse')
const { getFeatureFlag, FEATURE_FLAGS } = require('../featureFlag')
const models = require('../models')
const { getIP } = require('../utils/antiAbuse')
const { libs } = require('@audius/sdk')
const config = require('../config.js')

module.exports = function (app) {
  // TODO(roneilr): authenticate that user controls senderAddress somehow, potentially validate that
  // method sig has come from sender address as well
  app.post(
    '/relay',
    captchaMiddleware,
    handleResponse(async (req, res, next) => {
      const body = req.body
      const redis = req.app.get('redis')

      // TODO: Use auth middleware to derive this
      const user = await models.User.findOne({
        where: { walletAddress: body.senderAddress },
        attributes: [
          'id',
          'blockchainUserId',
          'walletAddress',
          'handle',
          'isBlockedFromRelay',
          'isBlockedFromNotifications',
          'isBlockedFromEmails',
          'appliedRules'
        ]
      })

      let optimizelyClient
      let detectAbuseOnRelay = false
      let blockAbuseOnRelay = false
      try {
        optimizelyClient = req.app.get('optimizelyClient')
        detectAbuseOnRelay = getFeatureFlag(
          optimizelyClient,
          FEATURE_FLAGS.DETECT_ABUSE_ON_RELAY
        )
        blockAbuseOnRelay = getFeatureFlag(
          optimizelyClient,
          FEATURE_FLAGS.BLOCK_ABUSE_ON_RELAY
        )
      } catch (error) {
        req.logger.error(
          `failed to retrieve optimizely feature flag for ${FEATURE_FLAGS.DETECT_ABUSE_ON_RELAY} or ${FEATURE_FLAGS.BLOCK_ABUSE_ON_RELAY}: ${error}`
        )
      }

      // Handle abusive users

      const userFlaggedAsAbusive =
        user &&
        (user.isBlockedFromRelay ||
          user.isBlockedFromNotifications ||
          user.isBlockedFromEmails)
      if (blockAbuseOnRelay && user && userFlaggedAsAbusive) {
        // allow previously abusive users to redeem themselves for next relays
        if (detectAbuseOnRelay) {
          const reqIP = getIP(req)
          detectAbuse(user, reqIP) // fired & forgotten
        }

        // Only reject relay for users explicitly blocked from relay
        if (user.isBlockedFromRelay) {
          return errorResponseForbidden(`Forbidden ${user.appliedRules}`)
        }
      }

      let txProps
      if (
        body &&
        body.contractRegistryKey &&
        body.contractAddress &&
        body.senderAddress &&
        body.encodedABI
      ) {
        // fire and forget update handle if necessary for early anti-abuse measures
        ;(async () => {
          try {
            if (!user) return

            const useProvisionalHandle = !user.handle && !user.blockchainUserId
            if (body.handle && useProvisionalHandle) {
              user.handle = body.handle
              await user.save()
              const reqIP = getIP(req)
              // Perform an abbreviated check here, b/c we
              // won't have all the requried info on DN for a full check
              detectAbuse(user, reqIP, true /* abbreviated */)
            }
          } catch (e) {
            req.logger.error(
              `Error setting provisional handle for user ${user.wallet}: ${e.message}`
            )
          }
        })()

        // send tx
        let receipt
        const reqBodySHA = crypto
          .createHash('sha256')
          .update(JSON.stringify(req.body))
          .digest('hex')
        try {
          txProps = {
            contractRegistryKey: body.contractRegistryKey,
            contractAddress: body.contractAddress,
            encodedABI: body.encodedABI,
            senderAddress: body.senderAddress,
            gasLimit: body.gasLimit || null
          }

          // When EntityManager is enabled for replica sets, throw error for URSM
          // Fallback to EntityManager
          if (
            config.get('entityManagerReplicaSetEnabled') &&
            txProps.contractRegistryKey === 'UserReplicaSetManager'
          ) {
            const decodedABI = libs.AudiusABIDecoder.decodeMethod(
              txProps.contractRegistryKey,
              txProps.encodedABI
            )
            if (decodedABI.name === 'updateReplicaSet') {
              throw new Error(
                'Cannot relay UserReplicaSetManager transactions when EntityManager is enabled'
              )
            }
          }
          receipt = await txRelay.sendTransaction(
            req,
            false, // resetNonce
            txProps,
            reqBodySHA
          )
        } catch (e) {
          if (e.message.includes('nonce')) {
            req.logger.warn(
              'Nonce got out of sync, resetting. Original error message: ',
              e.message
            )
            // this is a retry in case we get an error about the nonce being out of sync
            // the last parameter is an optional bool that forces a nonce reset
            receipt = await txRelay.sendTransaction(
              req,
              true, // resetNonce
              txProps,
              reqBodySHA
            )
            // no need to return success response here, regular code execution will continue after catch()
          } else {
            // if the tx fails, store it in redis with a 24 hour expiration
            await redis.setex(
              `failedTx:${reqBodySHA}`,
              60 /* seconds */ * 60 /* minutes */ * 24 /* hours */,
              JSON.stringify(req.body)
            )

            req.logger.error('Error in transaction:', e.message, reqBodySHA)
            return errorResponseServerError(
              `Something caused the transaction to fail for payload ${reqBodySHA}, ${e.message}`
            )
          }
        }

        if (user && detectAbuseOnRelay) {
          const reqIP = getIP(req)
          detectAbuse(user, reqIP) // fired & forgotten
        }

        return successResponse({ receipt: receipt })
      }

      return errorResponseBadRequest(
        'Missing one of the required fields: contractRegistryKey, contractAddress, senderAddress, encodedABI'
      )
    })
  )
}
