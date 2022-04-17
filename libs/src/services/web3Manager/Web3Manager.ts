import Web3 from '../../web3'
import sigUtil from 'eth-sig-util'
import retry from 'async-retry'
import { ContractMethod, estimateGas } from '../../utils'
import { AudiusABIDecoder } from '../ABIDecoder'
import EthereumWallet from 'ethereumjs-wallet'
import { XMLHttpRequest } from './XMLHttpRequest'
import type { Web3Config } from './Web3Config'
import type { IdentityService, Receipt } from '../identity'
import type { Hedgehog } from '@audius/hedgehog'
import type Web3Type from 'web3'
import type { HttpProvider } from 'web3-core'
import type { EIP712TypedData } from 'eth-sig-util'
import type { DecodedLog } from 'abi-decoder'

const DEFAULT_GAS_LIMIT = 2000000

/** singleton class to be instantiated and persisted with every AudiusLibs */
export class Web3Manager {
  web3Config: Web3Config
  isServer: boolean
  identityService: IdentityService
  hedgehog: Hedgehog
  AudiusABIDecoder: typeof AudiusABIDecoder
  web3: Web3Type | undefined
  useExternalWeb3: boolean | undefined
  // @ts-expect-error an error is thrown if it's not provided
  ownerWallet: EthereumWallet

  constructor(
    web3Config: Web3Config,
    identityService: IdentityService,
    hedgehog: Hedgehog,
    isServer: boolean
  ) {
    this.web3Config = web3Config
    this.isServer = isServer

    // Unset if externalWeb3 = true
    this.identityService = identityService
    this.hedgehog = hedgehog
    this.AudiusABIDecoder = AudiusABIDecoder
  }

  async init() {
    const web3Config = this.web3Config
    if (!web3Config) throw new Error('Failed to initialize Web3Manager')

    if (
      // External Web3
      web3Config?.useExternalWeb3 &&
      web3Config.externalWeb3Config?.web3 &&
      web3Config.externalWeb3Config.ownerWallet
    ) {
      this.web3 = web3Config.externalWeb3Config.web3
      this.useExternalWeb3 = true
      this.ownerWallet = web3Config.externalWeb3Config.ownerWallet
    } else if (
      // Internal Web3
      web3Config &&
      !web3Config.useExternalWeb3 &&
      web3Config.internalWeb3Config?.web3ProviderEndpoints
    ) {
      // either user has external web3 but it's not configured, or doesn't have web3
      this.web3 = new Web3(
        this.provider(
          web3Config.internalWeb3Config.web3ProviderEndpoints[0] as string,
          10000
        )
      )
      this.useExternalWeb3 = false

      if (web3Config.internalWeb3Config.privateKey) {
        const pkeyBuffer = Buffer.from(
          web3Config.internalWeb3Config.privateKey,
          'hex'
        )
        this.ownerWallet = EthereumWallet.fromPrivateKey(pkeyBuffer)
        return
      }

      // create private key pair here if it doesn't already exist
      const storedWallet = this.hedgehog.getWallet()
      if (storedWallet) {
        this.ownerWallet = storedWallet
      } else {
        const passwordEntropy = `audius-dummy-pkey-${Math.floor(
          Math.random() * 1000000
        )}`
        this.ownerWallet = await this.hedgehog.createWalletObj(passwordEntropy)
      }
    } else {
      throw new Error("web3ProviderEndpoint isn't passed into constructor")
    }
  }

  getWeb3() {
    return this.web3 as Web3Type
  }

  setWeb3(web3: Web3Type) {
    this.web3 = web3
  }

  getWalletAddress() {
    if (this.useExternalWeb3) {
      // Lowercase the owner wallet. Consider using the checksum address.
      // See https://github.com/ethereum/EIPs/blob/master/EIPS/eip-55.md.
      // @ts-expect-error Wallet type doesn't have `toLowerCase` method?
      return this.ownerWallet.toLowerCase()
    } else {
      return this.ownerWallet.getAddressString()
    }
  }

  setOwnerWallet(ownerWallet: EthereumWallet) {
    this.ownerWallet = ownerWallet
  }

  web3IsExternal() {
    return this.useExternalWeb3
  }

  getOwnerWalletPrivateKey() {
    if (this.useExternalWeb3) {
      throw new Error("Can't get owner wallet private key for external web3")
    } else {
      return this.ownerWallet.getPrivateKey()
    }
  }

  /**
   * Signs provided string data (should be timestamped).
   * @param data
   */
  async sign(data: string) {
    if (this.useExternalWeb3) {
      const account = this.getWalletAddress()
      if (this.isServer) {
        return await this.web3?.eth.sign(
          this.web3.utils.fromUtf8(data),
          account
        )
      } else {
        return await this.web3?.eth.personal.sign(
          this.web3.utils.fromUtf8(data),
          account,
          ''
        )
      }
    }

    return sigUtil.personalSign(this.getOwnerWalletPrivateKey(), { data })
  }

  /**
   * Given a data payload and signature, verifies that signature is valid, and returns
   * Ethereum wallet address used to sign data.
   * @param data information that was signed
   * @param signature hex-formatted signature of data generated by web3 personalSign method
   */
  async verifySignature(data: string, signature: string) {
    return sigUtil.recoverPersonalSignature({ data: data, sig: signature })
  }

  async signTypedData(signatureData: EIP712TypedData) {
    if (this.useExternalWeb3) {
      return await ethSignTypedData(
        this.getWeb3(),
        this.getWalletAddress(),
        signatureData
      )
    } else {
      // Due to changes in ethereumjs-util's toBuffer method as of v6.2.0
      // non hex-prefixed string values are not permitted and need to be
      // provided directly as a buffer.
      // https://github.com/ethereumjs/ethereumjs-util/releases/tag/v6.2.0
      Object.keys(signatureData.message).forEach((key) => {
        const message = signatureData.message[key]
        if (typeof message === 'string' && !message.startsWith('0x')) {
          signatureData.message[key] = Buffer.from(message)
        }
      })
      return sigUtil.signTypedData(this.ownerWallet.getPrivateKey(), {
        data: signatureData
      })
    }
  }

  async sendTransaction(
    contractMethod: ContractMethod,
    contractRegistryKey: string,
    contractAddress: string,
    txRetries = 5,
    txGasLimit?: number
  ) {
    const gasLimit =
      txGasLimit ??
      (await estimateGas({
        method: contractMethod,
        gasLimitMaximum: DEFAULT_GAS_LIMIT
      }))
    if (this.useExternalWeb3) {
      return contractMethod.send({ from: this.ownerWallet, gas: gasLimit })
    } else {
      const encodedABI = contractMethod.encodeABI()

      const response = await retry(
        async () => {
          return await this.identityService.relay(
            contractRegistryKey,
            contractAddress,
            this.ownerWallet.getAddressString(),
            encodedABI,
            gasLimit
          )
        },
        {
          // Retry function 5x by default
          // 1st retry delay = 500ms, 2nd = 1500ms, 3rd...nth retry = 4000 ms (capped)
          minTimeout: 500,
          maxTimeout: 4000,
          factor: 3,
          retries: txRetries,
          onRetry: (err) => {
            if (err) {
              console.log(
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                `libs web3Manager transaction send retry error : ${err}`
              )
            }
          }
        }
      )

      const receipt = response.receipt

      // interestingly, using contractMethod.send from Metamask's web3 (eg. like in the if
      // above) parses the event log into an 'events' key on the transaction receipt and
      // blows away the 'logs' key. However, using sendRawTransaction as our
      // relayer does, returns only the logs. Here, we replicate the part of the 'events'
      // key that our code consumes, but we may want to change our functions to consume
      // this data in a different way in future (this parsing is messy).
      // More on Metamask's / Web3.js' behavior here:
      // https://web3js.readthedocs.io/en/1.0/web3-eth-contract.html#methods-mymethod-send
      if (receipt.logs) {
        const events: Receipt['events'] = {}
        // TODO: decodeLogs appears to return DecodedLog, not DecodedLog[] so maybe a type/version issue
        const decoded = this.AudiusABIDecoder.decodeLogs(
          contractRegistryKey,
          receipt.logs
        ) as unknown as DecodedLog[]
        decoded.forEach((evt) => {
          const returnValues: Record<string, string> = {}
          evt.events.forEach((arg) => {
            returnValues[arg.name] = arg.value
          })
          events[evt.name] = { returnValues }
        })
        receipt.events = events
      }
      return response.receipt
    }
  }

  // TODO - Remove this. Adapted from https://github.com/raiden-network/webui/pull/51/files
  // Vendored code below
  provider(url: string, timeout: number) {
    return this.monkeyPatchProvider(
      new Web3.providers.HttpProvider(url, { timeout })
    )
  }

  // TODO: Workaround for https://github.com/ethereum/web3.js/issues/1803 it should be immediately removed
  // as soon as the issue is fixed upstream.
  // Issue is also documented here https://github.com/ethereum/web3.js/issues/1802
  monkeyPatchProvider(httpProvider: HttpProvider) {
    // @ts-expect-error overriding a private method not appearing in types
    override(httpProvider, '_prepareRequest', function () {
      return function (
        this: HttpProvider & {
          timeout: number
          headers: Array<{ name: string; value: string }>
        }
      ) {
        const request = new XMLHttpRequest()

        request.open('POST', this.host, true)
        request.setRequestHeader('Content-Type', 'application/json')
        request.timeout = this.timeout && this.timeout !== 1 ? this.timeout : 0

        if (this.headers) {
          this.headers.forEach(function (header) {
            request.setRequestHeader(header.name, header.value)
          })
        }
        return request
      }
    })
    return httpProvider
  }
  // End vendored code
}

/** Browser and testing-compatible signTypedData */
const ethSignTypedData = async (
  web3: Web3Type,
  wallet: EthereumWallet,
  signatureData: EIP712TypedData
) => {
  return await new Promise((resolve, reject) => {
    let processedSignatureData: EIP712TypedData | string = signatureData
    let method
    // @ts-expect-error isMetaMask not captured by web3Provider
    if (web3.currentProvider.isMetaMask === true) {
      method = 'eth_signTypedData_v3'
      processedSignatureData = JSON.stringify(signatureData)
    } else {
      method = 'eth_signTypedData'
      // fix per https://github.com/ethereum/web3.js/issues/1119
    }

    ;(web3.currentProvider as HttpProvider).send(
      {
        method: method,
        params: [wallet, processedSignatureData],
        // @ts-expect-error from not in JsonRpcPayload
        from: wallet
      },
      (err, result) => {
        if (err) {
          reject(err)
        } else if (result?.error) {
          reject(result?.error)
        } else {
          resolve(result?.result)
        }
      }
    )
  })
}

function override<Class, K extends keyof Class, T extends Class[K] & Function>(
  object: Class,
  methodName: K,
  callback: T
) {
  object[methodName] = callback(object[methodName])
}
