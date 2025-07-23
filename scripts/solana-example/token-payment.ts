import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createLocalWallet } from "@faremeter/wallet-solana";
import { createTokenPaymentHandler } from "@faremeter/x402-solana";
import { wrap as wrapFetch } from "@faremeter/fetch";
import type { RequestContext, x402PaymentRequirements } from "@faremeter/types";
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

const mint = await createTestToken(connection, keypair);

const wallet = await createLocalWallet(network, keypair);
const handler = createTokenPaymentHandler(wallet, mint);

const fetchWithPayer = wrapFetch(fetch, {
  handlers: [
    async (ctx: RequestContext, accepts: x402PaymentRequirements[]) => {
      const req = accepts[0];

      if (req === undefined) {
        throw new Error("no payment requirements found!");
      }

      // XXX - This is a temporary hack to make sure the funds
      // receiving account exists.  This will get removed once the
      // mint configuration has been pushed to the server example.

      await getOrCreateAssociatedTokenAccount(
        connection,
        keypair,
        mint,
        new PublicKey(req.payTo),
      );

      return handler(ctx, accepts);
    },
  ],
});

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");

console.log(await req.json());
