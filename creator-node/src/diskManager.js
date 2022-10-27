const util = require('util')
const exec = util.promisify(require('child_process').exec)
const path = require('path')
const fs = require('fs-extra')
const CID = require('cids')
const { chunk } = require('lodash')

const DbManager = require('./dbManager')
const models = require('./models')
const redisClient = require('./redis')
const config = require('./config')
const { logger: genericLogger } = require('./logging')

// regex to check if a directory or just a regular file
// if directory - will have both outer and inner properties in match.groups
// else - will have just outer property, no inner
const CID_DIRECTORY_REGEX =
  /\/(?<outer>Qm[a-zA-Z0-9]{44})\/?(?<inner>Qm[a-zA-Z0-9]{44})?/

// Prefix for redis keys that store which files to delete for a user
const REDIS_DEL_FILE_KEY_PREFIX = 'filePathsToDeleteFor'

const DAYS_BEFORE_PRUNING_ORPHANED_CONTENT = 7

const DB_QUERY_SUCCESS_CHECK_STR = `sweep_db_query_success_${Math.floor(
  Math.random() * 10000
)}`

// variable to cache if we've run `ensureDirPathExists` in getTmpTrackUploadArtifactsPath so we don't run
// it every time a track is uploaded
let TMP_TRACK_ARTIFACTS_CREATED = false

class DiskManager {
  /**
   * Return the storagePath from the config
   */
  static getConfigStoragePath() {
    return config.get('storagePath')
  }

  /**
   *
   * @param {string} path the path to get the size for
   * @returns the string output of stdout
   */
  static async getDirSize(path) {
    const stdout = await this._execShellCommand(`du -sh ${path}`)
    return stdout
  }

  /**
   * Empties the tmp track artifacts directory of any old artifacts
   */
  static async emptyTmpTrackUploadArtifacts() {
    const dirPath = await this.getTmpTrackUploadArtifactsPath()
    const dirSize = await this.getDirSize(dirPath)
    await fs.emptyDir(dirPath)

    return dirSize
  }

  /**
   * Returns the folder that stores track artifacts uploaded by creators. The reason this is all stored together
   * is we should be able to delete the contents of this folder without scanning through other folders with the
   * naming scheme.
   */
  static async getTmpTrackUploadArtifactsPath() {
    const dirPath = path.join(
      config.get('storagePath'),
      'files',
      'tmp_track_artifacts'
    )
    if (!TMP_TRACK_ARTIFACTS_CREATED) {
      await this.ensureDirPathExists(dirPath)
      TMP_TRACK_ARTIFACTS_CREATED = true
    }
    return dirPath
  }

  /**
   * Construct the path to a file or directory given a CID
   *
   * eg. if you have a file CID `Qmabcxyz`, use this function to get the path /file_storage/files/cxy/Qmabcxyz
   * eg. if you have a dir CID `Qmdir123`, use this function to get the path /file_storage/files/r12/Qmdir123/
   * Use `computeFilePathInDir` if you want to get the path for a file inside a directory.
   *
   * @dev Returns a path with the three characters before the last character
   *      eg QmYfSQCgCwhxwYcdEwCkFJHicDe6rzCAb7AtLz3GrHmuU6 will be eg /file_storage/muU/QmYfSQCgCwhxwYcdEwCkFJHicDe6rzCAb7AtLz3GrHmuU6
   * @param {String} cid file system destination, either filename or directory
   */
  static async computeFilePath(cid, ensureDirPathExists = true) {
    try {
      CID.isCID(new CID(cid))
    } catch (e) {
      genericLogger.error(`CID invalid, cid=${cid}, error=${e.toString()}`)
      throw new Error(
        `Please pass in a valid cid to computeFilePath. Passed in ${cid} ${e.message}`
      )
    }

    // This is the directory path that file with cid will go into.
    // The reason for nesting `files` inside `/file_storage` is because legacy nodes store files at the root of `/file_storage`, and
    // that can cause potential collisions if we're creating large amounts of subdirectories. A way to mitigate this is create one
    // directory in the root `/file_storage` and all other directories inside of it like `file_storage/files/<directoryID>/<cid>
    const directoryID = cid.slice(-4, -1)
    const parentDirPath = path.join(
      this.getConfigStoragePath(),
      'files',
      directoryID
    )
    // in order to easily dev against the older and newer paths, the line below is the legacy storage path
    // const parentDirPath = this.getConfigStoragePath()

    // create the subdirectories in parentDirHash if they don't exist
    if (ensureDirPathExists) {
      await this.ensureDirPathExists(parentDirPath)
    }

    return path.join(parentDirPath, cid)
  }

  /**
   * Construct the legacy path to a file or directory given a CID
   */
  static computeLegacyFilePath(cid) {
    if (!this.isValidCID(cid)) {
      throw new Error(`[computeLegacyFilePath] [CID=${cid}] Invalid CID.`)
    }
    return path.join(this.getConfigStoragePath(), cid)
  }

  /**
   * Boolean function to check if arg is a valid CID
   */
  static isValidCID(cid) {
    try {
      // Will throw if `new CID(cid)` fails
      // CID.isCID() returns boolean
      return CID.isCID(new CID(cid))
    } catch (e) {
      return false
    }
  }

  /**
   * Given a directory name and a file name, construct the full file system path for a directory and a folder inside a directory
   *
   * eg if you're manually computing the file path to an file `Qmabcxyz` inside a dir `Qmdir123`, use this function to get the
   * path with both the dir and the file /file_storage/files/r12/Qmdir123/Qmabcxyz
   * Use `computeFilePath` if you just want to get to the path of a file or directory.
   *
   * @param {String} dirName directory name
   * @param {String} fileName file name
   */
  static async computeFilePathInDir(dirName, fileName) {
    if (!dirName || !fileName) {
      genericLogger.error(
        `Invalid dirName and/or fileName, dirName=${dirName}, fileName=${fileName}`
      )
      throw new Error('Must pass in valid dirName and fileName')
    }

    try {
      CID.isCID(new CID(dirName))
      CID.isCID(new CID(fileName))
    } catch (e) {
      genericLogger.error(
        `CID invalid, dirName=${dirName}, fileName=${fileName}, error=${e.toString()}`
      )
      throw new Error(
        `Please pass in a valid cid to computeFilePathInDir for dirName and fileName. Passed in dirName: ${dirName} fileName: ${fileName} ${e.message}`
      )
    }

    const parentDirPath = await this.computeFilePath(dirName)
    const absolutePath = path.join(parentDirPath, fileName)
    genericLogger.info(`File path computed, absolutePath=${absolutePath}`)
    return absolutePath
  }

  /**
   * Given a directory path, this function will create the dirPath if it doesn't exist
   * If it does exist, it will not overwrite, effectively a no-op
   * @param {*} dirPath fs directory path to create if it does not exist
   */
  static async ensureDirPathExists(dirPath) {
    try {
      // the mkdir recursive option is equivalent to `mkdir -p` and should created nested folders several levels deep
      await fs.mkdir(dirPath, { recursive: true })
    } catch (e) {
      genericLogger.error(
        `Error making directory, dirName=${dirPath}, error=${e.toString()}`
      )
      throw new Error(`Error making directory at ${dirPath} - ${e.message}`)
    }
  }

  /**
   * Given a file system path, extract CID's from the path and returns obj
   * @param {String} fsPath file system path like /file_storage/files/r12/Qmdir123/Qmabcxyz
   * @returns {Object} {isDir: Boolean, outer: CID, inner: CID|null}
   *    outer should always be defined and can either be a file if not dir, or the dir name if dir
   *    inner will be defined if the file is inside the dir matched by the outer match group
   */
  static extractCIDsFromFSPath(fsPath) {
    const match = CID_DIRECTORY_REGEX.exec(fsPath)
    if (!match || !match.groups) {
      genericLogger.info(
        `Input path does not match cid directory pattern, fsPath=${fsPath}`
      )
      return null
    }

    let ret = null
    if (match && match.groups && match.groups.outer && match.groups.inner) {
      ret = {
        isDir: true,
        outer: match.groups.outer,
        inner: match.groups.inner
      }
    } else if (match.groups.outer && !match.groups.inner) {
      ret = { isDir: false, outer: match.groups.outer, inner: null }
    }

    return ret
  }

  static async deleteFileOrDir(pathToFileOrDir) {
    // Base case - delete single file (not a directory)
    if (!(await fs.lstat(pathToFileOrDir)).isDirectory()) {
      await fs.unlink(pathToFileOrDir)
      return
    }

    // Recursively remove all contents of directory
    for (const file of await fs.readdir(pathToFileOrDir)) {
      const childPath = path.join(pathToFileOrDir, file)
      if ((await fs.lstat(childPath)).isDirectory()) {
        await DiskManager.deleteFileOrDir(childPath)
      } else {
        await fs.unlink(childPath)
      }
    }

    // Remove actual directory
    await fs.rmdir(pathToFileOrDir)
  }

  /**
   * Recursively deletes an array of file paths and their subdirectories in paginated chunks.
   * @param {string[]} storagePaths the file paths to delete
   * @param {number} batchSize the number of concurrent deletes to perform
   * @param {bunyan.Logger} logger
   * @returns {number} number of files successfully deleted
   */
  static async batchDeleteFileOrDir(storagePaths, batchSize, logger) {
    let numFilesDeleted = 0
    const batches = chunk(storagePaths, batchSize)
    const promiseResults = []
    for (const batchOfStoragePaths of batches) {
      const promiseResultsForBatch = await Promise.allSettled(
        batchOfStoragePaths.map((storagePath) =>
          DiskManager.deleteFileOrDir(storagePath)
        )
      )
      promiseResults.push(...promiseResultsForBatch)
    }

    // Count number of files successfully deleted and log errors
    for (const promiseResult of promiseResults) {
      if (promiseResult.status === 'fulfilled') {
        numFilesDeleted++
      } else {
        logger.error(`Could not delete file: ${promiseResult?.reason?.stack}`)
      }
    }
    return numFilesDeleted
  }

  /**
   * Adds path to redis set for every file of the given user.
   * DOES NOT DELETE. Call deleteAllCNodeUserDataFromDisk() to delete the data that was added to redis.
   * Uses pagination to avoid loading all files in memory for users with a lot of data.
   * @param {string} walletPublicKey the wallet of the user to delete all data for
   * @param {bunyan.Logger} logger
   * @return number of file paths added to redis
   */
  static async gatherCNodeUserDataToDelete(walletPublicKey, logger) {
    const FILES_PER_QUERY = 10_000
    const redisSetKey = `${REDIS_DEL_FILE_KEY_PREFIX}${walletPublicKey}`
    await redisClient.del(redisSetKey)

    const cnodeUser = await models.CNodeUser.findOne({
      where: { walletPublicKey }
    })
    if (!cnodeUser) throw new Error('No cnodeUser found')
    const { cnodeUserUUID } = cnodeUser
    logger.info(
      `Fetching data to delete from disk for cnodeUserUUID: ${cnodeUserUUID}`
    )

    // Add files to delete to redis, paginated by storagePath, starting at the lowest real character (space)
    let prevStoragePath = ' '
    let numFilesAdded = 0
    let filePaths = []
    do {
      filePaths = await DbManager.getCNodeUserFilesFromDb(
        cnodeUserUUID,
        prevStoragePath,
        FILES_PER_QUERY
      )
      if (filePaths.length) {
        numFilesAdded = await redisClient.sadd(redisSetKey, filePaths)
        prevStoragePath = filePaths[filePaths.length - 1]
      } else numFilesAdded = 0
    } while (filePaths.length === FILES_PER_QUERY || numFilesAdded > 0)
    // Nothing left to paginate if the last page wasn't full length and didn't contain new files

    return redisClient.scard(redisSetKey)
  }

  /**
   * Deletes from disk each file path that was added by gatherCNodeUserDataToDelete().
   * Uses pagination to avoid loading all files in memory for users with a lot of data.
   * @param {string} walletPublicKey the wallet of the user to delete all data for
   * @param {number} numFilesToDelete the number of file paths in redis
   * @param {bunyan.Logger} logger
   * @return number of files deleted
   */
  static async deleteAllCNodeUserDataFromDisk(
    walletPublicKey,
    numFilesToDelete,
    logger
  ) {
    const FILES_PER_REDIS_QUERY = 10_000
    const FILES_PER_DELETION_BATCH = 100
    const redisSetKey = `${REDIS_DEL_FILE_KEY_PREFIX}${walletPublicKey}`
    try {
      // Read file paths from redis and delete them
      let numFilesDeleted = 0
      for (let i = 0; i < numFilesToDelete; i += FILES_PER_REDIS_QUERY) {
        const filePathsToDelete = await redisClient.spop(
          redisSetKey,
          FILES_PER_REDIS_QUERY
        )
        if (!filePathsToDelete?.length) return numFilesDeleted

        numFilesDeleted += await DiskManager.batchDeleteFileOrDir(
          filePathsToDelete,
          FILES_PER_DELETION_BATCH,
          logger
        )
      }
      return numFilesDeleted
    } finally {
      await redisClient.del(redisSetKey)
    }
  }

  static async clearFilePathsToDelete(walletPublicKey) {
    const redisSetKey = `${REDIS_DEL_FILE_KEY_PREFIX}${walletPublicKey}`
    await redisClient.del(redisSetKey)
  }

  // lists all the folders in /file_storage/files/
  static async listSubdirectoriesInFiles() {
    const subdirectories = []
    const fileStorageFilesDirPath = path.join(
      this.getConfigStoragePath(),
      'files'
    ) // /file_storage/files
    try {
      // returns list of directories like
      // `
      // .
      // ./d8A
      // ./Pyx
      // ./BJg
      // ./nVU
      // `
      const stdout = await this._execShellCommand(
        `cd ${fileStorageFilesDirPath}; find . -maxdepth 1`
      )
      // stdout is a string so split on newline and remove any empty strings
      // clean any . and ./ results since find can include these to reference relative paths
      for (const dir of stdout.split('\n')) {
        const dirTrimmed = dir.replace('.', '').replace('/', '').trim()
        // if dirTrimmed is a non-null string
        if (dirTrimmed) {
          subdirectories.push(`${fileStorageFilesDirPath}/${dirTrimmed}`)
        }
      }

      return subdirectories
    } catch (e) {
      genericLogger.error(
        `Error in diskManager - listSubdirectoriesInFiles: ${e}`
      )
    }
  }

  // list all the CIDs in /file_storage/files/AqN
  // returns mapping of {cid: filePath, cid: filePath ...}
  static async listNestedCIDsInFilePath(filesSubdirectory) {
    const cidsToFilePathMap = {}
    // find files older than DAYS_BEFORE_PRUNING_ORPHANED_CONTENT days in filesSubdirectory (eg /file_storage/files/AqN)
    try {
      const stdout = await this._execShellCommand(
        `find ${filesSubdirectory} -mtime +${DAYS_BEFORE_PRUNING_ORPHANED_CONTENT}`
      )

      for (const file of stdout.split('\n')) {
        const fileTrimmed = file.trim()
        // if fileTrimmed is a non-null string and is not just equal to base directory
        if (fileTrimmed && fileTrimmed !== filesSubdirectory) {
          const parts = fileTrimmed.split('/')
          // returns the last CID in the event of dirCID
          const leafCID = parts[parts.length - 1]
          cidsToFilePathMap[leafCID] = fileTrimmed
        }
      }

      return cidsToFilePathMap
    } catch (e) {
      genericLogger.error(
        `Error in diskManager - listNestedCIDsInFilePath: ${e}`
      )
    }
  }

  static async sweepSubdirectoriesInFiles(redoJob = true) {
    const subdirectories = await this.listSubdirectoriesInFiles()
    if (!subdirectories) return

    for (let i = 0; i < subdirectories.length; i += 1) {
      try {
        const subdirectory = subdirectories[i]

        const cidsToFilePathMap = await this.listNestedCIDsInFilePath(
          subdirectory
        )
        const cidsInSubdirectory = Object.keys(cidsToFilePathMap)

        if (cidsInSubdirectory.length === 0) {
          continue
        }

        const queryResults =
          // add a `query_success` row to the result so we know the query ran successfully
          // shouldn't need this because sequelize should throw an error, but when deleting
          // from disk paranoia is probably justified
          (
            await models.sequelize.query(
              `(SELECT "multihash" FROM "Files" WHERE "multihash" IN (:cidsInSubdirectory)) 
              UNION
              (SELECT '${DB_QUERY_SUCCESS_CHECK_STR}');`,
              { replacements: { cidsInSubdirectory } }
            )
          )[0]

        genericLogger.debug(
          `diskManager#sweepSubdirectoriesInFiles - iteration ${i} out of ${
            subdirectories.length
          }. subdirectory: ${subdirectory}. got ${
            Object.keys(cidsToFilePathMap).length
          } files in folder and ${
            queryResults.length
          } results from db. files: ${Object.keys(
            cidsToFilePathMap
          ).toString()}. db records: ${JSON.stringify(queryResults)}`
        )

        const cidsInDB = new Set()
        let foundSuccessRow = false
        for (const file of queryResults) {
          if (file.multihash === `${DB_QUERY_SUCCESS_CHECK_STR}`)
            foundSuccessRow = true
          else cidsInDB.add(file.multihash)
        }

        if (!foundSuccessRow)
          throw new Error(`DB did not return expected success row`)

        const cidsToDelete = []
        const cidsNotToDelete = []
        // iterate through all files on disk and check if db contains it
        for (const cid of cidsInSubdirectory) {
          // if db doesn't contain file, log as okay to delete
          if (!cidsInDB.has(cid)) {
            cidsToDelete.push(cid)
          } else cidsNotToDelete.push(cid)
        }

        if (cidsNotToDelete.length > 0) {
          genericLogger.debug(
            `diskmanager.js - not safe to delete ${cidsNotToDelete.toString()}`
          )
        }

        if (cidsToDelete.length > 0) {
          genericLogger.info(
            `diskmanager.js - safe to delete ${cidsToDelete.toString()}`
          )

          if (config.get('backgroundDiskCleanupDeleteEnabled')) {
            await this._execShellCommand(
              `rm ${cidsToDelete
                .map((cid) => cidsToFilePathMap[cid])
                .join(' ')}`
            )
          }
        }
      } catch (e) {
        genericLogger.error(
          `diskManager#sweepSubdirectoriesInFiles - error: ${e}`
        )
      }
    }

    // keep calling this function recursively without an await so the original function scope can close
    if (redoJob) return this.sweepSubdirectoriesInFiles()
  }

  static async _execShellCommand(cmd, log = false) {
    if (log)
      genericLogger.info(
        `diskManager - about to call _execShellCommand: ${cmd}`
      )
    const { stdout, stderr } = await exec(`${cmd}`, {
      maxBuffer: 1024 * 1024 * 5
    }) // 5mb buffer
    if (stderr) throw stderr

    return stdout
  }
}

module.exports = DiskManager
