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

solanaRouter.post('/relay', handleResponse(async (req, res, next) => {
  const redis = req.app.get('redis')
  const { recentBlockhash, secpInstruction, instruction = {}, instructions = [] } = req.body

  const reqBodySHA = crypto.createHash('sha256').update(JSON.stringify({ secpInstruction, instruction, instructions })).digest('hex')

  try {
    const tx = new Transaction({ recentBlockhash })

    if (secpInstruction) {
      const secpTransactionInstruction = Secp256k1Program.createInstructionWithPublicKey({
        publicKey: Buffer.from(secpInstruction.publicKey),
        message: (new PublicKey(secpInstruction.message)).toBytes(),
        signature: Buffer.from(secpInstruction.signature),
        recoveryId: secpInstruction.recoveryId
      })
      tx.add(secpTransactionInstruction)
    }

    [instruction].concat(instructions).filter(isValidInstruction).forEach((instr) => {
      const keys = instr.keys.map(key => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable
      }))
      const txInstruction = new TransactionInstruction({
        keys,
        programId: new PublicKey(instr.programId),
        data: Buffer.from(instr.data)
      })
      tx.add(txInstruction)
    })

    const feePayerAccount = getFeePayer()
    tx.sign(feePayerAccount)

    const transactionSignature = await sendAndConfirmTransaction(
      connection,
      tx,
      [feePayerAccount],
      {
        skipPreflight: true,
        commitment: 'processed',
        preflightCommitment: 'processed'
      }
    )

    return successResponse({ transactionSignature })
  } catch (e) {
    // if the tx fails, store it in redis with a 24 hour expiration
    await redis.setex(`solanaFailedTx:${reqBodySHA}`, 60 /* seconds */ * 60 /* minutes */ * 24 /* hours */, JSON.stringify(req.body))

    req.logger.error(e)
    req.logger.error('Error in solana transaction:', e.message, reqBodySHA)
    return errorResponseServerError(`Something caused the solana transaction to fail for payload ${reqBodySHA}`)
  }
}))

solanaRouter.post('/relay/raw', handleResponse(async (req, res, next) => {
  const redis = req.app.get('redis')
  const { recentBlockhash, secpInstruction, instruction = {}, instructions = [], signatures = [] } = req.body

  const reqBodySHA = crypto.createHash('sha256').update(JSON.stringify({ secpInstruction, instruction, instructions, signatures })).digest('hex')

  try {
    const tx = new Transaction({ recentBlockhash })

    if (secpInstruction) {
      const secpTransactionInstruction = Secp256k1Program.createInstructionWithPublicKey({
        publicKey: Buffer.from(secpInstruction.publicKey),
        message: (new PublicKey(secpInstruction.message)).toBytes(),
        signature: Buffer.from(secpInstruction.signature),
        recoveryId: secpInstruction.recoveryId
      })
      tx.add(secpTransactionInstruction)
    }

    [instruction].concat(instructions).filter(isValidInstruction).forEach((instr) => {
      const keys = instr.keys.map(key => ({
        pubkey: new PublicKey(key.pubkey),
        isSigner: key.isSigner,
        isWritable: key.isWritable
      }))
      const txInstruction = new TransactionInstruction({
        keys,
        programId: new PublicKey(instr.programId),
        data: Buffer.from(instr.data)
      })
      tx.add(txInstruction)
    })

    // Manually attach each signature ot the transaction
    signatures.forEach(sig => {
      tx.signatures.push({
        publicKey: new PublicKey(sig.publicKey),
        signature: sig.signature ? Buffer.from(sig.signature): sig.signature
      })
    })


    const feePayerAccount = getFeePayer()
    tx.partialSign(feePayerAccount)


    const transactionSignature = await sendAndConfirmRawTransaction(
      connection,
      tx.serialize(), {
      skipPreflight: true,
      commitment: 'processed',
      preflightCommitment: 'processed'
    })

    return successResponse({ transactionSignature })
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
