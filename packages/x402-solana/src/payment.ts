/* eslint-disable @typescript-eslint/no-non-null-assertion */
//
// Disable checks for no-non-null-assertions until this is
// production ready.
//

import {
  type Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import {
  createPaymentTransaction,
  createPaymentSplTransaction,
  createSolPaymentInstruction,
} from "./solana";
import { createPaymentHeader } from "./header";
import type { RequestContext, PaymentRequirements } from "@faremeter/types";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import bs58 from "bs58";
import * as multisig from "@sqds/multisig";
import {
  createCrossmint,
  CrossmintWallets,
  SolanaWallet,
} from "@crossmint/wallets-sdk";

export function createBasicPaymentHandler(
  connection: Connection,
  keypair: Keypair,
) {
  return async (ctx: RequestContext, accepts: PaymentRequirements[]) => {
    // XXX - We need to decide how to filter for possibilities.
    const requirements = accepts[0]!;

    const exec = async () => {
      const tx = await createPaymentTransaction(
        connection,
        {
          // XXX - we need to map over to the x402 requirements.
          amount: Number(requirements.maxAmountRequired),
          receiver: new PublicKey(requirements.payTo),
          admin: new PublicKey(requirements.asset),
        },
        keypair.publicKey,
      );
      tx.sign([keypair]);

      const header = createPaymentHeader(keypair.publicKey, tx);
      return {
        headers: {
          "X-PAYMENT": header,
        },
      };
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}

export function createTokenPaymentHandler(
  connection: Connection,
  keypair: Keypair,
  mint: PublicKey,
) {
  return async (ctx: RequestContext, accepts: PaymentRequirements[]) => {
    // XXX - We need to decide how to filter for possibilities.
    const requirements = accepts[0]!;

    const exec = async () => {
      await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        mint,
        new PublicKey(requirements.payTo),
      );

      const paymentRequirements = {
        // XXX - we need to map over to the x402 requirements.
        amount: Number(requirements.maxAmountRequired),
        receiver: new PublicKey(requirements.payTo),
        admin: new PublicKey(requirements.asset),
      };

      const tx = await createPaymentSplTransaction(
        connection,
        paymentRequirements,
        mint,
        keypair.publicKey,
      );
      tx.sign([keypair]);

      const header = createPaymentHeader(keypair.publicKey, tx);

      return {
        headers: {
          "X-PAYMENT": header,
        },
      };
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}

export function createSquadsPaymentHandler(
  connection: Connection,
  keypair: Keypair,
  multisigPda: PublicKey,
  squadMember: Keypair,
) {
  return async (ctx: RequestContext, accepts: PaymentRequirements[]) => {
    // XXX - We need to decide how to filter for possibilities.
    const requirements = accepts[0]!;

    const exec = async () => {
      const [vaultPda] = multisig.getVaultPda({
        multisigPda,
        index: 0,
      });

      const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda,
      );

      const currentTransactionIndex = Number(multisigInfo.transactionIndex);
      const newTransactionIndex = BigInt(currentTransactionIndex + 1);

      const paymentRequirements = {
        // XXX - we need to map over to the x402 requirements.
        amount: Number(requirements.maxAmountRequired),
        receiver: new PublicKey(requirements.payTo),
        admin: new PublicKey(requirements.asset),
      };

      const createPaymentInstruction = await createSolPaymentInstruction(
        paymentRequirements,
        keypair.publicKey,
      );

      const testTransferMessage = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [createPaymentInstruction],
      });

      const createVaultInstruction =
        multisig.instructions.vaultTransactionCreate({
          multisigPda,
          transactionIndex: newTransactionIndex,
          creator: keypair.publicKey,
          vaultIndex: 0,
          ephemeralSigners: 0,
          transactionMessage: testTransferMessage,
          memo: "Our first transfer!",
        });

      const createVaultTransaction = new Transaction().add(
        createVaultInstruction,
      );
      const createVaultTxSignature = await sendAndConfirmTransaction(
        connection,
        createVaultTransaction,
        [keypair],
      );
      console.log(
        "Create vault transaction with signature",
        createVaultTxSignature,
      );

      const createProposalInstruction = multisig.instructions.proposalCreate({
        multisigPda,
        transactionIndex: newTransactionIndex,
        creator: keypair.publicKey,
      });

      const createProposalTransaction = new Transaction().add(
        createProposalInstruction,
      );
      const createProposalTxSignature = await sendAndConfirmTransaction(
        connection,
        createProposalTransaction,
        [keypair],
      );
      console.log(
        "Create proposal transaction with signature",
        createProposalTxSignature,
      );

      const adminApproveInstruction = multisig.instructions.proposalApprove({
        multisigPda,
        transactionIndex: newTransactionIndex,
        member: keypair.publicKey,
      });

      const memberApproveInstruction = multisig.instructions.proposalApprove({
        multisigPda,
        transactionIndex: newTransactionIndex,
        member: squadMember.publicKey,
      });

      const approveProposalTransaction = new Transaction().add(
        adminApproveInstruction,
        memberApproveInstruction,
      );
      const approveProposalTxSignature = await sendAndConfirmTransaction(
        connection,
        approveProposalTransaction,
        [keypair, squadMember],
      );
      console.log(
        "Approve vault transaction with signature",
        approveProposalTxSignature,
      );

      const { instruction } =
        await multisig.instructions.vaultTransactionExecute({
          connection,
          multisigPda,
          transactionIndex: newTransactionIndex,
          member: keypair.publicKey,
        });

      const { blockhash } = await connection.getLatestBlockhash("confirmed");

      const message = new TransactionMessage({
        instructions: [instruction],
        payerKey: keypair.publicKey,
        recentBlockhash: blockhash,
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([keypair]);

      if (tx.signatures[0] === undefined) {
        throw new Error("vault transaction is undefined");
      }

      console.log(
        "Execute vault transaction signature",
        bs58.encode(tx.signatures[0]),
      );

      const header = createPaymentHeader(keypair.publicKey, tx);

      return {
        headers: {
          "X-PAYMENT": header,
        },
      };
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}

export function createCrossmintPaymentHandler(
  connection: Connection,
  crossmintApiKey: string,
  crossmintWalletAddress: string,
) {
  return async (ctx: RequestContext, accepts: PaymentRequirements[]) => {
    const requirements = accepts[0]!;

    const exec = async () => {
      const crossmint = createCrossmint({
        apiKey: crossmintApiKey,
      });
      const crossmintWallets = CrossmintWallets.from(crossmint);
      const wallet = await crossmintWallets.getWallet(crossmintWalletAddress, {
        chain: "solana",
        signer: {
          type: "api-key",
        },
      });
      console.log(wallet.address);

      const solanaWallet = SolanaWallet.from(wallet);
      const walletPubkey = new PublicKey(solanaWallet.address);

      const tx = await createPaymentTransaction(
        connection,
        {
          // XXX - we need to map over to the x402 requirements.
          amount: Number(requirements.maxAmountRequired),
          receiver: new PublicKey(requirements.payTo),
          admin: new PublicKey(requirements.asset),
        },
        walletPubkey,
      );

      const solTx = await solanaWallet.sendTransaction({
        transaction: tx as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      });

      console.log(solTx);

      const header = createPaymentHeader(walletPubkey, undefined, solTx.hash);
      return {
        headers: {
          "X-PAYMENT": header,
        },
      };
    };

    return [
      {
        exec,
        requirements,
      },
    ];
  };
}
