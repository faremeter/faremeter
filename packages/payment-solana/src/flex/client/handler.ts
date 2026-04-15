import { type Address, address } from "@solana/kit";

import type {
  PaymentExecer,
  PaymentHandler,
  RequestContext,
} from "@faremeter/types/client";
import type { x402PaymentRequirements } from "@faremeter/types/x402v2";
import { isValidationError } from "@faremeter/types";

import {
  serializePaymentAuthorization,
  signPaymentAuthorization,
  fetchEscrowAccount,
  FlexPaymentRequirementsExtra,
  FLEX_PROGRAM_ADDRESS,
} from "@faremeter/flex-solana";
import { generateMatcher } from "../common";
import type { webcrypto } from "node:crypto";
import { logger } from "../logger";

type CryptoKeyPair = webcrypto.CryptoKeyPair;

type Rpc = Parameters<typeof fetchEscrowAccount>[0];

type SlotProvider = { getSlot(): { send(): Promise<bigint> } };

/** Configuration for `createPaymentHandler`. */
export type CreateFlexPaymentHandlerOpts = {
  network: string;
  escrow: Address;
  mint: Address;
  sessionKeyPair: CryptoKeyPair;
  sessionKeyAddress: Address;
  rpc: Rpc & SlotProvider;
  programAddress?: Address;
};

const MS_PER_SLOT = 400;
const EXPIRY_BUFFER_SLOTS = 20n;

/**
 * Creates a client-side `PaymentHandler` that signs Flex payment
 * authorizations against compatible x402 requirements.
 *
 * @param opts - Escrow, session key, and RPC configuration
 * @returns A handler that produces signed payment payloads
 */
export function createPaymentHandler(
  opts: CreateFlexPaymentHandlerOpts,
): PaymentHandler {
  const {
    escrow,
    mint,
    sessionKeyPair,
    sessionKeyAddress,
    rpc,
    programAddress = FLEX_PROGRAM_ADDRESS,
  } = opts;

  const { isMatchingRequirement } = generateMatcher(opts.network, mint);

  let cachedRefundTimeoutSlots: bigint | null = null;
  let refundTimeoutPromise: Promise<bigint> | null = null;

  async function getRefundTimeoutSlots(): Promise<bigint> {
    if (cachedRefundTimeoutSlots !== null) return cachedRefundTimeoutSlots;
    refundTimeoutPromise ??= fetchEscrowAccount(rpc, escrow)
      .then((account) => {
        if (!account) {
          throw new Error("Escrow account not found on-chain");
        }
        cachedRefundTimeoutSlots = account.refundTimeoutSlots;
        return account.refundTimeoutSlots;
      })
      .catch((cause: unknown) => {
        refundTimeoutPromise = null;
        throw cause;
      });
    return refundTimeoutPromise;
  }

  let lastKnownSlot = 0n;
  let lastSlotFetchedAtMs = 0;

  async function getCurrentSlot(): Promise<bigint> {
    const elapsed = Date.now() - lastSlotFetchedAtMs;
    if (lastKnownSlot > 0n && elapsed < 5_000) {
      return lastKnownSlot + BigInt(Math.floor(elapsed / MS_PER_SLOT));
    }
    lastKnownSlot = await rpc.getSlot().send();
    lastSlotFetchedAtMs = Date.now();
    return lastKnownSlot;
  }

  function randomU64(): bigint {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return view.getBigUint64(0, true);
  }

  return async (
    _context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> => {
    const compatible = accepts.filter(isMatchingRequirement);

    return compatible.map((requirements) => {
      const exec = async () => {
        const extraResult = FlexPaymentRequirementsExtra(requirements.extra);
        if (isValidationError(extraResult)) {
          throw new Error(
            `Invalid flex requirements extra: ${extraResult.summary}`,
          );
        }

        const refundTimeoutSlots = await getRefundTimeoutSlots();

        const currentSlot = await getCurrentSlot();
        const authorizationId = randomU64();
        const expiresAtSlot =
          currentSlot + refundTimeoutSlots - EXPIRY_BUFFER_SLOTS;
        const maxAmount = BigInt(requirements.amount);

        const message = serializePaymentAuthorization({
          programId: programAddress,
          escrow,
          mint,
          maxAmount,
          authorizationId,
          expiresAtSlot,
          splits: extraResult.splits.map((s) => ({
            recipient: address(s.recipient),
            bps: s.bps,
          })),
        });

        const signature = await signPaymentAuthorization({
          message,
          keyPair: sessionKeyPair,
        });

        const signatureBase64 = btoa(String.fromCharCode(...signature));

        logger.debug("signed payment authorization", {
          escrow,
          authorizationId: authorizationId.toString(),
          maxAmount: maxAmount.toString(),
        });

        const payload = {
          escrow,
          mint,
          maxAmount: maxAmount.toString(),
          authorizationId: authorizationId.toString(),
          expiresAtSlot: expiresAtSlot.toString(),
          splits: extraResult.splits,
          sessionKey: sessionKeyAddress,
          signature: signatureBase64,
        };

        return { payload };
      };

      return { exec, requirements };
    });
  };
}
