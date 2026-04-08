import "dotenv/config";
import { logger } from "../logger";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getCreateAccountInstruction } from "@solana-program/system";
import fs from "fs";

const { PAYER_KEYPAIR_PATH, PAYTO_KEYPAIR_PATH } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}
if (!PAYTO_KEYPAIR_PATH) {
  throw new Error("PAYTO_KEYPAIR_PATH must be set in your environment");
}

const payer = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8"))),
);

const payTo = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(fs.readFileSync(PAYTO_KEYPAIR_PATH, "utf-8"))),
);

const decimals = 6;

const rpc = createSolanaRpc("https://api.devnet.solana.com");
const rpcSubscriptions = createSolanaRpcSubscriptions(
  "wss://api.devnet.solana.com",
);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions,
});

const mintSigner = await generateKeyPairSigner();
const mintSpace = BigInt(getMintSize());
const mintRent = await rpc.getMinimumBalanceForRentExemption(mintSpace).send();

const { value: blockhash } = await rpc.getLatestBlockhash().send();

const createMintMessage = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayerSigner(payer, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
  (m) =>
    appendTransactionMessageInstructions(
      [
        getCreateAccountInstruction({
          payer,
          newAccount: mintSigner,
          lamports: mintRent,
          space: mintSpace,
          programAddress: TOKEN_PROGRAM_ADDRESS,
        }),
        getInitializeMint2Instruction({
          mint: mintSigner.address,
          decimals,
          mintAuthority: payer.address,
          freezeAuthority: payer.address,
        }),
      ],
      m,
    ),
);

const createMintTx = await signTransactionMessageWithSigners(createMintMessage);
await sendAndConfirm(createMintTx as Parameters<typeof sendAndConfirm>[0], {
  commitment: "confirmed",
});

logger.info(`Created new test token: ${mintSigner.address}`);

async function sendMint(owner: typeof payer, amountToMint: bigint) {
  const [ata] = await findAssociatedTokenPda({
    mint: mintSigner.address,
    owner: owner.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const { value: bh } = await rpc.getLatestBlockhash().send();

  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getCreateAssociatedTokenIdempotentInstruction({
            ata,
            owner: owner.address,
            payer,
            mint: mintSigner.address,
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          }),
          getMintToInstruction({
            mint: mintSigner.address,
            token: ata,
            mintAuthority: payer,
            amount: amountToMint,
          }),
        ],
        m,
      ),
  );

  const tx = await signTransactionMessageWithSigners(msg);
  await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed",
  });

  logger.info(`Minted ${amountToMint} tokens for ${owner.address} to ${ata}`);
}

const amountToMint = BigInt(1_000_000) * BigInt(10 ** decimals);

await sendMint(payer, amountToMint);
await sendMint(payTo, amountToMint);
