import "dotenv/config";
import { logResponse } from "../logger";
import { clusterApiUrl } from "@solana/web3.js";
import {
  type Instruction,
  type KeyPairSigner,
  type Signature,
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { lookupKnownSPLToken } from "@faremeter/info/solana";
import {
  fetchEscrowAccount,
  findPendingSettlementsByEscrow,
  findVaultPda,
  getCloseEscrowInstruction,
  getCloseSessionKeyInstruction,
  getCreateEscrowInstructionAsync,
  getDepositInstructionAsync,
  getRefundInstruction,
  getRegisterSessionKeyInstructionAsync,
  getRevokeSessionKeyInstruction,
} from "@faremeter/flex-solana";
import { createPaymentHandler } from "@faremeter/payment-solana/flex/client";
import { wrap as wrapFetch } from "@faremeter/fetch";
import type { webcrypto } from "node:crypto";
import fs from "fs";

const { PAYER_KEYPAIR_PATH, ADMIN_KEYPAIR_PATH } = process.env;

if (!PAYER_KEYPAIR_PATH) {
  throw new Error("PAYER_KEYPAIR_PATH must be set in your environment");
}

if (!ADMIN_KEYPAIR_PATH) {
  throw new Error("ADMIN_KEYPAIR_PATH must be set in your environment");
}

const network = "devnet";
const rpcURL = clusterApiUrl(network);
const rpc = createSolanaRpc(rpcURL);

const payerRaw = JSON.parse(
  fs.readFileSync(PAYER_KEYPAIR_PATH, "utf-8"),
) as number[];
const owner = await createKeyPairSignerFromBytes(Uint8Array.from(payerRaw));

const facilitatorRaw = JSON.parse(
  fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf-8"),
) as number[];
const facilitator = await createKeyPairSignerFromBytes(
  Uint8Array.from(facilitatorRaw),
);

const usdcInfo = lookupKnownSPLToken(network, "USDC");
if (!usdcInfo) {
  throw new Error(`Could not look up USDC on ${network}`);
}
const mintAddress = address(usdcInfo.address);

const ESCROW_INDEX = Date.now();
const DEPOSIT_AMOUNT = 50_000;
const REFUND_TIMEOUT_SLOTS = 150;
const DEADMAN_TIMEOUT_SLOTS = 100_000;
const MAX_SESSION_KEYS = 10;
const GRACE_PERIOD_SLOTS = 10;

async function confirmSignature(sig: Signature) {
  for (let i = 0; i < 60; i++) {
    const { value: statuses } = await rpc.getSignatureStatuses([sig]).send();
    const status = statuses[0];
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      if (status.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Transaction confirmation timeout");
}

async function sendInstructions(
  feePayer: KeyPairSigner,
  instructions: Instruction[],
) {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signedTx = await signTransactionMessageWithSigners(msg);
  const wire = getBase64EncodedWireTransaction(signedTx);
  const sig = await rpc.sendTransaction(wire, { encoding: "base64" }).send();
  await confirmSignature(sig);
}

async function waitSlots(n: number) {
  const target = (await rpc.getSlot().send()) + BigInt(n);
  while ((await rpc.getSlot().send()) < target) {
    await new Promise((r) => setTimeout(r, 400));
  }
}

// --- Setup: create escrow, deposit, register session key ---

const { value: tokenAccounts } = await rpc
  .getTokenAccountsByOwner(
    owner.address,
    { mint: mintAddress },
    { encoding: "base64" },
  )
  .send();

const firstAccount = tokenAccounts[0];
if (!firstAccount) {
  throw new Error(
    "No USDC token account found for the owner. " +
      "Get devnet USDC from https://faucet.circle.com (select Solana devnet).",
  );
}
const sourceTokenAccount = firstAccount.pubkey;

const createIx = await getCreateEscrowInstructionAsync({
  owner,
  index: ESCROW_INDEX,
  facilitator: facilitator.address,
  refundTimeoutSlots: REFUND_TIMEOUT_SLOTS,
  deadmanTimeoutSlots: DEADMAN_TIMEOUT_SLOTS,
  maxSessionKeys: MAX_SESSION_KEYS,
});
await sendInstructions(owner, [createIx]);

const escrowMeta = createIx.accounts[1];
if (!escrowMeta) throw new Error("escrow account meta missing");
const escrowAddress = escrowMeta.address;

const depositIx = await getDepositInstructionAsync({
  depositor: owner,
  escrow: escrowAddress,
  mint: mintAddress,
  source: sourceTokenAccount,
  amount: DEPOSIT_AMOUNT,
});
await sendInstructions(owner, [depositIx]);

const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
  "sign",
  "verify",
])) as webcrypto.CryptoKeyPair;
const sessionKeyAddress = await getAddressFromPublicKey(keyPair.publicKey);

const registerIx = await getRegisterSessionKeyInstructionAsync({
  owner,
  escrow: escrowAddress,
  sessionKey: sessionKeyAddress,
  expiresAtSlot: null,
  revocationGracePeriodSlots: GRACE_PERIOD_SLOTS,
});
await sendInstructions(owner, [registerIx]);

const sessionKeyAccountMeta = registerIx.accounts[2];
if (!sessionKeyAccountMeta) throw new Error("session key account meta missing");
const sessionKeyPDA = sessionKeyAccountMeta.address;

// --- Make the payment ---

const handler = createPaymentHandler({
  network,
  escrow: escrowAddress,
  mint: mintAddress,
  sessionKeyPair: keyPair,
  sessionKeyAddress,
  rpc,
});

const fetchWithPayer = wrapFetch(fetch, { handlers: [handler] });

const req = await fetchWithPayer("http://127.0.0.1:3000/protected");
await logResponse(req);

// --- Cleanup: refund pending settlements, revoke session key, close everything ---

// Wait for the facilitator to submit the authorization on-chain.
for (let i = 0; i < 30; i++) {
  const escrow = await fetchEscrowAccount(rpc, escrowAddress);
  if (escrow && escrow.pendingCount > 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}

const pendings = await findPendingSettlementsByEscrow(rpc, escrowAddress);
for (const pending of pendings) {
  const refundIx = getRefundInstruction({
    escrow: escrowAddress,
    facilitator,
    pending: pending.address,
    refundAmount: pending.account.amount,
  });
  await sendInstructions(facilitator, [refundIx]);
}

const revokeIx = getRevokeSessionKeyInstruction({
  owner,
  escrow: escrowAddress,
  sessionKeyAccount: sessionKeyPDA,
});
await sendInstructions(owner, [revokeIx]);

await waitSlots(GRACE_PERIOD_SLOTS + 1);

const closeSessionKeyIx = getCloseSessionKeyInstruction({
  owner,
  escrow: escrowAddress,
  sessionKeyAccount: sessionKeyPDA,
});
await sendInstructions(owner, [closeSessionKeyIx]);

const [vaultAddress] = await findVaultPda({
  escrow: escrowAddress,
  mint: mintAddress,
});

const baseCloseIx = getCloseEscrowInstruction({
  escrow: escrowAddress,
  owner,
  facilitator,
});
const closeEscrowIx = {
  ...baseCloseIx,
  accounts: [
    ...baseCloseIx.accounts,
    { address: vaultAddress, role: AccountRole.WRITABLE as const },
    { address: sourceTokenAccount, role: AccountRole.WRITABLE as const },
  ],
};
await sendInstructions(owner, [closeEscrowIx]);
