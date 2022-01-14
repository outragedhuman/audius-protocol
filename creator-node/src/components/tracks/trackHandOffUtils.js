const path = require('path')
const axios = require('axios')
const fs = require('fs')
const fsExtra = require('fs-extra')
const FormData = require('form-data')

const config = require('../../config.js')
const {
  logger: genericLogger,
  logInfoWithDuration,
  getStartTime
} = require('../../logging')
const fileManager = require('../../fileManager')
const Utils = require('../../utils')

const SELF_ENDPOINT = config.get('creatorNodeEndpoint')
const NUMBER_OF_SPS_FOR_HANDOFF_TRACK = 3
const MAX_TRACK_HANDOFF_TIMEOUT_MS = 180000 / 3 // 3min/3

const POLL_STATUS_INTERVAL_MS = 10000 / 10 // 10s/10

async function handOffTrack(libs, req) {
  const logger = genericLogger.child(req.logContext)
  const sps = await selectRandomSPs(libs)

  logger.info({ sps }, 'BANANA selected random sps')

  for (let sp of sps) {
    // hard code cus lazy
    sp = 'http://cn2_creator-node_1:4001'
    try {
      logger.info(`BANANA handing off to sp=${sp}`)

      const { transcodeFilePath, segmentFileNames } = await _handOffTrack({
        sp,
        req
      })

      return { transcodeFilePath, segmentFileNames, sp }
    } catch (e) {
      // delete tmp dir here if fails and continue
      logger.warn(
        `BANANA Could not hand off track to sp=${sp} err=${e.toString()}`
      )
    }
  }

  return {}
}

// If any call fails -> throw error
async function _handOffTrack({ sp, req }) {
  const {
    logContext,
    fileDir,
    fileName,
    fileNameNoExtension,
    uuid: requestID,
    AsyncProcessingQueue
  } = req
  const logger = genericLogger.child(logContext)

  logger.info(
    `the tHINGS fileDir=${fileDir} fileName=${fileName} noExtension=${fileNameNoExtension} uuid for req=${requestID}`
  )
  await fetchHealthCheck(sp)

  const transcodeAndSegmentUUID = await sendTranscodeAndSegmentRequest({
    requestID,
    logger,
    sp,
    fileDir,
    fileName,
    fileNameNoExtension
  })

  // TODO: PROBLEM IS THAT IT'S PASSING IN A NEW UUID SO CAUSING FILE CANNOT BE FOUND.
  logger.info({ sp, requestID }, 'BANANA polling time')
  // const { fileName, transcodeFilePath, segmentFileNames, segmentFileNamesToPath } = await pollProcessingStatus(
  const pollResp = await pollProcessingStatus({
    logger,
    taskType: AsyncProcessingQueue.PROCESS_NAMES.transcodeAndSegment, // ???? why is this an ampty obj
    uuid: transcodeAndSegmentUUID,
    sp
  })

  const { transcodeFilePath, segmentFileNames, segmentFilePaths, m3u8Path } =
    pollResp

  let res

  for (let i = 0; i < segmentFileNames.length; i++) {
    const segmentFileName = segmentFileNames[i]
    const segmentFilePath = segmentFilePaths[i]

    logger.info(
      { sp, segmentFileName, segmentFilePath },
      'BANANA getting segments'
    )

    res = await fetchSegment(res, sp, segmentFileName, fileNameNoExtension)

    await Utils.writeStreamToFileSystem(res.data, segmentFilePath)
  }

  // Get transcode and write to tmp disk
  logger.info({ sp, transcodeFilePath }, 'BANANA getting transcode')
  const transcodeFileName = fileNameNoExtension + '-dl.mp3'
  res = await fetchTranscode(res, sp, transcodeFileName, fileNameNoExtension)
  await Utils.writeStreamToFileSystem(res.data, transcodeFilePath)

  // Get m3u8 file and write to tmp disk
  logger.info({ sp, m3u8Path }, 'BANANA getting m3u8')
  const m3u8FileName = fileNameNoExtension + '.m3u8'
  res = await fetchM3U8File(res, sp, m3u8FileName, fileNameNoExtension)
  await Utils.writeStreamToFileSystem(res.data, m3u8Path)

  logger.info('BANANAZ WE ARE DONE')
  return {
    transcodeFilePath,
    segmentFileNames,
    m3u8Path
  }
}

async function selectRandomSPs(
  libs,
  numberOfSPs = NUMBER_OF_SPS_FOR_HANDOFF_TRACK
) {
  let allSPs = await libs.ethContracts.getServiceProviderList('content-node')
  allSPs = allSPs.map((sp) => sp.endpoint)

  const validSPs = new Set()
  while (validSPs.size < numberOfSPs) {
    const index = Utils.getRandomInt(allSPs.length)
    const currentSP = allSPs[index]
    // do not pick self or a node that has already been chosen
    if (currentSP === SELF_ENDPOINT || validSPs.has(currentSP)) {
      continue
    }
    validSPs.add(currentSP)
  }

  return Array.from(validSPs)
}

async function pollProcessingStatus({ logger, taskType, uuid, sp }) {
  const start = Date.now()
  while (Date.now() - start < MAX_TRACK_HANDOFF_TIMEOUT_MS) {
    try {
      const { status, resp } = await fetchTrackContentProcessingStatus(
        sp,
        uuid,
        taskType
      )
      // Should have a body structure of:
      //   { transcodedTrackCID, transcodedTrackUUID, track_segments, source_file }
      if (status && status === 'DONE') return resp
      if (status && status === 'FAILED') {
        throw new Error(`${taskType} failed: uuid=${uuid}, error=${resp}`)
      }
    } catch (e) {
      // Catch errors here and swallow them. Errors don't signify that the track
      // upload has failed, just that we were unable to establish a connection to the node.
      // This allows polling to retry
      logger.error(`Failed to poll for processing status, ${e}`)
    }

    await Utils.timeout(POLL_STATUS_INTERVAL_MS)
  }

  throw new Error(
    `${taskType} took over ${MAX_TRACK_HANDOFF_TIMEOUT_MS}ms. uuid=${uuid}`
  )
}

async function sendTranscodeAndSegmentRequest({
  requestID,
  logger,
  sp,
  fileDir,
  fileName,
  fileNameNoExtension
}) {
  const originalTrackFormData = await createFormData(fileDir + '/' + fileName)
  logger.info({ sp }, 'BANANA posting t/s')

  const resp = await axios.post(
    `${sp}/transcode_and_segment`,
    originalTrackFormData,
    {
      headers: {
        ...originalTrackFormData.getHeaders()
        // 'X-Request-ID': requestID
      },
      params: {
        use_cid_in_path: fileNameNoExtension
      },
      adapter: require('axios/lib/adapters/http'),
      // Set content length headers (only applicable in server/node environments).
      // See: https://github.com/axios/axios/issues/1362
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  )

  return resp.data.data.uuid
}

async function createFormData(pathToFile) {
  const fileExists = await fsExtra.pathExists(pathToFile)
  if (!fileExists) {
    throw new Error(`File does not exist at path=${pathToFile}`)
  }

  let formData = new FormData()
  formData.append('file', fs.createReadStream(pathToFile))

  return formData
}

async function fetchHealthCheck(sp) {
  await axios({
    url: `${sp}/health_check`,
    method: 'get'
  })
}

/**
 * Gets the task progress given the task type and uuid associated with the task
 * @param {string} uuid the uuid of the track transcoding task
 * @returns the status, and the success or failed response if the task is complete
 */
async function fetchTrackContentProcessingStatus(sp, uuid, taskType) {
  const { data: body } = await axios({
    url: `${sp}/track_content_status`,
    params: { uuid },
    method: 'get'
  })

  return body.data
}

async function fetchSegment(res, sp, segmentFileName, fileNameNoExtension) {
  return axios({
    url: `${sp}/transcode_and_segment`,
    method: 'get',
    params: {
      fileName: segmentFileName,
      fileType: 'segment',
      cidInPath: fileNameNoExtension
    },
    responseType: 'stream'
  })
}

async function fetchTranscode(res, sp, transcodeFileName, fileNameNoExtension) {
  return axios({
    url: `${sp}/transcode_and_segment`,
    method: 'get',
    params: {
      fileName: transcodeFileName,
      fileType: 'transcode',
      cidInPath: fileNameNoExtension
    },
    responseType: 'stream'
  })
}

async function fetchM3U8File(res, sp, m3u8FileName, fileNameNoExtension) {
  return axios({
    url: `${sp}/transcode_and_segment`,
    method: 'get',
    params: {
      fileName: m3u8FileName,
      fileType: 'm3u8',
      cidInPath: fileNameNoExtension // TODO: rename this key bvar
    },
    responseType: 'stream'
  })
}

module.exports = {
  selectRandomSPs,
  handOffTrack
}
