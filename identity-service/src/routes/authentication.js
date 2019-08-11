const models = require('../models')
const { handleResponse, successResponse, errorResponseBadRequest } = require('../apiHelpers')

module.exports = function (app) {
  /**
   * This signup function writes the encryption values from the user's browser(iv, cipherText, lookupKey)
   * into the Authentications table and the email to the Users table. This is the first step in the
   * authentication process
   */
  app.post('/authentication', handleResponse(async (req, res, next) => {
    // body should contain {iv, cipherText, lookupKey}
    let body = req.body
    if (body && body.iv && body.cipherText && body.lookupKey) {
      try {
        await models.Authentication.create({ iv: body.iv, cipherText: body.cipherText, lookupKey: body.lookupKey })
        return successResponse()
      } catch (err) {
        req.logger.error('Error signing up a user', err)
        return errorResponseBadRequest('Error signing up a user')
      }
    } else return errorResponseBadRequest('Missing one of the required fields: iv, cipherText, lookupKey')
  }))

  app.get('/authentication', handleResponse(async (req, res, next) => {
    let queryParams = req.query

    if (queryParams && queryParams.lookupKey && queryParams.username) {
      const email = queryParams.username.toLowerCase()
      const existingUser = await models.Authentication.findOne({
        where: {
          lookupKey: queryParams.lookupKey
        }
      })

      let userObj = await models.User.findOne({
        where: {
          email: email
        }
      })

      // This is a boolean that returns to the frontend if the user has been fully configured
      if (userObj && userObj.isConfigured && existingUser) {
        existingUser.dataValues.isConfigured = true
      }

      if (existingUser) {
        return successResponse(existingUser)
      } else return errorResponseBadRequest('Email or password is incorrect')
    } else return errorResponseBadRequest('Missing field: lookupKey or username')
  }))
}
