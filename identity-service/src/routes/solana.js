const express = require('express')
const crypto = require('crypto')

const config = require('../config')
const { handleResponse, successResponse, errorResponseServerError } = require('../apiHelpers')
const { getFeePayer } = require('../solana-client')

const solanaEndpoint = "https://audius.rpcpool.com" // config.get('solanaEndpoint')

const {
  Connection,
  PublicKey,
  Secp256k1Program,
  sendAndConfirmTransaction,
  sendAndConfirmRawTransaction,
  Transaction,
  TransactionInstruction
} = require('@solana/web3.js')

const solanaRouter = express.Router()
const connection = new Connection(solanaEndpoint)

// Check that an instruction has all the necessary data
const isValidInstruction = (instr) => {
  if (!instr || !Array.isArray(instr.keys) || !instr.programId || !instr.data) return false
  if (!instr.keys.every(key => !!key.pubkey)) return false
  return true
}

const isValidTransactionSignature = (signature) => {
  if (!signature || !signature.pubkey) return false
  return true
}

solanaRouter.post('/relay', handleResponse(async (req, res, next) => {
  const redis = req.app.get('redis')
  const { serializedTx, recentBlockhash, secpInstruction, instruction = {}, instructions = [], signatures = [] } = req.body

  const reqBodySHA = crypto.createHash('sha256').update(JSON.stringify({ secpInstruction, instruction })).digest('hex')

  try {
    // const tx = new Transaction({ recentBlockhash })
    const tx = Transaction.from(Buffer.from(serializedTx))

    // if (secpInstruction) {
    //   const secpTransactionInstruction = Secp256k1Program.createInstructionWithPublicKey({
    //     publicKey: Buffer.from(secpInstruction.publicKey),
    //     message: (new PublicKey(secpInstruction.message)).toBytes(),
    //     signature: Buffer.from(secpInstruction.signature),
    //     recoveryId: secpInstruction.recoveryId
    //   })
    //   tx.add(secpTransactionInstruction)
    // }

    // [instruction].concat(instructions).filter(isValidInstruction).forEach((instr) => {
    //   const keys = instr.keys.map(key => ({
    //     pubkey: new PublicKey(key.pubkey),
    //     isSigner: key.isSigner,
    //     isWritable: key.isWritable
    //   }))
    //   const txInstruction = new TransactionInstruction({
    //     keys,
    //     programId: new PublicKey(instr.programId),
    //     data: Buffer.from(instr.data)
    //   })
    //   tx.add(txInstruction)
    // })

    req.logger.info('adding signatures')

    const feePayerAccount = getFeePayer()
    // tx.feePayer = feePayerAccount.publicKey
    req.logger.info(`Fee payer is ${feePayerAccount.publicKey.toString()}`)
    req.logger.info(tx.signatures)

    // signatures.filter(isValidTransactionSignature).forEach((sig) => {
    //   tx.addSignature(new PublicKey(sig.pubkey), Buffer.from(sig.signature))
    // })
    req.logger.info(tx.signatures)
    req.logger.info('now sign')

    tx.partialSign(feePayerAccount)

    req.logger.info({ feePayer: feePayerAccount.publicKey.toString(), signatures, tx: tx.signatures})

    const isVerified = tx.verifySignatures()
    req.logger.info(`Is signagture verified: ${isVerified}`)
    req.logger.info(tx.serialize())
    req.logger.info(`diod serialize`)

    const res = await sendAndConfirmRawTransaction(
      connection,
      tx.serialize(), {
      skipPreflight: true,
      commitment: 'processed',
      preflightCommitment: 'processed'
    })
    // const transactionSignature = await sendAndConfirmTransaction(
    //   connection,
    //   tx,
    //   [],
    //   {
    //     skipPreflight: true,
    //     commitment: 'processed',
    //     preflightCommitment: 'processed'
    //   }
    // )

    return successResponse({ res })
  } catch (e) {
    // if the tx fails, store it in redis with a 24 hour expiration
    await redis.setex(`solanaFailedTx:${reqBodySHA}`, 60 /* seconds */ * 60 /* minutes */ * 24 /* hours */, JSON.stringify(req.body))

    req.logger.error(e)
    req.logger.error('Error in solana transaction:', e.message, reqBodySHA)
    return errorResponseServerError(`Something caused the solana transaction to fail for payload ${reqBodySHA}`)
  }
}))

module.exports = function (app) {
  app.use('/solana', solanaRouter)
}
