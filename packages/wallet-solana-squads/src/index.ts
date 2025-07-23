import {
  type Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import bs58 from "bs58";

export async function createSquadsWallet(
  network: string,
  connection: Connection,
  keypair: Keypair,
  multisigPda: PublicKey,
  squadMember: Keypair,
) {
  return {
    network,
    publicKey: keypair.publicKey,
    buildTransaction: async (
      instructions: TransactionInstruction[],
    ): Promise<VersionedTransaction> => {
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

      const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const testTransferMessage = new TransactionMessage({
        payerKey: vaultPda,
        recentBlockhash,
        instructions,
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

      return tx;
    },
  };
}
