const Bull = require('bull')
const axios = require('axios')

const utils = require('../utils')
const models = require('../models')
const { logger } = require('../logging')

const SyncDeDuplicator = require('./snapbackDeDuplicator')
const PeerSetManager = require('./peerSetManager')

// Maximum number of time to wait for a sync operation, 6 minutes by default
const MaxSyncMonitoringDurationInMs = 360000 // ms

// Retry delay between requests during monitoring
const SyncMonitoringRetryDelayMs = 15000

// The number of replica set nodes
const NUMBER_OF_REPLICA_SET_NODES = 3

// Describes the type of sync operation
const SyncType = Object.freeze({
  Recurring: 'RECURRING' /** scheduled background sync to keep secondaries up to date */,
  Manual: 'MANUAL' /** triggered by a user data write to primary */
})

// Phases in `issueUpdateReplicaSetOp`. Used for debugging if method fails
const issueUpdateReplicaSetOpPhases = Object.freeze({
  SELECT_CREATOR_NODES: 'SELECT_CREATOR_NODES',
  ENQUEUE_SYNCS: 'ENQUEUE_SYNCS',
  FETCH_CLOCK_VALUES: 'FETCH_CLOCK_VALUES',
  UPDATE_URSM_REPLICA_SET: 'UPDATE_URSM_REPLICA_SET'
})

/*
  SnapbackSM aka Snapback StateMachine
  Ensures file availability through recurring sync operations
  Pending: User replica set management
*/
class SnapbackSM {
  constructor (nodeConfig, audiusLibs) {
    this.nodeConfig = nodeConfig
    this.audiusLibs = audiusLibs

    // Toggle to switch logs
    this.debug = true

    this.endpoint = this.nodeConfig.get('creatorNodeEndpoint')
    this.spID = this.nodeConfig.get('spID')
    this.snapbackDevModeEnabled = true // this.nodeConfig.get('snapbackDevModeEnabled')

    this.MaxManualRequestSyncJobConcurrency = this.nodeConfig.get('maxManualRequestSyncJobConcurrency')
    this.MaxRecurringRequestSyncJobConcurrency = this.nodeConfig.get('maxRecurringRequestSyncJobConcurrency')

    // Throw an error if running as creator node and no libs are provided
    if (!this.nodeConfig.get('isUserMetadataNode') && (!this.audiusLibs || !this.spID || !this.endpoint)) {
      throw new Error('Missing required configs - cannot start')
    }

    // State machine queue processes all user operations
    this.stateMachineQueue = this.createBullQueue('state-machine')

    // Sync queues handle issuing sync request from primary -> secondary
    this.manualSyncQueue = this.createBullQueue('manual-sync-queue')
    this.recurringSyncQueue = this.createBullQueue('recurring-sync-queue')

    // Incremented as users are processed
    this.currentModuloSlice = this.randomStartingSlice()

    // PeerSetManager instance to determine the peer set and its health state
    this.peerSetManager = new PeerSetManager({
      discoveryProviderEndpoint: audiusLibs.discoveryProvider.discoveryProviderEndpoint,
      creatorNodeEndpoint: this.endpoint
    })

    // Config to determine if reconfig is enabled
    this.snapbackReconfigEnabled = this.nodeConfig.get('snapbackReconfigEnabled')

    // Base value used to filter users over a 24 hour period
    this.moduloBase = this.nodeConfig.get('snapbackModuloBase')

    // For local dev, configure this to be the interval when SnapbackSM is fired
    this.devDelayInMS = this.nodeConfig.get('snapbackDevJobDelay')

    // Delay 1 hour between production state machine jobs
    this.productionJobDelayInMs = this.nodeConfig.get('snapbackProdJobDelay')
  }

  /**
   * Initialize StateMachine processing:
   * - StateMachineQueue -> determines all system state changes required
   * - SyncQueue -> triggers syncs on secondaries
   */
  async init () {
    // Empty all queues to minimize memory consumption
    await this.stateMachineQueue.empty()
    await this.manualSyncQueue.empty()
    await this.recurringSyncQueue.empty()

    // SyncDeDuplicator ensure a sync for a (syncType, userWallet, secondaryEndpoint) tuple is only enqueued once
    this.syncDeDuplicator = new SyncDeDuplicator()

    // Short-circuit if (isUserMetadataNode = true)
    const isUserMetadata = this.nodeConfig.get('isUserMetadataNode')
    if (isUserMetadata) {
      this.log(`SnapbackSM disabled for userMetadataNode. ${this.endpoint}, isUserMetadata=${isUserMetadata}`)
      return
    }

    // Setup the mapping of Content Node endpoint to service provider id. Used in reconfig
    let endpointToSPIdMap = {}
    const contentNodes = await this.audiusLibs.ethContracts.getServiceProviderList('content-node')
    contentNodes.forEach(cn => {
      endpointToSPIdMap[cn.endpoint] = cn.spID
    })
    this.endpointToSPIdMap = endpointToSPIdMap

    /**
     * Initialize all queue processors
     */

    // Initialize stateMachineQueue job processor
    // - Re-adds job to queue after processing current job, with a fixed delay
    const stateMachineJobInterval = (this.snapbackDevModeEnabled) ? this.devDelayInMS : this.productionJobDelayInMs
    this.stateMachineQueue.process(
      async (job, done) => {
        try {
          await this.processStateMachineOperation()
        } catch (e) {
          this.log(`StateMachineQueue error processing ${e}`)
        }

        await utils.timeout(stateMachineJobInterval)

        await this.stateMachineQueue.add({ starttime: Date.now() })

        done()
      }
    )

    // Initialize manualSyncQueue job processor
    this.manualSyncQueue.process(
      this.MaxManualRequestSyncJobConcurrency,
      async (job, done) => {
        try {
          await this.processSyncOperation(job, SyncType.Manual)
        } catch (e) {
          this.log(`ManualSyncQueue processing error: ${e}`)
        }

        done()
      }
    )

    // Initialize recurringSyncQueue job processor
    this.recurringSyncQueue.process(
      this.MaxRecurringRequestSyncJobConcurrency,
      async (job, done) => {
        try {
          await this.processSyncOperation(job, SyncType.Recurring)
        } catch (e) {
          this.log(`RecurringSyncQueue processing error ${e}`)
        }

        done()
      }
    )

    // Enqueue first state machine operation (the processor internally re-enqueues job on recurring interval)
    await this.stateMachineQueue.add({ startTime: Date.now() })

    this.log(`SnapbackSM initialized in ${this.snapbackDevModeEnabled ? 'dev' : 'production'} mode. Added initial stateMachineQueue job; next job in ${stateMachineJobInterval}ms`)
  }

  log (msg) {
    logger.info(`SnapbackSM: ${msg}`)
  }

  logError (msg) {
    logger.error(`SnapbackSM ERROR: ${msg}`)
  }

  // Initialize queue object with provided name and unix timestamp
  createBullQueue (queueName) {
    return new Bull(
      `${queueName}-${Date.now()}`,
      {
        redis: {
          port: this.nodeConfig.get('redisPort'),
          host: this.nodeConfig.get('redisHost')
        },
        defaultJobOptions: {
          // removeOnComplete is required since the completed jobs data set will grow infinitely until memory exhaustion
          removeOnComplete: true,
          removeOnFail: true
        }
      }
    )
  }

  // Randomly select an initial slice
  randomStartingSlice () {
    let slice = Math.floor(Math.random() * Math.floor(this.moduloBase))
    this.log(`Starting at data slice ${slice}/${this.moduloBase}`)
    return slice
  }

  // Helper function to retrieve all relevant configs
  async getSPInfo () {
    const spID = this.nodeConfig.get('spID')
    const endpoint = this.endpoint
    const delegateOwnerWallet = this.nodeConfig.get('delegateOwnerWallet')
    const delegatePrivateKey = this.nodeConfig.get('delegatePrivateKey')
    return {
      spID,
      endpoint,
      delegateOwnerWallet,
      delegatePrivateKey
    }
  }

  /**
   * Given wallets array, queries DB and returns a map of all users with
   *    those wallets and their clock values
   *
   * @dev - TODO what happens if this DB call fails?
   */
  async getUserPrimaryClockValues (wallets) {
    // Query DB for all cnodeUsers with walletPublicKey in `wallets` arg array
    const cnodeUsers = await models.CNodeUser.findAll({
      where: {
        walletPublicKey: {
          [models.Sequelize.Op.in]: wallets
        }
      }
    })

    // Convert cnodeUsers array to map (wallet => clock)
    const cnodeUserClockValuesMap = cnodeUsers.reduce((o, k) => {
      o[k.walletPublicKey] = k.clock
      return o
    }, {})

    return cnodeUserClockValuesMap
  }

  /**
   * Enqueues a sync request to secondary on specified syncQueue and returns job info
   *
   * @dev NOTE avoid using bull priority if possible as it significantly reduces performance
   * @dev TODO no need to accept `primaryEndpoint` as param, it always equals `this.endpoint`
   */
  async enqueueSync ({
    userWallet,
    primaryEndpoint,
    secondaryEndpoint,
    syncType,
    immediate = false
  }) {
    const queue = (syncType === SyncType.Manual) ? this.manualSyncQueue : this.recurringSyncQueue

    // If duplicate sync already exists, do not add and instead return existing sync job info
    const duplicateSyncJobInfo = this.syncDeDuplicator.getDuplicateSyncJobInfo(syncType, userWallet, secondaryEndpoint)
    if (duplicateSyncJobInfo) {
      this.log(`enqueueSync Failure - a sync of type ${syncType} is already waiting for user wallet ${userWallet} against secondary ${secondaryEndpoint}`)

      return duplicateSyncJobInfo
    }

    // Define axios params for sync request to secondary
    const syncRequestParameters = {
      baseURL: secondaryEndpoint,
      url: '/sync',
      method: 'post',
      data: {
        wallet: [userWallet],
        creator_node_endpoint: primaryEndpoint,
        // Note - `sync_type` param is only used for logging by nodeSync.js
        sync_type: syncType,
        immediate
      }
    }

    // Add job to manualSyncQueue or recurringSyncQueue based on `syncType` param
    const jobProps = {
      syncRequestParameters,
      startTime: Date.now()
    }

    const jobInfo = await queue.add(jobProps)

    // Record sync in syncDeDuplicator
    this.syncDeDuplicator.recordSync(syncType, userWallet, secondaryEndpoint, jobInfo)

    return jobInfo
  }

  /**
   * Depending on the size of `unhealthyReplicas`:
   * 1. Determine a new replica set
   * 2. Write new replica set to URSM
   * 3. Sync data to new replica set
   *
   * @param {number} userId user id to issue a reconfiguration for
   * @param {string} wallet wallet address of user id
   * @param {string} primary endpoint of the current primary node on replica set
   * @param {string} secondary1 endpoint of the current first secondary node on replica set
   * @param {string} secondary2 endpoint of the current second secondary node on replica set
   * @param {string[]} unhealthyReplicas array of endpoints of current replica set nodes that are unhealthy
   * @param {string[]} healthyPeers array of endpoints of current peer set nodes slice that are healthy
  */
  async issueUpdateReplicaSetOp (userId, wallet, primary, secondary1, secondary2, unhealthyReplicas, healthyPeers) {
    this.log(`[issueUpdateReplicaSetOp] userId=${userId} wallet=${wallet} unhealthy replica set=[${unhealthyReplicas}] | current healthy peer set=[${healthyPeers}]`)

    // TODO: make optimizely flag
    if (!this.snapbackReconfigEnabled) return

    const reconfigPrefixLog = `[issueUpdateReplicaSetOp] Updating userId=${userId} wallet=${wallet} replica set=[${primary},${secondary1},${secondary2}] to`
    const unhealthyReplicasSet = new Set(unhealthyReplicas)
    const baseSyncRequestParams = { userWallet: wallet, syncType: SyncType.Manual }
    let newReplicaSetSPIds = []

    // If a primary is currently unhealthy or more than one node is unhealthy, skip for now
    if (unhealthyReplicasSet.has(primary) || unhealthyReplicas.length > 1) {
      this.log(`[issueUpdateReplicaSetOp] userId=${userId} skipping reconfig.`)
      return
    }

    let phase = ''
    try {
      // Generate new replica set, excluding current replica set
      phase = issueUpdateReplicaSetOpPhases.SELECT_CREATOR_NODES
      const currentHealthySecondary = unhealthyReplicasSet.has(secondary1) ? secondary2 : secondary1

      // make sure new secondary is not in current replica set
      let newSecondary = primary
      while (newSecondary === primary || newSecondary === currentHealthySecondary) {
        newSecondary = healthyPeers[Math.floor(Math.random() * healthyPeers.length)]
      }

      // Reassign new secondary
      newReplicaSetSPIds = [
        this.endpointToSPIdMap[primary],
        this.endpointToSPIdMap[currentHealthySecondary],
        this.endpointToSPIdMap[newSecondary]
      ]

      // Write to URSM
      this.log(`${reconfigPrefixLog} new replica set=[${primary},${currentHealthySecondary},${newSecondary}]`)
      phase = issueUpdateReplicaSetOpPhases.UPDATE_URSM_REPLICA_SET
      await this.audiusLibs.contracts.UserReplicaSetManagerClient.updateReplicaSet(
        userId,
        newReplicaSetSPIds[0], // primary
        newReplicaSetSPIds.slice(1) // [secondary1, secondary2]
      )

      // Sync
      phase = issueUpdateReplicaSetOpPhases.ENQUEUE_SYNCS
      await this.enqueueSync({
        ...baseSyncRequestParams,
        primaryEndpoint: primary,
        secondaryEndpoint: newSecondary
      })
    } catch (e) {
      const errorMsg = `[issueUpdateReplicaSetOp] userId=${userId} wallet=${wallet} failed at phase=${phase} reconfiguring to spIds=[${newReplicaSetSPIds}]: ${e.toString()}\n${e.stack}`
      this.logError(errorMsg)
      throw new Error(errorMsg)
    }
  }

  /**
   * Converts provided array of SyncRequests to issue to a map(secondaryNode => userWallets[]) for easier access
   *
   * @param {Array} potentialSyncRequests array of objects with schema { user_id, wallet, primary, secondary1, secondary2, endpoint }
   * @returns {Object} map of secondary endpoint strings to array of wallet strings of users with that node as secondary
   */
  buildSecondaryNodesToUserWalletsMap (potentialSyncRequests) {
    const secondaryNodesToUserWalletsMap = {}

    potentialSyncRequests.forEach(userInfo => {
      const { wallet, endpoint: secondary } = userInfo

      if (!secondaryNodesToUserWalletsMap[secondary]) {
        secondaryNodesToUserWalletsMap[secondary] = []
      }

      secondaryNodesToUserWalletsMap[secondary].push(wallet)
    })

    return secondaryNodesToUserWalletsMap
  }

  /**
   * Given map(secondaryNode => userWallets[]), retrieves clock values for every (secondaryNode, userWallet) pair
   *
   * @returns {Object} map of secondary endpoint strings to (map of user wallet strings to clock value of secondary for user)
   */
  async retrieveClockStatusesForSecondaryUsersFromNodes (secondaryNodesToUserWalletsMap) {
    const secondaryNodesToUserClockValuesMap = {}

    const secondaryNodes = Object.keys(secondaryNodesToUserWalletsMap)

    // TODO change to batched parallel requests
    await Promise.all(secondaryNodes.map(async (secondaryNode) => {
      secondaryNodesToUserClockValuesMap[secondaryNode] = {}

      const secondaryNodeUserWallets = secondaryNodesToUserWalletsMap[secondaryNode]

      const axiosReqParams = {
        baseURL: secondaryNode,
        url: '/users/batch_clock_status',
        method: 'post',
        data: { 'walletPublicKeys': secondaryNodeUserWallets }
      }

      // TODO convert to axios-retry, wrap in try-catch
      const userClockValuesResp = (await axios(axiosReqParams)).data.data.users

      userClockValuesResp.forEach(userClockValueResp => {
        const { walletPublicKey, clock } = userClockValueResp
        try {
          secondaryNodesToUserClockValuesMap[secondaryNode][walletPublicKey] = clock
        } catch (e) {
          this.log(`Error updating secondaryNodesToUserClockValuesMap for wallet ${walletPublicKey} to clock ${clock}`)
          throw e
        }
      })
    }))

    return secondaryNodesToUserClockValuesMap
  }

  /**
   * Issues SyncRequests for every (user, secondary) pair if needed
   * Only issues requests if primary clock value is greater than secondary clock value
   *
   * @param {Array} userReplicaSets array of objects of schema { user_id, wallet, primary, secondary1, secondary2, endpoint }
   *      `endpoint` field indicates secondary on which to issue SyncRequest
   * @param {Object} secondaryNodesToUserClockStatusesMap map(secondaryNode => map(userWallet => secondaryClockValue))
   * @returns {Number} number of sync requests issued
   * @returns {Array} array of all SyncRequest errors
   */
  async issueSyncRequests (userReplicaSets, secondaryNodesToUserClockStatusesMap) {
    // TODO ensure all syncRequests are for users with primary == self

    // Retrieve clock values for all users on this node, which is their primary
    const userWallets = userReplicaSets.map(user => user.wallet)
    const userPrimaryClockValues = await this.getUserPrimaryClockValues(userWallets)

    let numSyncRequestsRequired = 0
    let numSyncRequestsIssued = 0
    let syncRequestErrors = []

    // TODO change to chunked parallel
    await Promise.all(userReplicaSets.map(async (user) => {
      try {
        const { wallet, endpoint: secondary } = user

        // TODO - throw on null wallet (is this needed?)

        // Determine if secondary requires a sync by comparing clock values against primary (this node)
        const userPrimaryClockVal = userPrimaryClockValues[wallet]
        const userSecondaryClockVal = secondaryNodesToUserClockStatusesMap[secondary][wallet]
        const syncRequired = !userSecondaryClockVal || (userPrimaryClockVal > userSecondaryClockVal)

        if (syncRequired) {
          numSyncRequestsRequired += 1

          await this.enqueueSync({
            userWallet: wallet,
            secondaryEndpoint: secondary,
            primaryEndpoint: this.endpoint,
            syncType: SyncType.Recurring
          })

          numSyncRequestsIssued += 1
        }
      } catch (e) {
        syncRequestErrors.push(`issueSyncRequest() Error for user ${JSON.stringify(user)} - ${e.message}`)
      }
    }))

    return { numSyncRequestsRequired, numSyncRequestsIssued, syncRequestErrors }
  }

  /**
   * Main state machine processing function
   * - Processes all users in chunks
   * - For every user on an unhealthy replica, issues an updateReplicaSet op to cycle them off
   * - For every (primary) user on a healthy secondary replica, issues SyncRequest op to secondary
   *
   * @note refer to git history for reference to `processStateMachineOperationOld()`
   */
  async processStateMachineOperation () {
    // Record all stages of this function along with associated information for use in logging
    let decisionTree = [{
      stage: 'BEGIN processStateMachineOperation()',
      vals: {
        currentModuloSlice: this.currentModuloSlice
      },
      time: Date.now()
    }]

    try {
      let nodeUsers
      try {
        nodeUsers = await this.peerSetManager.getNodeUsers()
        nodeUsers = this.sliceUsers(nodeUsers)

        decisionTree.push({ stage: 'getNodeUsers() and sliceUsers() Success', vals: { nodeUsersLength: nodeUsers.length }, time: Date.now() })
      } catch (e) {
        decisionTree.push({ stage: 'getNodeUsers() or sliceUsers() Error', vals: e.message, time: Date.now() })
        throw new Error(`processStateMachineOperation():getNodeUsers()/sliceUsers() Error: ${e.toString()}`)
      }

      let unhealthyPeers

      try {
        unhealthyPeers = await this.peerSetManager.getUnhealthyPeers(nodeUsers)
        decisionTree.push({
          stage: 'getUnhealthyPeers() Success',
          vals: {
            unhealthyPeerSetLength: unhealthyPeers.size,
            unhealthyPeers: Array.from(unhealthyPeers)
          },
          time: Date.now()
        })
      } catch (e) {
        decisionTree.push({ stage: 'processStateMachineOperation():getUnhealthyPeers() Error', vals: e.message, time: Date.now() })
        throw new Error(`processStateMachineOperation():getUnhealthyPeers() Error: ${e.toString()}`)
      }

      // Lists to aggregate all required ReplicaSetUpdate ops and potential SyncRequest ops
      const requiredUpdateReplicaSetOps = []
      const potentialSyncRequests = []

      /**
       * For every node user, record sync requests to issue to secondaries if this node is primary
       *    and record replica set updates to issue for any unhealthy replicas
       *
       * Purpose for the if/else case is that if the current node is a primary, issue reconfig or sync requests.
       * Else, if the current node is a secondary, only issue reconfig requests.
       *
       * @notice this will issue sync to healthy secondary and update replica set away from unhealthy secondary
       * TODO make this more readable -> maybe two separate loops? need to ensure mutual exclusivity
       */
      for (const nodeUser of nodeUsers) {
        const { primary, secondary1, secondary2 } = nodeUser

        let unhealthyReplicas = []
        if (primary === this.endpoint) {
          // filter out false-y values to account for incomplete replica sets
          const secondaries = ([secondary1, secondary2]).filter(Boolean)

          for (const secondary of secondaries) {
            if (unhealthyPeers.has(secondary)) {
              unhealthyReplicas.push(secondary)
            } else {
              potentialSyncRequests.push({ ...nodeUser, endpoint: secondary })
            }
          }

          if (unhealthyReplicas.length > 0) {
            requiredUpdateReplicaSetOps.push({ ...nodeUser, unhealthyReplicas })
          }
        } else {
          // filter out false-y values to account for incomplete replica sets
          let replicas = ([primary, secondary1, secondary2]).filter(Boolean)
          // filter out this endpoint
          replicas = replicas.filter(replica => replica !== this.endpoint)

          for (const replica of replicas) {
            if (unhealthyPeers.has(replica)) {
              unhealthyReplicas.push(replica)
            }
          }

          if (unhealthyReplicas.length > 0) {
            requiredUpdateReplicaSetOps.push({ ...nodeUser, unhealthyReplicas })
          }
        }
      }
      decisionTree.push({
        stage: 'Build requiredUpdateReplicaSetOps and potentialSyncRequests arrays',
        vals: {
          requiredUpdateReplicaSetOps,
          requiredUpdateReplicaSetOpsLength: requiredUpdateReplicaSetOps.length,
          potentialSyncRequestsLength: potentialSyncRequests.length
        },
        time: Date.now()
      })

      // Build map of secondary node to secondary user wallets array
      const secondaryNodesToUserWalletsMap = this.buildSecondaryNodesToUserWalletsMap(potentialSyncRequests)
      decisionTree.push({
        stage: 'buildSecondaryNodesToUserWalletsMap() Success',
        vals: { numSecondaryNodes: Object.keys(secondaryNodesToUserWalletsMap).length },
        time: Date.now()
      })

      // Retrieve clock statuses for all secondary users from secondary nodes
      let secondaryNodesToUserClockStatusesMap
      try {
        secondaryNodesToUserClockStatusesMap = await this.retrieveClockStatusesForSecondaryUsersFromNodes(
          secondaryNodesToUserWalletsMap
        )
        decisionTree.push({
          stage: 'retrieveClockStatusesForSecondaryUsersFromNodes() Success',
          vals: { },
          time: Date.now()
        })
      } catch (e) {
        decisionTree.push({
          stage: 'retrieveClockStatusesForSecondaryUsersFromNodes() Error',
          vals: e.message,
          time: Date.now()
        })
        throw new Error('processStateMachineOperation():retrieveClockStatusesForSecondaryUsersFromNodes() Error')
      }

      // Issue all required sync requests
      let numSyncRequestsRequired, numSyncRequestsIssued, syncRequestErrors
      try {
        const resp = await this.issueSyncRequests(potentialSyncRequests, secondaryNodesToUserClockStatusesMap)
        numSyncRequestsRequired = resp.numSyncRequestsRequired
        numSyncRequestsIssued = resp.numSyncRequestsIssued
        syncRequestErrors = resp.syncRequestErrors

        if (syncRequestErrors.length > numSyncRequestsIssued) {
          throw new Error()
        }

        decisionTree.push({
          stage: 'issueSyncRequests() Success',
          vals: {
            numSyncRequestsRequired,
            numSyncRequestsIssued,
            numSyncRequestErrors: syncRequestErrors.length,
            syncRequestErrors
          },
          time: Date.now()
        })
      } catch (e) {
        decisionTree.push({
          stage: 'issueSyncRequests() Error',
          vals: {
            numSyncRequestsRequired,
            numSyncRequestsIssued,
            numSyncRequestErrors: (syncRequestErrors ? syncRequestErrors.length : null),
            syncRequestErrors
          },
          time: Date.now()
        })
        throw new Error('processStateMachineOperation():issueSyncRequests() Error')
      }

      /**
       * Issue all required replica set updates
       * TODO move to chunked parallel (maybe?) + wrap each in try-catch to not halt on single error
       */
      let numUpdateReplicaOpsIssued = 0
      let healthyNodes
      try {
        for await (const userInfo of requiredUpdateReplicaSetOps) {
          if (!healthyNodes) {
            const { services: healthyServicesMap } = await this.audiusLibs.ServiceProvider.autoSelectCreatorNodes({
              blacklist: new Set([userInfo.primary, userInfo.secondary1, userInfo.secondary2]),
              performSyncCheck: false
            })

            healthyNodes = Object.keys(healthyServicesMap)
          }
          await this.issueUpdateReplicaSetOp(
            userInfo.user_id,
            userInfo.wallet,
            userInfo.primary,
            userInfo.secondary1,
            userInfo.secondary2,
            userInfo.unhealthyReplicas,
            healthyNodes
          )
          numUpdateReplicaOpsIssued++
        }

        decisionTree.push({
          stage: 'issueUpdateReplicaSetOp() Success',
          vals: { numUpdateReplicaOpsIssued },
          time: Date.now()
        })
      } catch (e) {
        decisionTree.push({
          stage: 'issueUpdateReplicaSetOp() Error',
          vals: e.message,
          time: Date.now()
        })
        throw new Error('processStateMachineOperation():issueUpdateReplicaSetOp() Error')
      }

      // Increment and adjust current slice by this.moduloBase
      const previousModuloSlice = this.currentModuloSlice
      this.currentModuloSlice += 1
      this.currentModuloSlice = this.currentModuloSlice % this.moduloBase

      decisionTree.push({
        stage: 'END processStateMachineOperation()',
        vals: {
          currentModuloSlice: previousModuloSlice,
          nextModuloSlice: this.currentModuloSlice,
          moduloBase: this.moduloBase,
          numSyncRequestsIssued,
          numUpdateReplicaOpsIssued
        },
        time: Date.now()
      })

      // Log error without throwing - next run will attempt to rectify
    } catch (e) {
      decisionTree.push({ stage: 'processStateMachineOperation Error', vals: e.message, time: Date.now() })
    } finally {
      // Log decision tree
      try {
        this.log(`processStateMachineOperation Decision Tree ${JSON.stringify(decisionTree, null, 2)}`)
      } catch (e) {
        this.logError(`Error printing processStateMachineOperation Decision Tree ${decisionTree}`)
      }
    }
  }

  /**
   * Monitor an ongoing sync operation for a given secondaryUrl and user wallet
   * Return boolean indicating if an additional sync is required
   *
   * Polls secondary for MaxSyncMonitoringDurationInMs
   */
  async additionalSyncIsRequired (userWallet, primaryClockValue, secondaryUrl, syncType) {
    const MaxExportClockValueRange = this.nodeConfig.get('maxExportClockValueRange')
    const logMsgString = `additionalSyncIsRequired (${syncType}): wallet ${userWallet} secondary ${secondaryUrl} primaryClock ${primaryClockValue}`

    // Define axios request object for secondary clock status request
    const clockStatusRequestParams = {
      method: 'get',
      baseURL: secondaryUrl,
      url: `/users/clock_status/${userWallet}`,
      responseType: 'json'
    }

    const startTimeMs = Date.now()
    const endTimeMs = startTimeMs + MaxSyncMonitoringDurationInMs

    let additionalSyncRequired = true
    while (Date.now() < endTimeMs) {
      try {
        const clockStatusResp = await axios(clockStatusRequestParams)
        const { clockValue: secondaryClockValue } = clockStatusResp.data.data

        this.log(`${logMsgString} secondaryClock ${secondaryClockValue}`)

        /**
         * One sync op can process at most MaxExportClockValueRange range
         * A larger clock diff will require multiple syncs; short-circuit monitoring
         */
        if (secondaryClockValue + MaxExportClockValueRange < primaryClockValue) {
          this.log(`${logMsgString} secondaryClock ${secondaryClockValue} || MaxExportClockValueRange exceeded -> re-enqueuing sync`)
          break

          /**
           * Stop monitoring once secondary has caught up
           * Note - secondaryClockValue can be greater than primaryClockValue if additional
           *    data was written to primary after primaryClockValue was computed
           */
        } else if (secondaryClockValue >= primaryClockValue) {
          this.log(`${logMsgString} secondaryClock ${secondaryClockValue} || Sync completed in ${Date.now() - startTimeMs}ms`)
          additionalSyncRequired = false
          break
        }
      } catch (e) {
        this.log(`${logMsgString} || Error: ${e.message}`)
      }

      // Delay between retries
      await utils.timeout(SyncMonitoringRetryDelayMs, false)
    }

    return additionalSyncRequired
  }

  /**
   * Processes job as it is picked off the queue
   *  - Handles sync jobs for manualSyncQueue and recurringSyncQueue
   *  - Given job data, triggers sync request to secondary
   *
   * @param job instance of Bull queue job
   */
  async processSyncOperation (job, syncType) {
    const { id } = job
    const { syncRequestParameters } = job.data

    const isValidSyncJobData = (
      ('baseURL' in syncRequestParameters) &&
      ('url' in syncRequestParameters) &&
      ('method' in syncRequestParameters) &&
      ('data' in syncRequestParameters)
    )
    if (!isValidSyncJobData) {
      logger.error(`Invalid sync data found`, job.data)
      return
    }

    const userWallet = syncRequestParameters.data.wallet[0]
    const secondaryEndpoint = syncRequestParameters.baseURL

    /**
     * Remove sync from syncDeDuplicator once it moves to Active status, before processing
     * It is ok for two identical syncs to be present in Active and Waiting, just not two in Waiting
     */
    this.syncDeDuplicator.removeSync(syncType, userWallet, secondaryEndpoint)

    // primaryClockValue is used in additionalSyncIsRequired() call below
    const primaryClockValue = (await this.getUserPrimaryClockValues([userWallet]))[userWallet]

    this.log(`------------------Process SYNC | User ${userWallet} | Secondary: ${secondaryEndpoint} | Primary clock value ${primaryClockValue} | type: ${syncType} | jobID: ${id} ------------------`)

    // Issue sync request to secondary
    await axios(syncRequestParameters)

    // Wait until has sync has completed (within time threshold)
    const additionalSyncRequired = await this.additionalSyncIsRequired(
      userWallet,
      primaryClockValue,
      secondaryEndpoint,
      syncType
    )

    /**
     * Re-enqueue sync if required
     *
     * TODO can infinite loop on failing sync ops, but should not block any users as
     *    it enqueues job to the end of the queue
     */
    if (additionalSyncRequired) {
      await this.enqueueSync({
        userWallet,
        primaryEndpoint: this.endpoint,
        secondaryEndpoint,
        syncType
      })
    }

    // Exit when sync status is computed
    this.log(`------------------END Process SYNC | jobID: ${id}------------------`)
  }

  /**
   * Returns all jobs from manualSyncQueue and recurringSyncQueue, keyed by status
   *
   * @dev TODO may be worth manually recording + exposing completed jobs count
   *    completed and failed job records are disabled in createBullQueue()
   */
  async getSyncQueueJobs () {
    const [
      manualWaiting,
      manualActive,
      recurringWaiting,
      recurringActive
    ] = await Promise.all([
      this.manualSyncQueue.getJobs(['waiting']),
      this.manualSyncQueue.getJobs(['active']),
      this.recurringSyncQueue.getJobs(['waiting']),
      this.recurringSyncQueue.getJobs(['active'])
    ])

    return {
      manualWaiting,
      manualActive,
      recurringWaiting,
      recurringActive
    }
  }

  /**
   * Select chunk of users to process in this run
   *  - User is selected if (user_id % moduloBase = currentModuloSlice)
   * @param {Object[]} nodeUsers array of objects of schema { primary, secondary1, secondary2, user_id, wallet }
   */
  sliceUsers (nodeUsers) {
    return nodeUsers.filter(nodeUser =>
      nodeUser.user_id % this.moduloBase === this.currentModuloSlice
    )
  }

  // Fetch clock values with max number of attempts
  async fetchClockValues (maxClockFetchAttempts = 10) {
    let endpointToClockMap = {}
    let fetchedClockValues = false
    let attempts = 0

    while (!fetchedClockValues || attempts++ < maxClockFetchAttempts) {
      const clockResponses = await this.audiusLibs.creatorNode.getClockValuesFromReplicaSet()
      for (const response of clockResponses) {
        // If clock values are null, do not attempt to create `endpointToClockMap`
        if (!response.clockValue) break
        endpointToClockMap[response.endpoint] = response.clockValue
      }

      if (Object.keys(endpointToClockMap).length === NUMBER_OF_REPLICA_SET_NODES) fetchedClockValues = true
    }

    return endpointToClockMap
  }
}

module.exports = { SnapbackSM, SyncType }
