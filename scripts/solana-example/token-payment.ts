import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createPaymentSplTransaction } from "@faremeter/x402-solana/solana";
import type {
  PaymentRequirements,
  PaymentResponse,
} from "@faremeter/x402-solana/types";
import { createPaymentHeader } from "@faremeter/x402-solana/header";
import fs from "fs";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const createTestToken = async (
  connection: Connection,
  payer: Keypair,
  decimals = 6,
): Promise<PublicKey> => {
  try {
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      payer.publicKey,
      decimals,
    );

    console.log(`Created new test token: ${mint.toString()}`);

    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      payer.publicKey,
    );

    const amountToMint = 1000000 * Math.pow(10, decimals);
    await mintTo(
      connection,
      payer,
      mint,
      tokenAccount.address,
      payer.publicKey,
      amountToMint,
    );

    console.log(
      `Minted ${1000000} tokens to ${tokenAccount.address.toString()}`,
    );
    return mint;
  } catch (error) {
    console.error("Error creating test token:", error);
    throw error;
  }
};

const testTokenPayment = async () => {
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const keypair = Keypair.fromSecretKey(
    Uint8Array.from(
      JSON.parse(fs.readFileSync("../keypairs/payer.json", "utf-8")),
    ),
  );
  const url = "http://127.0.0.1:3000/protected";

  const initialResponse = (await (await fetch(url)).json()) as PaymentResponse;
  const { address, admin, amount } = initialResponse;

  const paymentRequirements: PaymentRequirements = {
    receiver: new PublicKey(address),
    admin: new PublicKey(admin),
    amount: Number(amount),
  };

  const mint = await createTestToken(connection, keypair);

  await getOrCreateAssociatedTokenAccount(
    connection,
    keypair,
    mint,
    paymentRequirements.receiver,
  );

  const tx = await createPaymentSplTransaction(
    connection,
    paymentRequirements,
    mint,
    keypair,
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

testTokenPayment();
