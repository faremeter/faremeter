import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createTokenPaymentHandler } from "@faremeter/x402-solana";
import { wrap as wrapFetch } from "@faremeter/fetch";
import fs from "fs";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
const keypair = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(fs.readFileSync("../keypairs/payer.json", "utf-8")),
  ),
);

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

const mint = await createTestToken(connection, keypair);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [createTokenPaymentHandler(connection, keypair, mint)],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");

console.log(await req.json());
