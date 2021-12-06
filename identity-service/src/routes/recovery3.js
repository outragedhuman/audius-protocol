// Let's think about abstractions!

// New class for data access - your only responsibility here
// is to get things and handle errors. This thing can be tested 
// independently and mocked as needed!
//
// AND, we're not coupling the recovery code to sequelize. We could
// switch out the DB and this class would be fine.
class SequelizeUserProvider {
  getUserByWallet(wallet) {
    ///
  }

  updateUserEvent(update, predicate) {
    ///
  }
}

// While we're at it, let's also make another class for mailgun.
// What if we want to move to another email provider? Right now, we're
// tightly coupled to mailgun.
class MailgunEmailProvider {
  constructor (mg) {}

  async enqueueEmail({sender, recipient, subject, bodyHtml}) {
    // Let's hide all the details of what exact format
    // mailgun needs for sending emails inside this class
    const emailParams = {
      from: sender,
      to: recipient,
      subject: subject,
      html: bodyHtml
    }

    await this._enqueueEmail(emailParams)
  }

  async _enqueueEmail(emailParams) {
    // ...do queue stuff 
  }
}

// Error handling in a testable way:

// Let's list out all the possible errors 
// this thing could have, so we could test them
const RecoveryErrors = Object.freeze({
  NO_MAILGUN: 'NO_MAILGUN',
  INVALID_LOGIN: 'INVALID_LOGIN',
  INVALID_HOST: 'INVALID_HOST'
  // ... more errors go here
})

// Let's make a mapping of errors to errorStrings, so 
// we can change the error description here if we ever want
// without altering the business logic
const ErrorDescriptions = Object.freeze({
  [RecoveryErrors.NO_MAILGUN]: "No mailgun api key found!",
  [RecoveryErrors.INVALID_LOGIN]: "Please provide valid login info!"
  // .. More strings here
})


// Let's handle input validation and dependency management outside of the business logic
// NOTE: even better would be to have a declarative solution for input validation
const handleRecoveryController = (req) => {
  // generic providers
  const emailProvider = new MailgunEmailProvider(req.app.get('mailgun'))
  const userProvider = serviceRegistry.sequelizeUserProvider 

  // Do input validation
  try {
    const { host, login, data, signature, handle } = getParams(req)
    await enqueueRecoveryEmailAndUpdateUser({ emailProvider: mailgunProvider, userProvider, host, login, data, signature, handle})
  } catch (e) {
    const errorString = ErrorDescriptions[e]
    throw errorString 
  }
}

const AUDIUS_EMAIL_SENDER = 'Audius Recovery <recovery@audius.co>'
const AUDIUS_EMAIL_SUBJECT = 'Save This Email: Audius Password Recovery'

const enqueueRecoveryEmailAndUpdateUser = ({ emailProvider, host, login, data, signature, handle }) => {
  const recoveredWallet = recoverPersonalSignature({ data, sig: signature })
  const user = userProvider.fromWallet(recoveredWallet)
  if (user) {
    throw new Error(recoveryErrors.NO_USER_FOUND)
  }
  const recoveryUrl = generateRecoveryUrl({ userEmail: user.email, login })
  const emailBody = generateEmailBody(recoveryUrl)
  await emailProvider.enqueueEmail({ sender: AUDIUS_SENDER, recipient: user.email, subject: AUDIUS_SUBJECT, bodyUrl: emailBody })
  await userProvider.updateUserEvent({ needsRecoveryEmail: false }, { walletAddress: walletFromSignature})
}

const generateEmailBody = ({ recoveryLink, handle}) => {
    const copyrightYear = new Date().getFullYear().toString()
    const context = {
      recovery_link: recoveryLink,
      handle: handle,
      copyright_year: copyrightYear
    }
    return recoveryTemplate(context)
}

const generateRecoveryUrl = (userEmail, login) => {
  const recoveryParams = {
    warning: 'RECOVERY_DO_NOT_SHARE',
    login,
    email: userEmail
  } 
  return host + toQueryStr(recoveryParams)
}

// Routing

const routes = {
  '/recovery': [handleRecoveryController, { type: 'POST '} ],
  '/foo': handleFooController,
  '/bar': handleBarController
}

setupRoutes(routes)

