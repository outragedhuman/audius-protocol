const request = require('supertest')
const fs = require('fs-extra')
const path = require('path')
const assert = require('assert')
const _ = require('lodash')
const nock = require('nock')
const chai = require('chai')
const sinon = require('sinon')
const proxyquire = require('proxyquire')

const config = require('../src/config')
const models = require('../src/models')
const { getApp, getServiceRegistryMock } = require('./lib/app')
const { getLibsMock } = require('./lib/libsMock')
const libsMock = getLibsMock()
const {
  createStarterCNodeUser,
  testEthereumConstants,
  destroyUsers
} = require('./lib/dataSeeds')
const { uploadTrack } = require('./lib/helpers')
const BlacklistManager = require('../src/blacklistManager')
const sessionManager = require('../src/sessionManager')

const redisClient = require('../src/redis')
const { stringifiedDateFields } = require('./lib/utils')
const secondarySyncFromPrimary = require('../src/services/sync/secondarySyncFromPrimary')

const { saveFileForMultihashToFS } = require('../src/fileManager')

chai.use(require('sinon-chai'))
chai.use(require('chai-as-promised'))
const { expect } = chai

const testAudioFilePath = path.resolve(__dirname, 'testTrack.mp3')

const DUMMY_WALLET = testEthereumConstants.pubKey.toLowerCase()
const DUMMY_CNODEUSER_BLOCKNUMBER = 10
// Below files generated using above dummy data
const sampleExportDummyCIDPath = path.resolve(
  __dirname,
  'syncAssets/sampleExportDummyCID.json'
)
const sampleExportDummyCIDFromClock2Path = path.resolve(
  __dirname,
  'syncAssets/sampleExportDummyCIDFromClock2.json'
)

describe.only('Test secondarySyncFromPrimary()', async function () {
  let server, app, mockServiceRegistry, userId

  const originalMaxExportClockValueRange = config.get(
    'maxExportClockValueRange'
  )
  let maxExportClockValueRange = originalMaxExportClockValueRange

  userId = 1

  let sandbox
  const setupDepsAndApp = async function () {
    sandbox = sinon.createSandbox()
    const appInfo = await getApp(libsMock, BlacklistManager, null, userId)
    server = appInfo.server
    app = appInfo.app
    mockServiceRegistry = appInfo.mockServiceRegistry
  }

  /** Wipe DB + Redis */
  beforeEach(async function () {
    try {
      await destroyUsers()
    } catch (e) {
      // do nothing
    }

    await redisClient.flushdb()
  })

  /**
   * Wipe DB, server, and redis state
   */
  afterEach(async function () {
    if (sandbox) {
      sandbox.restore()
    }
    await sinon.restore()
    await server.close()
  })

  describe('test /export route', async function () {
    let cnodeUserUUID,
      sessionToken,
      sessionWalletPublicKey,
      metadataMultihash,
      metadataFileUUID,
      transcodedTrackCID,
      transcodedTrackUUID,
      trackSegments,
      sourceFile
    let trackMetadataMultihash, trackMetadataFileUUID

    const { pubKey } = testEthereumConstants

    const createUserAndTrack = async function () {
      // Create user
      ;({
        cnodeUserUUID,
        sessionToken,
        userId,
        walletPublicKey: sessionWalletPublicKey
      } = await createStarterCNodeUser(userId))

      // Upload user metadata
      const metadata = {
        metadata: {
          testField: 'testValue'
        }
      }
      const userMetadataResp = await request(app)
        .post('/audius_users/metadata')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .set('Enforce-Write-Quorum', false)
        .send(metadata)
        .expect(200)
      metadataMultihash = userMetadataResp.body.data.metadataMultihash
      metadataFileUUID = userMetadataResp.body.data.metadataFileUUID

      // Make chain recognize current session wallet as the wallet for the session user ID
      const blockchainUserId = 1
      const getUserStub = sinon.stub().callsFake((blockchainUserIdArg) => {
        let wallet = 'no wallet'
        if (blockchainUserIdArg === blockchainUserId) {
          wallet = sessionWalletPublicKey
        }
        return {
          wallet
        }
      })
      libsMock.contracts.UserFactoryClient = { getUser: getUserStub }

      // Associate user with with blockchain ID
      const associateRequest = {
        blockchainUserId: 1,
        metadataFileUUID,
        blockNumber: 10
      }
      await request(app)
        .post('/audius_users')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .send(associateRequest)
        .expect(200)

      /** Upload a track */

      const trackUploadResponse = await uploadTrack(
        testAudioFilePath,
        cnodeUserUUID,
        mockServiceRegistry.blacklistManager
      )

      transcodedTrackUUID = trackUploadResponse.transcodedTrackUUID
      trackSegments = trackUploadResponse.track_segments
      sourceFile = trackUploadResponse.source_file
      transcodedTrackCID = trackUploadResponse.transcodedTrackCID

      // Upload track metadata
      const trackMetadata = {
        metadata: {
          test: 'field1',
          owner_id: 1,
          track_segments: trackSegments
        },
        source_file: sourceFile
      }
      const trackMetadataResp = await request(app)
        .post('/tracks/metadata')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .set('Enforce-Write-Quorum', false)
        .send(trackMetadata)
        .expect(200)
      trackMetadataMultihash = trackMetadataResp.body.data.metadataMultihash
      trackMetadataFileUUID = trackMetadataResp.body.data.metadataFileUUID

      // Make chain recognize wallet as owner of track
      const blockchainTrackId = 1
      const getTrackStub = sinon.stub().callsFake((blockchainTrackIdArg) => {
        let trackOwnerId = -1
        if (blockchainTrackIdArg === blockchainTrackId) {
          trackOwnerId = userId
        }
        return {
          trackOwnerId
        }
      })
      libsMock.contracts.TrackFactoryClient = { getTrack: getTrackStub }

      // associate track + track metadata with blockchain ID
      await request(app)
        .post('/tracks')
        .set('X-Session-ID', sessionToken)
        .set('User-Id', userId)
        .send({
          blockchainTrackId,
          blockNumber: 10,
          metadataFileUUID: trackMetadataFileUUID,
          transcodedTrackUUID
        })
    }

    describe('Confirm export object matches DB state with a user and track', async function () {
      beforeEach(setupDepsAndApp)

      beforeEach(createUserAndTrack)

      it('Test default export', async function () {
        // confirm maxExportClockValueRange > cnodeUser.clock
        const cnodeUserClock = (
          await models.CNodeUser.findOne({
            where: { cnodeUserUUID },
            raw: true
          })
        ).clock
        assert.ok(cnodeUserClock <= maxExportClockValueRange)

        const { body: exportBody } = await request(app).get(
          `/export?wallet_public_key=${pubKey.toLowerCase()}`
        )

        /**
         * Verify
         */

        // Get user metadata
        const userMetadataFile = stringifiedDateFields(
          await models.File.findOne({
            where: {
              multihash: metadataMultihash,
              fileUUID: metadataFileUUID,
              clock: 1
            },
            raw: true
          })
        )

        // get transcoded track file
        const copy320 = stringifiedDateFields(
          await models.File.findOne({
            where: {
              multihash: transcodedTrackCID,
              fileUUID: transcodedTrackUUID,
              type: 'copy320'
            },
            raw: true
          })
        )

        // get segment files
        const segmentHashes = trackSegments.map((t) => t.multihash)
        const segmentFiles = await Promise.all(
          segmentHashes.map(async (hash, i) => {
            const segment = await models.File.findOne({
              where: {
                multihash: hash,
                type: 'track'
              },
              raw: true
            })
            return stringifiedDateFields(segment)
          })
        )

        // Get track metadata file
        const trackMetadataFile = stringifiedDateFields(
          await models.File.findOne({
            where: {
              multihash: trackMetadataMultihash,
              fileUUID: trackMetadataFileUUID,
              clock: 36
            },
            raw: true
          })
        )

        // get audiusUser
        const audiusUser = stringifiedDateFields(
          await models.AudiusUser.findOne({
            where: {
              metadataFileUUID,
              clock: 2
            },
            raw: true
          })
        )

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(
          await models.CNodeUser.findOne({
            where: {
              cnodeUserUUID
            },
            raw: true
          })
        )

        // get clock records
        const clockRecords = (
          await models.ClockRecord.findAll({
            where: { cnodeUserUUID },
            raw: true
          })
        ).map(stringifiedDateFields)

        // get track file
        const trackFile = stringifiedDateFields(
          await models.Track.findOne({
            where: {
              cnodeUserUUID,
              metadataFileUUID: trackMetadataFileUUID
            },
            raw: true
          })
        )

        const clockInfo = {
          localClockMax: cnodeUser.clock,
          requestedClockRangeMin: 0,
          requestedClockRangeMax: maxExportClockValueRange - 1
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers: [audiusUser],
            tracks: [trackFile],
            files: [
              userMetadataFile,
              copy320,
              ...segmentFiles,
              trackMetadataFile
            ],
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(clockRecords.length, cnodeUserClock)
        assert.deepStrictEqual(exportedUserData, expectedData)
      })
    })

    describe('Confirm export works for user with data exceeding maxExportClockValueRange', async function () {
      /**
       * override maxExportClockValueRange to smaller value for testing
       */
      beforeEach(async function () {
        maxExportClockValueRange = 10
        process.env.maxExportClockValueRange = maxExportClockValueRange
      })

      beforeEach(setupDepsAndApp)

      beforeEach(createUserAndTrack)

      /**
       * unset maxExportClockValueRange
       */
      afterEach(async function () {
        delete process.env.maxExportClockValueRange
      })

      it('Export from clock = 0', async function () {
        const requestedClockRangeMin = 0
        const requestedClockRangeMax = maxExportClockValueRange - 1

        // confirm maxExportClockValueRange < cnodeUser.clock
        const cnodeUserClock = (
          await models.CNodeUser.findOne({
            where: { cnodeUserUUID },
            raw: true
          })
        ).clock
        assert.ok(cnodeUserClock > maxExportClockValueRange)

        const { body: exportBody, statusCode } = await request(app).get(
          `/export?wallet_public_key=${pubKey.toLowerCase()}`
        )

        /**
         * Verify
         */

        assert.strictEqual(statusCode, 200)

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(
          await models.CNodeUser.findOne({
            where: {
              cnodeUserUUID
            },
            raw: true
          })
        )
        cnodeUser.clock = requestedClockRangeMax

        // get clockRecords
        const clockRecords = (
          await models.ClockRecord.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // Get audiusUsers
        const audiusUsers = (
          await models.AudiusUser.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // get tracks
        const tracks = (
          await models.Track.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // get files
        const files = (
          await models.File.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        const clockInfo = {
          requestedClockRangeMin,
          requestedClockRangeMax,
          localClockMax: requestedClockRangeMax
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers,
            tracks,
            files,
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(exportedUserData, expectedData)
        // when requesting from 0, exported data set is 1 less than expected range since clock values are 1-indexed
        assert.deepStrictEqual(
          clockRecords.length,
          maxExportClockValueRange - 1
        )
      })

      it('Export from clock = 10', async function () {
        const clockRangeMin = 10
        const requestedClockRangeMin = clockRangeMin
        const requestedClockRangeMax =
          clockRangeMin + (maxExportClockValueRange - 1)

        // confirm maxExportClockValueRange < cnodeUser.clock
        const cnodeUserClock = (
          await models.CNodeUser.findOne({
            where: { cnodeUserUUID },
            raw: true
          })
        ).clock
        assert.ok(cnodeUserClock > maxExportClockValueRange)

        const { body: exportBody, statusCode } = await request(app).get(
          `/export?wallet_public_key=${pubKey.toLowerCase()}&clock_range_min=${requestedClockRangeMin}`
        )

        /**
         * Verify
         */

        assert.strictEqual(statusCode, 200)

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(
          await models.CNodeUser.findOne({
            where: {
              cnodeUserUUID
            },
            raw: true
          })
        )
        cnodeUser.clock = requestedClockRangeMax

        // get clockRecords
        const clockRecords = (
          await models.ClockRecord.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // Get audiusUsers
        const audiusUsers = (
          await models.AudiusUser.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // get tracks
        const tracks = (
          await models.Track.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // get files
        const files = (
          await models.File.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        const clockInfo = {
          requestedClockRangeMin,
          requestedClockRangeMax,
          localClockMax: requestedClockRangeMax
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers,
            tracks,
            files,
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(exportedUserData, expectedData)
        assert.deepStrictEqual(clockRecords.length, maxExportClockValueRange)
      })

      it('Export from clock = 30 where range exceeds final value', async function () {
        const clockRangeMin = 30
        const requestedClockRangeMin = clockRangeMin
        const requestedClockRangeMax =
          clockRangeMin + (maxExportClockValueRange - 1)

        // confirm cnodeUser.clock < (requestedClockRangeMin + maxExportClockValueRange)
        const cnodeUserClock = (
          await models.CNodeUser.findOne({
            where: { cnodeUserUUID },
            raw: true
          })
        ).clock
        assert.ok(
          cnodeUserClock < requestedClockRangeMin + maxExportClockValueRange
        )

        const { body: exportBody, statusCode } = await request(app).get(
          `/export?wallet_public_key=${pubKey.toLowerCase()}&clock_range_min=${requestedClockRangeMin}`
        )

        /**
         * Verify
         */
        assert.strictEqual(statusCode, 200)

        // get cnodeUser
        const cnodeUser = stringifiedDateFields(
          await models.CNodeUser.findOne({
            where: {
              cnodeUserUUID
            },
            raw: true
          })
        )
        cnodeUser.clock = Math.min(cnodeUser.clock, requestedClockRangeMax)

        // get clockRecords
        const clockRecords = (
          await models.ClockRecord.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // Get audiusUsers
        const audiusUsers = (
          await models.AudiusUser.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // get tracks
        const tracks = (
          await models.Track.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        // get files
        const files = (
          await models.File.findAll({
            where: {
              cnodeUserUUID,
              clock: {
                [models.Sequelize.Op.gte]: requestedClockRangeMin,
                [models.Sequelize.Op.lte]: requestedClockRangeMax
              }
            },
            order: [['clock', 'ASC']],
            raw: true
          })
        ).map(stringifiedDateFields)

        const clockInfo = {
          requestedClockRangeMin,
          requestedClockRangeMax,
          localClockMax: cnodeUser.clock
        }

        // construct the expected response
        const expectedData = {
          [cnodeUserUUID]: {
            ...cnodeUser,
            audiusUsers,
            tracks,
            files,
            clockRecords,
            clockInfo
          }
        }

        // compare exported data
        const exportedUserData = exportBody.data.cnodeUsers
        assert.deepStrictEqual(exportedUserData, expectedData)
        assert.deepStrictEqual(
          clockRecords.length,
          cnodeUser.clock - requestedClockRangeMin + 1
        )
      })
    })

    describe('Confirm export throws an error with inconsistent data', async function () {
      beforeEach(setupDepsAndApp)

      beforeEach(createUserAndTrack)

      it('Inconsistent clock values', async function () {
        // Mock findOne DB function for cnodeUsers and ClockRecords
        // Have them return inconsistent values
        const clockRecordTableClock = 8
        const clockRecordsFindAllStub = sandbox.stub().resolves([
          {
            cnodeUserUUID: '48523a08-2a11-4200-8aac-ae74b8a39dd0',
            clock: clockRecordTableClock
          }
        ])
        const cnodeUserTableClock = 7
        const cNodeUserFindAll = sandbox.stub().resolves([
          {
            // Random UUID
            cnodeUserUUID: '48523a08-2a11-4200-8aac-ae74b8a39dd0',
            clock: cnodeUserTableClock
          }
        ])

        const modelsMock = {
          ...models,
          ClockRecord: {
            findAll: clockRecordsFindAllStub
          },
          CNodeUser: {
            findAll: cNodeUserFindAll
          }
        }
        const exportComponentServiceMock = proxyquire(
          '../src/components/replicaSet/exportComponentService.js',
          {
            '../../models': modelsMock
          }
        )

        await expect(
          exportComponentServiceMock({
            walletPublicKeys: pubKey.toLowerCase(),
            requestedClockRangeMin: 0,
            requestedClockRangeMax: maxExportClockValueRange,
            logger: console,
            forceExport: false
          })
        ).to.eventually.be.rejectedWith(
          `Cannot export - exported data is not consistent. Exported max clock val = ${cnodeUserTableClock} and exported max ClockRecord val ${clockRecordTableClock}. Fixing and trying again...`
        )

        expect(clockRecordsFindAllStub).to.have.been.calledOnce
        expect(cNodeUserFindAll).to.have.been.calledOnce
      })
    })
  })

  describe('Test secondarySyncFromPrimary function', async function () {
    let serviceRegistryMock

    const TEST_ENDPOINT = 'http://test-cn.co'
    const { pubKey } = testEthereumConstants
    const userWallets = [pubKey.toLowerCase()]

    const createUser = async function () {
      // Create user
      const session = await createStarterCNodeUser(userId)

      // Upload user metadata
      const metadata = {
        metadata: {
          testField: 'testValue'
        }
      }
      const userMetadataResp = await request(app)
        .post('/audius_users/metadata')
        .set('X-Session-ID', session.sessionToken)
        .set('User-Id', session.userId)
        .set('Enforce-Write-Quorum', false)
        .send(metadata)
        .expect(200)

      const metadataFileUUID = userMetadataResp.body.data.metadataFileUUID

      // Make chain recognize current session wallet as the wallet for the session user ID
      const blockchainUserId = 1
      const getUserStub = sinon.stub().callsFake((blockchainUserIdArg) => {
        let wallet = 'no wallet'
        if (blockchainUserIdArg === blockchainUserId) {
          wallet = session.walletPublicKey
        }
        return {
          wallet
        }
      })
      libsMock.contracts.UserFactoryClient = { getUser: getUserStub }

      // Associate user with with blockchain ID
      const associateRequest = {
        blockchainUserId: 1,
        metadataFileUUID,
        blockNumber: 10
      }
      await request(app)
        .post('/audius_users')
        .set('X-Session-ID', session.sessionToken)
        .set('User-Id', session.userId)
        .send(associateRequest)
        .expect(200)

      return session.cnodeUserUUID
    }

    const unpackSampleExportData = (sampleExportFilePath) => {
      const sampleExport = JSON.parse(fs.readFileSync(sampleExportFilePath))
      const cnodeUser = Object.values(sampleExport.data.cnodeUsers)[0]
      const { audiusUsers, tracks, files, clockRecords } = cnodeUser

      return {
        sampleExport,
        cnodeUser,
        audiusUsers,
        tracks,
        files,
        clockRecords
      }
    }

    const setupMocks = (sampleExport, contentIsAvailable = true) => {
      // Mock /export route response
      nock(TEST_ENDPOINT)
        .persist()
        .get((uri) => uri.includes('/export'))
        .reply(200, sampleExport)

      // This text 'audius is cool' is mapped to the hash in the dummy json data
      // If changes are made to the response body, make the corresponding changes to the hash too
      nock('http://mock-cn1.audius.co')
        .persist()
        .get((uri) =>
          uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE')
        )
        .reply(() => {
          return contentIsAvailable
            ? [200, 'audius is cool']
            : [404, 'audius is less cool']
        })

      nock('http://mock-cn2.audius.co')
        .persist()
        .get((uri) =>
          uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE')
        )
        .reply(() => {
          return contentIsAvailable
            ? [200, 'audius is cool']
            : [404, 'audius is less cool']
        })

      nock('http://mock-cn3.audius.co')
        .persist()
        .get((uri) =>
          uri.includes('/ipfs/QmSU6rdPHdTrVohDSfhVCBiobTMr6a3NvPz4J7nLWVDvmE')
        )
        .reply(() => {
          return contentIsAvailable
            ? [200, 'audius is cool']
            : [404, 'audius is less cool']
        })
    }

    const verifyLocalCNodeUserStateForUser = async (exportedCnodeUser) => {
      exportedCnodeUser = _.pick(exportedCnodeUser, [
        'cnodeUserUUID',
        'walletPublicKey',
        'lastLogin',
        'latestBlockNumber',
        'clock',
        'createdAt'
      ])

      const localCNodeUser = stringifiedDateFields(
        await models.CNodeUser.findOne({
          where: {
            walletPublicKey: exportedCnodeUser.walletPublicKey
          },
          raw: true
        })
      )

      assert.deepStrictEqual(
        _.omit(localCNodeUser, ['cnodeUserUUID', 'updatedAt']),
        _.omit(exportedCnodeUser, ['cnodeUserUUID', 'updatedAt'])
      )

      const newCNodeUserUUID = localCNodeUser.cnodeUserUUID
      return newCNodeUserUUID
    }

    /**
     * Verifies local state for user with CNodeUserUUID for AudiusUsers, Tracks, Files, and ClockRecords tables
     */
    const verifyLocalStateForUser = async ({
      cnodeUserUUID,
      exportedAudiusUsers,
      exportedClockRecords,
      exportedFiles,
      exportedTracks
    }) => {
      /**
       * Verify local AudiusUsers table state matches export
       */
      for (const exportedAudiusUser of exportedAudiusUsers) {
        const localAudiusUser = stringifiedDateFields(
          await models.AudiusUser.findOne({
            where: {
              cnodeUserUUID,
              clock: exportedAudiusUser.clock
            },
            raw: true
          })
        )
        assert.deepStrictEqual(
          _.omit(localAudiusUser, ['cnodeUserUUID']),
          _.omit(exportedAudiusUser, ['cnodeUserUUID'])
        )
      }

      /**
       * Verify local Tracks table state matches export
       */
      for (const exportedTrack of exportedTracks) {
        const { clock, blockchainId, metadataFileUUID } = exportedTrack
        const localFile = stringifiedDateFields(
          await models.Track.findOne({
            where: {
              clock,
              cnodeUserUUID,
              blockchainId,
              metadataFileUUID
            },
            raw: true
          })
        )
        assert.deepStrictEqual(
          _.omit(localFile, ['cnodeUserUUID']),
          _.omit(exportedTrack, ['cnodeUserUUID'])
        )
      }

      /**
       * Verify local Files table state matches export
       */
      for (const exportedFile of exportedFiles) {
        const { fileUUID, multihash, clock } = exportedFile
        const localFile = stringifiedDateFields(
          await models.File.findOne({
            where: {
              clock,
              cnodeUserUUID,
              multihash,
              fileUUID
            },
            raw: true
          })
        )
        assert.deepStrictEqual(
          _.omit(localFile, ['cnodeUserUUID']),
          _.omit(exportedFile, ['cnodeUserUUID'])
        )
      }

      /**
       * Verify local ClockRecords table state matches export
       */
      for (const exportedRecord of exportedClockRecords) {
        const { clock, sourceTable, createdAt, updatedAt } = exportedRecord
        const localRecord = stringifiedDateFields(
          await models.ClockRecord.findOne({
            where: {
              clock,
              cnodeUserUUID,
              sourceTable,
              createdAt,
              updatedAt
            },
            raw: true
          })
        )
        assert.deepStrictEqual(
          _.omit(localRecord, ['cnodeUserUUID']),
          _.omit(exportedRecord, ['cnodeUserUUID'])
        )
      }

      /**
       * TODO - Verify all expected files are on disk
       */
    }

    /**
     * Setup deps + mocks + app
     */
    beforeEach(async function () {
      // Clear storagePath
      const storagePath = config.get('storagePath')
      const absoluteStoragePath = path.resolve(storagePath)
      await fs.emptyDir(path.resolve(absoluteStoragePath))

      nock.cleanAll()

      maxExportClockValueRange = originalMaxExportClockValueRange
      process.env.maxExportClockValueRange = maxExportClockValueRange

      const appInfo = await getApp(libsMock, BlacklistManager, null, userId)
      server = appInfo.server
      app = appInfo.app

      serviceRegistryMock = getServiceRegistryMock(libsMock, BlacklistManager)
    })

    it('Syncs correctly from clean user state with mocked export object', async function () {
      const {
        sampleExport,
        cnodeUser: exportedCnodeUser,
        audiusUsers: exportedAudiusUsers,
        tracks: exportedTracks,
        files: exportedFiles,
        clockRecords: exportedClockRecords
      } = unpackSampleExportData(sampleExportDummyCIDPath)

      setupMocks(sampleExport)

      // Confirm local user state is empty before sync
      const initialCNodeUserCount = await models.CNodeUser.count()
      assert.strictEqual(initialCNodeUserCount, 0)

      // Call secondarySyncFromPrimary
      const result = await secondarySyncFromPrimary({
        serviceRegistry: serviceRegistryMock,
        wallet: userWallets[0],
        creatorNodeEndpoint: TEST_ENDPOINT
      })

      assert.deepStrictEqual(result, {
        result: 'success'
      })

      const newCNodeUserUUID = await verifyLocalCNodeUserStateForUser(
        exportedCnodeUser
      )

      await verifyLocalStateForUser({
        cnodeUserUUID: newCNodeUserUUID,
        exportedAudiusUsers,
        exportedClockRecords,
        exportedFiles,
        exportedTracks
      })
    })

    it('Syncs correctly when cnodeUser data already exists locally', async function () {
      const {
        sampleExport,
        cnodeUser: exportedCnodeUser,
        audiusUsers: exportedAudiusUsers,
        tracks: exportedTracks,
        files: exportedFiles,
        clockRecords: exportedClockRecords
      } = unpackSampleExportData(sampleExportDummyCIDFromClock2Path)

      setupMocks(sampleExport)

      // Confirm local user state is empty before sync
      const initialCNodeUserCount = await models.CNodeUser.count()
      assert.strictEqual(initialCNodeUserCount, 0)

      // seed user state locally with different cnodeUserUUID
      const cnodeUserUUID = await createUser()

      // Confirm local user state exists before sync
      const localCNodeUserCount = await models.CNodeUser.count({
        where: { cnodeUserUUID }
      })
      assert.strictEqual(localCNodeUserCount, 1)

      // Call secondarySyncFromPrimary
      const result = await secondarySyncFromPrimary({
        serviceRegistry: serviceRegistryMock,
        wallet: userWallets[0],
        creatorNodeEndpoint: TEST_ENDPOINT
      })

      assert.deepStrictEqual(result, {
        result: 'success'
      })

      await verifyLocalCNodeUserStateForUser(exportedCnodeUser)

      await verifyLocalStateForUser({
        cnodeUserUUID,
        exportedAudiusUsers,
        exportedClockRecords,
        exportedFiles,
        exportedTracks
      })
    })

    it('Syncs correctly when cnodeUser data already exists locally with `forceResync` = true', async () => {
      const {
        sampleExport,
        cnodeUser: exportedCnodeUser,
        audiusUsers: exportedAudiusUsers,
        tracks: exportedTracks,
        files: exportedFiles,
        clockRecords: exportedClockRecords
      } = unpackSampleExportData(sampleExportDummyCIDPath)

      setupMocks(sampleExport)

      // Confirm local user state is empty before sync
      const initialCNodeUserCount = await models.CNodeUser.count()
      assert.strictEqual(initialCNodeUserCount, 0)

      // seed local user state with different cnodeUserUUID
      const cnodeUserUUID = await createUser()

      // Confirm local user state exists before sync
      const localCNodeUserCount = await models.CNodeUser.count({
        where: { cnodeUserUUID }
      })
      assert.strictEqual(localCNodeUserCount, 1)

      // Call secondarySyncFromPrimary with `forceResync` = true
      const secondarySyncFromPrimary = proxyquire(
        '../src/services/sync/secondarySyncFromPrimary',
        {
          './secondarySyncFromPrimaryUtils': {
            shouldForceResync: async () => {
              return true
            }
          }
        }
      )

      const result = await secondarySyncFromPrimary({
        serviceRegistry: serviceRegistryMock,
        wallet: userWallets[0],
        creatorNodeEndpoint: TEST_ENDPOINT,
        blockNumber: null
      })

      assert.deepStrictEqual(result, {
        result: 'success'
      })

      const newCNodeUserUUID = await verifyLocalCNodeUserStateForUser(
        exportedCnodeUser
      )

      await verifyLocalStateForUser({
        cnodeUserUUID: newCNodeUserUUID,
        exportedAudiusUsers,
        exportedClockRecords,
        exportedFiles,
        exportedTracks
      })
    })

    it('Syncs correctly from clean user state, even when content is unavailable, by skipping files', async function () {
      const {
        sampleExport,
        cnodeUser: exportedCnodeUser,
        audiusUsers: exportedAudiusUsers,
        tracks: exportedTracks,
        files: exportedFiles,
        clockRecords: exportedClockRecords
      } = unpackSampleExportData(sampleExportDummyCIDPath)

      setupMocks(sampleExport, false)

      // Mock the number of retries to 1 to speed up test
      const secondarySyncFromPrimaryMock = proxyquire(
        '../src/services/sync/secondarySyncFromPrimary',
        {
          '../../fileManager': {
            saveFileForMultihashToFS: async function (
              libs,
              logger,
              multihash,
              expectedStoragePath,
              targetGateways,
              fileNameForImage = null,
              trackId = null
            ) {
              console.log('I AM MOCKED')
              return saveFileForMultihashToFS(
                libs,
                logger,
                multihash,
                expectedStoragePath,
                targetGateways,
                fileNameForImage,
                trackId,
                1 /* numRetries */
              )
            }
          }
        }
      )

      // TODO: need to make numRetries like 2 or 1

      // Confirm local user state is empty before sync
      const initialCNodeUserCount = await models.CNodeUser.count()
      assert.strictEqual(initialCNodeUserCount, 0)

      // Ensure secondarySyncFromPrimary() succeeds after threshold reached
      const result = await secondarySyncFromPrimaryMock({
        serviceRegistry: serviceRegistryMock,
        wallet: userWallets[0],
        creatorNodeEndpoint: TEST_ENDPOINT
      })

      assert.deepStrictEqual(result, {
        result: 'success'
      })

      const newCNodeUserUUID = await verifyLocalCNodeUserStateForUser(
        exportedCnodeUser
      )

      // Update files with skipped = true
      const skippedExportedFiles = exportedFiles.map((file) => ({
        ...file,
        skipped: true
      }))

      await verifyLocalStateForUser({
        cnodeUserUUID: newCNodeUserUUID,
        exportedAudiusUsers,
        exportedClockRecords,
        exportedFiles: skippedExportedFiles,
        exportedTracks
      })
    })
  })
})

describe.only('Test primarySyncFromSecondary() with mocked export', async () => {
  let server, app, serviceRegistryMock, primarySyncFromSecondaryStub

  const NODES = {
    CN1: 'http://mock-cn1.audius.co',
    CN2: 'http://mock-cn2.audius.co',
    CN3: 'http://mock-cn3.audius.co'
  }
  const NODES_LIST = Object.values(NODES)
  const SELF = NODES.CN1
  const SECONDARY = NODES.CN3
  const USER_1_ID = 1
  const SP_ID_1 = 1
  const USER_1_WALLET = DUMMY_WALLET
  const USER_1_BLOCKNUMBER = DUMMY_CNODEUSER_BLOCKNUMBER
  const SyncRequestMaxUserFailureCountBeforeSkip = 3

  const assetsDirPath = path.resolve(__dirname, 'sync/assets')
  const exportFilePath = path.resolve(assetsDirPath, 'realExport.json')

  const unpackExportDataFromFile = (exportDataFilePath) => {
    const exportObj = JSON.parse(fs.readFileSync(exportDataFilePath))
    const cnodeUserInfo = Object.values(exportObj.data.cnodeUsers)[0]
    const cnodeUser = _.omit(cnodeUserInfo, [
      'audiusUsers',
      'tracks',
      'files',
      'clockRecords',
      'clockInfo'
    ])
    const { audiusUsers, tracks, files, clockRecords, clockInfo } =
      cnodeUserInfo

    return {
      exportObj,
      cnodeUser,
      audiusUsers,
      tracks,
      files,
      clockRecords,
      clockInfo
    }
  }

  /**
   * Sets `/export` route response from `endpoint` to `exportData`
   */
  const setupExportMock = (endpoint, exportData) => {
    nock(endpoint)
      .persist()
      .get((uri) => uri.includes('/export'))
      .reply(200, exportData)
  }

  const computeFilePathForCID = (CID) => {
    const directoryID = CID.slice(-4, -1) // sharded file system
    const parentDirPath = path.join(assetsDirPath, 'files', directoryID)
    const filePath = path.join(parentDirPath, CID)
    return filePath
  }

  /**
   * Sets `/ipfs` route responses for DUMMY_CID from all nodes to DUMMY_CID_DATA
   */
  const setupIPFSRouteMocks = (contentIsAvailable = true) => {
    NODES_LIST.forEach((node) => {
      nock(node)
        .persist()
        .get((uri) => uri.includes('/ipfs'))
        .reply((uri, requestBody) => {
          if (contentIsAvailable) {
            const CID = uri.split('/ipfs/')[1].slice(0, 46)
            const CIDFilePath = computeFilePathForCID(CID)
            const fileBuffer = fs.readFileSync(CIDFilePath)
            return [200, fileBuffer]
          } else {
            return [404, 'bad']
          }
        })
    })
  }

  const fetchDBStateForWallet = async (walletPublicKey) => {
    const response = {
      cnodeUser: null,
      audiusUsers: null,
      tracks: null,
      files: null,
      clockRecords: null
    }

    const cnodeUser = stringifiedDateFields(
      await models.CNodeUser.findOne({
        where: {
          walletPublicKey
        },
        raw: true
      })
    )

    if (!cnodeUser || Object.keys(cnodeUser).length === 0) {
      return response
    } else {
      response.cnodeUser = cnodeUser
    }

    const cnodeUserUUID = cnodeUser.cnodeUserUUID

    const audiusUsers = (
      await models.AudiusUser.findAll({
        where: { cnodeUserUUID },
        raw: true
      })
    ).map(stringifiedDateFields)
    response.audiusUsers = audiusUsers

    const tracks = (
      await models.Track.findAll({
        where: { cnodeUserUUID },
        raw: true
      })
    ).map(stringifiedDateFields)
    response.tracks = tracks

    const files = (
      await models.File.findAll({
        where: { cnodeUserUUID },
        raw: true
      })
    ).map(stringifiedDateFields)
    response.files = files

    const clockRecords = (
      await models.ClockRecord.findAll({
        where: { cnodeUserUUID },
        raw: true
      })
    ).map(stringifiedDateFields)
    response.clockRecords = clockRecords

    return response
  }

  const comparisonOmittedFields = ['cnodeUserUUID', 'createdAt', 'updatedAt']

  const assertTableEquality = (tableA, tableB, comparisonOmittedFields) => {
    assert.deepStrictEqual(
      _.orderBy(
        tableA.map((entry) => _.omit(entry, comparisonOmittedFields)),
        ['clock'],
        ['asc']
      ),
      _.orderBy(
        tableB.map((entry) => _.omit(entry, comparisonOmittedFields)),
        ['clock'],
        ['asc']
      )
    )
  }

  const assertFullUserStateEquality = async (wallet, exportedUserData) => {
    const {
      cnodeUser: localCNodeUser,
      audiusUsers: localAudiusUsers,
      tracks: localTracks,
      files: localFiles,
      clockRecords: localClockRecords
    } = await fetchDBStateForWallet(wallet)

    const {
      exportedCnodeUser,
      exportedAudiusUsers,
      exportedTracks,
      exportedFiles,
      exportedClockRecords
    } = exportedUserData

    assert.deepStrictEqual(
      _.omit(localCNodeUser, comparisonOmittedFields),
      _.omit(exportedCnodeUser, comparisonOmittedFields)
    )

    assertTableEquality(
      localAudiusUsers,
      exportedAudiusUsers,
      comparisonOmittedFields
    )

    assertTableEquality(localTracks, exportedTracks, comparisonOmittedFields)

    assertTableEquality(localFiles, exportedFiles, comparisonOmittedFields)

    assertTableEquality(
      localClockRecords,
      exportedClockRecords,
      comparisonOmittedFields
    )
  }

  /**
   * Create local user with CNodeUser, AudiusUser, File, and ClockRecord state
   * @returns cnodeUserUUID
   */
  const createUser = async (userId, userWallet, blockNumber) => {
    // Create CNodeUser
    const session = await createStarterCNodeUser(userId, userWallet)

    // Upload user metadata
    const metadata = {
      metadata: {
        testField: 'testValue'
      }
    }
    const userMetadataResp = await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', session.sessionToken)
      .set('User-Id', session.userId)
      .set('Enforce-Write-Quorum', false)
      .send(metadata)
      .expect(200)

    const metadataFileUUID = userMetadataResp.body.data.metadataFileUUID

    // Make chain recognize current session wallet as the wallet for the session user ID
    const blockchainUserId = 1
    const getUserStub = sinon.stub().callsFake((blockchainUserIdArg) => {
      let wallet = 'no wallet'
      if (blockchainUserIdArg === blockchainUserId) {
        wallet = session.walletPublicKey
      }
      return {
        wallet
      }
    })
    libsMock.contracts.UserFactoryClient = { getUser: getUserStub }

    // Associate user with with blockchain ID
    const associateRequest = {
      blockchainUserId: userId,
      metadataFileUUID,
      blockNumber
    }
    await request(app)
      .post('/audius_users')
      .set('X-Session-ID', session.sessionToken)
      .set('User-Id', session.userId)
      .set('Enforce-Write-Quorum', false)
      .send(associateRequest)
      .expect(200)

    return session.cnodeUserUUID
  }

  /** Upload new metadata for user */
  const updateUser = async (userId, cnodeUserUUID) => {
    const sessionToken = await sessionManager.createSession(cnodeUserUUID)

    // Upload user metadata
    const metadata = {
      metadata: {
        testField: 'testValue2'
      }
    }
    await request(app)
      .post('/audius_users/metadata')
      .set('X-Session-ID', sessionToken)
      .set('User-Id', userId)
      .set('Enforce-Write-Quorum', false)
      .send(metadata)
      .expect(200)
  }

  /**
   * Reset nocks, DB, redis, file storage
   * Setup mocks, deps
   */
  beforeEach(async function () {
    nock.cleanAll()

    await destroyUsers()

    await redisClient.flushdb()

    // Clear storagePath
    const storagePath = config.get('storagePath')
    const absoluteStoragePath = path.resolve(storagePath)
    await fs.emptyDir(path.resolve(absoluteStoragePath))

    // Start server
    const appInfo = await getApp(libsMock, BlacklistManager, null, SP_ID_1)
    server = appInfo.server
    app = appInfo.app

    config.set(
      'syncRequestMaxUserFailureCountBeforeSkip',
      SyncRequestMaxUserFailureCountBeforeSkip
    )

    // Define mocks

    serviceRegistryMock = getServiceRegistryMock(libsMock, BlacklistManager)

    primarySyncFromSecondaryStub = proxyquire(
      '../src/services/sync/primarySyncFromSecondary',
      {
        '../../serviceRegistry': { serviceRegistry: serviceRegistryMock },
        '../initAudiusLibs': async () => libsMock,
        './../../config': config
      }
    )
  })

  // close server
  afterEach(async function () {
    await server.close()
  })

  it('Primary correctly syncs from secondary when primary has no state', async function () {
    const {
      exportObj,
      cnodeUser: exportedCnodeUser,
      audiusUsers: exportedAudiusUsers,
      tracks: exportedTracks,
      files: exportedFiles,
      clockRecords: exportedClockRecords
    } = unpackExportDataFromFile(exportFilePath)

    setupExportMock(SECONDARY, exportObj)
    setupIPFSRouteMocks()

    // Confirm local user state is empty before sync
    const { cnodeUser: initialLocalCNodeUser } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(initialLocalCNodeUser, null)

    const error = await primarySyncFromSecondaryStub({
      secondary: SECONDARY,
      wallet: USER_1_WALLET,
      selfEndpoint: SELF
    })
    assert.deepStrictEqual(error, undefined)

    /**
     * Verify DB state after sync
     */
    const exportedUserData = {
      exportedCnodeUser,
      exportedAudiusUsers,
      exportedTracks,
      exportedFiles,
      exportedClockRecords
    }
    await assertFullUserStateEquality(USER_1_WALLET, exportedUserData)
  })

  it('Primary correctly syncs from secondary when nodes have divergent state', async function () {
    const {
      exportObj,
      cnodeUser: exportedCnodeUser,
      audiusUsers: exportedAudiusUsers,
      tracks: exportedTracks,
      files: exportedFiles,
      clockRecords: exportedClockRecords
    } = unpackExportDataFromFile(exportFilePath)

    setupExportMock(SECONDARY, exportObj)
    setupIPFSRouteMocks()

    // Confirm local user state is empty initially
    const { cnodeUser: initialLocalCNodeUser } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(initialLocalCNodeUser, null)

    // Add some local user state
    await createUser(USER_1_ID, USER_1_WALLET, USER_1_BLOCKNUMBER)

    /**
     * Confirm local user state is non-empty before sync
     */

    const {
      cnodeUser: localInitialCNodeUser,
      audiusUsers: localInitialAudiusUsers,
      tracks: localInitialTracks,
      files: localInitialFiles,
      clockRecords: localInitialClockRecords
    } = await fetchDBStateForWallet(USER_1_WALLET)

    assert.deepStrictEqual(
      _.omit(localInitialCNodeUser, comparisonOmittedFields),
      {
        walletPublicKey: USER_1_WALLET,
        clock: 2,
        latestBlockNumber: USER_1_BLOCKNUMBER,
        lastLogin: null
      }
    )

    assertTableEquality(localInitialAudiusUsers, exportedAudiusUsers, [
      ...comparisonOmittedFields,
      'metadataFileUUID'
    ])

    assertTableEquality(localInitialTracks, [], comparisonOmittedFields)

    assertTableEquality(
      localInitialFiles,
      _.orderBy(exportedFiles, ['clock', 'asc']).slice(0, 1),
      [...comparisonOmittedFields, 'fileUUID']
    )

    assertTableEquality(
      localInitialClockRecords,
      _.orderBy(exportedClockRecords, ['clock', 'asc']).slice(0, 2),
      comparisonOmittedFields
    )

    const error = await primarySyncFromSecondaryStub({
      serviceRegistry: serviceRegistryMock,
      secondary: SECONDARY,
      wallet: USER_1_WALLET,
      sourceEndpoint: SELF
    })
    assert.deepStrictEqual(error, undefined)

    /**
     * Verify DB state after sync
     */

    const {
      cnodeUser: localFinalCNodeUser,
      audiusUsers: localFinalAudiusUsers,
      tracks: localFinalTracks,
      files: localFinalFiles,
      clockRecords: localFinalClockRecords
    } = await fetchDBStateForWallet(USER_1_WALLET)

    assert.deepStrictEqual(
      _.omit(localFinalCNodeUser, comparisonOmittedFields),
      _.omit(
        { ...exportedCnodeUser, clock: exportedCnodeUser.clock + 2 },
        comparisonOmittedFields
      )
    )

    assertTableEquality(
      localFinalAudiusUsers,
      _.concat(
        localInitialAudiusUsers,
        exportedAudiusUsers.map((audiusUser) => ({
          ...audiusUser,
          clock: audiusUser.clock + 2
        }))
      ),
      comparisonOmittedFields
    )

    assertTableEquality(localFinalTracks, exportedTracks, [
      ...comparisonOmittedFields,
      'clock'
    ])

    assertTableEquality(
      localFinalFiles,
      _.concat(
        localInitialFiles,
        exportedFiles.map((file) => ({ ...file, clock: file.clock + 2 }))
      ),
      comparisonOmittedFields
    )

    assertTableEquality(
      localFinalClockRecords,
      _.concat(
        localInitialClockRecords,
        exportedClockRecords.map((clockRecord) => ({
          ...clockRecord,
          clock: clockRecord.clock + 2
        }))
      ),
      comparisonOmittedFields
    )
  })

  it('Primary correctly syncs from secondary when primary has subset of secondary state', async function () {
    const {
      exportObj,
      cnodeUser: exportedCnodeUser,
      audiusUsers: exportedAudiusUsers,
      tracks: exportedTracks,
      files: exportedFiles,
      clockRecords: exportedClockRecords
    } = unpackExportDataFromFile(exportFilePath)

    setupExportMock(SECONDARY, exportObj)
    setupIPFSRouteMocks()

    /**
     * Confirm local user state is empty before sync
     */
    const { cnodeUser: localCNodeUserInitial } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(localCNodeUserInitial, null)

    /**
     * Write first few records to local DB before syncing
     */
    const audiusUsersSubset = _.orderBy(
      exportedAudiusUsers,
      ['clock'],
      ['asc']
    ).slice(0, 1)
    const filesSubset = _.orderBy(exportedFiles, ['clock'], ['asc']).slice(0, 1)
    const clockRecordsSubSet = _.orderBy(
      exportedClockRecords,
      ['clock'],
      ['asc']
    ).slice(0, 2)

    const transaction = await models.sequelize.transaction()
    await models.CNodeUser.create(
      { ...exportedCnodeUser, clock: 2 },
      { transaction }
    )
    await models.ClockRecord.bulkCreate(clockRecordsSubSet, { transaction })
    await models.File.bulkCreate(filesSubset, { transaction })
    await models.AudiusUser.bulkCreate(audiusUsersSubset, { transaction })
    await transaction.commit()

    /**
     * Confirm user state has updated
     */
    const { cnodeUser: localCNodeUserAfterWrite } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(localCNodeUserAfterWrite.clock, 2)

    /**
     * Sync primary from secondary
     */
    const error = await primarySyncFromSecondaryStub({
      serviceRegistry: serviceRegistryMock,
      secondary: SECONDARY,
      wallet: USER_1_WALLET,
      sourceEndpoint: SELF
    })
    assert.deepStrictEqual(error, undefined)

    /**
     * Verify DB state after sync
     */
    const exportedUserData = {
      exportedCnodeUser,
      exportedAudiusUsers,
      exportedTracks,
      exportedFiles,
      exportedClockRecords
    }
    await assertFullUserStateEquality(USER_1_WALLET, exportedUserData)
  })

  it('Primary correctly syncs from secondary when both have same data', async function () {
    const {
      exportObj,
      cnodeUser: exportedCnodeUser,
      audiusUsers: exportedAudiusUsers,
      tracks: exportedTracks,
      files: exportedFiles,
      clockRecords: exportedClockRecords
    } = unpackExportDataFromFile(exportFilePath)

    setupExportMock(SECONDARY, exportObj)
    setupIPFSRouteMocks()

    /**
     * Confirm local user state is empty before sync
     */
    const { cnodeUser: localCNodeUserInitial } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(localCNodeUserInitial, null)

    /**
     * Write all secondary state to primary
     */
    const exportedNonTrackFiles = exportedFiles.filter((file) =>
      models.File.NonTrackTypes.includes(file.type)
    )
    const exportedTrackFiles = exportedFiles.filter((file) =>
      models.File.TrackTypes.includes(file.type)
    )
    const transaction = await models.sequelize.transaction()
    await models.CNodeUser.create({ ...exportedCnodeUser }, { transaction })
    await models.ClockRecord.bulkCreate(exportedClockRecords, { transaction })
    await models.File.bulkCreate(exportedNonTrackFiles, { transaction })
    await models.AudiusUser.bulkCreate(exportedAudiusUsers, { transaction })
    await models.File.bulkCreate(exportedTrackFiles, { transaction })
    await models.Track.bulkCreate(exportedTracks, { transaction })
    await transaction.commit()

    /**
     * Confirm user state has updated
     */
    const { cnodeUser: localCNodeUserAfterWrite } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(
      localCNodeUserAfterWrite.clock,
      exportedCnodeUser.clock
    )

    /**
     * Sync primary from secondary
     */
    const error = await primarySyncFromSecondaryStub({
      serviceRegistry: serviceRegistryMock,
      secondary: SECONDARY,
      wallet: USER_1_WALLET
    })
    assert.deepStrictEqual(error, undefined)

    /**
     * Verify DB state after sync
     */
    const exportedUserData = {
      exportedCnodeUser,
      exportedAudiusUsers,
      exportedTracks,
      exportedFiles,
      exportedClockRecords
    }
    await assertFullUserStateEquality(USER_1_WALLET, exportedUserData)
  })

  it('Primary correctly syncs from secondary when primary has superset of secondary state', async function () {
    const {
      exportObj,
      cnodeUser: exportedCnodeUser,
      audiusUsers: exportedAudiusUsers,
      tracks: exportedTracks,
      files: exportedFiles,
      clockRecords: exportedClockRecords
    } = unpackExportDataFromFile(exportFilePath)

    setupExportMock(SECONDARY, exportObj)
    setupIPFSRouteMocks()

    /**
     * Confirm local user state is empty initially
     */
    const { cnodeUser: localCNodeUserInitial } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(localCNodeUserInitial, null)

    /**
     * Write all secondary state to primary
     */
    const exportedNonTrackFiles = exportedFiles.filter((file) =>
      models.File.NonTrackTypes.includes(file.type)
    )
    const exportedTrackFiles = exportedFiles.filter((file) =>
      models.File.TrackTypes.includes(file.type)
    )
    const transaction = await models.sequelize.transaction()
    const cnodeUser = await models.CNodeUser.create(exportedCnodeUser, {
      returning: true,
      transaction
    })
    await models.ClockRecord.bulkCreate(exportedClockRecords, { transaction })
    await models.File.bulkCreate(exportedNonTrackFiles, { transaction })
    await models.AudiusUser.bulkCreate(exportedAudiusUsers, { transaction })
    await models.File.bulkCreate(exportedTrackFiles, { transaction })
    await models.Track.bulkCreate(exportedTracks, { transaction })
    await transaction.commit()

    /**
     * Confirm user state has updated
     */
    const { cnodeUser: localCNodeUserAfterWrite } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(
      localCNodeUserAfterWrite.clock,
      exportedCnodeUser.clock
    )

    // Add some more local user state
    await updateUser(USER_1_ID, cnodeUser.cnodeUserUUID)
    const additionalClockRecords = 1

    /**
     * Confirm user state has updated
     */
    const { cnodeUser: localCNodeUserAfterCreateUser } =
      await fetchDBStateForWallet(USER_1_WALLET)
    assert.deepStrictEqual(
      localCNodeUserAfterCreateUser.clock,
      exportedCnodeUser.clock + additionalClockRecords
    )

    const {
      cnodeUser: localInitialCNodeUser,
      audiusUsers: localInitialAudiusUsers,
      tracks: localInitialTracks,
      files: localInitialFiles,
      clockRecords: localInitialClockRecords
    } = await fetchDBStateForWallet(USER_1_WALLET)

    /**
     * Sync primary from secondary
     */
    const error = await primarySyncFromSecondaryStub({
      serviceRegistry: serviceRegistryMock,
      secondary: SECONDARY,
      wallet: USER_1_WALLET
    })
    assert.deepStrictEqual(error, undefined)

    /**
     * Verify DB state after sync is identical to DB state before sync !!!
     */

    const {
      cnodeUser: localFinalCNodeUser,
      audiusUsers: localFinalAudiusUsers,
      tracks: localFinalTracks,
      files: localFinalFiles,
      clockRecords: localFinalClockRecords
    } = await fetchDBStateForWallet(USER_1_WALLET)

    assert.deepStrictEqual(localFinalCNodeUser, localInitialCNodeUser)

    assertTableEquality(localFinalAudiusUsers, localInitialAudiusUsers, [])

    assertTableEquality(localFinalTracks, localInitialTracks, [])

    assertTableEquality(localFinalFiles, localInitialFiles, [])

    assertTableEquality(localFinalClockRecords, localInitialClockRecords, [])
  })

  it('Primary correctly syncs from secondary when nodes have divergent state and content is unavailable in network', async function () {
    const {
      exportObj,
      cnodeUser: exportedCnodeUser,
      audiusUsers: exportedAudiusUsers,
      tracks: exportedTracks,
      files: exportedFiles,
      clockRecords: exportedClockRecords
    } = unpackExportDataFromFile(exportFilePath)

    const numUniqueCIDs = new Set(exportedFiles.map((file) => file.multihash))
      .size

    setupExportMock(SECONDARY, exportObj)
    setupIPFSRouteMocks(false)

    // Confirm local user state is empty before sync
    const { cnodeUser: initialLocalCNodeUser } = await fetchDBStateForWallet(
      USER_1_WALLET
    )
    assert.deepStrictEqual(initialLocalCNodeUser, null)

    // Ensure primarySyncFromSecondary() fails until SyncRequestMaxUserFailureCountBeforeSkip reached
    for (let i = 1; i < SyncRequestMaxUserFailureCountBeforeSkip; i++) {
      const error = await primarySyncFromSecondaryStub({
        secondary: SECONDARY,
        wallet: USER_1_WALLET,
        selfEndpoint: SELF
      })
      assert.deepStrictEqual(
        error.message,
        `[saveFilesToDisk] Failed to save ${numUniqueCIDs} files to disk. Cannot proceed because UserSyncFailureCount = ${i} below SyncRequestMaxUserFailureCountBeforeSkip = ${SyncRequestMaxUserFailureCountBeforeSkip}.`
      )
    }

    const error = await primarySyncFromSecondaryStub({
      secondary: SECONDARY,
      wallet: USER_1_WALLET,
      selfEndpoint: SELF
    })
    assert.deepStrictEqual(error, undefined)

    /**
     * Verify DB state after sync
     */
    const skippedExportedFiles = exportedFiles.map((file) => ({
      ...file,
      skipped: true
    }))
    const exportedUserData = {
      exportedCnodeUser,
      exportedAudiusUsers,
      exportedTracks,
      exportedFiles: skippedExportedFiles,
      exportedClockRecords
    }
    await assertFullUserStateEquality(USER_1_WALLET, exportedUserData)
  })
})
