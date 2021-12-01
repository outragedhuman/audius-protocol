const axios = require('axios')
const Web3 = require('web3')
const solanaWeb3 = require('@solana/web3.js')
const { Keypair } = solanaWeb3
const requireESM = require("esm")(module)
const {
  getSignedVAA,
  getEmitterAddressEth,
  parseSequenceFromLogEth,
  redeemOnSolana,
  postVaaSolana,
  CHAIN_ID_ETH
} = requireESM('@certusone/wormhole-sdk')
const EthRewardManagerABI = require('../../eth-contracts/ABIs/EthRewardsManager.json').abi

const { grpc } = require("@improbable-eng/grpc-web")
const { NodeHttpTransport } = require("@improbable-eng/grpc-web-node-http-transport")

// Do this first, before you make any grpc requests!
grpc.setDefaultTransport(NodeHttpTransport());


/*
Script that has no internal dependencies outside of web3, solanaWeb3, certusOne SDK to initialize and transfer
*/

const ETH_PROVIDER = 'https://mainnet.infura.io/v3/a3ed533ddfca4c76ab4df7556e2745e1'
const SOLANA_CLUSTER_ENDPOINT = 'https://api.mainnet-beta.solana.com'
const ETH_BRIDGE_ADDRESS = '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'
const SOL_BRIDGE_ADDRESS = 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth'
const ETH_TOKEN_BRIDGE_ADDRESS = '0x3ee18B2214AFF97000D974cf647E7C347E8fa585'
const SOL_TOKEN_BRIDGE_ADDRESS = 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb'
const WAUDIO_MINT_ADDRESS = 'BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7'

// https://github.com/certusone/wormhole/blob/7f5740754b8d722c42310be086dc21efa7ed8c83/bridge_ui/src/utils/consts.ts#L150
const WORMHOLE_RPC_HOSTS = [
  "https://wormhole-v2-mainnet-api.certus.one",
  "https://wormhole.inotel.ro",
  "https://wormhole-v2-mainnet-api.mcf.rocks",
  "https://wormhole-v2-mainnet-api.chainlayer.network",
  "https://wormhole-v2-mainnet-api.staking.fund",
  "https://wormhole-v2-mainnet-api.chainlayer.network",
]

const NUM_RETRIES_RECEIPT = 5
const RETRY_DELAY_MS_RECEIPT = 1000
const NUM_RETRIES_VAA = 10
const RETRY_DELAY_MS_VAA = 2000

// Test deployment from 9/22
const ETH_REWARD_MANAGER_ADDRESS = '0xF9B0871d3A8dc365f6231653f7D879c9578ED039'
const TEST_PRIVATE_KEY = process.env.testPrivateKey
const FEE_PAYER_SECRET_KEY = process.env.feePayerAddress

const feePayerSecretKey = Uint8Array.from(JSON.parse(FEE_PAYER_SECRET_KEY))
const feePayerKeypair = Keypair.fromSecretKey(feePayerSecretKey)
const feePayerPublicKey = feePayerKeypair.publicKey
const feePayerAddress = feePayerPublicKey.toString()

const web3 = new Web3(ETH_PROVIDER)
const ethAccount = web3.eth.accounts.wallet.add(TEST_PRIVATE_KEY)

const arbiterFee = 2 // todo: maybe we can optimize this?
const nonce = 2

async function getGasPrice() {
  try {
    const gasPrices = await axios.get(
      'https://ethgasstation.info/json/ethgasAPI.json'
    )
    return web3.utils.toWei((gasPrices.data.fastest / 10).toString(), 'gwei')
  } catch (err) {
    console.error(
      `Got ${err} when trying to fetch gas from ethgasstation.info, falling back web3's gas estimation`
    )
    return (await web3.eth.getGasPrice()).toString()
  }
}

// "Fetch the signedVAA from the Wormhole Network (this may require retries while you wait for confirmation)"
// https://github.com/certusone/wormhole/blob/c824a996360103eb2147bc43f7b0f7e3b989bdf5/sdk/js/src/rpc/getSignedVAAWithRetry.ts#L3
const getSignedVAAWithRetry = async function (
  hosts,
  emitterChain,
  emitterAddress,
  sequence,
  extraGrpcOpts = {},
  retryTimeout = RETRY_DELAY_MS_VAA,
  retryAttempts = NUM_RETRIES_VAA
) {
  let currentWormholeRpcHost = -1;
  const getNextRpcHost = () => ++currentWormholeRpcHost % hosts.length;
  let result;
  let attempts = 0;
  while (!result) {
    console.log('attempt #', attempts)
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, retryTimeout));
    try {
      result = await getSignedVAA(
        hosts[getNextRpcHost()],
        emitterChain,
        emitterAddress,
        sequence,
        extraGrpcOpts
      );
    } catch (e) {
      if (retryAttempts !== undefined && attempts > retryAttempts) {
        throw e;
      }
    }
  }
  return result;
}

async function run() {
  try {
    const ethRewardsManagerContract = new web3.eth.Contract(
      EthRewardManagerABI,
      ETH_REWARD_MANAGER_ADDRESS
    )
    const gasPrice = await getGasPrice()
    console.log({ gasPrice })

    const txResp = await ethRewardsManagerContract.methods.transferToSolana(
      arbiterFee,
      nonce
    ).send({
      from: ethAccount.address,
      gas: 200000,
      gasPrice
    })
    console.log({ txResp })

    const txHash = txResp.transactionHash
    console.log({ txHash })

    // Temp for testing
    // https://etherscan.io/tx/0x9b290ac6db60371227573fcb76b325b63abaace091a1908b441713ee2c5df5c9
    // const txHash = '0x9b290ac6db60371227573fcb76b325b63abaace091a1908b441713ee2c5df5c9'
    // const txHash = '0x5d77a96a2fb6002cd9ed673b1f033c8bf6a31e443be879f63c0f438b6260471b'
    // const txHash = '0x39b266b8e07e669289b241a210ce5b0b11ada8e51a33d2511338089ec8696030'
    // const txHash = '0xac66b2ffa1d76d35512584f5af6f181cec7817ca44768a43a15f189bbfe676ea'
    // const txHash = '0x6c5930a95c5e9f295d3ee320713a5a22fedb473cd622156405245849dc8db9a7'

    const getReceipt = async (txHash, numRetries) => {
      console.log(`transferCommunityRewardsToSolana.js | txHash ${txHash} | ${numRetries} retries left`)
      if (numRetries <= 0) {
        return null
      }
      const txReceipt = await web3.eth.getTransactionReceipt(txHash)
      if (!txReceipt) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS_RECEIPT))
        return getReceipt(numRetries - 1)
      }
      return txReceipt
    }

    const txReceipt = await getReceipt(txHash, NUM_RETRIES_RECEIPT)
    console.log({ txReceipt })
    if (!txReceipt) {
      return
    }

    const connection = new solanaWeb3.Connection(SOLANA_CLUSTER_ENDPOINT)

    const sequence = parseSequenceFromLogEth(txReceipt, ETH_BRIDGE_ADDRESS)
    const emitterAddress = getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS)
    console.log({ sequence, emitterAddress })

    // const { vaaBytes } = await getSignedVAA(
    const { vaaBytes } = await getSignedVAAWithRetry(
      WORMHOLE_RPC_HOSTS,
      CHAIN_ID_ETH,
      emitterAddress,
      sequence
    )
    console.log({ vaaBytes })

    const signTransaction = async (transaction) => {
      transaction.partialSign(feePayerKeypair);
      return transaction;
    }

    await postVaaSolana(
      connection,
      signTransaction,
      SOL_BRIDGE_ADDRESS,
      feePayerAddress,
      vaaBytes
    );

    const transaction = await redeemOnSolana(
      connection,
      SOL_BRIDGE_ADDRESS,
      SOL_TOKEN_BRIDGE_ADDRESS,
      feePayerAddress,
      vaaBytes,
      /* isSolanaNative */ false, // todo: is this line correct?
      /* mintAddress */ WAUDIO_MINT_ADDRESS
    );
    console.log({ transaction })
    const signed = await signTransaction(transaction);
    console.log({ signed })
    const txid = await connection.sendRawTransaction(signed.serialize());
    console.log({ txid })
    await connection.confirmTransaction(txid);
    console.log('Success!')
  } catch (e) {
    console.error(e)
    console.log(`Error: ${e.message}`)
  }
}

run()
