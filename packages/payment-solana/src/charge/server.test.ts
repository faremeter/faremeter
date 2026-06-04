#!/usr/bin/env pnpm tsx

import t from "tap";
import { isValidationError } from "@faremeter/types";
import {
  canonicalizeSortedJSON,
  decodeBase64URL,
  encodeBase64URL,
  type mppChallengeParams,
} from "@faremeter/types/mpp";
import {
  getBase64Encoder,
  generateKeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getSignatureFromTransaction,
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";

import {
  createMPPSolanaChargeClient,
  createMPPSolanaNativeChargeClient,
} from "./client";
import { chargeCredentialPayload, mppChargeRequest } from "./common";
import { createInMemoryReplayStore } from "./replay";
import type { ReplayStore } from "./replay";
import {
  createMPPSolanaChargeHandler,
  createMPPSolanaNativeChargeHandler,
} from "./server";
import type { Wallet } from "../exact/client";

const FAKE_BLOCKHASH = "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3";
const SIGNATURE =
  "1111111111111111111111111111111111111111111111111111111111111111";
const SETTLEMENT_SIGNATURE =
  "2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2";
const TOKEN_SIGNATURE =
  "3L3RY5sT8K4kyEnqhizwaqxLEbcYvpGrGPNEYRwtbCSUtL6YL86jdrvCbohnP5q8VxQ3qzGmt3W3iQJW97rD7m3";
const SECRET_KEY = new Uint8Array(32).fill(1);
const RECEIPT_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const RESOURCE_URL = "https://example.test/resource";

async function createWallet(): Promise<Wallet> {
  const signer = await generateKeyPairSigner();
  return {
    network: "devnet",
    publicKey: signer.address,
    partiallySignTransaction: (tx) =>
      partiallySignTransaction([signer.keyPair], tx),
  };
}

function createChargeContext(
  challenge: mppChallengeParams,
  network = "devnet",
) {
  const request = mppChargeRequest(
    JSON.parse(decodeBase64URL(challenge.request)),
  );
  if (isValidationError(request)) {
    throw new Error(request.summary);
  }
  return {
    pricing: {
      amount: request.amount,
      asset: request.currency,
      recipient: request.recipient,
      network,
    },
    resourceURL: RESOURCE_URL,
  };
}

function getTransactionPayload(payload: unknown) {
  const validatedPayload = chargeCredentialPayload(payload);
  if (isValidationError(validatedPayload)) {
    throw new Error(validatedPayload.summary);
  }
  if (validatedPayload.type !== "transaction") {
    throw new Error("expected transaction payload");
  }
  return validatedPayload.transaction;
}

function getPayloadTransactionSignature(transaction: string) {
  const txBytes = getBase64Encoder().encode(transaction);
  const decodedTx = getTransactionDecoder().decode(txBytes);
  return getSignatureFromTransaction(decodedTx);
}

type CreateFakeRpcOpts = {
  onSendTransaction?: (transaction: string) => void;
  signatureStatus?: {
    confirmationStatus?: "confirmed" | "finalized" | "processed" | null;
    err?: unknown;
  } | null;
  simulationError?: unknown;
};

function createFakeRpc(
  getTransactionBase64?: () => string,
  opts: CreateFakeRpcOpts = {},
): Rpc<SolanaRpcApi> {
  let sentTransactionBase64 = "";
  const signatureStatus =
    opts.signatureStatus === undefined
      ? { confirmationStatus: "confirmed", err: null }
      : opts.signatureStatus;

  return {
    getAccountInfo: () => ({
      send: async () => ({
        value: {
          data: [createMintAccountBase64(6), "base64"],
          executable: false,
          lamports: 1_000_000n,
          owner: TOKEN_PROGRAM_ADDRESS,
          space: 82n,
        },
      }),
    }),
    getLatestBlockhash: () => ({
      send: async () => ({
        value: {
          blockhash: FAKE_BLOCKHASH,
          lastValidBlockHeight: 1000n,
        },
      }),
    }),
    getSignatureStatuses: () => ({
      send: async () => ({
        value: [signatureStatus],
      }),
    }),
    getTransaction: () => ({
      send: async () => ({
        meta: { err: null },
        transaction: [
          getTransactionBase64?.() ?? sentTransactionBase64,
          "base64",
        ],
      }),
    }),
    sendTransaction: (transaction: string) => ({
      send: async () => {
        sentTransactionBase64 = transaction;
        opts.onSendTransaction?.(transaction);
        return SETTLEMENT_SIGNATURE;
      },
    }),
    simulateTransaction: () => ({
      send: async () => ({
        value: { err: opts.simulationError ?? null },
      }),
    }),
  } as unknown as Rpc<SolanaRpcApi>;
}

function createMintAccountBase64(decimals: number) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = 1;
  return Buffer.from(data).toString("base64");
}

async function claim(store: ReplayStore, id: string) {
  return store.claim(id);
}

async function generateChallengeID(
  secret: Uint8Array,
  params: Omit<mppChallengeParams, "id">,
): Promise<string> {
  const slots = [
    params.realm,
    params.method,
    params.intent,
    params.request,
    params.expires ?? "",
    params.digest ?? "",
    params.opaque ?? "",
  ];
  const message = new TextEncoder().encode(slots.join("|"));
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, message);
  return encodeBase64URL(String.fromCharCode(...new Uint8Array(sig)));
}

async function replaceChallengeRequest(
  challenge: mppChallengeParams,
  request: unknown,
  secretKey: Uint8Array,
): Promise<mppChallengeParams> {
  const requestEncoded = encodeBase64URL(canonicalizeSortedJSON(request));
  const nextParams: Omit<mppChallengeParams, "id"> = {
    realm: challenge.realm,
    method: challenge.method,
    intent: challenge.intent,
    request: requestEncoded,
    ...(challenge.expires !== undefined ? { expires: challenge.expires } : {}),
    ...(challenge.description !== undefined
      ? { description: challenge.description }
      : {}),
    ...(challenge.opaque !== undefined ? { opaque: challenge.opaque } : {}),
    ...(challenge.digest !== undefined ? { digest: challenge.digest } : {}),
  };
  const id = await generateChallengeID(secretKey, nextParams);
  return { id, ...nextParams };
}

async function replaceChallengeExpires(
  challenge: mppChallengeParams,
  expires: string,
  secretKey: Uint8Array,
): Promise<mppChallengeParams> {
  const nextParams: Omit<mppChallengeParams, "id"> = {
    realm: challenge.realm,
    method: challenge.method,
    intent: challenge.intent,
    request: challenge.request,
    expires,
    ...(challenge.description !== undefined
      ? { description: challenge.description }
      : {}),
    ...(challenge.opaque !== undefined ? { opaque: challenge.opaque } : {}),
    ...(challenge.digest !== undefined ? { digest: challenge.digest } : {}),
  };
  const id = await generateChallengeID(secretKey, nextParams);
  return { id, ...nextParams };
}

await t.test("charge request rejects malformed split amounts", async (t) => {
  const receiver = await generateKeyPairSigner();
  const splitReceiver = await generateKeyPairSigner();
  for (const amount of ["not-a-number", "1.5", "-1", "0"]) {
    const request = mppChargeRequest({
      amount: "1000000",
      currency: "sol",
      externalId: "challenge-a",
      recipient: receiver.address,
      methodDetails: {
        splits: [
          {
            amount,
            recipient: splitReceiver.address,
          },
        ],
      },
    });

    t.equal(isValidationError(request), true, amount);
  }
  t.end();
});

await t.test("charge request rejects too many splits", async (t) => {
  const receiver = await generateKeyPairSigner();
  const splitReceiver = await generateKeyPairSigner();
  const request = mppChargeRequest({
    amount: "1000000",
    currency: "sol",
    externalId: "challenge-a",
    recipient: receiver.address,
    methodDetails: {
      splits: Array.from({ length: 9 }, () => ({
        amount: "1",
        recipient: splitReceiver.address,
      })),
    },
  });

  t.equal(isValidationError(request), true);
  t.end();
});

await t.test(
  "native charge challenges bind externalId memo and claim push signatures",
  async (t) => {
    let transactionBase64 = "";
    const rpc = createFakeRpc(() => transactionBase64);
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: new Uint8Array(32).fill(1),
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const request = mppChargeRequest(
      JSON.parse(decodeBase64URL(challenge.request)),
    );
    if (isValidationError(request)) {
      throw new Error(request.summary);
    }
    t.match(challenge.expires, RECEIPT_TIMESTAMP_RE);
    t.ok(request.externalId);
    t.notOk(Object.hasOwn(request.methodDetails ?? {}, "memo"));
    t.notOk(Object.hasOwn(request.methodDetails ?? {}, "decimals"));

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }
    const credential = await execer.exec();
    transactionBase64 = getTransactionPayload(credential.payload);

    const receipt = await handler.handleSettle(
      {
        challenge,
        payload: { type: "signature", signature: SIGNATURE },
      },
      createChargeContext(challenge),
    );

    t.match(receipt, {
      status: "success",
      method: "solana",
      challengeId: challenge.id,
      timestamp: RECEIPT_TIMESTAMP_RE,
      reference: SIGNATURE,
    });
    t.equal(
      await claim(replayStore, `solana-charge:consumed:${SIGNATURE}`),
      false,
    );
    t.end();
  },
);

await t.test("native charge settles without externalId", async (t) => {
  const rpc = createFakeRpc();
  const replayStore = createInMemoryReplayStore();
  const handler = await createMPPSolanaNativeChargeHandler({
    network: "devnet",
    rpc,
    replayStore,
    realm: "test",
    secretKey: SECRET_KEY,
  });

  const receiver = await generateKeyPairSigner();
  const challenge = await handler.getChallenge(
    "charge",
    {
      amount: "1000000",
      asset: "sol",
      recipient: receiver.address,
      network: "solana:devnet",
    },
    "https://example.test/resource",
  );

  const request = mppChargeRequest(
    JSON.parse(decodeBase64URL(challenge.request)),
  );
  if (isValidationError(request)) {
    throw new Error(request.summary);
  }
  const requestWithoutExternalId = { ...request, externalId: undefined };
  const challengeWithoutExternalId = await replaceChallengeRequest(
    challenge,
    requestWithoutExternalId,
    SECRET_KEY,
  );
  await replayStore.add(challengeWithoutExternalId.id, Date.now() + 60_000);

  const client = createMPPSolanaNativeChargeClient({
    wallet: await createWallet(),
    rpc,
  });
  const execer = await client(challengeWithoutExternalId);
  if (!execer) {
    throw new Error("expected client to handle native charge challenge");
  }

  const receipt = await handler.handleSettle(
    await execer.exec(),
    createChargeContext(challengeWithoutExternalId),
  );

  t.match(receipt, {
    status: "success",
    method: "solana",
    challengeId: challengeWithoutExternalId.id,
    timestamp: RECEIPT_TIMESTAMP_RE,
    reference: SETTLEMENT_SIGNATURE,
  });
  t.end();
});

await t.test(
  "native charge settles with legacy unix-second expiry",
  async (t) => {
    const rpc = createFakeRpc();
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );
    const legacyChallenge = await replaceChallengeExpires(
      challenge,
      String(Math.floor(Date.now() / 1000) + 60),
      SECRET_KEY,
    );
    await replayStore.add(legacyChallenge.id, Date.now() + 60_000);

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(legacyChallenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }

    const receipt = await handler.handleSettle(
      await execer.exec(),
      createChargeContext(legacyChallenge),
    );

    t.match(receipt, {
      status: "success",
      method: "solana",
      challengeId: legacyChallenge.id,
      timestamp: RECEIPT_TIMESTAMP_RE,
      reference: SETTLEMENT_SIGNATURE,
    });
    t.end();
  },
);

await t.test(
  "native charge settles client-paid pull transactions without fee payer",
  async (t) => {
    const rpc = createFakeRpc();
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: new Uint8Array(32).fill(1),
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }
    const credential = await execer.exec();
    const transactionSignature = getPayloadTransactionSignature(
      getTransactionPayload(credential.payload),
    );

    const receipt = await handler.handleSettle(
      credential,
      createChargeContext(challenge),
    );

    t.match(receipt, {
      status: "success",
      method: "solana",
      challengeId: challenge.id,
      timestamp: RECEIPT_TIMESTAMP_RE,
      reference: SETTLEMENT_SIGNATURE,
    });
    t.equal(
      await claim(
        replayStore,
        `solana-charge:consumed:${transactionSignature}`,
      ),
      false,
    );
    t.end();
  },
);

await t.test(
  "native charge rejects pull when the confirmed transaction differs",
  async (t) => {
    let confirmedTransactionBase64 = "";
    const rpc = createFakeRpc(() => confirmedTransactionBase64);
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );
    const request = mppChargeRequest(
      JSON.parse(decodeBase64URL(challenge.request)),
    );
    if (isValidationError(request)) {
      throw new Error(request.summary);
    }

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }
    const credential = await execer.exec();

    const wrongReceiver = await generateKeyPairSigner();
    const wrongChallenge = await replaceChallengeRequest(
      challenge,
      { ...request, recipient: wrongReceiver.address },
      SECRET_KEY,
    );
    const wrongExecer = await client(wrongChallenge);
    if (!wrongExecer) {
      throw new Error("expected client to handle modified native challenge");
    }
    const wrongCredential = await wrongExecer.exec();
    confirmedTransactionBase64 = getTransactionPayload(wrongCredential.payload);

    await t.rejects(
      handler.handleSettle(credential, createChargeContext(challenge)),
      {
        message:
          /confirmed transaction verification failed: no matching transferSol instruction found/,
      },
    );
    t.end();
  },
);

await t.test(
  "native charge rejects consumed pull signatures before sending",
  async (t) => {
    let sendCount = 0;
    const rpc = createFakeRpc(undefined, {
      onSendTransaction: () => {
        sendCount += 1;
      },
    });
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: new Uint8Array(32).fill(1),
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }
    const credential = await execer.exec();
    const transactionSignature = getPayloadTransactionSignature(
      getTransactionPayload(credential.payload),
    );

    t.equal(
      await claim(
        replayStore,
        `solana-charge:consumed:${transactionSignature}`,
      ),
      true,
    );
    await t.rejects(
      handler.handleSettle(credential, createChargeContext(challenge)),
      {
        message: "transaction signature already consumed",
      },
    );
    t.equal(sendCount, 0);
    t.end();
  },
);

await t.test(
  "native charge releases pull signatures when simulation fails",
  async (t) => {
    let sendCount = 0;
    const rpc = createFakeRpc(undefined, {
      onSendTransaction: () => {
        sendCount += 1;
      },
      simulationError: { InstructionError: [0, "Custom"] },
    });
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }
    const credential = await execer.exec();
    const transactionSignature = getPayloadTransactionSignature(
      getTransactionPayload(credential.payload),
    );

    await t.rejects(
      handler.handleSettle(credential, createChargeContext(challenge)),
      { message: "settlement failed: Transaction simulation failed" },
    );

    t.equal(sendCount, 0);
    t.equal(
      await claim(
        replayStore,
        `solana-charge:consumed:${transactionSignature}`,
      ),
      true,
    );
    t.end();
  },
);

await t.test(
  "native charge keeps pull signatures claimed after submit timeout",
  async (t) => {
    let sendCount = 0;
    const rpc = createFakeRpc(undefined, {
      onSendTransaction: () => {
        sendCount += 1;
      },
      signatureStatus: null,
    });
    const replayStore = createInMemoryReplayStore();
    const handler = await createMPPSolanaNativeChargeHandler({
      network: "devnet",
      rpc,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
      maxRetries: 1,
      retryDelayMs: 0,
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: "sol",
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const client = createMPPSolanaNativeChargeClient({
      wallet: await createWallet(),
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }
    const credential = await execer.exec();
    const transactionSignature = getPayloadTransactionSignature(
      getTransactionPayload(credential.payload),
    );

    await t.rejects(
      handler.handleSettle(credential, createChargeContext(challenge)),
      { message: "settlement failed: Transaction confirmation timeout" },
    );

    t.equal(sendCount, 1);
    t.equal(
      await claim(
        replayStore,
        `solana-charge:consumed:${transactionSignature}`,
      ),
      false,
    );
    t.end();
  },
);

await t.test("native charge rejects consumed push signatures", async (t) => {
  let transactionBase64 = "";
  const rpc = createFakeRpc(() => transactionBase64);
  const replayStore = createInMemoryReplayStore();
  const handler = await createMPPSolanaNativeChargeHandler({
    network: "devnet",
    rpc,
    replayStore,
    realm: "test",
    secretKey: new Uint8Array(32).fill(1),
  });

  const receiver = await generateKeyPairSigner();
  const challenge = await handler.getChallenge(
    "charge",
    {
      amount: "1000000",
      asset: "sol",
      recipient: receiver.address,
      network: "solana:devnet",
    },
    "https://example.test/resource",
  );

  const client = createMPPSolanaNativeChargeClient({
    wallet: await createWallet(),
    rpc,
  });
  const execer = await client(challenge);
  if (!execer) {
    throw new Error("expected client to handle native charge challenge");
  }
  const credential = await execer.exec();
  transactionBase64 = getTransactionPayload(credential.payload);

  t.equal(
    await claim(replayStore, `solana-charge:consumed:${SIGNATURE}`),
    true,
  );
  await t.rejects(
    handler.handleSettle(
      {
        challenge,
        payload: { type: "signature", signature: SIGNATURE },
      },
      createChargeContext(challenge),
    ),
    { message: "transaction signature already consumed" },
  );
  t.end();
});

await t.test(
  "SPL charge settles client-paid pull transactions without fee payer",
  async (t) => {
    const rpc = createFakeRpc();
    const replayStore = createInMemoryReplayStore();
    const mint = await generateKeyPairSigner();
    const handler = await createMPPSolanaChargeHandler({
      network: "devnet",
      rpc,
      mint: mint.address,
      replayStore,
      realm: "test",
      secretKey: new Uint8Array(32).fill(1),
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: mint.address,
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const client = createMPPSolanaChargeClient({
      wallet: await createWallet(),
      mint: mint.address,
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle SPL charge challenge");
    }
    const credential = await execer.exec();
    const transactionSignature = getPayloadTransactionSignature(
      getTransactionPayload(credential.payload),
    );

    const receipt = await handler.handleSettle(
      credential,
      createChargeContext(challenge),
    );

    t.match(receipt, {
      status: "success",
      method: "solana",
      challengeId: challenge.id,
      timestamp: RECEIPT_TIMESTAMP_RE,
      reference: SETTLEMENT_SIGNATURE,
    });
    t.equal(
      await claim(
        replayStore,
        `solana-charge:consumed:${transactionSignature}`,
      ),
      false,
    );
    t.end();
  },
);

await t.test(
  "SPL charge releases pull signatures when simulation fails",
  async (t) => {
    let sendCount = 0;
    const rpc = createFakeRpc(undefined, {
      onSendTransaction: () => {
        sendCount += 1;
      },
      simulationError: { InstructionError: [0, "Custom"] },
    });
    const replayStore = createInMemoryReplayStore();
    const mint = await generateKeyPairSigner();
    const handler = await createMPPSolanaChargeHandler({
      network: "devnet",
      rpc,
      mint: mint.address,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: mint.address,
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );

    const client = createMPPSolanaChargeClient({
      wallet: await createWallet(),
      mint: mint.address,
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle SPL charge challenge");
    }
    const credential = await execer.exec();
    const transactionSignature = getPayloadTransactionSignature(
      getTransactionPayload(credential.payload),
    );

    await t.rejects(
      handler.handleSettle(credential, createChargeContext(challenge)),
      { message: "settlement failed: Transaction simulation failed" },
    );

    t.equal(sendCount, 0);
    t.equal(
      await claim(
        replayStore,
        `solana-charge:consumed:${transactionSignature}`,
      ),
      true,
    );
    t.end();
  },
);

await t.test(
  "SPL charge rejects pull transactions with address lookup tables",
  async (t) => {
    let sendCount = 0;
    const rpc = createFakeRpc(undefined, {
      onSendTransaction: () => {
        sendCount += 1;
      },
    });
    const replayStore = createInMemoryReplayStore();
    const mint = await generateKeyPairSigner();
    const handler = await createMPPSolanaChargeHandler({
      network: "devnet",
      rpc,
      mint: mint.address,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
    });

    const sender = await generateKeyPairSigner();
    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: mint.address,
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );
    const [senderATA] = await findAssociatedTokenPda({
      mint: mint.address,
      owner: sender.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const [receiverATA] = await findAssociatedTokenPda({
      mint: mint.address,
      owner: receiver.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
    const transaction = await encodeTransactionWithLookupTable(
      buildTransactionMessage(
        [
          getTransferCheckedInstruction(
            {
              source: senderATA,
              mint: mint.address,
              destination: receiverATA,
              authority: sender.address,
              amount: 1_000_000n,
              decimals: 6,
            },
            { programAddress: TOKEN_PROGRAM_ADDRESS },
          ),
        ],
        sender,
      ),
      sender,
      [receiverATA],
    );

    await t.rejects(
      handler.handleSettle(
        {
          challenge,
          payload: { type: "transaction", transaction },
        },
        createChargeContext(challenge),
      ),
      { message: "address lookup tables are not supported" },
    );
    t.equal(sendCount, 0);
    t.end();
  },
);

await t.test(
  "SPL charge rejects pull when the confirmed transaction differs",
  async (t) => {
    let confirmedTransactionBase64 = "";
    const rpc = createFakeRpc(() => confirmedTransactionBase64);
    const replayStore = createInMemoryReplayStore();
    const mint = await generateKeyPairSigner();
    const handler = await createMPPSolanaChargeHandler({
      network: "devnet",
      rpc,
      mint: mint.address,
      replayStore,
      realm: "test",
      secretKey: SECRET_KEY,
    });

    const receiver = await generateKeyPairSigner();
    const challenge = await handler.getChallenge(
      "charge",
      {
        amount: "1000000",
        asset: mint.address,
        recipient: receiver.address,
        network: "solana:devnet",
      },
      "https://example.test/resource",
    );
    const request = mppChargeRequest(
      JSON.parse(decodeBase64URL(challenge.request)),
    );
    if (isValidationError(request)) {
      throw new Error(request.summary);
    }

    const client = createMPPSolanaChargeClient({
      wallet: await createWallet(),
      mint: mint.address,
      rpc,
    });
    const execer = await client(challenge);
    if (!execer) {
      throw new Error("expected client to handle SPL charge challenge");
    }
    const credential = await execer.exec();

    const wrongReceiver = await generateKeyPairSigner();
    const wrongChallenge = await replaceChallengeRequest(
      challenge,
      { ...request, recipient: wrongReceiver.address },
      SECRET_KEY,
    );
    const wrongExecer = await client(wrongChallenge);
    if (!wrongExecer) {
      throw new Error("expected client to handle modified SPL challenge");
    }
    const wrongCredential = await wrongExecer.exec();
    confirmedTransactionBase64 = getTransactionPayload(wrongCredential.payload);

    await t.rejects(
      handler.handleSettle(credential, createChargeContext(challenge)),
      {
        message:
          /confirmed transaction verification failed: no matching transferChecked instruction found/,
      },
    );
    t.end();
  },
);

await t.test("SPL charge rejects consumed push signatures", async (t) => {
  let transactionBase64 = "";
  const rpc = createFakeRpc(() => transactionBase64);
  const replayStore = createInMemoryReplayStore();
  const mint = await generateKeyPairSigner();
  const handler = await createMPPSolanaChargeHandler({
    network: "devnet",
    rpc,
    mint: mint.address,
    replayStore,
    realm: "test",
    secretKey: new Uint8Array(32).fill(1),
  });

  const receiver = await generateKeyPairSigner();
  const challenge = await handler.getChallenge(
    "charge",
    {
      amount: "1000000",
      asset: mint.address,
      recipient: receiver.address,
      network: "solana:devnet",
    },
    "https://example.test/resource",
  );

  const client = createMPPSolanaChargeClient({
    wallet: await createWallet(),
    mint: mint.address,
    rpc,
  });
  const execer = await client(challenge);
  if (!execer) {
    throw new Error("expected client to handle SPL charge challenge");
  }
  const credential = await execer.exec();
  transactionBase64 = getTransactionPayload(credential.payload);

  t.equal(
    await claim(replayStore, `solana-charge:consumed:${TOKEN_SIGNATURE}`),
    true,
  );
  await t.rejects(
    handler.handleSettle(
      {
        challenge,
        payload: { type: "signature", signature: TOKEN_SIGNATURE },
      },
      createChargeContext(challenge),
    ),
    { message: "transaction signature already consumed" },
  );
  t.end();
});
