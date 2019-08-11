const AudiusLibs = require('@audius/libs')
const Web3 = require('web3')
const config = require('./config.js')

async function setupAndRun () {
  const registryAddress = config.get('registryAddress')
  const web3ProviderUrl = config.get('web3Provider')
  const dataWeb3 = new Web3(new Web3.providers.HttpProvider(web3ProviderUrl))

  const audiusInstance = new AudiusLibs({
    web3Config: AudiusLibs.configExternalWeb3(registryAddress, dataWeb3),
    isServer: true
  })

  await audiusInstance.init()
  return audiusInstance
}

module.exports = setupAndRun
