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
const WORMHOLE_RPC_HOST = 'https://wormhole-v2-mainnet-api.certus.one'
const ETH_BRIDGE_ADDRESS = '0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B'
const SOL_BRIDGE_ADDRESS = 'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth'
const ETH_TOKEN_BRIDGE_ADDRESS = '0x3ee18B2214AFF97000D974cf647E7C347E8fa585'
const SOL_TOKEN_BRIDGE_ADDRESS = 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb'
const WAUDIO_MINT_ADDRESS = 'BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7'

// Test deployment from 9/22
const ETH_REWARD_MANAGER_ADDRESS = '0xF9B0871d3A8dc365f6231653f7D879c9578ED039'
const TEST_PRIVATE_KEY = process.env.testPrivateKey
const FEE_PAYER_SECRET_KEY = process.env.feePayerAddress

const feePayerSecretKey = Uint8Array.from(JSON.parse(FEE_PAYER_SECRET_KEY))
const feePayerKeypair = Keypair.fromSecretKey(feePayerSecretKey)
const feePayerPublicKey = feePayerKeypair.publicKey
const feePayerAddress = feePayerPublicKey.toString()
console.log(feePayerSecretKey, feePayerPublicKey, feePayerAddress)

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

async function run() {
  try {
    // const ethRewardsManagerContract = new web3.eth.Contract(
    //   EthRewardManagerABI,
    //   ETH_REWARD_MANAGER_ADDRESS
    // )
    // const gasPrice = await getGasPrice()
    // console.log({ gasPrice })

    // const txResp = await ethRewardsManagerContract.methods.transferToSolana(
    //   arbiterFee,
    //   nonce
    // ).send({
    //   from: ethAccount.address,
    //   gas: 200000,
    //   gasPrice
    // })
    // console.log({ txResp })

    // const txHash = txResp.transactionHash
    // console.log({ txHash })

    // Temp for testing
    // https://etherscan.io/tx/0x9b290ac6db60371227573fcb76b325b63abaace091a1908b441713ee2c5df5c9
    const txHash = '0x9b290ac6db60371227573fcb76b325b63abaace091a1908b441713ee2c5df5c9'

    const txReceipt = await web3.eth.getTransactionReceipt(txHash)
    console.log({ txReceipt })

    const connection = new solanaWeb3.Connection(SOLANA_CLUSTER_ENDPOINT)

    const sequence = parseSequenceFromLogEth(txReceipt, ETH_BRIDGE_ADDRESS)
    const emitterAddress = getEmitterAddressEth(ETH_TOKEN_BRIDGE_ADDRESS)
    console.log({ sequence, emitterAddress })

    const { vaaBytes } = await getSignedVAA(
      WORMHOLE_RPC_HOST,
      CHAIN_ID_ETH,
      emitterAddress,
      sequence
    )
    console.log({ vaaBytes })

    // const SOLANA_PRIVATE_KEY = new Uint8Array([
    //   14, 173, 153, 4, 176, 224, 201, 111, 32, 237, 183, 185, 159, 247, 22, 161, 89,
    //   84, 215, 209, 212, 137, 10, 92, 157, 49, 29, 192, 101, 164, 152, 70, 87, 65,
    //   8, 174, 214, 157, 175, 126, 98, 90, 54, 24, 100, 177, 247, 77, 19, 112, 47,
    //   44, 165, 109, 233, 102, 14, 86, 109, 29, 134, 145, 132, 141,
    // ]);
    // const keypair = Keypair.fromSecretKey(SOLANA_PRIVATE_KEY);
    const signTransaction = async (transaction) => {
      console.log('joeeeeeeeeeee')
      console.log('SIGN', transaction.signatures)
      // transaction.signTransaction(feePayerKeypair)
      transaction.partialSign(feePayerKeypair);
      console.log('SIGN AFTER', transaction.signatures)
      // transaction.partialSign(keypair);
      return transaction;
    }

    await postVaaSolana(
      connection,
      // undefined,
      // ()=>{},
      // feePayerPublicKey,
      // web3.eth.signTransaction,
      // feePayerPublicKey.signTransaction,
      signTransaction,
      SOL_BRIDGE_ADDRESS,
      feePayerAddress,
      // keypair.publicKey.toString(),
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
    // const signed = await feePayerPublicKey.signTransaction(transaction);
    // const signed = await web3.eth.signTransaction(transaction);
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
