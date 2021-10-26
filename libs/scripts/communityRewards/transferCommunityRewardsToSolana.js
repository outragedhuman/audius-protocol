import Web3 from 'web3'
import axios from 'axios'
// const WormholeSDK = require('@certusone/wormhole-sdk')
// import { getSignedVAA } from '@certusone/wormhole-sdk'
const EthRewardManagerABI = require('../../eth-contracts/ABIs/EthRewardsManager.json').abi 
import { WormholeSDK } from '@certusone/wormhole-sdk'

/*
Script that has no internal dependencies outside of web3, solanaWeb3, certusOne SDK to initialize and transfer
*/

const ETH_PROVIDER = 'https://mainnet.infura.io/v3/a3ed533ddfca4c76ab4df7556e2745e1'
// Test deployment from 9/22
const ETH_REWARD_MANAGER_ADDRESS = '0xF9B0871d3A8dc365f6231653f7D879c9578ED039'
const TEST_PRIVATE_KEY = '949af9ca4db3d5977fe8270bd8686fad1cb3798dde764ba411929483b42f4cdd'

const web3 = new Web3(ETH_PROVIDER)
const ethAccount = web3.eth.accounts.wallet.add(TEST_PRIVATE_KEY)
const arbiterFee = 2
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


async function run () {
    /*
    const ethRewardsManagerContract = new web3.eth.Contract(
        EthRewardManagerABI,
        ETH_REWARD_MANAGER_ADDRESS
    )
    let gasPrice = await getGasPrice()
    let txResp = await ethRewardsManagerContract.methods.transferToSolana(
        arbiterFee,
        nonce
    ).send({
        from: ethAccount.address,
        gas: 200000,
        gasPrice
    })
    console.log(txResp)
    let txHash = txResp.transactionHash
    */

    // Temp for testing
    // https://etherscan.io/tx/0x9b290ac6db60371227573fcb76b325b63abaace091a1908b441713ee2c5df5c9
    let txHash = '0x9b290ac6db60371227573fcb76b325b63abaace091a1908b441713ee2c5df5c9'
    let txReceipt = await web3.eth.getTransactionReceipt(txHash)
    console.log(txReceipt)
}

run()