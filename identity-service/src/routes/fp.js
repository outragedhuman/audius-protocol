const {
  handleResponse, successResponse, errorResponseBadRequest
} = require('../apiHelpers')
const models = require('../models')

const { logger } = require('../logging')

module.exports = function (app) {
  app.post('/fp/webhook', handleResponse(async (req) => {
    // TODO: authenticate this endpt
    const { visitorId, linkedId: userId, requestId, tag } = req.body
    logger.info(`Received FP webhook: visitorId ${visitorId}, userId ${userId}, requestId: ${requestId}`)
    const origin = tag && tag.origin
    if (!origin || !visitorId || !userId || !requestId) {
      logger.error(`Invalid arguments to /fp/webhook: ${req.body}`)
      return successResponse()
    }
    const now = Date.now()
    try {
      await models.Fingerprints.create({
        userId,
        visitorId,
        origin,
        createdAt: now,
        updatedAt: now
      })
    } catch (e) {
      logger.error(`Error persisting fingerprint: ${e}`)
    }
    return successResponse()
  }))

  app.get('/fp', handleResponse(async (req) => {
    const { userId, origin, visitorId } = req.query

    // TODO: add index on visitorId
    if (visitorId) {
      const count = (await models.Fingerprints.findAll({
        where: {
          visitorId
        }
      })).length
      return successResponse({
        count
      })
    } else if (userId) {
      const query = {
        userId
      }
      if (origin) {
        query.origin = origin
      }
      const count = (await models.Fingerprints.findAll({
        where: query
      }))
      return successResponse({ count })
    }

    return errorResponseBadRequest()
  }))
}
