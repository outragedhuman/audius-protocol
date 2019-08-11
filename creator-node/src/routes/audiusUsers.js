const models = require('../models')
const authMiddleware = require('../authMiddleware')
const nodeSyncMiddleware = require('../redis').nodeSyncMiddleware
const { saveFile } = require('../fileManager')
const { handleResponse, successResponse, errorResponseBadRequest } = require('../apiHelpers')

module.exports = function (app) {
  // create AudiusUser from provided metadata, and make metadata available to network
  app.post('/audius_users', authMiddleware, nodeSyncMiddleware, handleResponse(async (req, res) => {
    const ipfs = req.app.get('ipfsAPI')

    // TODO(roneilr): do some validation on metadata given
    const metadataJSON = req.body

    const metadataBuffer = ipfs.types.Buffer.from(JSON.stringify(metadataJSON))
    const { multihash, fileUUID } = await saveFile(req, metadataBuffer)

    const audiusUserObj = {
      cnodeUserUUID: req.userId,
      metadataFileUUID: fileUUID,
      metadataJSON: metadataJSON
    }

    try {
      const { coverArtFileUUID, profilePicFileUUID } = await _getFileIdForPictures(req, metadataJSON)
      if (coverArtFileUUID) audiusUserObj.coverArtFileUUID = coverArtFileUUID
      if (profilePicFileUUID) audiusUserObj.profilePicFileUUID = profilePicFileUUID
    } catch (e) {
      return errorResponseBadRequest(e.message)
    }

    const audiusUser = await models.AudiusUser.create(audiusUserObj)

    return successResponse({ 'metadataMultihash': multihash, 'id': audiusUser.audiusUserUUID })
  }))

  // associate AudiusUser blockchain ID with existing creatornode AudiusUser to end creation process
  app.post('/audius_users/associate/:audiusUserUUID', authMiddleware, nodeSyncMiddleware, handleResponse(async (req, res) => {
    const audiusUserUUID = req.params.audiusUserUUID
    const blockchainId = req.body.userId
    if (!blockchainId || !audiusUserUUID) {
      return errorResponseBadRequest('Must include blockchainId and audius user ID')
    }

    const audiusUser = await models.AudiusUser.findOne({ where: { audiusUserUUID, cnodeUserUUID: req.userId } })
    if (!audiusUser || audiusUser.cnodeUserUUID !== req.userId) {
      return errorResponseBadRequest('Invalid Audius user ID')
    }

    // TODO(roneilr): validate that provided blockchain ID is indeed associated with
    // user wallet and metadata CID
    await audiusUser.update({
      blockchainId: blockchainId
    })

    return successResponse()
  }))

  // update a AudiusUser
  app.put('/audius_users/:blockchainId', authMiddleware, nodeSyncMiddleware, handleResponse(async (req, res) => {
    const ipfs = req.app.get('ipfsAPI')
    const blockchainId = req.params.blockchainId
    const audiusUser = await models.AudiusUser.findOne({ where: { blockchainId, cnodeUserUUID: req.userId } })

    if (!audiusUser) {
      req.logger.error('Attempting to find AudiusUser but none found', blockchainId, audiusUser)
      return errorResponseBadRequest(`Audius User doesn't exist for that blockchainId`)
    }

    // TODO(roneilr, dmanjunath): do some validation on metadata given
    const metadataJSON = req.body

    const metadataBuffer = ipfs.types.Buffer.from(JSON.stringify(metadataJSON))

    // write to a new file so there's still a record of the old file
    const { multihash, fileUUID } = await saveFile(req, metadataBuffer)

    // Update the file to the new fileId and write the metadata blob in the json field
    let updateObj = {
      metadataJSON: metadataJSON,
      metadataFileUUID: fileUUID
    }

    try {
      const { coverArtFileUUID, profilePicFileUUID } = await _getFileIdForPictures(req, metadataJSON)
      if (coverArtFileUUID) updateObj.coverArtFileUUID = coverArtFileUUID
      if (profilePicFileUUID) updateObj.profilePicFileUUID = profilePicFileUUID
    } catch (e) {
      return errorResponseBadRequest(e.message)
    }

    await audiusUser.update(updateObj)

    return successResponse({ 'metadataMultihash': multihash })
  }))
}

async function _getFileIdForPictures (req, metadataJSON) {
  let coverArtFileUUID = null
  let profilePicFileUUID = null

  const coverArtFileMultihash = metadataJSON.cover_photo
  if (coverArtFileMultihash) { // assumes AudiusUser.coverArtFileUUID is an optional param
    // ensure file exists for given multihash
    const imageFile = await models.File.findOne({
      where: {
        multihash: coverArtFileMultihash,
        cnodeUserUUID: req.userId
      }
    })
    if (!imageFile) {
      throw new Error(`No file found for provided multihash: ${coverArtFileMultihash}`)
    }
    coverArtFileUUID = imageFile.fileUUID
  }
  const profilePicFileMultihash = metadataJSON.profile_picture
  if (profilePicFileMultihash) { // assumes AudiusUser.profilePicFileUUID is an optional param
    // ensure file exists for given multihash
    const imageFile = await models.File.findOne({
      where: {
        multihash: profilePicFileMultihash,
        cnodeUserUUID: req.userId
      }
    })
    if (!imageFile) {
      throw new Error(`No file found for provided multihash: ${profilePicFileMultihash}`)
    }
    profilePicFileUUID = imageFile.fileUUID
  }

  return { coverArtFileUUID: coverArtFileUUID, profilePicFileUUID: profilePicFileUUID }
}
