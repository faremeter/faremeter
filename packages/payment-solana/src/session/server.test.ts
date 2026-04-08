#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Blockhash,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  canonicalizeSortedJSON,
  encodeBase64URL,
  mppReceipt,
  SESSION_INTENT,
  type mppCredential,
} from "@faremeter/types/mpp";
import { isValidationError } from "@faremeter/types";

import { createMPPSolanaSessionHandler } from "./server";
import { createInMemorySessionStore, type SessionState } from "./state";
import { serializeSpecVoucherMessage, serializeVoucherMessage } from "./verify";
import { verifyFlexOpenTransaction } from "./verify-open";
import type { solanaSessionMethodDetails } from "./common";
import { FLEX_PROGRAM_ADDRESS } from "@faremeter/flex-solana";
import { buildSessionOpenInstructions } from "./index";

const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const RECIPIENT = address("3QFU3r76XiQVdqkaX5K6FWkDyiBKN7EK3UjRSWxMXHt3");

// Minimal stub; the handler doesn't actually issue RPC calls in the paths
// exercised by these tests.
const stubRpc = {} as unknown as Rpc<SolanaRpcApi>;

const SECRET_KEY = new TextEncoder().encode("session-handler-test-secret");

async function makeHandler() {
  const facilitatorSigner = await generateKeyPairSigner();
  return createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    supportedMints: [MINT],
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: SECRET_KEY,
    mintDecimals: 6,
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });
}

await t.test("getChallenge mints a session-intent challenge", async (t) => {
  const handler = await makeHandler();
  const challenge = await handler.getChallenge(
    SESSION_INTENT,
    {
      amount: "25",
      asset: MINT.toString(),
      recipient: RECIPIENT.toString(),
      network: "solana-devnet",
    },
    "http://test/resource",
  );
  t.equal(challenge.method, "solana");
  t.equal(challenge.intent, SESSION_INTENT);
  t.ok(challenge.id);
  t.ok(challenge.expires);
  t.end();
});

await t.test("handleSettle rejects non-session intents", async (t) => {
  const handler = await makeHandler();
  const credential: mppCredential = {
    challenge: {
      id: "x",
      realm: "test",
      method: "solana",
      intent: "charge",
      request: "x",
    },
    payload: {},
  };
  const result = await handler.handleSettle(credential);
  t.equal(result, null);
  t.end();
});

await t.test("tryRegisterVoucher voucher monotonicity rules", async (t) => {
  const store = createInMemorySessionStore();
  const facilitatorSigner = await generateKeyPairSigner();
  const withStore = await createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    supportedMints: [MINT],
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: SECRET_KEY,
    sessionStore: store,
    mintDecimals: 6,
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });

  const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  const sessionKey = address("DFo9vd1eiRFGQuCkReqvZvRPJVwwYu8NwCiaa9tB5pWZ");

  const seed: SessionState = {
    channelId,
    sessionKey,
    mint: MINT,
    escrowedAmount: 1_000_000n,
    acceptedCumulative: 100n,
    spent: 50n,
    inFlightAuthorizationIds: [],
    status: "open",
  };
  await store.put(seed);

  const buildRegistration = (
    cumulativeAmount: string,
    authorizationId: string,
  ) => ({
    channelId,
    sessionKey,
    voucher: {
      voucher: {
        channelId: channelId.toString(),
        cumulativeAmount,
      },
      signer: sessionKey.toString(),
      signature: "",
      signatureType: "ed25519" as const,
    },
    flex: {
      mint: MINT.toString(),
      authorizationId,
      maxAmount: cumulativeAmount,
      expiresAtSlot: "0",
      splits: [],
      signature: "",
    },
  });

  // Lower cumulativeAmount: must succeed without mutating state
  // (replay tolerance per draft-solana-session-00 §"Concurrency and
  // Idempotency").
  const lower = await withStore.tryRegisterVoucher(
    buildRegistration("50", "1"),
  );
  t.equal(lower.ok, true);
  let after = await store.get(channelId);
  t.equal(after?.acceptedCumulative, 100n);
  t.equal(after?.inFlightAuthorizationIds.length, 0);

  // Equal cumulativeAmount: idempotent success without mutating state.
  const equal = await withStore.tryRegisterVoucher(
    buildRegistration("100", "2"),
  );
  t.equal(equal.ok, true);
  after = await store.get(channelId);
  t.equal(after?.acceptedCumulative, 100n);
  t.equal(after?.inFlightAuthorizationIds.length, 0);

  // Strictly greater cumulativeAmount: accepted, state advances.
  const ok = await withStore.tryRegisterVoucher(buildRegistration("200", "3"));
  t.equal(ok.ok, true);
  after = await store.get(channelId);
  t.equal(after?.acceptedCumulative, 200n);
  t.equal(after?.inFlightAuthorizationIds.length, 1);

  t.end();
});

await t.test("chargeSession rejects overdrafts", async (t) => {
  const facilitatorSigner = await generateKeyPairSigner();
  const store = createInMemorySessionStore();
  const handler = await createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    supportedMints: [MINT],
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: SECRET_KEY,
    sessionStore: store,
    mintDecimals: 6,
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });

  const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  const sessionKey = address("DFo9vd1eiRFGQuCkReqvZvRPJVwwYu8NwCiaa9tB5pWZ");
  await store.put({
    channelId,
    sessionKey,
    mint: MINT,
    escrowedAmount: 1_000_000n,
    acceptedCumulative: 100n,
    spent: 0n,
    inFlightAuthorizationIds: [],
    status: "open",
  });

  await handler.chargeSession(channelId, 40n);
  t.equal(await handler.remainingHold(channelId), 60n);

  await t.rejects(() => handler.chargeSession(channelId, 100n));
  void sessionKey;
  t.end();
});

await t.test(
  "voucher signature verification rejects bad signatures",
  async (t) => {
    const facilitatorSigner = await generateKeyPairSigner();
    const handler = await createMPPSolanaSessionHandler({
      network: "solana-devnet",
      rpc: stubRpc,
      facilitatorSigner,
      supportedMints: [MINT],
      mintDecimals: 6,
      defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
      realm: "test",
      secretKey: SECRET_KEY,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      minGracePeriodSlots: 150n,
      challengeExpiresSeconds: 3600,
      maxRetries: 1,
      retryDelayMs: 1,
      flushIntervalMs: 1000,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });

    const challenge = await handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const escrow = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    const sessionKeyAddress = address(
      "DFo9vd1eiRFGQuCkReqvZvRPJVwwYu8NwCiaa9tB5pWZ",
    );

    const credential: mppCredential = {
      challenge,
      payload: {
        action: "voucher",
        channelId: escrow.toString(),
        voucher: {
          voucher: {
            channelId: escrow.toString(),
            cumulativeAmount: "25",
          },
          signer: sessionKeyAddress.toString(),
          // 64 zero bytes base58-encoded — fails Ed25519 verification.
          signature: "1".repeat(88),
          signatureType: "ed25519",
        },
        flex: {
          mint: MINT.toString(),
          authorizationId: "1",
          maxAmount: "25",
          expiresAtSlot: "0",
          splits: [],
          signature: "AAAA",
        },
      },
    };

    await t.rejects(() => handler.handleSettle(credential));
    t.end();
  },
);

await t.test("withChannelLock serializes concurrent operations", async (t) => {
  const facilitatorSigner = await generateKeyPairSigner();
  const handler = await createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    supportedMints: [MINT],
    mintDecimals: 6,
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: SECRET_KEY,
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });

  const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

  const events: string[] = [];
  const op = (label: string, ms: number) =>
    handler.withChannelLock(channelId, async () => {
      events.push(`${label}-start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`${label}-end`);
    });

  await Promise.all([op("a", 30), op("b", 5), op("c", 5)]);

  // Each op must complete before the next starts.
  t.matchOnly(events, [
    "a-start",
    "a-end",
    "b-start",
    "b-end",
    "c-start",
    "c-end",
  ]);
  t.end();
});

await t.test("idempotency cache returns previous receipt", async (t) => {
  const handler = await makeHandler();
  const cached = await handler.lookupIdempotent("challenge-id", "key-1");
  t.equal(cached, undefined);

  const receipt = {
    status: "success" as const,
    method: "solana",
    intent: SESSION_INTENT,
    timestamp: new Date().toISOString(),
    reference: "ch",
    acceptedCumulative: "100",
    spent: "25",
  };
  await handler.recordIdempotent("challenge-id", "key-1", receipt);
  const found = await handler.lookupIdempotent("challenge-id", "key-1");
  t.matchOnly(found, receipt);

  // Different idempotency key on the same challenge: distinct entry.
  t.equal(await handler.lookupIdempotent("challenge-id", "key-2"), undefined);
  t.end();
});

await t.test("formatProblemResponse attaches WWW-Authenticate", async (t) => {
  const handler = await makeHandler();
  const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
  const problem = handler.buildSessionNotFoundProblem(channelId);
  const response = await handler.formatProblemResponse(
    problem,
    {
      amount: "25",
      asset: MINT.toString(),
      recipient: RECIPIENT.toString(),
      network: "solana-devnet",
    },
    "http://test/resource",
  );
  t.equal(response.status, 402);
  t.equal(response.headers["Content-Type"], "application/problem+json");
  t.ok(response.headers["WWW-Authenticate"]?.startsWith("Payment "));
  t.match(response.headers["WWW-Authenticate"], /method="solana"/);
  t.match(response.headers["WWW-Authenticate"], /intent="session"/);
  t.end();
});

// Smoke: a handler round-trips its own challenge canonicalization.
await t.test("challenge request survives JSON canonicalization", async (t) => {
  const handler = await makeHandler();
  const challenge = await handler.getChallenge(
    SESSION_INTENT,
    {
      amount: "25",
      asset: MINT.toString(),
      recipient: RECIPIENT.toString(),
      network: "solana-devnet",
    },
    "http://test/resource",
  );
  const requestBody = JSON.parse(
    Buffer.from(
      challenge.request.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf-8"),
  ) as {
    amount: string;
    currency: string;
    methodDetails: solanaSessionMethodDetails;
  };
  t.equal(requestBody.amount, "25");
  t.equal(requestBody.currency, MINT.toString());
  t.equal(requestBody.methodDetails.channelProgram, FLEX_PROGRAM_ADDRESS);
  t.equal(requestBody.methodDetails.flex.facilitator !== undefined, true);

  // The canonical JSON round-trip must be idempotent.
  const reserialized = encodeBase64URL(canonicalizeSortedJSON(requestBody));
  t.equal(reserialized, challenge.request);
  // serializeVoucherMessage kept for reference; unused here.
  void serializeVoucherMessage;
  t.end();
});

// Forward spec-conformance tests for handleSettle's voucher path.
// draft-solana-session-00 §"Voucher Verification" lists ten MUSTs the
// server has to enforce before serving a metered request. These tests
// assert the spec-correct rejection behavior; failing tests document
// a missing enforcement step in handleSettle.

import bs58 from "bs58";
import type { webcrypto } from "node:crypto";
import { serializeVoucherMessage as flexSerialize } from "./verify";

type SessionKeyPair = webcrypto.CryptoKeyPair;

async function makeStoreAndHandler(opts: { sponsorFees?: boolean } = {}) {
  const facilitatorSigner = await generateKeyPairSigner();
  const store = createInMemorySessionStore();
  const handler = await createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    ...(opts.sponsorFees !== undefined
      ? { sponsorFees: opts.sponsorFees }
      : {}),
    supportedMints: [MINT],
    mintDecimals: 6,
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: SECRET_KEY,
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
  return { handler, store, facilitatorSigner };
}

async function makeRealKeypairAddress() {
  const keypair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as SessionKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", keypair.publicKey),
  );
  return { keypair, address: address(bs58.encode(raw)) };
}

async function buildSignedVoucher(args: {
  keypair: SessionKeyPair;
  signerAddress: string;
  channelId: string;
  cumulativeAmount: string;
  expiresAt?: string;
}) {
  const message = serializeSpecVoucherMessage({
    channelId: args.channelId,
    cumulativeAmount: args.cumulativeAmount,
    ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
  });
  const sig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", args.keypair.privateKey, message),
  );
  return {
    voucher: {
      channelId: args.channelId,
      cumulativeAmount: args.cumulativeAmount,
      ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    },
    signer: args.signerAddress,
    signature: bs58.encode(sig),
    signatureType: "ed25519" as const,
  };
}

// Splits signed by the Flex authorization MUST match the challenge's
// `defaultSplits` or the handler will reject the voucher (splits
// cross-check lives alongside the signature verification in
// handleSettle). These helpers sign the canonical default splits the
// test handler declares.
const TEST_DEFAULT_SPLITS = [{ recipient: RECIPIENT.toString(), bps: 10000 }];

async function buildFlexExtension(args: {
  keypair: SessionKeyPair;
  channelId: string;
  authorizationId: string;
  maxAmount: string;
}) {
  const message = flexSerialize({
    programAddress: FLEX_PROGRAM_ADDRESS,
    escrow: address(args.channelId),
    mint: MINT,
    maxAmount: BigInt(args.maxAmount),
    authorizationId: BigInt(args.authorizationId),
    expiresAtSlot: 0n,
    splits: TEST_DEFAULT_SPLITS.map((s) => ({
      recipient: address(s.recipient),
      bps: s.bps,
    })),
  });
  const sig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", args.keypair.privateKey, message),
  );
  let binary = "";
  for (const b of sig) binary += String.fromCharCode(b);
  return {
    mint: MINT.toString(),
    authorizationId: args.authorizationId,
    maxAmount: args.maxAmount,
    expiresAtSlot: "0",
    splits: TEST_DEFAULT_SPLITS,
    signature: btoa(binary),
  };
}

await t.test(
  "spec §Concurrency and Idempotency — handleSettle returns current receipt for a lower-cumulative replay",
  async (t) => {
    // Spec text: "Submitting a voucher with lower cumulativeAmount
    // than the highest accepted voucher SHOULD return the current
    // receipt state and MUST NOT reduce channel state."
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 200n,
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
      "http://test/resource",
    );

    const signedVoucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: channelId.toString(),
      cumulativeAmount: "100",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: channelId.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    const credential = {
      challenge,
      payload: {
        action: "voucher",
        channelId: channelId.toString(),
        voucher: signedVoucher,
        flex,
      },
    };

    const receipt = await env.handler.handleSettle(credential);
    t.ok(receipt, "handleSettle must return a receipt, not throw");
    t.equal(
      receipt?.acceptedCumulative,
      "200",
      "receipt must report the channel's current acceptedCumulative, not the replay's cumulative",
    );

    // State must be unchanged.
    const state = await env.store.get(channelId);
    t.equal(
      state?.acceptedCumulative,
      200n,
      "replay must not reduce channel state",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 10 — handleSettle persists acceptedCumulative before returning",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
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
      "http://test/resource",
    );

    const signedVoucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: channelId.toString(),
      cumulativeAmount: "500",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: channelId.toString(),
      authorizationId: "42",
      maxAmount: "500",
    });

    const receipt = await env.handler.handleSettle({
      challenge,
      payload: {
        action: "voucher",
        channelId: channelId.toString(),
        voucher: signedVoucher,
        flex,
      },
    });
    t.equal(
      receipt?.acceptedCumulative,
      "500",
      "receipt must reflect the new acceptedCumulative",
    );

    const state = await env.store.get(channelId);
    t.equal(
      state?.acceptedCumulative,
      500n,
      "session store must be advanced to the voucher's cumulativeAmount",
    );
    t.matchOnly(
      state?.inFlightAuthorizationIds,
      [42n],
      "Flex authorizationId must be tracked against the escrow's pending cap",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 7 — handleSettle rejects voucher on a closing channel",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 0n,
      spent: 0n,
      inFlightAuthorizationIds: [],
      status: "closing",
    });

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const signedVoucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: channelId.toString(),
      cumulativeAmount: "100",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: channelId.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: channelId.toString(),
            voucher: signedVoucher,
            flex,
          },
        }),
      "handleSettle must reject a voucher on a non-open channel",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 8 — handleSettle rejects voucher whose cumulative exceeds escrow",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
      mint: MINT,
      escrowedAmount: 1000n,
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
      "http://test/resource",
    );
    const signedVoucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: channelId.toString(),
      cumulativeAmount: "9999999",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: channelId.toString(),
      authorizationId: "1",
      maxAmount: "9999999",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: channelId.toString(),
            voucher: signedVoucher,
            flex,
          },
        }),
      "handleSettle must reject a voucher whose cumulativeAmount exceeds escrowedAmount",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 3 — handleSettle rejects voucher signed by a key not registered for the channel",
  async (t) => {
    const env = await makeStoreAndHandler();
    const registered = await makeRealKeypairAddress();
    const attacker = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey: registered.address,
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
      "http://test/resource",
    );

    // Voucher is signed by `attacker`, not by the channel's
    // registered session key.
    const signedVoucher = await buildSignedVoucher({
      keypair: attacker.keypair,
      signerAddress: attacker.address.toString(),
      channelId: channelId.toString(),
      cumulativeAmount: "100",
    });
    const flex = await buildFlexExtension({
      keypair: attacker.keypair,
      channelId: channelId.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    const credential = {
      challenge,
      payload: {
        action: "voucher",
        channelId: channelId.toString(),
        voucher: signedVoucher,
        flex,
      },
    };

    await t.rejects(
      () => env.handler.handleSettle(credential),
      "handleSettle must reject a voucher whose signer is not the channel's registered session key",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: close — handleSettle rejects a close credential carrying an attacker-signed final voucher",
  async (t) => {
    const env = await makeStoreAndHandler();
    const registered = await makeRealKeypairAddress();
    const attacker = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey: registered.address,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 100n,
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
      "http://test/resource",
    );

    const forged = await buildSignedVoucher({
      keypair: attacker.keypair,
      signerAddress: attacker.address.toString(),
      channelId: channelId.toString(),
      cumulativeAmount: "999",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "close",
            channelId: channelId.toString(),
            voucher: forged,
          },
        }),
      "close must reject a final voucher not signed by the channel's session key",
    );

    // State must be unchanged.
    const after = await env.store.get(channelId);
    t.equal(after?.acceptedCumulative, 100n, "state acceptedCumulative intact");
    t.end();
  },
);

await t.test(
  "spec §Action: close — handleSettle close with no voucher marks the channel as closing",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 100n,
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
      "http://test/resource",
    );

    const receipt = await env.handler.handleSettle({
      challenge,
      payload: {
        action: "close",
        channelId: channelId.toString(),
      },
    });
    t.ok(receipt, "close without voucher must return a receipt");

    const after = await env.store.get(channelId);
    t.equal(
      after?.status,
      "closing",
      "close must transition the channel status to closing",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: topUp — handleSettle throws because topUp settlement is not implemented",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
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
      "http://test/resource",
    );

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "topUp",
            channelId: channelId.toString(),
            additionalAmount: "500",
            transaction: "not-verified",
          },
        }),
      "topUp must be rejected instead of silently returning a success receipt",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: close — handleSettle rejects a close credential after the channel is already closing",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

    await env.store.put({
      channelId,
      sessionKey,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 100n,
      spent: 0n,
      inFlightAuthorizationIds: [],
      status: "closing",
    });

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "close",
            channelId: channelId.toString(),
          },
        }),
      "close on a non-open channel must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Concurrency and Idempotency — concurrent vouchers: each receipt reflects that voucher's own persisted state",
  async (t) => {
    // The store.get delay is applied only to reads (not writes) so the
    // race window is between tryRegisterVoucher returning and the
    // receipt build. Without a fix, voucher A's receipt reports voucher
    // B's acceptedCumulative because B raced in between A's lock
    // release and A's state read.
    const baseStore = createInMemorySessionStore();
    let slow = false;
    const slowStore: typeof baseStore = {
      async get(id) {
        if (slow) {
          await new Promise((r) => setTimeout(r, 40));
        }
        return baseStore.get(id);
      },
      put: baseStore.put.bind(baseStore),
      delete: baseStore.delete.bind(baseStore),
      iterate: baseStore.iterate.bind(baseStore),
    };
    const facilitatorSigner = await generateKeyPairSigner();
    const handler = await createMPPSolanaSessionHandler({
      network: "solana-devnet",
      rpc: stubRpc,
      facilitatorSigner,
      supportedMints: [MINT],
      mintDecimals: 6,
      defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
      realm: "test",
      secretKey: SECRET_KEY,
      sessionStore: slowStore,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      minGracePeriodSlots: 150n,
      challengeExpiresSeconds: 3600,
      maxRetries: 1,
      retryDelayMs: 1,
      flushIntervalMs: 1000,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });

    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    const channelId = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
    await baseStore.put({
      channelId,
      sessionKey,
      mint: MINT,
      escrowedAmount: 1_000_000n,
      acceptedCumulative: 0n,
      spent: 0n,
      inFlightAuthorizationIds: [],
      status: "open",
    });

    const challenge = await handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const buildCredential = async (cumulative: string, authId: string) => {
      const voucher = await buildSignedVoucher({
        keypair,
        signerAddress: sessionKey.toString(),
        channelId: channelId.toString(),
        cumulativeAmount: cumulative,
      });
      const flex = await buildFlexExtension({
        keypair,
        channelId: channelId.toString(),
        authorizationId: authId,
        maxAmount: cumulative,
      });
      return {
        challenge,
        payload: {
          action: "voucher",
          channelId: channelId.toString(),
          voucher,
          flex,
        },
      };
    };

    slow = true;
    const [receiptA, receiptB] = await Promise.all([
      handler.handleSettle(await buildCredential("100", "1")),
      handler.handleSettle(await buildCredential("200", "2")),
    ]);

    // With the race, both receipts report 200 because the outer
    // state read runs outside the lock. The fix returns the
    // post-register state from tryRegisterVoucher so each receipt
    // reflects the state that that voucher persisted.
    t.ok(receiptA && receiptB);
    const receipts = [
      receiptA?.acceptedCumulative,
      receiptB?.acceptedCumulative,
    ].sort();
    t.matchOnly(
      receipts,
      ["100", "200"],
      "the two receipts must reflect each voucher's own persisted cumulative",
    );
    t.end();
  },
);

await t.test(
  "spec §Settlement Procedure / Open step 3 — verify-open rejects an open transaction whose fee payer is not the credential payer when sponsorFees is false",
  async (t) => {
    // This test targets the non-sponsored-fees branch of the spec's
    // fee-payer check (§"Settlement Procedure / Open" step 3). We
    // build the handler with sponsorFees: false and call
    // verifyFlexOpenTransaction directly with an expectedPayer that
    // does not match the transaction's fee payer. The handler should
    // reject.
    const owner = await generateKeyPairSigner();
    const source = await generateKeyPairSigner();
    const otherKey = await generateKeyPairSigner();
    const sessionKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey(
        "raw",
        (
          (await crypto.subtle.generateKey("Ed25519", true, [
            "sign",
            "verify",
          ])) as SessionKeyPair
        ).publicKey,
      ),
    );
    const sessionKey = address(bs58.encode(sessionKeyRaw));

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: otherKey.address,
      sessionKey,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as never,
            lastValidBlockHeight: 1000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey,
          programAddress: FLEX_PROGRAM_ADDRESS,
          expectedPayer: otherKey.address,
        }),
      "verify-open must reject a transaction whose fee payer is not the expected payer",
    );
    t.end();
  },
);

await t.test(
  "Flex invariant — verify-open rejects an open transaction whose create_escrow facilitator is not the expected facilitator",
  async (t) => {
    const owner = await generateKeyPairSigner();
    const source = await generateKeyPairSigner();
    const wrongFacilitator = await generateKeyPairSigner();
    const expectedFacilitator = await generateKeyPairSigner();
    const sessionKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey(
        "raw",
        (
          (await crypto.subtle.generateKey("Ed25519", true, [
            "sign",
            "verify",
          ])) as SessionKeyPair
        ).publicKey,
      ),
    );
    const sessionKey = address(bs58.encode(sessionKeyRaw));

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: wrongFacilitator.address,
      sessionKey,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as never,
            lastValidBlockHeight: 1000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey,
          programAddress: FLEX_PROGRAM_ADDRESS,
          expectedFacilitator: expectedFacilitator.address,
        }),
      "verify-open must reject a transaction whose create_escrow facilitator is not the expected facilitator",
    );
    t.end();
  },
);

await t.test(
  "Flex invariant — verify-open rejects an open transaction whose refund/deadman slots do not match expected",
  async (t) => {
    const owner = await generateKeyPairSigner();
    const source = await generateKeyPairSigner();
    const facilitator = await generateKeyPairSigner();
    const sessionKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey(
        "raw",
        (
          (await crypto.subtle.generateKey("Ed25519", true, [
            "sign",
            "verify",
          ])) as SessionKeyPair
        ).publicKey,
      ),
    );
    const sessionKey = address(bs58.encode(sessionKeyRaw));

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: facilitator.address,
      sessionKey,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      // These differ from what the handler advertises. Handler is built
      // below with 150n/1000n; the client builds with 75n/500n so the
      // decoded values should be rejected.
      refundTimeoutSlots: 75n,
      deadmanTimeoutSlots: 500n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as never,
            lastValidBlockHeight: 1000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey,
          programAddress: FLEX_PROGRAM_ADDRESS,
          expectedRefundTimeoutSlots: 150n,
          expectedDeadmanTimeoutSlots: 1000n,
        }),
      "verify-open must reject a transaction whose refund/deadman slot counts differ from the handler's advertised values",
    );
    t.end();
  },
);

await t.test(
  "spec §Settlement Procedure / Open step 4 — verify-open rejects an open transaction that carries duplicate Flex instructions",
  async (t) => {
    const owner = await generateKeyPairSigner();
    const source = await generateKeyPairSigner();
    const facilitator = await generateKeyPairSigner();
    const sessionKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey(
        "raw",
        (
          (await crypto.subtle.generateKey("Ed25519", true, [
            "sign",
            "verify",
          ])) as SessionKeyPair
        ).publicKey,
      ),
    );
    const sessionKey = address(bs58.encode(sessionKeyRaw));

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: facilitator.address,
      sessionKey,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    // Append a duplicate deposit instruction — verify-open currently
    // uses .find() on the discriminator and silently ignores
    // duplicates.
    const duplicated = [...built.instructions, built.instructions[1]];
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as never,
            lastValidBlockHeight: 1000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(duplicated, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "verify-open must reject a transaction carrying duplicate Flex instructions",
    );
    t.end();
  },
);

await t.test(
  "open-tx signature — verify-open rejects a transaction whose fee payer has not signed",
  async (t) => {
    const owner = await generateKeyPairSigner();
    const source = await generateKeyPairSigner();
    const facilitator = await generateKeyPairSigner();
    const sessionKeyRaw = new Uint8Array(
      await crypto.subtle.exportKey(
        "raw",
        (
          (await crypto.subtle.generateKey("Ed25519", true, [
            "sign",
            "verify",
          ])) as SessionKeyPair
        ).publicKey,
      ),
    );
    const sessionKey = address(bs58.encode(sessionKeyRaw));

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: facilitator.address,
      sessionKey,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    // Compile without signing — the resulting wire transaction has
    // no signatures attached.
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as never,
            lastValidBlockHeight: 1000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const compiled = compileTransaction(txMsg);
    const wire = getBase64EncodedWireTransaction(
      compiled as unknown as Parameters<
        typeof getBase64EncodedWireTransaction
      >[0],
    );

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "verify-open must reject a transaction with no signatures",
    );
    t.end();
  },
);

await t.test(
  "spec §Error Responses — handleSettle throws on a malformed challenge.request instead of returning null",
  async (t) => {
    const env = await makeStoreAndHandler();
    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const bogus = {
      ...challenge,
      request: "!!not-valid-base64-or-json!!",
    };
    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge: bogus,
          payload: { action: "voucher", channelId: "anything" },
        }),
      "malformed challenge.request must throw, not silently return null",
    );
    t.end();
  },
);

await t.test(
  "spec §Error Responses — handleSettle throws on a malformed challenge.expires field",
  async (t) => {
    const env = await makeStoreAndHandler();
    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const bogus = {
      ...challenge,
      expires: "not-a-number",
    };
    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge: bogus,
          payload: { action: "voucher", channelId: "anything" },
        }),
      "malformed challenge.expires must throw, not silently skip",
    );
    t.end();
  },
);

await t.test(
  "spec §Channel Exhaustion — handler rejects an open transaction whose depositAmount is below the minimum",
  async (t) => {
    const facilitatorSigner = await generateKeyPairSigner();
    const handler = await createMPPSolanaSessionHandler({
      network: "solana-devnet",
      rpc: stubRpc,
      facilitatorSigner,
      // This test exercises the minimum-deposit check, not fee-payer
      // policy, so disable sponsored fees.
      sponsorFees: false,
      supportedMints: [MINT],
      mintDecimals: 6,
      defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
      realm: "test",
      secretKey: SECRET_KEY,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      minGracePeriodSlots: 150n,
      challengeExpiresSeconds: 3600,
      maxRetries: 1,
      retryDelayMs: 1,
      flushIntervalMs: 1000,
      programAddress: FLEX_PROGRAM_ADDRESS,
      minDepositAmount: 10_000n,
    });

    const owner = await generateKeyPairSigner();
    const source = await generateKeyPairSigner();
    const sessionKeyPair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as SessionKeyPair;
    const raw = new Uint8Array(
      await crypto.subtle.exportKey("raw", sessionKeyPair.publicKey),
    );
    const sessionKey = address(bs58.encode(raw));

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: facilitatorSigner.address,
      sessionKey,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as never,
            lastValidBlockHeight: 1000n,
          },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    const initialVoucherMessage = serializeSpecVoucherMessage({
      channelId: built.escrow.toString(),
      cumulativeAmount: "0",
    });
    const initialVoucherSig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        sessionKeyPair.privateKey,
        initialVoucherMessage,
      ),
    );

    const challenge = await handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    await t.rejects(
      () =>
        handler.handleSettle({
          challenge,
          payload: {
            action: "open",
            channelId: built.escrow.toString(),
            payer: owner.address.toString(),
            depositAmount: "1",
            transaction: wire,
            voucher: {
              voucher: {
                channelId: built.escrow.toString(),
                cumulativeAmount: "0",
              },
              signer: sessionKey.toString(),
              signature: bs58.encode(initialVoucherSig),
              signatureType: "ed25519",
            },
          },
        }),
      "handler must reject an open transaction whose depositAmount is below minDepositAmount",
    );
    t.end();
  },
);

const TEST_CHANNEL_A = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const TEST_CHANNEL_B = address("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");

async function seedOpenChannel(
  store: ReturnType<typeof createInMemorySessionStore>,
  channelId: import("@solana/kit").Address,
  sessionKey: import("@solana/kit").Address,
  overrides: Partial<SessionState> = {},
) {
  await store.put({
    channelId,
    sessionKey,
    mint: MINT,
    escrowedAmount: 1_000_000n,
    acceptedCumulative: 0n,
    spent: 0n,
    inFlightAuthorizationIds: [],
    status: "open",
    ...overrides,
  });
}

await t.test(
  "spec §Voucher Verification step 4 — voucher inner channelId must equal credential channelId",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    // Voucher signed for channel B but submitted under channelId A.
    const tampered = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_B.toString(),
      cumulativeAmount: "100",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: TEST_CHANNEL_A.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: TEST_CHANNEL_A.toString(),
            voucher: tampered,
            flex,
          },
        }),
      "voucher whose inner channelId differs from the credential channelId must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Challenge — handleSettle rejects credentials with tampered challenge fields",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: TEST_CHANNEL_A.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });
    const payload = {
      action: "voucher" as const,
      channelId: TEST_CHANNEL_A.toString(),
      voucher,
      flex,
    };

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge: { ...challenge, realm: "evil-realm" },
          payload,
        }),
      "tampered realm must be rejected",
    );

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge: {
            ...challenge,
            request: Buffer.from('{"amount":"99999"}', "utf-8")
              .toString("base64")
              .replace(/\+/g, "-")
              .replace(/\//g, "_")
              .replace(/=+$/, ""),
          },
          payload,
        }),
      "tampered request body must be rejected",
    );

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge: { ...challenge, id: "fake-id" },
          payload,
        }),
      "tampered challenge id must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Challenge — handleSettle rejects an expired challenge",
  async (t) => {
    const facilitatorSigner = await generateKeyPairSigner();
    const handler = await createMPPSolanaSessionHandler({
      network: "solana-devnet",
      rpc: stubRpc,
      facilitatorSigner,
      sponsorFees: false,
      supportedMints: [MINT],
      mintDecimals: 6,
      defaultSplits: TEST_DEFAULT_SPLITS,
      realm: "test",
      secretKey: SECRET_KEY,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      minGracePeriodSlots: 150n,
      challengeExpiresSeconds: 1,
      maxRetries: 1,
      retryDelayMs: 1,
      flushIntervalMs: 1000,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });

    const challenge = await handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    await new Promise((r) => setTimeout(r, 1500));

    await t.rejects(
      () =>
        handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: TEST_CHANNEL_A.toString(),
            voucher: {
              voucher: {
                channelId: TEST_CHANNEL_A.toString(),
                cumulativeAmount: "100",
              },
              signer: TEST_CHANNEL_A.toString(),
              signature: "x".repeat(88),
              signatureType: "ed25519",
            },
          },
        }),
      "expired challenge must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 9 — voucher expiresAt in the past must be rejected",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
      expiresAt: expiredAt,
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: TEST_CHANNEL_A.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: TEST_CHANNEL_A.toString(),
            voucher,
            flex,
          },
        }),
      "expired voucher must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Format — voucher with non-ISO-8601 expiresAt must be rejected",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
      expiresAt: "yesterday-ish",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: TEST_CHANNEL_A.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: TEST_CHANNEL_A.toString(),
            voucher,
            flex,
          },
        }),
      "voucher with non-ISO-8601 expiresAt must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Receipt Format — handleSettle receipt validates against mppReceipt",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
    });
    const flex = await buildFlexExtension({
      keypair,
      channelId: TEST_CHANNEL_A.toString(),
      authorizationId: "1",
      maxAmount: "100",
    });

    const receipt = await env.handler.handleSettle({
      challenge,
      payload: {
        action: "voucher",
        channelId: TEST_CHANNEL_A.toString(),
        voucher,
        flex,
      },
    });
    t.ok(receipt, "receipt must be returned");
    if (receipt) {
      const validated = mppReceipt(receipt);
      t.notOk(
        isValidationError(validated),
        "session receipt must validate against the mppReceipt arktype",
      );
    }
    t.end();
  },
);

await t.test(
  "spec §Voucher Signing — serializeSpecVoucherMessage is independent of input key order",
  (t) => {
    const a = serializeSpecVoucherMessage({
      channelId: "channel-x",
      cumulativeAmount: "100",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    const reordered: {
      cumulativeAmount: string;
      expiresAt: string;
      channelId: string;
    } = {
      cumulativeAmount: "100",
      expiresAt: "2026-01-01T00:00:00.000Z",
      channelId: "channel-x",
    };
    const b = serializeSpecVoucherMessage(reordered);
    t.equal(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      t.equal(a[i], b[i]);
    }
    t.end();
  },
);

await t.test(
  "spec §Action: close — close with above-cumulative voucher advances state then transitions to closing",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey, {
      acceptedCumulative: 50n,
    });

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "150",
    });

    const receipt = await env.handler.handleSettle({
      challenge,
      payload: {
        action: "close",
        channelId: TEST_CHANNEL_A.toString(),
        voucher,
      },
    });
    t.ok(receipt);
    t.equal(receipt?.acceptedCumulative, "150");

    const after = await env.store.get(TEST_CHANNEL_A);
    t.equal(after?.acceptedCumulative, 150n);
    t.equal(after?.status, "closing");
    t.end();
  },
);

await t.test(
  "spec §Action: close — close with voucher exceeding escrowedAmount must be rejected",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey, {
      escrowedAmount: 1000n,
    });

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "9999999",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "close",
            channelId: TEST_CHANNEL_A.toString(),
            voucher,
          },
        }),
      "close voucher exceeding escrowedAmount must be rejected",
    );

    const after = await env.store.get(TEST_CHANNEL_A);
    t.equal(after?.status, "open", "state must be untouched after rejection");
    t.end();
  },
);

await t.test(
  "spec §Action: close — close on a non-existent channel must throw",
  async (t) => {
    const env = await makeStoreAndHandler();

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "close",
            channelId: TEST_CHANNEL_A.toString(),
          },
        }),
      "close on a missing channel must throw",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 1 — voucher on missing channel raises session-not-found",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
    });

    let caught: unknown;
    try {
      await env.handler.handleSettle({
        challenge,
        payload: {
          action: "voucher",
          channelId: TEST_CHANNEL_A.toString(),
          voucher,
        },
      });
    } catch (err) {
      caught = err;
    }
    t.ok(
      caught instanceof Error,
      "voucher on missing channel must throw an Error",
    );
    if (caught instanceof Error) {
      t.match(
        caught.message.toLowerCase(),
        /session-not-found/,
        "error must convey session-not-found reason",
      );
    }
    t.end();
  },
);

await t.test(
  "spec §Action: open — re-open with same params returns existing state without overwriting",
  async (t) => {
    // The owner is the fee payer for the open transaction in this
    // test, so disable sponsored fees on the handler.
    const env = await makeStoreAndHandler({ sponsorFees: false });
    const owner = await generateKeyPairSigner();
    const sessionA = await makeRealKeypairAddress();
    const source = await generateKeyPairSigner();
    const FAKE_BLOCKHASH =
      "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: env.facilitatorSigner.address,
      sessionKey: sessionA.address,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1000n },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    const initialMessage = serializeSpecVoucherMessage({
      channelId: built.escrow.toString(),
      cumulativeAmount: "0",
    });
    const initialSig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        sessionA.keypair.privateKey,
        initialMessage,
      ),
    );
    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const credential: mppCredential = {
      challenge,
      payload: {
        action: "open",
        channelId: built.escrow.toString(),
        payer: owner.address.toString(),
        depositAmount: "1000000",
        transaction: wire,
        voucher: {
          voucher: {
            channelId: built.escrow.toString(),
            cumulativeAmount: "0",
          },
          signer: sessionA.address.toString(),
          signature: bs58.encode(initialSig),
          signatureType: "ed25519",
        },
      },
    };

    await env.handler.handleSettle(credential);

    // Mutate the store directly to simulate the channel having served
    // some traffic since the first open.
    const live = await env.store.get(built.escrow);
    if (!live) throw new Error("missing state after first open");
    await env.store.put({ ...live, acceptedCumulative: 250n, spent: 100n });

    // A second handleSettle on the same credential must NOT reset
    // live state — the spec §"Action: open" idempotent re-open path
    // returns the existing state.
    const receipt = await env.handler.handleSettle(credential);
    t.equal(
      receipt?.acceptedCumulative,
      "250",
      "re-open must return the live acceptedCumulative",
    );
    t.equal(receipt?.spent, "100", "re-open must return the live spent value");

    const after = await env.store.get(built.escrow);
    t.equal(after?.acceptedCumulative, 250n);
    t.equal(after?.spent, 100n);
    t.end();
  },
);

await t.test(
  "spec §Settlement Procedure / Open step 6 — open with mint that doesn't match challenge currency must be rejected",
  async (t) => {
    // The owner is the fee payer for the open transaction in this
    // test, so disable sponsored fees on the handler.
    const env = await makeStoreAndHandler({ sponsorFees: false });
    const owner = await generateKeyPairSigner();
    const sessionKey = await makeRealKeypairAddress();
    const source = await generateKeyPairSigner();
    const FAKE_BLOCKHASH =
      "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;

    // Open transaction deposits a mint different from the challenge.
    const otherMint = address("So11111111111111111111111111111111111111112");
    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: env.facilitatorSigner.address,
      sessionKey: sessionKey.address,
      mint: otherMint,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });
    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1000n },
          m,
        ),
      (m) => appendTransactionMessageInstructions(built.instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    const initialMessage = serializeSpecVoucherMessage({
      channelId: built.escrow.toString(),
      cumulativeAmount: "0",
    });
    const initialSig = new Uint8Array(
      await crypto.subtle.sign(
        "Ed25519",
        sessionKey.keypair.privateKey,
        initialMessage,
      ),
    );

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "open",
            channelId: built.escrow.toString(),
            payer: owner.address.toString(),
            depositAmount: "1000000",
            transaction: wire,
            voucher: {
              voucher: {
                channelId: built.escrow.toString(),
                cumulativeAmount: "0",
              },
              signer: sessionKey.address.toString(),
              signature: bs58.encode(initialSig),
              signatureType: "ed25519",
            },
          },
        }),
      "open with mismatched deposit mint must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Settlement Procedure / Open step 4 — open carrying a foreign-program instruction must be rejected",
  async (t) => {
    const env = await makeStoreAndHandler();
    const owner = await generateKeyPairSigner();
    const sessionKey = await makeRealKeypairAddress();
    const source = await generateKeyPairSigner();
    const FAKE_BLOCKHASH =
      "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: env.facilitatorSigner.address,
      sessionKey: sessionKey.address,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });

    const memoIx = {
      programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      data: new Uint8Array([1, 2, 3]),
    };

    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1000n },
          m,
        ),
      (m) =>
        appendTransactionMessageInstructions(
          [...built.instructions, memoIx],
          m,
        ),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey.address,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "open carrying a foreign-program instruction must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Settlement Procedure / Open step 1 — open missing required Flex instruction must be rejected",
  async (t) => {
    const env = await makeStoreAndHandler();
    const owner = await generateKeyPairSigner();
    const sessionKey = await makeRealKeypairAddress();
    const source = await generateKeyPairSigner();
    const FAKE_BLOCKHASH =
      "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3" as Blockhash;

    const built = await buildSessionOpenInstructions({
      owner,
      facilitator: env.facilitatorSigner.address,
      sessionKey: sessionKey.address,
      mint: MINT,
      source: source.address,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 1,
      sessionKeyExpiresAtSlot: null,
      sessionKeyGracePeriodSlots: 150n,
      programAddress: FLEX_PROGRAM_ADDRESS,
    });

    // Drop the deposit instruction.
    const onlyTwo = [built.instructions[0], built.instructions[2]];

    const txMsg = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(owner, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1000n },
          m,
        ),
      (m) => appendTransactionMessageInstructions(onlyTwo, m),
    );
    const signed = await signTransactionMessageWithSigners(txMsg);
    const wire = getBase64EncodedWireTransaction(signed);

    await t.rejects(
      () =>
        verifyFlexOpenTransaction({
          transaction: wire,
          expectedChannelId: built.escrow,
          expectedSessionKey: sessionKey.address,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "open missing the deposit instruction must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Concurrency and Idempotency — voucher arriving before open returns session-not-found",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    // No seeded state.

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: TEST_CHANNEL_A.toString(),
            voucher,
          },
        }),
      "voucher submitted before open must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Verification step 7 — voucher arriving after close is rejected",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );

    // First, close the channel via handleSettle.
    await env.handler.handleSettle({
      challenge,
      payload: {
        action: "close",
        channelId: TEST_CHANNEL_A.toString(),
      },
    });

    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
    });

    await t.rejects(
      () =>
        env.handler.handleSettle({
          challenge,
          payload: {
            action: "voucher",
            channelId: TEST_CHANNEL_A.toString(),
            voucher,
          },
        }),
      "voucher arriving after close must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Method Details — handler construction rejects out-of-range mintDecimals",
  async (t) => {
    const facilitatorSigner = await generateKeyPairSigner();
    await t.rejects(
      () =>
        createMPPSolanaSessionHandler({
          network: "solana-devnet",
          rpc: stubRpc,
          facilitatorSigner,
          supportedMints: [MINT],
          mintDecimals: 10,
          defaultSplits: TEST_DEFAULT_SPLITS,
          realm: "test",
          secretKey: SECRET_KEY,
          refundTimeoutSlots: 150n,
          deadmanTimeoutSlots: 1000n,
          minGracePeriodSlots: 150n,
          challengeExpiresSeconds: 3600,
          maxRetries: 1,
          retryDelayMs: 1,
          flushIntervalMs: 1000,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "mintDecimals=10 must be rejected",
    );
    await t.rejects(
      () =>
        createMPPSolanaSessionHandler({
          network: "solana-devnet",
          rpc: stubRpc,
          facilitatorSigner,
          supportedMints: [MINT],
          mintDecimals: -1,
          defaultSplits: TEST_DEFAULT_SPLITS,
          realm: "test",
          secretKey: SECRET_KEY,
          refundTimeoutSlots: 150n,
          deadmanTimeoutSlots: 1000n,
          minGracePeriodSlots: 150n,
          challengeExpiresSeconds: 3600,
          maxRetries: 1,
          retryDelayMs: 1,
          flushIntervalMs: 1000,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "negative mintDecimals must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Method Details — handler construction rejects bogus tokenProgram",
  async (t) => {
    const facilitatorSigner = await generateKeyPairSigner();
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
    await t.rejects(
      () =>
        createMPPSolanaSessionHandler({
          network: "solana-devnet",
          rpc: stubRpc,
          facilitatorSigner,
          supportedMints: [MINT],
          mintDecimals: 6,
          tokenProgram: SYSTEM_PROGRAM,
          defaultSplits: TEST_DEFAULT_SPLITS,
          realm: "test",
          secretKey: SECRET_KEY,
          refundTimeoutSlots: 150n,
          deadmanTimeoutSlots: 1000n,
          minGracePeriodSlots: 150n,
          challengeExpiresSeconds: 3600,
          maxRetries: 1,
          retryDelayMs: 1,
          flushIntervalMs: 1000,
          programAddress: FLEX_PROGRAM_ADDRESS,
        }),
      "non-token-program tokenProgram must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Concurrency and Idempotency — idempotency cache evicts oldest entries past capacity",
  async (t) => {
    const env = await makeStoreAndHandler();
    const baseReceipt = {
      status: "success" as const,
      method: "solana",
      intent: SESSION_INTENT,
      timestamp: new Date().toISOString(),
      reference: "ref",
      acceptedCumulative: "0",
      spent: "0",
    };

    for (let i = 0; i < 4097; i++) {
      await env.handler.recordIdempotent("ch", `key-${i}`, baseReceipt);
    }

    const oldest = await env.handler.lookupIdempotent("ch", "key-0");
    t.equal(
      oldest,
      undefined,
      "oldest entry must be evicted once capacity is exceeded",
    );

    const newest = await env.handler.lookupIdempotent("ch", "key-4096");
    t.ok(newest, "newest entry must remain present");
    t.end();
  },
);

await t.test(
  "spec §Action: voucher — voucher without Flex extension is accepted (spec-pure path)",
  async (t) => {
    const env = await makeStoreAndHandler();
    const { keypair, address: sessionKey } = await makeRealKeypairAddress();
    await seedOpenChannel(env.store, TEST_CHANNEL_A, sessionKey);

    const challenge = await env.handler.getChallenge(
      SESSION_INTENT,
      {
        amount: "25",
        asset: MINT.toString(),
        recipient: RECIPIENT.toString(),
        network: "solana-devnet",
      },
      "http://test/resource",
    );
    const voucher = await buildSignedVoucher({
      keypair,
      signerAddress: sessionKey.toString(),
      channelId: TEST_CHANNEL_A.toString(),
      cumulativeAmount: "100",
    });

    const receipt = await env.handler.handleSettle({
      challenge,
      payload: {
        action: "voucher",
        channelId: TEST_CHANNEL_A.toString(),
        voucher,
      },
    });
    t.ok(receipt, "spec-pure voucher must be accepted");
    t.equal(receipt?.acceptedCumulative, "100");

    const after = await env.store.get(TEST_CHANNEL_A);
    t.equal(after?.acceptedCumulative, 100n);
    t.equal(
      after?.inFlightAuthorizationIds.length,
      0,
      "spec-pure voucher must NOT advance the Flex pending count",
    );
    t.end();
  },
);
