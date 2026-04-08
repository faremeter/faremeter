#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  address,
  generateKeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import type { webcrypto } from "node:crypto";

type SessionKeyPair = webcrypto.CryptoKeyPair;
import {
  createMPPSolanaSessionHandler,
  serializeVoucherMessage,
  serializeSpecVoucherMessage,
  FLEX_PROGRAM_ADDRESS,
  createInMemorySessionStore,
} from "@faremeter/payment-solana/session";
import {
  SESSION_INTENT,
  PROBLEM_VERIFICATION_FAILED,
  type mppCredential,
} from "@faremeter/types/mpp";
import { FLEX_PROBLEM_PENDING_LIMIT } from "@faremeter/payment-solana/session";
import bs58 from "bs58";

const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const RECIPIENT = address("3QFU3r76XiQVdqkaX5K6FWkDyiBKN7EK3UjRSWxMXHt3");
const ESCROW = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

const stubRpc = {} as unknown as Rpc<SolanaRpcApi>;

async function makeSessionEnv() {
  const facilitatorSigner = await generateKeyPairSigner();
  const sessionKeyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as SessionKeyPair;
  const exported = await crypto.subtle.exportKey(
    "raw",
    sessionKeyPair.publicKey,
  );
  const sessionKeyBytes = new Uint8Array(exported);
  const sessionKeyAddress = address(bs58.encode(sessionKeyBytes));

  const store = createInMemorySessionStore();
  const handler = await createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    supportedMints: [MINT],
    mintDecimals: 6,
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: new TextEncoder().encode("session-end-to-end-secret"),
    sessionStore: store,
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });

  return { handler, sessionKeyPair, sessionKeyAddress, store };
}

async function buildSignedVoucherCredential(args: {
  challenge: mppCredential["challenge"];
  sessionKeyPair: SessionKeyPair;
  sessionKeyAddress: string;
  cumulativeAmount: bigint;
  delta: bigint;
  authorizationId: bigint;
}): Promise<mppCredential> {
  // Sign the spec-shaped voucher (JCS over voucher data, base58).
  const specMessage = serializeSpecVoucherMessage({
    channelId: ESCROW.toString(),
    cumulativeAmount: args.cumulativeAmount.toString(),
  });
  const specSig = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      args.sessionKeyPair.privateKey,
      specMessage,
    ),
  );

  // Sign the Flex authorization (packed binary, base64). Carried as a
  // Faremeter extension because Flex's submit_authorization expects
  // these bytes on chain. The splits must match the challenge's
  // defaultSplits or the handler will reject the voucher.
  const splits = [{ recipient: RECIPIENT.toString(), bps: 10000 }];
  const flexMessage = serializeVoucherMessage({
    programAddress: FLEX_PROGRAM_ADDRESS,
    escrow: ESCROW,
    mint: MINT,
    maxAmount: args.delta,
    authorizationId: args.authorizationId,
    expiresAtSlot: 0n,
    splits: splits.map((s) => ({
      recipient: address(s.recipient),
      bps: s.bps,
    })),
  });
  const flexSig = new Uint8Array(
    await crypto.subtle.sign(
      "Ed25519",
      args.sessionKeyPair.privateKey,
      flexMessage,
    ),
  );
  let binary = "";
  for (const b of flexSig) binary += String.fromCharCode(b);
  const flexSignature = btoa(binary);

  return {
    challenge: args.challenge,
    payload: {
      action: "voucher",
      channelId: ESCROW.toString(),
      voucher: {
        voucher: {
          channelId: ESCROW.toString(),
          cumulativeAmount: args.cumulativeAmount.toString(),
        },
        signer: args.sessionKeyAddress,
        signature: bs58.encode(specSig),
        signatureType: "ed25519",
      },
      flex: {
        mint: MINT.toString(),
        authorizationId: args.authorizationId.toString(),
        maxAmount: args.delta.toString(),
        expiresAtSlot: "0",
        splits,
        signature: flexSignature,
      },
    },
  };
}

await t.test("session: open then voucher updates state", async (t) => {
  const env = await makeSessionEnv();

  // Seed the session as if open had succeeded.
  await env.store.put({
    channelId: ESCROW,
    sessionKey: env.sessionKeyAddress,
    mint: MINT,
    escrowedAmount: 1_000_000n,
    acceptedCumulative: 0n,
    spent: 0n,
    inFlightAuthorizationIds: [],
    status: "open",
  });

  const challenge = await env.handler.getChallenge(
    SESSION_INTENT,
    {
      amount: "25",
      asset: MINT.toString(),
      recipient: RECIPIENT.toString(),
      network: "solana-devnet",
    },
    "http://test/api",
  );

  const credential = await buildSignedVoucherCredential({
    challenge,
    sessionKeyPair: env.sessionKeyPair,
    sessionKeyAddress: env.sessionKeyAddress.toString(),
    cumulativeAmount: 100n,
    delta: 100n,
    authorizationId: 1n,
  });

  // handleSettle is the spec's voucher-submission path; it calls
  // tryRegisterVoucher internally so the receipt reflects the
  // persisted state by the time we return.
  const receipt = await env.handler.handleSettle(credential);
  t.ok(receipt);
  t.equal(receipt?.acceptedCumulative, "100");

  await env.handler.chargeSession(ESCROW, 25n);
  const remaining = await env.handler.remainingHold(ESCROW);
  t.equal(remaining, 75n);

  const post = await env.handler.buildReceipt(ESCROW);
  t.equal(post.acceptedCumulative, "100");
  t.equal(post.spent, "25");
  t.equal(post.intent, SESSION_INTENT);

  t.end();
});

await t.test("session: insufficient hold yields a problem", async (t) => {
  const env = await makeSessionEnv();
  await env.store.put({
    channelId: ESCROW,
    sessionKey: env.sessionKeyAddress,
    mint: MINT,
    escrowedAmount: 100n,
    acceptedCumulative: 100n,
    spent: 100n,
    inFlightAuthorizationIds: [],
    status: "open",
  });
  const remaining = await env.handler.remainingHold(ESCROW);
  t.equal(remaining, 0n);

  const state = await env.handler.getSessionState(ESCROW);
  if (!state) throw new Error("missing state");
  const problem = env.handler.buildInsufficientHoldProblem(state, 30n);
  t.equal(problem.type, PROBLEM_VERIFICATION_FAILED);
  t.equal(problem.title, "Insufficient hold");
  t.match(problem.detail, /requiredTopUp=30/);
  t.match(problem.detail, /acceptedCumulative=100/);
  t.match(problem.detail, /spent=100/);
  t.end();
});

await t.test(
  "session: pending-limit problem builder reports counts",
  async (t) => {
    const env = await makeSessionEnv();
    const inFlightAuthorizationIds = Array.from({ length: 16 }, (_, i) =>
      BigInt(i + 1),
    );
    await env.store.put({
      channelId: ESCROW,
      sessionKey: env.sessionKeyAddress,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 0n,
      spent: 0n,
      inFlightAuthorizationIds,
      status: "open",
    });

    const state = await env.handler.getSessionState(ESCROW);
    if (!state) throw new Error("missing state");
    const problem = env.handler.buildPendingLimitProblem(state);
    t.equal(problem.type, FLEX_PROBLEM_PENDING_LIMIT);
    t.equal(problem.pendingCount, 16);
    t.equal(problem.maxPending, 16);
    t.equal(problem.channelId, ESCROW.toString());
    t.end();
  },
);

await t.test(
  "session: session-not-found builder for unknown sessions",
  async (t) => {
    const env = await makeSessionEnv();
    const problem = env.handler.buildSessionNotFoundProblem(ESCROW);
    t.equal(problem.type, PROBLEM_VERIFICATION_FAILED);
    t.equal(problem.title, "Channel not found");
    t.match(problem.detail, new RegExp(`channelId=${ESCROW.toString()}`));
    t.end();
  },
);
