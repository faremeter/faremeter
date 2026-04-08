/**
 * @title Squads Multisig Wallet Package
 * @sidebarTitle Wallet Squads
 * @description Squads multisig wallet integration for Solana
 * @packageDocumentation
 *
 * NOTE: This package retains @solana/web3.js v1 as a direct dependency
 * because @sqds/multisig has no @solana/kit-compatible version. It
 * exposes a kit-typed Wallet bridge so Faremeter callers can stay on
 * the kit-native payment-solana/exact flow. A future kit
 * reimplementation of the Squads instruction builders is a follow-up.
 */
import {
  type Connection,
  type Keypair,
  type PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
  PublicKey as SolanaPublicKey,
} from "@solana/web3.js";
import {
  AccountRole,
  address,
  type Address,
  type Blockhash,
  type Instruction,
  type Transaction as KitTransaction,
} from "@solana/kit";
import { getTransactionDecoder } from "@solana/transactions";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";
import { logger } from "./logger";

function toV1Instruction(ix: Instruction): TransactionInstruction {
  if (!ix.accounts || !ix.data) {
    throw new Error(
      "squads bridge requires instructions with accounts and data",
    );
  }
  return new TransactionInstruction({
    programId: new SolanaPublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => ({
      pubkey: new SolanaPublicKey(a.address),
      isSigner:
        a.role === AccountRole.WRITABLE_SIGNER ||
        a.role === AccountRole.READONLY_SIGNER,
      isWritable:
        a.role === AccountRole.WRITABLE_SIGNER ||
        a.role === AccountRole.WRITABLE,
    })),
    data: Buffer.from(ix.data),
  });
}

/**
 * Creates a Squads multisig wallet for Solana.
 *
 * Wraps the Squads SDK (still on @solana/web3.js v1 internally) and
 * exposes a kit-typed Wallet via a bridge: callers pass kit
 * `Instruction`s, the package converts them to v1 `TransactionInstruction`s,
 * runs them through the full @sqds/multisig proposal + approve + execute
 * flow, serializes the resulting v1 VersionedTransaction, and decodes
 * the bytes as a kit `Transaction`.
 *
 * @param network - Solana network identifier.
 * @param connection - Solana RPC connection (v1).
 * @param keypair - Admin keypair for creating and signing proposals.
 * @param multisigPda - Program-derived address of the Squads multisig.
 * @param squadMember - Additional squad member keypair for approval quorum.
 * @returns A wallet object that builds and executes multisig transactions.
 */
export async function createSquadsWallet(
  network: string,
  connection: Connection,
  keypair: Keypair,
  multisigPda: PublicKey,
  squadMember: Keypair,
) {
  const publicKey: Address = address(keypair.publicKey.toBase58());

  return {
    network,
    publicKey,
    buildTransaction: async (
      instructions: readonly Instruction[],
      lifetimeConstraint: {
        blockhash: Blockhash;
        lastValidBlockHeight: bigint;
      },
    ): Promise<KitTransaction> => {
      const v1Instructions = instructions.map(toV1Instruction);

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

      const testTransferMessage = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash: lifetimeConstraint.blockhash,
        instructions: v1Instructions,
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
      logger.info(
        `Create vault transaction with signature: ${createVaultTxSignature}`,
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
      logger.info(
        `Create proposal transaction with signature: ${createProposalTxSignature}`,
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

      logger.info(
        `Approve vault transaction with signature: ${approveProposalTxSignature}`,
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

      const v1Tx = new VersionedTransaction(message);
      v1Tx.sign([keypair]);

      if (v1Tx.signatures[0] === undefined) {
        throw new Error("vault transaction is undefined");
      }

      logger.info(
        `Execute vault transaction signature: ${bs58.encode(v1Tx.signatures[0])}`,
      );

      // Bridge the v1 VersionedTransaction back to a kit Transaction by
      // serializing to wire bytes and running them through the kit
      // Transaction decoder.
      const wireBytes = v1Tx.serialize();
      return getTransactionDecoder().decode(wireBytes);
    },
  };
}
