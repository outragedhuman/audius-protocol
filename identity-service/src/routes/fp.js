const {
  handleResponse, successResponse, errorResponseBadRequest, errorResponse
} = require('../apiHelpers')
const { QueryTypes } = require('sequelize')

const models = require('../models')

const { logger } = require('../logging')

const getDeviceIDCountForUserId = async (userId) => {
  const res = await models.sequelize.query(
    `select count(*), "Fingerprints"."userId"
     from "Fingerprints"
     where "visitorId" in (
      select distinct "visitorId"
      from "Fingerprints"
      where "userId" = :userId
    ) group by "Fingerprints"."userId"`,
    {
      replacements: {
        userId
      },
      type: QueryTypes.SELECT
    }
  )
  return res.length
}

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
    const { userId, origin } = req.query
    if (!userId || !origin) return errorResponseBadRequest()

    const query = {
      userId,
      origin
    }
    if (origin) {
      query.origin = origin
    }
    const count = (await models.Fingerprints.findAll({
      where: {
        userId,
        origin
      }
    })).length
    return successResponse({ count })
  }))

  app.get('/fp/counts/:userId', handleResponse(async (req) => {
    const userId = req.params.userId
    try {
      const counts = await getDeviceIDCountForUserId(userId)
      return successResponse({ counts })
    } catch (e) {
      return errorResponse(`Something went wrong fetching fp counts: ${JSON.stringify(e)}`)
    }
  }))
}
