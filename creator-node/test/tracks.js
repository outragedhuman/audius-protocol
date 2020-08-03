const request = require('supertest')
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const sinon = require('sinon')

const config = require('../src/config')
const defaultConfig = require('../default-config.json')

const blacklistManager = require('../src/blacklistManager')
const TranscodingQueue = require('../src/TranscodingQueue')

const { getApp } = require('./lib/app')
const { createStarterCNodeUser } = require('./lib/dataSeeds')
const { getIPFSMock } = require('./lib/ipfsMock')
const { getLibsMock } = require('./lib/libsMock')

const testAudioFilePath = path.resolve(__dirname, 'testTrack.mp3')
const testAudioFileWrongFormatPath = path.resolve(__dirname, 'testTrackWrongFormat.jpg')

describe('test Tracks', function () {
  let app, server, session, ipfsMock, libsMock

  beforeEach(async () => {
    ipfsMock = getIPFSMock()
    libsMock = getLibsMock()

    const appInfo = await getApp(ipfsMock, libsMock, blacklistManager)
    await blacklistManager.blacklist(ipfsMock)

    app = appInfo.app
    server = appInfo.server
    session = await createStarterCNodeUser()
  })

  afterEach(async () => {
    sinon.restore()
    await server.close()
  })

  it('fails to upload when format is not accepted', async function () {
    const file = fs.readFileSync(testAudioFileWrongFormatPath)

    await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.jpg' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(400)
  })

  it('fails to upload when maxAudioFileSizeBytes exceeded', async function () {
    // Configure extremely small file size
    process.env.maxAudioFileSizeBytes = 10

    // Reset app
    await server.close()

    ipfsMock = getIPFSMock()
    const appInfo = await getApp(ipfsMock)
    app = appInfo.app
    server = appInfo.server
    session = await createStarterCNodeUser()

    ipfsMock.add.exactly(64)
    ipfsMock.pin.add.exactly(32)

    // Confirm max audio file size is respected by multer
    let file = fs.readFileSync(testAudioFilePath)
    await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(500)

    // Reset max file limits
    process.env.maxAudioFileSizeBytes = defaultConfig['maxAudioFileSizeBytes']
    await server.close()
  })

  it('fails to upload when maxMemoryFileSizeBytes exceeded', async function () {
    // Configure extremely small file size
    process.env.maxMemoryFileSizeBytes = 10

    // Reset app
    await server.close()
    ipfsMock = getIPFSMock()
    const appInfo = await getApp(ipfsMock)
    app = appInfo.app
    server = appInfo.server
    session = await createStarterCNodeUser()

    ipfsMock.add.exactly(64)
    ipfsMock.pin.add.exactly(32)

    // Confirm max audio file size is respected by multer
    let file = fs.readFileSync(testAudioFileWrongFormatPath)
    await request(app)
      .post('/image_upload')
      .attach('file', file, { filename: 'fname.jpg' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(500)

    // Reset max file limits
    process.env.maxMemoryFileSizeBytes = defaultConfig['maxMemoryFileSizeBytes']
    await server.close()
  })

  it('uploads file to IPFS', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(33)
    ipfsMock.pin.add.exactly(33)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)
    assert.deepStrictEqual(resp1.body.transcodedTrackCID, 'testCIDLink')
    assert.deepStrictEqual(typeof resp1.body.transcodedTrackUUID, 'string')
  })

  // depends on "upload file to IPFS"
  it('creates Audius track', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(2)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)

    // creates Audius track
    const metadata = {
      test: 'field1',
      owner_id: 1,
      track_segments: [{ 'multihash': 'testCIDLink', 'duration': 1000 }]
    }

    const resp2 = await request(app)
      .post('/tracks/metadata')
      .set('X-Session-ID', session)
      .send({ metadata, sourceFile: resp1.body.source_file })
      .expect(200)

    assert.deepStrictEqual(resp2.body.metadataMultihash, 'testCIDLink')
  })

  // depends on "upload file to IPFS"
  it('fails to create Audius track when segments not provided', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(2)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)

    // creates Audius track
    const metadata = {
      test: 'field1',
      owner_id: 1
    }

    await request(app)
      .post('/tracks/metadata')
      .set('X-Session-ID', session)
      .send({ metadata, sourceFile: resp1.body.source_file })
      .expect(400)
  })

  // depends on "upload file to IPFS"
  it('fails to create Audius track when invalid segment multihashes are provided', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(2)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)

    // creates Audius track
    const metadata = {
      test: 'field1',
      track_segments: [{ 'multihash': 'incorrectCIDLink', 'duration': 1000 }],
      owner_id: 1
    }

    await request(app)
      .post('/tracks')
      .set('X-Session-ID', session)
      .send({ metadata, sourceFile: resp1.body.source_file })
      .expect(400)
  })

  // depends on "upload file to IPFS"
  it('fails to create Audius track when owner_id is not provided', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(2)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)

    // creates Audius track
    const metadata = {
      test: 'field1',
      track_segments: [{ 'multihash': 'testCIDLink', 'duration': 1000 }]
    }

    await request(app)
      .post('/tracks')
      .set('X-Session-ID', session)
      .send({ metadata, sourceFile: resp1.body.source_file })
      .expect(400)
  })

  // depends on "upload file to IPFS" and "creates Audius user" tests
  it('completes Audius track creation', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(4)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)

    const metadata = {
      test: 'field1',
      track_segments: [{ 'multihash': 'testCIDLink', 'duration': 1000 }],
      owner_id: 1
    }

    const resp2 = await request(app)
      .post('/tracks/metadata')
      .set('X-Session-ID', session)
      .send({ metadata, sourceFile: resp1.body.source_file })
      .expect(200)

    if (resp2.body.metadataMultihash !== 'testCIDLink') {
      throw new Error('invalid return data')
    }

    await request(app)
      .post('/tracks')
      .set('X-Session-ID', session)
      .send({ blockchainTrackId: 1, blockNumber: 10, metadataFileUUID: resp2.body.metadataFileUUID })
      .expect(200)
  })

  // depends on "upload file to IPFS"
  it('fails to create downloadable track with no track_id and no source_id present', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(2)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)

    // creates a downloadable Audius track with no track_id and no source_file
    const metadata = {
      test: 'field1',
      owner_id: 1,
      track_segments: [{ 'multihash': 'testCIDLink', 'duration': 1000 }],
      download: {
        is_downloadable: true,
        requires_follow: false
      }
    }

    await request(app)
      .post('/tracks/metadata')
      .set('X-Session-ID', session)
      .send({ metadata })
      .expect(400)
  })

  // depends on "upload file to IPFS" and "creates Audius user" tests
  it('creates a downloadable track', async function () {
    const file = fs.readFileSync(testAudioFilePath)

    ipfsMock.addFromFs.exactly(34)
    ipfsMock.pin.add.exactly(34)
    libsMock.User.getUsers.exactly(4)

    const resp1 = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    assert.deepStrictEqual(resp1.body.track_segments[0].multihash, 'testCIDLink')
    assert.deepStrictEqual(resp1.body.track_segments.length, 32)
    assert.deepStrictEqual(resp1.body.source_file.includes('.mp3'), true)

    // needs debugging as to why this 'cid' key is needed for test to work
    const metadata = {
      test: 'field1',
      track_segments: [{ 'multihash': 'testCIDLink', 'duration': 1000 }],
      owner_id: 1,
      download: {
        'is_downloadable': true,
        'requires_follow': false,
        'cid': 'testCIDLink'
      }
    }

    const resp2 = await request(app)
      .post('/tracks/metadata')
      .set('X-Session-ID', session)
      .send({ metadata, sourceFile: resp1.body.source_file })
      .expect(200)

    if (resp2.body.metadataMultihash !== 'testCIDLink') {
      throw new Error('invalid return data')
    }

    await request(app)
      .post('/tracks')
      .set('X-Session-ID', session)
      .send({ blockchainTrackId: 1, blockNumber: 10, metadataFileUUID: resp2.body.metadataFileUUID })
      .expect(200)
  })
})

describe('test /track_content with actual ipfsClient', function () {
  let app, server, session, ipfs, libsMock

  beforeEach(async () => {
    ipfs = require('../src/ipfsClient').ipfs
    libsMock = getLibsMock()

    const appInfo = await getApp(ipfs, libsMock, blacklistManager)
    await blacklistManager.blacklist(ipfs)

    app = appInfo.app
    server = appInfo.server
    session = await createStarterCNodeUser()
  })

  afterEach(async () => {
    sinon.restore()
    await server.close()
  })

  it('sends server error response if segmenting fails', async function () {
    const file = fs.readFileSync(testAudioFilePath)
    sinon.stub(TranscodingQueue, 'segment').rejects(new Error('failed to segment'))

    await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(500)
  })

  it('sends server error response if transcoding fails', async function () {
    const file = fs.readFileSync(testAudioFilePath)
    sinon.stub(TranscodingQueue, 'transcode320').rejects(new Error('failed to transcode'))

    await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(500)
  })

  it('should upload 32 segments and 1 320kbps copy to storagePath', async function () {
    const file = fs.readFileSync(testAudioFilePath)
    libsMock.User.getUsers.exactly(4)

    const resp = await request(app)
      .post('/track_content')
      .attach('file', file, { filename: 'fname.mp3' })
      .set('Content-Type', 'multipart/form-data')
      .set('X-Session-ID', session)
      .expect(200)

    let storagePath = config.get('storagePath')
    storagePath = storagePath.slice(0, 1) === '/' ? '.' + storagePath : storagePath

    // check if track UUID dir exists
    const originalTrackUUID = resp.body.source_file.split('.').slice(0, -1).join('.') // remove extension
    const originalTrackUUIDPath = path.join(storagePath, originalTrackUUID)
    assert.ok(fs.existsSync(originalTrackUUIDPath))

    // check that the track UUID dir contains the transcoded copy
    const transcodedTrackPath = path.join(originalTrackUUIDPath, originalTrackUUID + '-dl.mp3')
    assert.ok(fs.existsSync(transcodedTrackPath))

    // check that the generated transcoded track is the same as the transcoded track in /tests
    const transcodedTrackAssetPath = path.join(__dirname, 'testTranscoded320Track.mp3')
    const transcodedTrackAssetBuf = fs.readFileSync(transcodedTrackAssetPath)
    const transcodedTrackTestBuf = fs.readFileSync(transcodedTrackPath)
    assert.deepStrictEqual(transcodedTrackAssetBuf.compare(transcodedTrackTestBuf), 0)

    // check that the track UUID dir contains the source file
    const sourceFile = resp.body.source_file
    const sourceFilePath = path.join(originalTrackUUIDPath, sourceFile)
    assert.ok(fs.existsSync(sourceFilePath))

    // check that there are 32 segments in <uuid>/segments and that they follow
    // the naming convention 'segment<3 digit #>.ts'
    const segmentsPath = path.join(originalTrackUUIDPath, 'segments')
    fs.readdir(segmentsPath, (err, files) => {
      if (err) assert.fail(err.message)
      assert.deepStrictEqual(files.length, 32)

      for (let i = 0; i < 32; i++) {
        const indexSuffix = ('000' + i).slice(-3)
        assert.deepStrictEqual(files[i], `segment${indexSuffix}.ts`)
      }
    })

    // check that there are 32 CIDs that have been added to fs
    const segmentCIDs = resp.body.track_segments
    assert.deepStrictEqual(segmentCIDs.length, 32)
    segmentCIDs.map(cid => {
      const cidPath = path.join(storagePath, cid.multihash)
      assert.ok(fs.existsSync(cidPath))
    })
  })
})
