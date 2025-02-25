import {
  DiscoveryProvider,
  DiscoveryProviderConfig
} from '../services/discoveryProvider'
import { EthContracts, EthContractsConfig } from '../services/ethContracts'
import { EthWeb3Config, EthWeb3Manager } from '../services/ethWeb3Manager'
import { IdentityService, IdentityServiceConfig } from '../services/identity'
import { UserStateManager } from '../userStateManager'
import { Oauth } from './oauth'
import { TracksApi } from './api/TracksApi'
import { ResolveApi } from './api/ResolveApi'
import {
  Configuration,
  PlaylistsApi,
  UsersApi,
  TipsApi,
  querystring
} from './api/generated/default'
import {
  Configuration as ConfigurationFull,
  PlaylistsApi as PlaylistsApiFull,
  ReactionsApi as ReactionsApiFull,
  SearchApi as SearchApiFull,
  TracksApi as TracksApiFull,
  UsersApi as UsersApiFull,
  TipsApi as TipsApiFull,
  TransactionsApi as TransactionsApiFull
} from './api/generated/full'

import {
  CLAIM_DISTRIBUTION_CONTRACT_ADDRESS,
  ETH_OWNER_WALLET,
  ETH_PROVIDER_URLS,
  ETH_REGISTRY_ADDRESS,
  ETH_TOKEN_ADDRESS,
  IDENTITY_SERVICE_ENDPOINT,
  WORMHOLE_ADDRESS
} from './constants'
import { getPlatformLocalStorage, LocalStorage } from '../utils/localStorage'
import type { SetOptional } from 'type-fest'

type Web3Config = {
  providers: string[]
}

type SdkConfig = {
  /**
   * Your app name
   */
  appName: string
  /**
   * Configuration for the DiscoveryProvider client
   */
  discoveryProviderConfig?: Omit<
    DiscoveryProviderConfig,
    'userStateManager' | 'ethContracts' | 'web3Manager'
  >
  /**
   * Configuration for the Ethereum contracts client
   */
  ethContractsConfig?: Omit<EthContractsConfig, 'ethWeb3Manager'>
  /**
   * Configuration for the Ethereum Web3 client
   */
  ethWeb3Config: SetOptional<EthWeb3Config, 'ownerWallet'>
  /**
   * Configuration for the IdentityService client
   */
  identityServiceConfig?: IdentityServiceConfig
  /**
   * Optional custom local storage
   */
  localStorage?: LocalStorage
  /**
   * Configuration for Web3
   */
  web3Config?: Web3Config
}

/**
 * The Audius SDK
 */
export const sdk = (config: SdkConfig) => {
  const { appName } = config

  // Initialize services
  const { discoveryProvider } = initializeServices(config)

  // Initialize APIs
  const apis = initializeApis({ appName, discoveryProvider })

  // Initialize OAuth
  const oauth =
    typeof window !== 'undefined'
      ? new Oauth({ discoveryProvider, appName })
      : undefined

  return {
    oauth,
    ...apis
  }
}

const initializeServices = (config: SdkConfig) => {
  const {
    discoveryProviderConfig,
    ethContractsConfig,
    ethWeb3Config,
    identityServiceConfig,
    localStorage = getPlatformLocalStorage()
  } = config

  const userStateManager = new UserStateManager({ localStorage })

  const identityService = new IdentityService({
    identityServiceEndpoint: IDENTITY_SERVICE_ENDPOINT,
    ...identityServiceConfig
  })

  const ethWeb3Manager = new EthWeb3Manager({
    identityService,
    web3Config: {
      ownerWallet: ETH_OWNER_WALLET,
      ...ethWeb3Config,
      providers: formatProviders(ethWeb3Config?.providers ?? ETH_PROVIDER_URLS)
    }
  })

  const ethContracts = new EthContracts({
    ethWeb3Manager,
    tokenContractAddress: ETH_TOKEN_ADDRESS,
    registryAddress: ETH_REGISTRY_ADDRESS,
    claimDistributionContractAddress: CLAIM_DISTRIBUTION_CONTRACT_ADDRESS,
    wormholeContractAddress: WORMHOLE_ADDRESS,
    ...ethContractsConfig
  })

  const discoveryProvider = new DiscoveryProvider({
    ethContracts,
    userStateManager,
    localStorage,
    ...discoveryProviderConfig
  })

  return { discoveryProvider }
}

const initializeApis = ({
  appName,
  discoveryProvider
}: {
  appName: string
  discoveryProvider: DiscoveryProvider
}) => {
  const initializationPromise = discoveryProvider.init()

  const fetchApi = async (url: string, context?: RequestInit) => {
    // Ensure discovery node is initialized
    await initializationPromise

    // Append the appName to the query params
    const urlWithAppName =
      url + (url.includes('?') ? '&' : '?') + querystring({ app_name: appName })
    const requestParams: Record<string, unknown> = {
      ...context,
      endpoint: urlWithAppName
    }
    return await discoveryProvider._makeRequest(
      requestParams,
      undefined,
      undefined,
      // Throw errors instead of returning null
      true
    )
  }

  const generatedApiClientConfig = new Configuration({
    fetchApi
  })

  const tracks = new TracksApi(generatedApiClientConfig, discoveryProvider)
  const users = new UsersApi(generatedApiClientConfig)
  const playlists = new PlaylistsApi(generatedApiClientConfig)
  const tips = new TipsApi(generatedApiClientConfig)
  const { resolve } = new ResolveApi(generatedApiClientConfig)

  const generatedApiClientConfigFull = new ConfigurationFull({
    fetchApi
  })

  const full = {
    tracks: new TracksApiFull(generatedApiClientConfigFull),
    users: new UsersApiFull(generatedApiClientConfigFull),
    search: new SearchApiFull(generatedApiClientConfigFull),
    playlists: new PlaylistsApiFull(generatedApiClientConfigFull),
    reactions: new ReactionsApiFull(generatedApiClientConfigFull),
    tips: new TipsApiFull(generatedApiClientConfigFull),
    transactions: new TransactionsApiFull(generatedApiClientConfigFull)
  }

  return {
    tracks,
    users,
    playlists,
    tips,
    resolve,
    full
  }
}

const formatProviders = (providers: string | string[]) => {
  if (typeof providers === 'string') {
    return providers.split(',')
  } else if (Array.isArray(providers)) {
    return providers
  } else {
    throw new Error('Providers must be of type string, Array, or Web3 instance')
  }
}
