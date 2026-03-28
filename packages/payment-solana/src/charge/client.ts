import type {
  MPPPaymentHandler,
  MPPPaymentExecer,
  mppChallengeParams,
  mppCredential,
} from "@faremeter/types/mpp";
import { decodeBase64URL } from "@faremeter/types/mpp";
import { isValidationError } from "@faremeter/types";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { Wallet } from "../exact";
import { mppChargeRequest } from "./common";

async function broadcastAndConfirm(
  tx: VersionedTransaction,
  wallet: Wallet,
  connection: Connection,
  challenge: mppChallengeParams,
  md: mppChargeRequest["methodDetails"],
  recentBlockhash: string,
): Promise<mppCredential> {
  if (md?.feePayer) {
    throw new Error("push mode is not allowed with fee sponsorship");
  }

  const { lastValidBlockHeight } = await connection.getLatestBlockhash({
    commitment: "confirmed",
  });

  let signature: string;
  if (wallet.sendTransaction) {
    signature = await wallet.sendTransaction(tx);
  } else {
    signature = await connection.sendRawTransaction(tx.serialize());
  }

  await connection.confirmTransaction(
    { signature, blockhash: recentBlockhash, lastValidBlockHeight },
    "confirmed",
  );

  return {
    challenge,
    payload: { type: "signature", signature },
  };
}

export type CreateMPPSolanaChargeClientArgs = {
  wallet: Wallet;
  mint: PublicKey;
  connection?: Connection;
  tokenProgramId?: PublicKey;
  broadcast?: boolean;
};

export function createMPPSolanaChargeClient(
  args: CreateMPPSolanaChargeClientArgs,
): MPPPaymentHandler {
  const { wallet, mint, connection, broadcast = false } = args;

  if (broadcast && !connection) {
    throw new Error("connection is required when broadcast is true");
  }

  return async (
    challenge: mppChallengeParams,
  ): Promise<MPPPaymentExecer | null> => {
    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency === "sol") return null;

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const md = request.methodDetails;
        const amount = BigInt(request.amount);
        const recipientKey = new PublicKey(request.recipient);
        const feePayerKey = md?.feePayer === true ? md.feePayerKey : undefined;

        let recentBlockhash: string;
        if (md?.recentBlockhash) {
          recentBlockhash = md.recentBlockhash;
        } else if (connection) {
          recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        } else {
          throw new Error("no blockhash available");
        }

        let decimals: number;
        if (md?.decimals !== undefined) {
          decimals = md.decimals;
        } else if (connection) {
          const mintInfo = await getMint(connection, mint);
          decimals = mintInfo.decimals;
        } else {
          throw new Error("no decimals available");
        }

        const tokenProgramId = md?.tokenProgram
          ? new PublicKey(md.tokenProgram)
          : (args.tokenProgramId ?? TOKEN_PROGRAM_ID);

        const sourceAccount = getAssociatedTokenAddressSync(
          mint,
          wallet.publicKey,
          false,
          tokenProgramId,
        );

        const receiverAccount = getAssociatedTokenAddressSync(
          mint,
          recipientKey,
          false,
          tokenProgramId,
        );

        const instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
          createTransferCheckedInstruction(
            sourceAccount,
            mint,
            receiverAccount,
            wallet.publicKey,
            amount,
            decimals,
            undefined,
            tokenProgramId,
          ),
        ];

        const payerKey = feePayerKey
          ? new PublicKey(feePayerKey)
          : wallet.publicKey;

        let tx: VersionedTransaction;
        if (wallet.buildTransaction) {
          tx = await wallet.buildTransaction(instructions, recentBlockhash);
        } else {
          const message = new TransactionMessage({
            instructions,
            payerKey,
            recentBlockhash,
          }).compileToV0Message();

          tx = new VersionedTransaction(message);
        }

        if (wallet.partiallySignTransaction) {
          tx = await wallet.partiallySignTransaction(tx);
        }

        if (broadcast) {
          if (!connection) throw new Error("connection is required");
          return broadcastAndConfirm(
            tx,
            wallet,
            connection,
            challenge,
            md,
            recentBlockhash,
          );
        }

        const wireBytes = tx.serialize();
        const base64Transaction = btoa(
          String.fromCharCode.apply(null, [...wireBytes]),
        );

        return {
          challenge,
          payload: {
            type: "transaction",
            transaction: base64Transaction,
          },
        };
      },
    };
  };
}

export type CreateMPPSolanaNativeChargeClientArgs = {
  wallet: Wallet;
  connection?: Connection;
  broadcast?: boolean;
};

export function createMPPSolanaNativeChargeClient(
  args: CreateMPPSolanaNativeChargeClientArgs,
): MPPPaymentHandler {
  const { wallet, connection, broadcast = false } = args;

  if (broadcast && !connection) {
    throw new Error("connection is required when broadcast is true");
  }

  return async (
    challenge: mppChallengeParams,
  ): Promise<MPPPaymentExecer | null> => {
    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency !== "sol") return null;

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const md = request.methodDetails;
        const amount = BigInt(request.amount);
        const recipientKey = new PublicKey(request.recipient);
        const feePayerKey = md?.feePayer === true ? md.feePayerKey : undefined;

        let recentBlockhash: string;
        if (md?.recentBlockhash) {
          recentBlockhash = md.recentBlockhash;
        } else if (connection) {
          recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        } else {
          throw new Error("no blockhash available");
        }

        const instructions = [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
          SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: recipientKey,
            lamports: amount,
          }),
        ];

        const payerKey = feePayerKey
          ? new PublicKey(feePayerKey)
          : wallet.publicKey;

        let tx: VersionedTransaction;
        if (wallet.buildTransaction) {
          tx = await wallet.buildTransaction(instructions, recentBlockhash);
        } else {
          const message = new TransactionMessage({
            instructions,
            payerKey,
            recentBlockhash,
          }).compileToV0Message();

          tx = new VersionedTransaction(message);
        }

        if (wallet.partiallySignTransaction) {
          tx = await wallet.partiallySignTransaction(tx);
        }

        if (broadcast) {
          if (!connection) throw new Error("connection is required");
          return broadcastAndConfirm(
            tx,
            wallet,
            connection,
            challenge,
            md,
            recentBlockhash,
          );
        }

        const wireBytes = tx.serialize();
        const base64Transaction = btoa(
          String.fromCharCode.apply(null, [...wireBytes]),
        );

        return {
          challenge,
          payload: {
            type: "transaction",
            transaction: base64Transaction,
          },
        };
      },
    };
  };
}
