const { handleResponse, successResponse, errorResponseBadRequest, errorResponseServerError } = require('../apiHelpers')
const { recoverPersonalSignature } = require('eth-sig-util')
const models = require('../models')
const handlebars = require('handlebars')
const fs = require('fs')
const path = require('path')

const recoveryTemplate = handlebars.compile(
  fs
    .readFileSync(path.resolve(__dirname, '../notifications/emails/recovery.html'))
    .toString()
)

const toQueryStr = (obj) => {
  return '?' +
    Object.keys(obj).map((key) => {
      return key + '=' + encodeURIComponent(obj[key])
    }).join('&')
}

module.exports = function (app) {
  /**
   * Send recovery information to the requested account
   */
  // Things this function is responsible for:
  //  1. Routing
  //  2. Dependency Management
  //  3. Input Validation
  //
  //  4. Business logic (obscured)
  //  5. Data Access
  //  6. Side effects! 
  //      - Sending an email 
  //      - Writing to the DB
  app.post('/recovery', handleResponse(async (req, res, next) => {

    // 2. DEPENDENCY MANAGEMENT
    let mg = req.app.get('mailgun')
    if (!mg) {
      req.logger.error('Missing api key')
      // Short-circuit if no api key provided, but do not error
      return successResponse({ msg: 'No mailgun API Key found', status: true })
    }

    // 3. INPUT VALIDATION

    let { host, login, data, signature, handle } = req.body

    if (!login) {
      return errorResponseBadRequest('Please provide valid login information')
    }
    if (!host) {
      return errorResponseBadRequest('Please provide valid host')
    }
    if (!data || !signature) {
      return errorResponseBadRequest('Please provide data and signature')
    }
    if (!handle) {
      return errorResponseBadRequest('Please provide a handle')
    }

    // 4. Some bisness logic
    let walletFromSignature = recoverPersonalSignature({ data: data, sig: signature })

    // Data Access
    const existingUser = await models.User.findOne({
      where: {
        walletAddress: walletFromSignature
      }
    })

    if (!existingUser) {
      return errorResponseBadRequest('Invalid signature provided, no user found')
    }

    const email = existingUser.email
    const recoveryParams = {
      warning: 'RECOVERY_DO_NOT_SHARE',
      login: login,
      email: email
    }
    const recoveryLink = host + toQueryStr(recoveryParams)
    const copyrightYear = new Date().getFullYear().toString()
    const context = {
      recovery_link: recoveryLink,
      handle: handle,
      copyright_year: copyrightYear
    }
    const recoveryHtml = recoveryTemplate(context)

    const emailParams = {
      from: 'Audius Recovery <recovery@audius.co>',
      to: `${email}`,
      subject: 'Save This Email: Audius Password Recovery',
      html: recoveryHtml
    }
    try {
      await new Promise((resolve, reject) => {
        mg.messages().send(emailParams, (error, body) => {
          if (error) {
            reject(error)
          }
          resolve(body)
        })
      })
      await models.UserEvents.update(
        { needsRecoveryEmail: false },
        {
          where: {
            walletAddress: walletFromSignature
          }
        }
      )
      return successResponse({ status: true })
    } catch (e) {
      return errorResponseServerError(e)
    }
  }))
}
