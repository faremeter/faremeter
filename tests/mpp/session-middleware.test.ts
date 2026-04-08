#!/usr/bin/env pnpm tsx

// Integration tests for the MPP solana/session lifecycle through the
// public test harness. These exercise the full request/response
// stack: client credential construction, JCS-canonical serialization,
// HTTP `Authorization: Payment ...` round-trip, the middleware's MPP
// dispatcher, the session handler, and the receipt header that comes
// back. Each test builds a real Flex session-open transaction (signed
// by the owner) so the handler's verify-open path runs end-to-end.
// On-chain broadcast is out of scope; the handler verifies the wire
// format and persists state without touching RPC.

import t from "tap";
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Blockhash,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import type { webcrypto } from "node:crypto";
import bs58 from "bs58";

import { TestHarness, isResourceContextMPP } from "@faremeter/test-harness";
import {
  createMPPSolanaSessionHandler,
  createMPPSolanaSessionClient,
  buildSessionOpenInstructions,
  serializeSpecVoucherMessage,
  FLEX_PROGRAM_ADDRESS,
  type MPPSolanaSessionClient,
  type FlexSessionHandler,
} from "@faremeter/payment-solana/session";
import { SOLANA_DEVNET } from "@faremeter/info/solana";
import {
  AUTHORIZATION_HEADER,
  PAYMENT_RECEIPT_HEADER,
  parseWWWAuthenticate,
  parseReceipt,
  serializeCredential,
  SESSION_INTENT,
  PROBLEM_VERIFICATION_FAILED,
  type mppCredential,
} from "@faremeter/types/mpp";
import type { ResourcePricing } from "@faremeter/types/pricing";

type SessionKeyPair = webcrypto.CryptoKeyPair;

const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const RECIPIENT = address("3QFU3r76XiQVdqkaX5K6FWkDyiBKN7EK3UjRSWxMXHt3");
const FAKE_BLOCKHASH =
  "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;

const stubRpc = {} as unknown as Rpc<SolanaRpcApi>;

async function buildSessionKeyPair(): Promise<{
  keypair: SessionKeyPair;
  address: Address;
}> {
  const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as SessionKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keypair.publicKey),
  );
  return { keypair, address: address(bs58.encode(raw)) };
}

type SessionEnv = {
  harness: TestHarness;
  handler: FlexSessionHandler;
  client: MPPSolanaSessionClient;
  facilitatorSigner: TransactionSigner;
  ownerSigner: TransactionSigner;
  session: { keypair: SessionKeyPair; address: Address };
  depositAmount: bigint;
  pricing: ResourcePricing[];
};

// Builds a fully-wired session env: a handler with `sponsorFees: false`
// (the test client signs the open as the escrow owner, not as the
// facilitator), a session client with a `buildOpenTransaction` callback
// that produces a real Flex three-instruction batch, and a TestHarness
// stitching them together.
async function makeSessionEnv(): Promise<SessionEnv> {
  const facilitatorSigner = await generateKeyPairSigner();
  const handler = await createMPPSolanaSessionHandler({
    network: SOLANA_DEVNET.caip2,
    rpc: stubRpc,
    facilitatorSigner,
    sponsorFees: false,
    supportedMints: [MINT],
    mintDecimals: 6,
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "session-integration",
    secretKey: new TextEncoder().encode("session-integration-secret"),
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });

  const ownerSigner = await generateKeyPairSigner();
  const sourceTokenAccount = await generateKeyPairSigner();
  const session = await buildSessionKeyPair();
  const depositAmount = 1_000_000n;

  const client = createMPPSolanaSessionClient({
    wallet: { address: ownerSigner.address },
    sessionKeyPair: session.keypair,
    sessionKeyAddress: session.address,
    programAddress: FLEX_PROGRAM_ADDRESS,
    buildOpenTransaction: async () => {
      const built = await buildSessionOpenInstructions({
        owner: ownerSigner,
        facilitator: facilitatorSigner.address,
        sessionKey: session.address,
        mint: MINT,
        source: sourceTokenAccount.address,
        index: 0n,
        depositAmount,
        refundTimeoutSlots: 150n,
        deadmanTimeoutSlots: 1000n,
        maxSessionKeys: 1,
        sessionKeyExpiresAtSlot: null,
        sessionKeyGracePeriodSlots: 150n,
        programAddress: FLEX_PROGRAM_ADDRESS,
      });
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(ownerSigner, m),
        (m) =>
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1000n },
            m,
          ),
        (m) => appendTransactionMessageInstructions(built.instructions, m),
      );
      const signed = await signTransactionMessageWithSigners(message);
      const wire = getBase64EncodedWireTransaction(signed);
      return {
        transaction: wire,
        escrow: built.escrow,
        mint: MINT,
        payer: ownerSigner.address,
        depositAmount,
      };
    },
  });

  const pricing: ResourcePricing[] = [
    {
      amount: "25",
      asset: MINT.toString(),
      recipient: RECIPIENT.toString(),
      network: SOLANA_DEVNET.caip2,
    },
  ];

  const harness = new TestHarness({
    mppMethodHandlers: [handler],
    mppClientHandlers: [client],
    pricing,
    clientHandlers: [],
    settleMode: "settle-only",
  });

  return {
    harness,
    handler,
    client,
    facilitatorSigner,
    ownerSigner,
    session,
    depositAmount,
    pricing,
  };
}

// Drives the spec's open path through `harness.createClientFetch()`
// directly so the test can inspect the 402 challenge before submitting
// the credential. Returns the open response (200) and the channelId
// the server bound on the credential.
async function openSession(env: SessionEnv): Promise<{
  response: Response;
  channelId: Address;
}> {
  const clientFetch = env.harness.createClientFetch();
  const challengeResponse = await clientFetch("/protected");
  if (challengeResponse.status !== 402) {
    throw new Error(
      `expected 402 to start the open flow, got ${challengeResponse.status}`,
    );
  }
  const wwwAuth = challengeResponse.headers.get("WWW-Authenticate");
  if (!wwwAuth) throw new Error("no WWW-Authenticate on initial 402");
  const challenges = parseWWWAuthenticate(wwwAuth);
  const challenge = challenges.find(
    (c) => c.method === "solana" && c.intent === SESSION_INTENT,
  );
  if (!challenge) throw new Error("no session challenge in WWW-Authenticate");

  const execer = await env.client(challenge);
  if (!execer) throw new Error("session client did not match the challenge");
  const credential = await execer.exec();
  const authHeader = `Payment ${serializeCredential(credential)}`;
  const response = await clientFetch("/protected", {
    headers: { [AUTHORIZATION_HEADER]: authHeader },
  });
  const channelId = address(
    (credential.payload as { channelId: string }).channelId,
  );
  return { response, channelId };
}

await t.test(
  "spec §Challenge — initial GET returns 402 with WWW-Authenticate Payment header carrying the session challenge",
  async (t) => {
    const env = await makeSessionEnv();
    const clientFetch = env.harness.createClientFetch();

    const response = await clientFetch("/protected");
    t.equal(response.status, 402, "unauthenticated GET must return 402");

    const wwwAuth = response.headers.get("WWW-Authenticate");
    t.ok(wwwAuth, "402 must carry WWW-Authenticate header");

    const challenges = parseWWWAuthenticate(wwwAuth ?? "");
    const session = challenges.find(
      (c) => c.method === "solana" && c.intent === SESSION_INTENT,
    );
    t.ok(session, "WWW-Authenticate must include a session-intent challenge");
    t.equal(session?.realm, "session-integration");
    t.ok(session?.id, "challenge must carry an HMAC id");
    t.ok(session?.request, "challenge must carry a request body");

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Action: open — happy-path open through createFetch round-trips a valid Payment-Receipt",
  async (t) => {
    const env = await makeSessionEnv();

    let resourceCalled = false;
    let observedReference: string | undefined;
    env.harness.setResourceHandler((ctx) => {
      if (!isResourceContextMPP(ctx)) {
        throw new Error("expected MPP resource context");
      }
      resourceCalled = true;
      observedReference = ctx.receipt.reference;
      return { status: 200, body: { ok: true } };
    });

    const fetch = env.harness.createFetch();
    const response = await fetch("/protected");
    t.equal(response.status, 200, "middleware must accept the open credential");
    t.ok(resourceCalled, "resource handler must run after settlement");
    t.ok(observedReference, "receipt must carry a non-empty channelId");

    // The middleware sets Payment-Receipt on the response. Parse it
    // back through the shared receipt decoder so we exercise the full
    // serialize/deserialize round-trip.
    const receiptHeader = response.headers.get(PAYMENT_RECEIPT_HEADER);
    t.ok(receiptHeader, "response must include the Payment-Receipt header");
    if (receiptHeader) {
      const parsed = parseReceipt(receiptHeader);
      t.ok(parsed, "Payment-Receipt header must decode as an mppReceipt");
      t.equal(parsed?.intent, SESSION_INTENT);
      t.equal(parsed?.method, "solana");
      t.equal(parsed?.acceptedCumulative, "0");
      t.equal(parsed?.spent, "0");
    }

    if (observedReference !== undefined) {
      const state = await env.handler.getSessionState(
        address(observedReference),
      );
      t.ok(state, "open must persist a session state for the channel");
      t.equal(state?.sessionKey, env.session.address);
      t.equal(state?.mint, MINT);
      t.equal(state?.acceptedCumulative, 0n);
      t.equal(state?.spent, 0n);
      t.equal(state?.status, "open");
    }

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Action: voucher — open then multiple voucher submissions advance state monotonically",
  async (t) => {
    const env = await makeSessionEnv();

    // Drive the open via createClientFetch + manual credential so we
    // can capture the channelId.
    const { response: openResponse, channelId } = await openSession(env);
    t.equal(openResponse.status, 200, "open must succeed");

    // Now drive two vouchers via the client's helper. handleInsufficientHold
    // is the public API the session client exposes for advancing
    // acceptedCumulative by a delta.
    const clientFetch = env.harness.createClientFetch();

    const auth1 = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 250n,
    });
    const voucher1Resp = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth1 },
    });
    t.equal(voucher1Resp.status, 200, "first voucher must be accepted");
    const receipt1 = parseReceipt(
      voucher1Resp.headers.get(PAYMENT_RECEIPT_HEADER) ?? "",
    );
    t.equal(receipt1?.acceptedCumulative, "250");

    const auth2 = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 100n,
    });
    const voucher2Resp = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth2 },
    });
    t.equal(voucher2Resp.status, 200, "second voucher must be accepted");
    const receipt2 = parseReceipt(
      voucher2Resp.headers.get(PAYMENT_RECEIPT_HEADER) ?? "",
    );
    t.equal(
      receipt2?.acceptedCumulative,
      "350",
      "second voucher must add to the running cumulative",
    );

    const state = await env.handler.getSessionState(channelId);
    t.equal(state?.acceptedCumulative, 350n);
    t.equal(state?.inFlightAuthorizationIds.length, 2);

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Concurrency and Idempotency — replaying an open credential is idempotent and returns the live state",
  async (t) => {
    const env = await makeSessionEnv();

    // First open: succeeds and persists.
    const { response: first, channelId } = await openSession(env);
    t.equal(first.status, 200);

    // Mutate the live state to simulate the channel having advanced.
    const live = await env.handler.getSessionState(channelId);
    if (!live) throw new Error("missing state after first open");
    // We can't mutate the SessionStore from outside; instead drive a
    // voucher to advance state, then replay the same open credential.
    const auth = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 500n,
    });
    const clientFetch = env.harness.createClientFetch();
    await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth },
    });

    // Re-drive open: the client builds a fresh open credential
    // (deterministic for the same wallet/session/escrow) and submits.
    // The spec §"Action: open" idempotent re-open path returns the
    // existing live state without resetting it.
    const replay = await openSession(env);
    t.equal(replay.response.status, 200, "re-open must succeed");
    const replayReceipt = parseReceipt(
      replay.response.headers.get(PAYMENT_RECEIPT_HEADER) ?? "",
    );
    t.equal(
      replayReceipt?.acceptedCumulative,
      "500",
      "re-open must report the live acceptedCumulative, not reset to 0",
    );

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Concurrency and Idempotency — a replayed voucher credential is idempotent",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);

    const auth = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 250n,
    });
    const clientFetch = env.harness.createClientFetch();

    const first = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth },
    });
    t.equal(first.status, 200, "first submission accepted");

    // Re-submit the SAME credential. The credential's voucher carries
    // the same cumulativeAmount the channel already accepted, which
    // tryRegisterVoucher treats as an idempotent retry. The middleware
    // returns 200 with the same receipt.
    const replay = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth },
    });
    t.equal(
      replay.status,
      200,
      "replayed voucher must return 200 (idempotent)",
    );

    const state = await env.handler.getSessionState(channelId);
    t.equal(
      state?.acceptedCumulative,
      250n,
      "replay must not double-advance state",
    );
    t.equal(
      state?.inFlightAuthorizationIds.length,
      1,
      "replay must not double-add the authorization id",
    );

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification — a voucher signed for a different channel is rejected",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);

    // Build a voucher whose inner data points at a fake channelId,
    // signed by the real session key, then submit it under the real
    // channelId. The handler must reject because verifyVoucher checks
    // the inner channelId against the credential channelId.
    const tamperedChannel = address(
      "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
    );
    const tamperedMessage = serializeSpecVoucherMessage({
      channelId: tamperedChannel.toString(),
      cumulativeAmount: "100",
    });
    const tamperedSig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        env.session.keypair.privateKey,
        tamperedMessage,
      ),
    );

    const clientFetch = env.harness.createClientFetch();
    // Mint a fresh challenge first so we have one to bind to.
    const challengeResponse = await clientFetch("/protected");
    const wwwAuth = challengeResponse.headers.get("WWW-Authenticate");
    if (!wwwAuth) throw new Error("no WWW-Authenticate");
    const challenges = parseWWWAuthenticate(wwwAuth);
    const challenge = challenges.find(
      (c) => c.method === "solana" && c.intent === SESSION_INTENT,
    );
    if (!challenge) throw new Error("no session challenge");

    const credential: mppCredential = {
      challenge,
      payload: {
        action: "voucher",
        channelId: channelId.toString(),
        voucher: {
          voucher: {
            channelId: tamperedChannel.toString(),
            cumulativeAmount: "100",
          },
          signer: env.session.address.toString(),
          signature: bs58.encode(tamperedSig),
          signatureType: "ed25519",
        },
      },
    };
    const authHeader = `Payment ${serializeCredential(credential)}`;
    const response = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: authHeader },
    });
    t.equal(
      response.status,
      402,
      "cross-channel voucher must be rejected with 402",
    );
    t.ok(
      response.headers.get("WWW-Authenticate"),
      "rejection must carry a fresh WWW-Authenticate",
    );

    // The channel's state must be unchanged.
    const state = await env.handler.getSessionState(channelId);
    t.equal(state?.acceptedCumulative, 0n);

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 8 — voucher whose cumulative exceeds escrow is rejected with 402",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);

    const auth = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      // depositAmount is 1_000_000; ask for more.
      requiredTopUp: 9_999_999n,
    });

    const clientFetch = env.harness.createClientFetch();
    const response = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth },
    });
    t.equal(
      response.status,
      402,
      "voucher exceeding escrowedAmount must yield 402",
    );
    t.ok(
      response.headers.get("WWW-Authenticate"),
      "402 must carry a fresh challenge for retry",
    );

    const state = await env.handler.getSessionState(channelId);
    t.equal(
      state?.acceptedCumulative,
      0n,
      "rejection must not advance acceptedCumulative",
    );

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 1 — voucher submitted before any open returns 402",
  async (t) => {
    const env = await makeSessionEnv();
    // No open performed.
    const fakeChannel = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    const clientFetch = env.harness.createClientFetch();
    const challengeResponse = await clientFetch("/protected");
    const wwwAuth = challengeResponse.headers.get("WWW-Authenticate") ?? "";
    const challenges = parseWWWAuthenticate(wwwAuth);
    const challenge = challenges.find(
      (c) => c.method === "solana" && c.intent === SESSION_INTENT,
    );
    if (!challenge) throw new Error("no session challenge");

    const message = serializeSpecVoucherMessage({
      channelId: fakeChannel.toString(),
      cumulativeAmount: "100",
    });
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        env.session.keypair.privateKey,
        message,
      ),
    );
    const credential: mppCredential = {
      challenge,
      payload: {
        action: "voucher",
        channelId: fakeChannel.toString(),
        voucher: {
          voucher: {
            channelId: fakeChannel.toString(),
            cumulativeAmount: "100",
          },
          signer: env.session.address.toString(),
          signature: bs58.encode(sig),
          signatureType: "ed25519",
        },
      },
    };
    const authHeader = `Payment ${serializeCredential(credential)}`;
    const response = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: authHeader },
    });
    t.equal(
      response.status,
      402,
      "voucher on a non-existent channel must be rejected",
    );

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Action: close — bare close credential transitions the channel to closing",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);

    // Build a close credential by hand — the session client doesn't
    // expose a close helper.
    const clientFetch = env.harness.createClientFetch();
    const challengeResponse = await clientFetch("/protected");
    const wwwAuth = challengeResponse.headers.get("WWW-Authenticate") ?? "";
    const challenges = parseWWWAuthenticate(wwwAuth);
    const challenge = challenges.find(
      (c) => c.method === "solana" && c.intent === SESSION_INTENT,
    );
    if (!challenge) throw new Error("no session challenge");

    const credential: mppCredential = {
      challenge,
      payload: {
        action: "close",
        channelId: channelId.toString(),
      },
    };
    const authHeader = `Payment ${serializeCredential(credential)}`;
    const response = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: authHeader },
    });
    t.equal(response.status, 200, "close must be accepted");

    const state = await env.handler.getSessionState(channelId);
    t.equal(
      state?.status,
      "closing",
      "close must transition status to closing",
    );

    // A subsequent voucher on the closing channel must be refused.
    const auth = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 100n,
    });
    const followupResponse = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth },
    });
    t.equal(
      followupResponse.status,
      402,
      "voucher on a closing channel must be rejected",
    );

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Concurrency and Idempotency — concurrent voucher submissions on the same channel are serialized correctly",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);
    const clientFetch = env.harness.createClientFetch();

    // Build two voucher Authorization headers with non-overlapping
    // deltas. Submit them in parallel.
    const auth1 = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 100n,
    });
    const auth2 = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 200n,
    });

    const [resp1, resp2] = await Promise.all([
      clientFetch("/protected", {
        headers: { [AUTHORIZATION_HEADER]: auth1 },
      }),
      clientFetch("/protected", {
        headers: { [AUTHORIZATION_HEADER]: auth2 },
      }),
    ]);
    t.equal(resp1.status, 200);
    t.equal(resp2.status, 200);

    // Both must persist. After both have landed the channel's
    // acceptedCumulative is the larger of the two voucher cumulatives
    // (100 and 100+200=300). The receipts on each response report the
    // state at the moment that voucher was registered.
    const state = await env.handler.getSessionState(channelId);
    t.equal(state?.acceptedCumulative, 300n);
    t.equal(state?.inFlightAuthorizationIds.length, 2);

    const r1 = parseReceipt(resp1.headers.get(PAYMENT_RECEIPT_HEADER) ?? "");
    const r2 = parseReceipt(resp2.headers.get(PAYMENT_RECEIPT_HEADER) ?? "");
    const receipts = [r1?.acceptedCumulative, r2?.acceptedCumulative].sort();
    t.matchOnly(
      receipts,
      ["100", "300"],
      "each receipt must reflect the state at the time that voucher landed",
    );

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Error Responses — every error response carries a fresh WWW-Authenticate challenge",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);

    // Submit a voucher exceeding escrow to trigger an error.
    const auth = await env.client.handleInsufficientHold({
      channelId: channelId.toString(),
      requiredTopUp: 9_999_999n,
    });
    const clientFetch = env.harness.createClientFetch();
    const errorResp = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: auth },
    });
    t.equal(errorResp.status, 402);

    const wwwAuth = errorResp.headers.get("WWW-Authenticate");
    t.ok(wwwAuth, "error response must carry WWW-Authenticate");
    const challenges = parseWWWAuthenticate(wwwAuth ?? "");
    const fresh = challenges.find(
      (c) => c.method === "solana" && c.intent === SESSION_INTENT,
    );
    t.ok(fresh, "fresh challenge must be present");
    t.ok(fresh?.id, "fresh challenge must have a new id");

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Receipt Format — handleSettle receipt is observable in the resource handler context",
  async (t) => {
    const env = await makeSessionEnv();

    let capturedCumulative: string | undefined;
    let capturedIntent: string | undefined;
    env.harness.setResourceHandler((ctx) => {
      if (!isResourceContextMPP(ctx)) {
        throw new Error("expected MPP resource context");
      }
      capturedCumulative = ctx.receipt.acceptedCumulative;
      capturedIntent = ctx.receipt.intent;
      return { status: 200, body: { ok: true } };
    });

    const fetch = env.harness.createFetch();
    const response = await fetch("/protected");
    t.equal(response.status, 200);
    t.equal(capturedIntent, SESSION_INTENT);
    t.equal(capturedCumulative, "0");

    env.handler.stop();
    t.end();
  },
);

await t.test(
  "spec §Action: voucher — voucher signed by a key that isn't the channel's session key is rejected",
  async (t) => {
    const env = await makeSessionEnv();
    const { channelId } = await openSession(env);

    // Build a voucher signed by an attacker keypair, claiming the
    // attacker's pubkey as the signer.
    const attacker = await buildSessionKeyPair();
    const message = serializeSpecVoucherMessage({
      channelId: channelId.toString(),
      cumulativeAmount: "100",
    });
    const sig = new Uint8Array(
      await crypto.subtle.sign("Ed25519", attacker.keypair.privateKey, message),
    );

    const clientFetch = env.harness.createClientFetch();
    const challengeResponse = await clientFetch("/protected");
    const wwwAuth = challengeResponse.headers.get("WWW-Authenticate") ?? "";
    const challenges = parseWWWAuthenticate(wwwAuth);
    const challenge = challenges.find(
      (c) => c.method === "solana" && c.intent === SESSION_INTENT,
    );
    if (!challenge) throw new Error("no session challenge");

    const credential: mppCredential = {
      challenge,
      payload: {
        action: "voucher",
        channelId: channelId.toString(),
        voucher: {
          voucher: {
            channelId: channelId.toString(),
            cumulativeAmount: "100",
          },
          signer: attacker.address.toString(),
          signature: bs58.encode(sig),
          signatureType: "ed25519",
        },
      },
    };
    const authHeader = `Payment ${serializeCredential(credential)}`;
    const response = await clientFetch("/protected", {
      headers: { [AUTHORIZATION_HEADER]: authHeader },
    });
    t.equal(
      response.status,
      402,
      "voucher signed by an unregistered key must be rejected",
    );

    env.handler.stop();
    t.end();
  },
);

// Reference an unused import so a future drift renaming
// PROBLEM_VERIFICATION_FAILED is caught here.
void PROBLEM_VERIFICATION_FAILED;
