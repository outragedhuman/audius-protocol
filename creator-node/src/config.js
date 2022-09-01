const axios = require('axios')
const convict = require('convict')
const fs = require('fs')
const process = require('process')
const path = require('path')
const os = require('os')

// can't import logger here due to possible circular dependency, use console

// Custom boolean format used to ensure that empty string '' is evaluated as false
// https://github.com/mozilla/node-convict/issues/380
convict.addFormat({
  name: 'BooleanCustom',
  validate: function (val) {
    return typeof val === 'boolean' || typeof val === 'string'
  },
  coerce: function (val) {
    return val === true || val === 'true'
  }
})

// Define a schema
const config = convict({
  dbUrl: {
    doc: 'Database URL connection string',
    format: String,
    env: 'dbUrl',
    default: null
  },
  dbConnectionPoolMax: {
    doc: 'Max connections in database pool',
    format: 'nat',
    env: 'dbConnectionPoolMax',
    default: 100
  },
  storagePath: {
    doc: 'File system path to store raw files that are uploaded',
    format: String,
    env: 'storagePath',
    default: null
  },
  redisHost: {
    doc: 'Redis host name',
    format: String,
    env: 'redisHost',
    default: null
  },
  allowedUploadFileExtensions: {
    doc: 'Override the default list of file extension allowed',
    format: Array,
    env: 'allowedUploadFileExtensions',
    default: [
      'mp2',
      'mp3',
      'mpga',
      'mp4',
      'm4a',
      'm4p',
      'm4b',
      'm4r',
      'm4v',
      'wav',
      'wave',
      'flac',
      'aif',
      'aiff',
      'aifc',
      'ogg',
      'ogv',
      'oga',
      'ogx',
      'ogm',
      'spx',
      'opus',
      '3gp',
      'aac',
      'amr',
      '3ga',
      'awb',
      'xwma',
      'webm',
      'ts',
      'tsv',
      'tsa'
    ]
  },
  redisPort: {
    doc: 'Redis port',
    format: 'port',
    env: 'redisPort',
    default: null
  },
  port: {
    doc: 'Port to run service on',
    format: 'port',
    env: 'port',
    default: null
  },
  setTimeout: {
    doc: `
      Sets the timeout value (in ms) for sockets
      https://nodejs.org/dist/latest-v6.x/docs/api/http.html#http_server_settimeout_msecs_callback
    `,
    format: 'nat',
    env: 'setTimeout',
    default: 60 * 60 * 1000 // 1 hour
  },
  timeout: {
    doc: `
      Sets the timeout value (in ms) for socket inactivity
      https://nodejs.org/dist/latest-v6.x/docs/api/http.html#http_server_timeout
    `,
    format: 'nat',
    env: 'timeout',
    default: 60 * 60 * 1000 // 1 hour
  },
  keepAliveTimeout: {
    doc: `
      Server keep alive timeout
      https://nodejs.org/dist/latest-v6.x/docs/api/http.html#http_server_keepalivetimeout
    `,
    format: 'nat',
    env: 'keepAliveTimeout',
    default: 5000 // node.js default value
  },
  headersTimeout: {
    doc: `
      Server headers timeout
      https://nodejs.org/dist/latest-v6.x/docs/api/http.html#http_server_headerstimeout
    `,
    format: 'nat',
    env: 'headersTimeout',
    default: 60 * 1000 // 60s - node.js default value
  },
  logLevel: {
    doc: 'Log level',
    format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace'],
    env: 'logLevel',
    default: null
  },

  /**
   * Rate limit configs
   */
  endpointRateLimits: {
    doc: `A serialized objects of rate limits with the form {
      <req.path>: {
        <req.method>:
          [
            {
              expiry: <seconds>,
              max: <count>
            },
            ...
          ],
          ...
        }
      }
    `,
    format: String,
    env: 'endpointRateLimits',
    default: '{}'
  },
  rateLimitingAudiusUserReqLimit: {
    doc: 'Total requests per hour rate limit for /audius_user routes',
    format: 'nat',
    env: 'rateLimitingAudiusUserReqLimit',
    default: null
  },
  rateLimitingUserReqLimit: {
    doc: 'Total requests per hour rate limit for /users routes',
    format: 'nat',
    env: 'rateLimitingUserReqLimit',
    default: null
  },
  rateLimitingMetadataReqLimit: {
    doc: 'Total requests per hour rate limit for /metadata routes',
    format: 'nat',
    env: 'rateLimitingMetadataReqLimit',
    default: null
  },
  rateLimitingImageReqLimit: {
    doc: 'Total requests per hour rate limit for /image_upload routes',
    format: 'nat',
    env: 'rateLimitingImageReqLimit',
    default: null
  },
  rateLimitingTrackReqLimit: {
    doc: 'Total requests per hour rate limit for /track routes',
    format: 'nat',
    env: 'rateLimitingTrackReqLimit',
    default: null
  },
  rateLimitingBatchCidsExistLimit: {
    doc: 'Total requests per hour rate limit for /track routes',
    format: 'nat',
    env: 'rateLimitingBatchCidsExistLimit',
    default: null
  },
  URSMRequestForSignatureReqLimit: {
    doc: 'Total requests per hour rate limit for /ursm_request_for_signature route',
    format: 'nat',
    env: 'URSMRequestForSignatureReqLimit',
    default: null
  },

  maxAudioFileSizeBytes: {
    doc: 'Maximum file size for audio file uploads in bytes',
    format: 'nat',
    env: 'maxAudioFileSizeBytes',
    default: null
  },
  maxMemoryFileSizeBytes: {
    doc: 'Maximum memory usage for audio file uploads in bytes',
    format: 'nat',
    env: 'maxMemoryFileSizeBytes',
    default: null
  },
  serviceLatitude: {
    doc: 'Latitude where the server running this service is located',
    format: String,
    env: 'serviceLatitude',
    default: null
  },
  serviceLongitude: {
    doc: 'Longitude where the server running this service is located',
    format: String,
    env: 'serviceLongitude',
    default: null
  },
  serviceCountry: {
    doc: 'Country where the server running this service is located',
    format: String,
    env: 'serviceCountry',
    default: null
  },
  sampleRate: {
    doc: 'FFMPEG sample rate',
    format: 'nat',
    env: 'sampleRate',
    default: 48000
  },
  bitRate: {
    doc: 'FFMPEG bit rate',
    format: String,
    env: 'bitRate',
    default: '320k'
  },
  hlsTime: {
    doc: 'Time of each HLS segment',
    format: 'nat',
    env: 'hlsTime',
    default: 6
  },
  hlsSegmentType: {
    doc: 'Segment type of each HLS segment',
    format: String,
    env: 'hlsSegmentType',
    default: 'mpegts'
  },
  printSequelizeLogs: {
    doc: 'If we should print logs from sequelize',
    format: Boolean,
    env: 'printSequelizeLogs',
    default: false
  },

  // Transcoding settings
  transcodingMaxConcurrency: {
    doc: 'Maximum ffmpeg processes to spawn concurrently. If unset (-1), set to # of CPU cores available',
    format: Number,
    env: 'transcodingMaxConcurrency',
    default: -1
  },

  // Image processing settings
  imageProcessingMaxConcurrency: {
    doc: 'Maximum image resizing processes to spawn concurrently. If unset (-1), set to # of CPU cores available',
    format: Number,
    env: 'imageProcessingMaxConcurrency',
    default: -1
  },

  // wallet information
  delegateOwnerWallet: {
    doc: 'wallet address',
    format: String,
    env: 'delegateOwnerWallet',
    default: null
  },
  delegatePrivateKey: {
    doc: 'private key string',
    format: String,
    env: 'delegatePrivateKey',
    default: null
  },
  solDelegatePrivateKeyBase64: {
    doc: 'Base64-encoded Solana private key created using delegatePrivateKey as the seed (auto-generated -- any input here will be overwritten)',
    format: String,
    env: 'solDelegatePrivateKeyBase64',
    default: ''
  },
  // `env` property is not defined as this should never be passed in as an envvar and should only be set programatically
  isRegisteredOnURSM: {
    doc: 'boolean indicating whether or not node has been registered on dataContracts UserReplicaSetManager contract (URSM)',
    format: Boolean,
    default: false
  },

  spID: {
    doc: 'ID of creator node in ethContracts ServiceProviderFactory',
    format: Number,
    env: 'spID',
    default: 0
  },
  ethProviderUrl: {
    doc: 'eth provider url',
    format: String,
    env: 'ethProviderUrl',
    default: null
  },
  ethNetworkId: {
    doc: 'eth network id',
    format: String,
    env: 'ethNetworkId',
    default: null
  },
  ethTokenAddress: {
    doc: 'eth token address',
    format: String,
    env: 'ethTokenAddress',
    default: null
  },
  ethRegistryAddress: {
    doc: 'eth registry address',
    format: String,
    env: 'ethRegistryAddress',
    default: null
  },
  ethOwnerWallet: {
    doc: 'eth owner wallet',
    format: String,
    env: 'ethOwnerWallet',
    default: null
  },
  spOwnerWallet: {
    doc: 'Service provider owner wallet',
    format: String,
    env: 'spOwnerWallet',
    default: null
  },
  ethWallets: {
    doc: 'all unlocked accounts from eth chain',
    format: Array,
    env: 'ethWallets',
    default: []
  },
  spOwnerWalletIndex: {
    doc: 'Index in ethWallets array of service owner wallet',
    format: Number,
    env: 'spOwnerWalletIndex',
    default: 0
  },
  isReadOnlyMode: {
    doc: 'Flag indicating whether to run this node in read only mode (no writes)',
    format: Boolean,
    env: 'isReadOnlyMode',
    default: false
  },
  dataRegistryAddress: {
    doc: 'data contracts registry address',
    format: String,
    env: 'dataRegistryAddress',
    default: null
  },
  dataProviderUrl: {
    doc: 'data contracts web3 provider url',
    format: String,
    env: 'dataProviderUrl',
    default: null
  },
  dataNetworkId: {
    doc: 'data contracts network id',
    format: String,
    env: 'dataNetworkId',
    default: null
  },
  creatorNodeEndpoint: {
    doc: 'http endpoint registered on chain for cnode',
    format: String,
    env: 'creatorNodeEndpoint',
    default: null
  },
  discoveryProviderWhitelist: {
    doc: 'Whitelisted discovery providers to select from (comma-separated)',
    format: String,
    env: 'discoveryProviderWhitelist',
    default: ''
  },
  discoveryNodeUnhealthyBlockDiff: {
    doc: 'Number of missed blocks after which a discovery node would be considered unhealthy',
    format: 'nat',
    env: 'discoveryNodeUnhealthyBlockDiff',
    default: 500
  },
  identityService: {
    doc: 'Identity service endpoint to record creator-node driven plays against',
    format: String,
    env: 'identityService',
    default: ''
  },
  creatorNodeIsDebug: {
    doc: 'Whether the creatornode is in debug mode.',
    format: Boolean,
    env: 'creatorNodeIsDebug',
    default: false
  },
  snapbackHighestReconfigMode: {
    doc: 'Depending on the reconfig op, issue a reconfig or not. See snapbackSM.js for the modes.',
    format: String,
    env: 'snapbackHighestReconfigMode',
    default: 'ONE_SECONDARY'
  },
  devMode: {
    doc: 'Used to differentiate production vs dev mode for node',
    format: 'BooleanCustom',
    env: 'devMode',
    default: false
  },
  maxStorageUsedPercent: {
    doc: 'Max percentage of storage capacity allowed to be used in CNode before blocking writes',
    format: 'nat',
    env: 'maxStorageUsedPercent',
    default: 95
  },
  pinAddCIDs: {
    doc: 'Array of comma separated CIDs to pin',
    format: String,
    env: 'pinAddCIDs',
    default: ''
  },
  cidWhitelist: {
    doc: 'Array of comma separated CIDs to whitelist. Takes precedent over blacklist',
    format: String,
    env: 'cidWhitelist',
    default: ''
  },
  considerNodeUnhealthy: {
    doc: 'Flag to mark the node as unhealthy (health_check will 200 but healthy: false in response). Wont be selected in replica sets, other nodes will roll this node off replica sets for their users',
    format: Boolean,
    env: 'considerNodeUnhealthy',
    default: false
  },

  /** sync / snapback configs */

  syncForceWipeEnabled: {
    doc: "whether or not this node can wipe a user's data from its database during a sync (true = wipe allowed)",
    format: Boolean,
    env: 'syncForceWipeEnabled',
    default: true
  },
  fetchCNodeEndpointToSpIdMapIntervalMs: {
    doc: 'interval (ms) to update the cNodeEndpoint->spId mapping',
    format: 'nat',
    env: 'fetchCNodeEndpointToSpIdMapIntervalMs',
    default: 3_600_000 // 1hr
  },
  stateMonitoringQueueRateLimitInterval: {
    doc: 'interval (ms) during which at most stateMonitoringQueueRateLimitJobsPerInterval monitor-state jobs will run',
    format: 'nat',
    env: 'stateMonitoringQueueRateLimitInterval',
    default: 60_000 // 1m
  },
  stateMonitoringQueueRateLimitJobsPerInterval: {
    doc: 'number of state monitoring jobs that can run in each interval (0 to pause queue)',
    format: 'nat',
    env: 'stateMonitoringQueueRateLimitJobsPerInterval',
    default: 3
  },
  recoverOrphanedDataQueueRateLimitInterval: {
    doc: 'interval (ms) during which at most recoverOrphanedDataQueueRateLimitJobsPerInterval recover-orphaned-data jobs will run',
    format: 'nat',
    env: 'recoverOrphanedDataQueueRateLimitInterval',
    // default: 86_400_000 // 1day
    default: 7_200_000 // 2hrs
  },
  recoverOrphanedDataQueueRateLimitJobsPerInterval: {
    doc: 'number of recover-orphaned-data jobs that can run in each interval (0 to pause queue)',
    format: 'nat',
    env: 'recoverOrphanedDataQueueRateLimitJobsPerInterval',
    default: 0
  },
  debounceTime: {
    doc: 'sync debounce time in ms',
    format: 'nat',
    env: 'debounceTime',
    default: 0 // 0ms
  },
  maxExportClockValueRange: {
    doc: 'Maximum range of clock values to export at once to prevent process OOM',
    format: Number,
    env: 'maxExportClockValueRange',
    default: 10000
  },
  nodeSyncFileSaveMaxConcurrency: {
    doc: 'Max concurrency of saveFileForMultihashToFS calls inside nodesync',
    format: 'nat',
    env: 'nodeSyncFileSaveMaxConcurrency',
    default: 10
  },
  syncQueueMaxConcurrency: {
    doc: 'Max concurrency of SyncQueue',
    format: 'nat',
    env: 'syncQueueMaxConcurrency',
    default: 30
  },
  issueAndWaitForSecondarySyncRequestsPollingDurationMs: {
    doc: 'Duration for which to poll secondaries for content replication in `issueAndWaitForSecondarySyncRequests` function',
    format: 'nat',
    env: 'issueAndWaitForSecondarySyncRequestsPollingDurationMs',
    default: 45000 // 45 seconds (prod default)
  },
  enforceWriteQuorum: {
    doc: 'Boolean flag indicating whether or not primary should reject write until 2/3 replication across replica set',
    format: Boolean,
    env: 'enforceWriteQuorum',
    default: false
  },
  manualSyncsDisabled: {
    doc: 'Disables issuing of manual syncs in order to test state machine Recurring Sync logic.',
    format: 'BooleanCustom',
    env: 'manualSyncsDisabled',
    default: false
  },
  snapbackModuloBase: {
    doc: 'The modulo base to segment users by on snapback. Will process `1/snapbackModuloBase` users at some snapback interval',
    format: 'nat',
    env: 'snapbackModuloBase',
    default: 48
  },
  snapbackUsersPerJob: {
    doc: 'Maximum number of users to process in each SnapbackSM job',
    format: 'nat',
    env: 'snapbackUsersPerJob',
    default: 2000
  },
  maxManualRequestSyncJobConcurrency: {
    doc: 'Max bull queue concurrency for manual sync request jobs',
    format: 'nat',
    env: 'maxManualRequestSyncJobConcurrency',
    default: 15
  },
  maxRecurringRequestSyncJobConcurrency: {
    doc: 'Max bull queue concurrency for recurring sync request jobs',
    format: 'nat',
    env: 'maxRecurringRequestSyncJobConcurrency',
    default: 30
  },
  maxUpdateReplicaSetJobConcurrency: {
    doc: 'Max bull queue concurrency for update replica set jobs',
    format: 'nat',
    env: 'maxUpdateReplicaSetJobConcurrency',
    default: 15
  },
  peerHealthCheckRequestTimeout: {
    doc: 'Timeout [ms] for checking health check route',
    format: 'nat',
    env: 'peerHealthCheckRequestTimeout',
    default: 2000
  },
  minimumMemoryAvailable: {
    doc: 'Minimum memory available [bytes] on node to be a viable option in peer set; 2gb',
    format: 'nat',
    env: 'minimumMemoryAvailable',
    default: 2000000000
  },
  maxFileDescriptorsAllocatedPercentage: {
    doc: 'Max file descriptors allocated percentage on node to be a viable option in peer set',
    format: 'nat',
    env: 'maxFileDescriptorsAllocatedPercentage',
    default: 95
  },
  minimumDailySyncCount: {
    doc: 'Minimum count of daily syncs that need to have occurred to consider daily sync history',
    format: 'nat',
    env: 'minimumDailySyncCount',
    default: 50
  },
  minimumRollingSyncCount: {
    doc: 'Minimum count of rolling syncs that need to have occurred to consider rolling sync history',
    format: 'nat',
    env: 'minimumRollingSyncCount',
    default: 5000
  },
  minimumSuccessfulSyncCountPercentage: {
    doc: 'Minimum percentage of failed syncs to be considered healthy in peer health computation',
    format: 'nat',
    env: 'minimumSuccessfulSyncCountPercentage',
    // TODO: Update to higher percentage when higher threshold of syncs are passing
    default: 0
  },
  minimumSecondaryUserSyncSuccessPercent: {
    doc: 'Minimum percent of successful Syncs for a user on a secondary for the secondary to be considered healthy for that user. Ensures that a single failure will not cycle out secondary.',
    format: 'nat',
    env: 'minimumSecondaryUserSyncSuccessPercent',
    default: 50
  },
  minimumFailedSyncRequestsBeforeReconfig: {
    doc: '[on Primary] Minimum number of failed SyncRequests from Primary before it cycles Secondary out of replica set',
    format: 'nat',
    env: 'minimumFailedSyncRequestsBeforeReconfig',
    default: 20
  },
  maxNumberSecondsPrimaryRemainsUnhealthy: {
    doc: 'The max number of seconds since first failed health check that a primary can still be marked as healthy',
    format: 'nat',
    env: 'maxNumberSecondsPrimaryRemainsUnhealthy',
    // 24 hours in seconds
    default: 86400
  },
  secondaryUserSyncDailyFailureCountThreshold: {
    doc: 'Max number of sync failures for a secondary for a user per day before stopping further SyncRequest issuance',
    format: 'nat',
    env: 'secondaryUserSyncDailyFailureCountThreshold',
    default: 20
  },
  maxSyncMonitoringDurationInMs: {
    doc: 'Max duration that primary will monitor secondary for syncRequest completion for non-manual syncs',
    format: 'nat',
    env: 'maxSyncMonitoringDurationInMs',
    default: 300000 // 5min (prod default)
  },
  maxManualSyncMonitoringDurationInMs: {
    doc: 'Max duration that primary will monitor secondary for syncRequest completion for manual syncs',
    format: 'nat',
    env: 'maxManualSyncMonitoringDurationInMs',
    default: 45000 // 45 sec (prod default)
  },
  skippedCIDsRetryQueueJobIntervalMs: {
    doc: 'Interval (ms) for SkippedCIDsRetryQueue Job Processing',
    format: 'nat',
    env: 'skippedCIDsRetryQueueJobIntervalMs',
    default: 3600000 // 1hr in ms
  },
  skippedCIDRetryQueueMaxAgeHr: {
    doc: 'Max age (hours) of skipped CIDs to retry in SkippedCIDsRetryQueue',
    format: 'nat',
    env: 'skippedCIDRetryQueueMaxAgeHr',
    default: 8760 // 1 year in hrs
  },
  contentCacheLayerEnabled: {
    doc: 'Flag to enable or disable the nginx cache layer that caches content. DO NOT SET THIS HERE, set in the Dockerfile because it needs to be set above the application layer',
    format: 'BooleanCustom',
    env: 'contentCacheLayerEnabled',
    default: false
  },
  reconfigNodeWhitelist: {
    doc: 'Comma separated string - list of Content Nodes to select from for reconfig. Empty string = whitelist all.',
    format: String,
    env: 'reconfigNodeWhitelist',
    default: ''
  },
  maximumTranscodingActiveJobs: {
    doc: 'The maximum number of active jobs the TranscodingQueue can have at a given moment. Will be the number of cores in the running machine, or a custom size',
    format: 'nat',
    env: 'maximumTranscodingActiveJobs',
    default: os.cpus().length
  },
  maximumTranscodingWaitingJobs: {
    doc: 'The maximum number of waiting jobs the TranscodingQueue can have at a given moment. Will be the number of cores in the running machine, or a custom size',
    format: 'nat',
    env: 'maximumTranscodingWaitingJobs',
    default: os.cpus().length
  },
  trustedNotifierID: {
    doc: 'To select a trusted notifier, set to a value >= 1 corresponding to the index of the notifier on chain. 0 means no trusted notifier selected and self manage notifications',
    format: 'nat',
    env: 'trustedNotifierID',
    default: 1
  },
  nodeOperatorEmailAddress: {
    doc: 'Email address for the node operator where they will respond in a timely manner. Must be defined if trustedNotifierID is set to 0',
    format: String,
    env: 'nodeOperatorEmailAddress',
    default: ''
  },
  maxBatchClockStatusBatchSize: {
    doc: 'Maximum number of wallets the /users/batch_clock_status route will accept at one time',
    format: 'nat',
    env: 'maxBatchClockStatusBatchSize',
    default: 5000
  },
  audiusContentInfraSetup: {
    doc: 'How the content node infrastructure stack is running, injected by the infra directly, not to be defined manually',
    format: String,
    env: 'audiusContentInfraSetup',
    default: ''
  },
  monitorStateJobLastSuccessfulRunDelayMs: {
    doc: 'Max time delay since last monitor-state job successfully ran (milliseconds)',
    format: 'nat',
    env: 'monitorStateJobLastSuccessfulRunDelayMs',
    default: 10 * 60 * 1000 // 10 mins
  },
  findSyncRequestsJobLastSuccessfulRunDelayMs: {
    doc: 'Max time delay since last find-sync-requests job successfully ran (milliseconds)',
    format: 'nat',
    env: 'findSyncRequestsJobLastSuccessfulRunDelayMs',
    default: 10 * 60 * 1000 // 10 mins
  },
  findReplicaSetUpdatesJobLastSuccessfulRunDelayMs: {
    doc: 'Max time delay since last find-replica-set-updates job successfully ran (milliseconds)',
    format: 'nat',
    env: 'findReplicaSetUpdatesJobLastSuccessfulRunDelayMs',
    default: 10 * 60 * 1000 // 10 mins
  },
  disableSnapback: {
    doc: 'True to not run any snapback queues (old state machine and old syncs)',
    format: Boolean,
    env: 'disableSnapback',
    default: true
  },
  mergePrimaryAndSecondaryEnabled: {
    doc: 'True to enable issuing sync requests with sync mode = mergePrimaryAndSecondary',
    format: Boolean,
    env: 'mergePrimaryAndSecondaryEnabled',
    default: false
  },
  findCIDInNetworkEnabled: {
    doc: 'enable findCIDInNetwork lookups',
    format: Boolean,
    env: 'findCIDInNetworkEnabled',
    default: true
  }
  /**
   * unsupported options at the moment
   */

  // awsBucket: {
  //   doc: 'AWS S3 bucket to upload files to',
  //   format: String,
  //   env: 'awsBucket',
  //   default: null
  // },
  // awsAccessKeyId: {
  //   doc: 'AWS access key id',
  //   format: String,
  //   env: 'awsAccessKeyId',
  //   default: null
  // },
  // awsSecretAccessKey: {
  //   doc: 'AWS access key secret',
  //   format: String,
  //   env: 'awsSecretAccessKey',
  //   default: null
  // }
})

/*
 * If you wanted to load a file, this is lower precendence than env variables.
 * So if registryAddress or ownerWallet env variables are defined, they take precendence.
 */

const pathTo = (fileName) => path.join(process.cwd(), fileName)

// TODO(DM) - remove these defaults
const defaultConfigExists = fs.existsSync('default-config.json')
if (defaultConfigExists) config.loadFile('default-config.json')

if (fs.existsSync(pathTo('eth-contract-config.json'))) {
  const ethContractConfig = require(pathTo('eth-contract-config.json'))
  config.load({
    ethTokenAddress: ethContractConfig.audiusTokenAddress,
    ethRegistryAddress: ethContractConfig.registryAddress,
    ethOwnerWallet: ethContractConfig.ownerWallet,
    ethWallets: ethContractConfig.allWallets
  })
}

if (fs.existsSync(pathTo('contract-config.json'))) {
  const dataContractConfig = require(pathTo('contract-config.json'))
  config.load({
    dataRegistryAddress: dataContractConfig.registryAddress
  })
}

// Perform validation and error any properties are not present on schema
config.validate()

// Retrieves and populates IP info configs
const asyncConfig = async () => {
  try {
    const ipinfo = await axios.get('https://ipinfo.io')
    const country = ipinfo.data.country
    const [lat, long] = ipinfo.data.loc.split(',')

    if (!config.get('serviceCountry')) config.set('serviceCountry', country)
    if (!config.get('serviceLatitude')) config.set('serviceLatitude', lat)
    if (!config.get('serviceLongitude')) config.set('serviceLongitude', long)
  } catch (e) {
    console.error(
      `config.js:asyncConfig(): Failed to retrieve IP info || ${e.message}`
    )
  }
}

config.asyncConfig = asyncConfig

module.exports = config
