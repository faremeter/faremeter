import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";

import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const network = "devnet";
const connection = new Connection(clusterApiUrl(network), "confirmed");
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

await createTestToken(connection, keypair);
