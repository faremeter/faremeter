import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createPaymentTransaction } from "@faremeter/x402-solana/solana";
import type {
  PaymentRequirements,
  PaymentResponse,
} from "@faremeter/x402-solana/types";
import { createPaymentHeader } from "@faremeter/x402-solana/header";
import fs from "fs";

const testSolPayment = async () => {
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

  const tx = await createPaymentTransaction(
    connection,
    paymentRequirements,
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

testSolPayment();
