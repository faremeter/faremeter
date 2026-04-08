#!/usr/bin/env pnpm tsx

// Forward spec-conformance tests for the Solana session credential
// payloads. Each test asserts the spec-correct shape from
// draft-solana-session-00 §"Credential Schema" / §"Action: *". Failing
// tests document a wire-format divergence between the handler's
// validators and the spec.

import t from "tap";
import { isValidationError } from "@faremeter/types";
import {
  solanaSessionOpenPayload,
  solanaSessionTopUpPayload,
  solanaSessionVoucherPayload,
  solanaSessionClosePayload,
} from "./common";

const CHANNEL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SIGNER = "DFo9vd1eiRFGQuCkReqvZvRPJVwwYu8NwCiaa9tB5pWZ";

const minimalSpecVoucher = {
  voucher: {
    channelId: CHANNEL,
    cumulativeAmount: "100",
  },
  signer: SIGNER,
  signature: "1".repeat(88),
  signatureType: "ed25519" as const,
};

await t.test(
  "spec §Action: open — minimal spec-shaped credential validates",
  (t) => {
    const result = solanaSessionOpenPayload({
      action: "open",
      channelId: CHANNEL,
      payer: "owner-pubkey",
      depositAmount: "1000000",
      transaction: "base64transactionbytes",
      voucher: minimalSpecVoucher,
    });
    t.notOk(
      isValidationError(result),
      "spec-shaped open credential must validate",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: topUp — minimal spec-shaped credential validates",
  (t) => {
    const result = solanaSessionTopUpPayload({
      action: "topUp",
      channelId: CHANNEL,
      additionalAmount: "500000",
      transaction: "base64topupbytes",
    });
    t.notOk(
      isValidationError(result),
      "spec-shaped topUp credential must validate",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: voucher — minimal spec-shaped credential validates",
  (t) => {
    // Spec §"Action: voucher" carries `action`, `channelId`, and the
    // signed voucher object only. The `flex` extension is a Faremeter
    // extension and MUST NOT be required for the credential to
    // validate.
    const result = solanaSessionVoucherPayload({
      action: "voucher",
      channelId: CHANNEL,
      voucher: minimalSpecVoucher,
    });
    t.notOk(
      isValidationError(result),
      "spec-shaped voucher credential must validate without a Flex extension",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: close — minimal spec-shaped credential without voucher validates",
  (t) => {
    // Spec §"Action: close" makes `voucher` OPTIONAL and does not
    // define a `closeTransaction` field. A close credential carrying
    // only `action` and `channelId` MUST validate.
    const result = solanaSessionClosePayload({
      action: "close",
      channelId: CHANNEL,
    });
    t.notOk(
      isValidationError(result),
      "spec-shaped bare close credential must validate",
    );
    t.end();
  },
);

await t.test(
  "spec §Action: close — spec-shaped credential with optional voucher validates",
  (t) => {
    const result = solanaSessionClosePayload({
      action: "close",
      channelId: CHANNEL,
      voucher: minimalSpecVoucher,
    });
    t.notOk(
      isValidationError(result),
      "spec-shaped close credential with voucher must validate",
    );
    t.end();
  },
);

await t.test(
  "spec §Voucher Format / Voucher Data — voucher cumulativeAmount rejects decimals and negatives",
  (t) => {
    // draft-solana-session-00 §"Voucher Format / Voucher Data"
    // specifies cumulativeAmount as a "total amount in base units".
    // Base units are non-negative integers; decimals and negatives
    // are not meaningful and must be rejected by the validator.
    const decimal = solanaSessionVoucherPayload({
      action: "voucher",
      channelId: CHANNEL,
      voucher: {
        ...minimalSpecVoucher,
        voucher: {
          channelId: CHANNEL,
          cumulativeAmount: "1.5",
        },
      },
    });
    t.ok(
      isValidationError(decimal),
      "cumulativeAmount with a decimal point must be rejected",
    );

    const negative = solanaSessionVoucherPayload({
      action: "voucher",
      channelId: CHANNEL,
      voucher: {
        ...minimalSpecVoucher,
        voucher: {
          channelId: CHANNEL,
          cumulativeAmount: "-1",
        },
      },
    });
    t.ok(
      isValidationError(negative),
      "negative cumulativeAmount must be rejected",
    );
    t.end();
  },
);

await t.test(
  "spec §Signed Voucher — schema rejects signatureType other than ed25519",
  (t) => {
    // Spec §"Signed Voucher" defines signatureType as the literal
    // "ed25519". A bare voucher claiming any other algorithm MUST
    // fail validation at the schema layer.
    const result = solanaSessionVoucherPayload({
      action: "voucher",
      channelId: CHANNEL,
      voucher: {
        voucher: {
          channelId: CHANNEL,
          cumulativeAmount: "100",
        },
        signer: SIGNER,
        signature: "1".repeat(88),
        signatureType: "secp256r1",
      },
    });
    t.ok(
      isValidationError(result),
      "voucher with signatureType !== 'ed25519' must fail validation",
    );
    t.end();
  },
);
