import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import fs from "fs";
import { createSolPaymentInstruction } from "@faremeter/x402-solana/solana";
import type {
  PaymentRequirements,
  PaymentResponse,
} from "@faremeter/x402-solana/types";
import { createPaymentHeader } from "@faremeter/x402-solana/header";
import bs58 from "bs58";

const { Permission, Permissions } = multisig.types;

const transferSol = async (
  connection: Connection,
  receiver: PublicKey,
  sender: Keypair,
  amount: number,
) => {
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: receiver,
      lamports: amount * 1000000000,
    }),
  );

  await sendAndConfirmTransaction(connection, transaction, [sender]);
};

const testSquadsMultisigPayment = async () => {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("../keypairs/payer.json", "utf-8")),
    ),
  );
  const url = "http://127.0.0.1:3000/protected";

  const createKey = Keypair.generate();
  const squadMember = Keypair.generate();

  await transferSol(connection, squadMember.publicKey, keypair, 0.002);
  await transferSol(connection, createKey.publicKey, keypair, 0.002);

  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });

  const programConfigPda = multisig.getProgramConfigPda({})[0];
  const programConfig =
    await multisig.accounts.ProgramConfig.fromAccountAddress(
      connection,
      programConfigPda,
    );

  const createSquadInstruction = multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey,
    creator: keypair.publicKey,
    multisigPda,
    configAuthority: null,
    timeLock: 0,
    members: [
      {
        key: keypair.publicKey,
        permissions: Permissions.all(),
      },
      {
        key: squadMember.publicKey,
        permissions: Permissions.fromPermissions([Permission.Vote]),
      },
    ],
    threshold: 2,
    treasury: programConfig.treasury,
    rentCollector: null,
  });

  const transaction = new Transaction().add(createSquadInstruction);
  const squadCreateSignature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [keypair, createKey],
  );

  console.log("Created squad with signature", squadCreateSignature);

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

  const initialResponse = (await (await fetch(url)).json()) as PaymentResponse;
  const { address, admin, amount } = initialResponse;

  const paymentRequirements: PaymentRequirements = {
    receiver: new PublicKey(address),
    admin: new PublicKey(admin),
    amount: Number(amount),
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

  const createVaultInstruction = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: newTransactionIndex,
    creator: keypair.publicKey,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: testTransferMessage,
    memo: "Our first transfer!",
  });

  const createVaultTransaction = new Transaction().add(createVaultInstruction);
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

  const { instruction } = await multisig.instructions.vaultTransactionExecute({
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

  console.log(
    "Execute vault transaction signature",
    bs58.encode(tx.signatures[0]),
  );

  const header = createPaymentHeader(tx, keypair);

  const secondResponse = await (
    await fetch(url, {
      headers: {
        "X-PAYMENT": header,
      },
    })
  ).json();

  console.log(secondResponse);
};

testSquadsMultisigPayment();
