import {
  sendResponse,
  errorResponseServerError,
  errorResponseForbidden,
  errorResponseUnauthorized,
  errorResponseBadRequest,
  CustomRequest
} from '../../apiHelpers'
import { NextFunction, Request, Response } from 'express'
import type Logger from 'bunyan'
import { checkPremiumContentAccess } from '../../premiumContent/premiumContentAccessChecker'
import config from '../../config'

/**
 * Middleware to validate requests to get premium content.
 * For premium content, CN gets a request with 2 signatures:
 * - one generated by a DN with the premium track/playlist id and wallet from user who has access to it,
 * along with a timestamp,
 * - another from the client generated by the user who is requesting the premium track.
 * This middleware will recover the DN signature and verify that it is from a registered DN.
 * It will also recover the user signature. Then, it will verify that wallet from recovered signature
 * is the same as that of wallet in the DN-signed data, also verify that id and type (track/playlist)
 * of content requested are same as those in the DN-signed data, and also verify that DN-signed data
 * timestamp is relatively recent.
 * If all these verifications are successful, then this middleware will proceed with the request as normal.
 */
export const premiumContentMiddleware = async (
  request: Request,
  res: Response,
  next: NextFunction
) => {
  const req = request as CustomRequest
  const cid = req.params?.CID
  if (!cid) {
    return sendResponse(
      req,
      res,
      errorResponseBadRequest(`Invalid request, no CID provided.`)
    )
  }

  if (!config.get('premiumContentEnabled')) {
    return next()
  }

  try {
    const premiumContentHeaders = req.headers['x-premium-content'] as string
    const serviceRegistry = req.app.get('serviceRegistry')
    const { libs, redis } = serviceRegistry
    // Need to set the type here as the compiler cannot tell what type it is from the serviceRegistry
    const logger = req.logger as Logger

    const { doesUserHaveAccess, error } = await checkPremiumContentAccess({
      cid,
      premiumContentHeaders,
      libs,
      logger,
      redis
    })
    if (doesUserHaveAccess) {
      // Set premium content track id and 'premium-ness' so that next middleware or
      // request handler does not need to make trips to the database to get this info.
      // We need the info because if the content is premium, then we need to set
      // the cache-control response header to no-cache so that nginx does not cache it.
      // req.premiumContent = {
      //   trackId,
      //   isPremium
      // }
      return next()
    }

    switch (error) {
      case 'MissingHeaders':
        return sendResponse(
          req,
          res,
          errorResponseUnauthorized(
            'Missing request headers for premium content.'
          )
        )
      case 'InvalidDiscoveryNode':
        return sendResponse(
          req,
          res,
          errorResponseForbidden(
            'Failed discovery node signature validation for premium content.'
          )
        )
      case 'IncorrectCID':
        return sendResponse(
          req,
          res,
          errorResponseForbidden('Incorrect CID signature')
        )
      case 'ExpiredTimestamp':
        return sendResponse(
          req,
          res,
          errorResponseForbidden('Timestamp for content is expired')
        )
      default:
        return sendResponse(
          req,
          res,
          errorResponseForbidden(
            'Failed match verification for premium content.'
          )
        )
    }
  } catch (e) {
    const error = `Could not validate premium content access: ${
      (e as Error).message
    }`
    req.logger.error(`${error}.\nError: ${JSON.stringify(e, null, 2)}`)
    return sendResponse(req, res, errorResponseServerError(error))
  }
}
