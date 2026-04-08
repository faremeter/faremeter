#!/usr/bin/env pnpm tsx

// Forward spec-conformance test: the client must produce credentials
// whose payloads validate against the server's spec-shaped validators.
// draft-solana-session-00 §"Action: open" requires the open credential
// to carry `payer`, `depositAmount`, `transaction`, AND an initial
// signed `voucher`. This test asserts the round trip end-to-end via
// the public client/server APIs without touching any RPC.

import t from "tap";
import {
  address,
  generateKeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import type { webcrypto } from "node:crypto";
import bs58 from "bs58";

import { createMPPSolanaSessionClient } from "./client";
import { createMPPSolanaSessionHandler } from "./server";
import { solanaSessionPayload, solanaSessionRequest } from "./common";
import { isValidationError } from "@faremeter/types";
import { SESSION_INTENT, decodeBase64URL } from "@faremeter/types/mpp";
import { FLEX_PROGRAM_ADDRESS } from "@faremeter/flex-solana";

type SessionKeyPair = webcrypto.CryptoKeyPair;

const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const RECIPIENT = address("3QFU3r76XiQVdqkaX5K6FWkDyiBKN7EK3UjRSWxMXHt3");
const ESCROW = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");

const stubRpc = {} as unknown as Rpc<SolanaRpcApi>;

async function makeClientServerEnv() {
  const facilitatorSigner = await generateKeyPairSigner();
  const handler = await createMPPSolanaSessionHandler({
    network: "solana-devnet",
    rpc: stubRpc,
    facilitatorSigner,
    supportedMints: [MINT],
    mintDecimals: 6,
    defaultSplits: [{ recipient: RECIPIENT.toString(), bps: 10000 }],
    realm: "test",
    secretKey: new TextEncoder().encode("client-test-secret"),
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    minGracePeriodSlots: 150n,
    challengeExpiresSeconds: 3600,
    maxRetries: 1,
    retryDelayMs: 1,
    flushIntervalMs: 1000,
    programAddress: FLEX_PROGRAM_ADDRESS,
  });

  const sessionKeyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as SessionKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", sessionKeyPair.publicKey),
  );
  const sessionKeyAddress = address(bs58.encode(raw));

  const walletSigner = await generateKeyPairSigner();
  const wallet = { address: walletSigner.address };

  const depositAmount = 1_000_000n;

  const client = createMPPSolanaSessionClient({
    wallet,
    sessionKeyPair,
    sessionKeyAddress,
    programAddress: FLEX_PROGRAM_ADDRESS,
    buildOpenTransaction: async () => ({
      // The client test does not exercise verifyFlexOpenTransaction
      // (which lives behind the server's handleSettle). The dedicated
      // middleware integration test in tests/mpp-session/ wires a real
      // wire transaction through the verify path.
      transaction: "AA",
      escrow: ESCROW,
      mint: MINT,
      depositAmount,
      payer: wallet.address,
    }),
  });

  return {
    handler,
    client,
    wallet,
    sessionKeyPair,
    sessionKeyAddress,
    depositAmount,
  };
}

await t.test(
  "spec §Action: open — client emits a credential payload that validates",
  async (t) => {
    const env = await makeClientServerEnv();

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

    const requestParsed = solanaSessionRequest(
      JSON.parse(decodeBase64URL(challenge.request)),
    );
    if (isValidationError(requestParsed)) {
      throw new Error(
        `server emitted a request that fails its own validator: ${requestParsed.summary}`,
      );
    }

    const execer = await env.client(challenge);
    if (!execer) {
      throw new Error("client refused a session-intent solana challenge");
    }

    const credential = await execer.exec();
    const validated = solanaSessionPayload(credential.payload);

    t.notOk(
      isValidationError(validated),
      "client open credential payload must validate against solanaSessionPayload",
    );

    if (!isValidationError(validated)) {
      t.equal(
        validated.action,
        "open",
        "credential payload must carry the open action",
      );
      if (validated.action === "open") {
        t.equal(
          validated.channelId,
          ESCROW.toString(),
          "credential channelId must match the escrow returned by buildOpenTransaction",
        );
        t.equal(
          validated.payer,
          env.wallet.address.toString(),
          "credential payer must match the wallet address",
        );
        t.equal(
          validated.depositAmount,
          env.depositAmount.toString(),
          "credential depositAmount must match the value buildOpenTransaction returned",
        );
        t.equal(
          validated.voucher.signer,
          env.sessionKeyAddress.toString(),
          "initial voucher must be signed by the session key",
        );
        t.equal(
          validated.voucher.voucher.cumulativeAmount,
          "0",
          "initial voucher cumulative amount must be 0",
        );
        t.equal(
          validated.voucher.voucher.channelId,
          ESCROW.toString(),
          "initial voucher channelId must match the credential channelId",
        );
      }
    }

    void requestParsed;
    t.end();
  },
);
