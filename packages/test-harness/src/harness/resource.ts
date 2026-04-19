import type {
  x402PaymentRequirements as x402PaymentRequirementsV1,
  x402PaymentPayload as x402PaymentPayloadV1,
  x402SettleResponse as x402SettleResponseV1,
  x402VerifyResponse as x402VerifyResponseV1,
} from "@faremeter/types/x402";
import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402VerifyResponse,
} from "@faremeter/types/x402v2";
import type { mppCredential, mppReceipt } from "@faremeter/types/mpp";

/**
 * Common fields shared between v1 and v2 resource contexts.
 */
type ResourceContextBase = {
  resource: string;
  request: Request;
};

/**
 * Resource context for v1 protocol.
 */
export type ResourceContextV1 = ResourceContextBase & {
  protocolVersion: 1;
  paymentRequirements: x402PaymentRequirementsV1;
  paymentPayload: x402PaymentPayloadV1;
  settleResponse: x402SettleResponseV1;
  verifyResponse?: x402VerifyResponseV1 | undefined;
};

/**
 * Resource context for v2 protocol.
 */
export type ResourceContextV2 = ResourceContextBase & {
  protocolVersion: 2;
  paymentRequirements: x402PaymentRequirements;
  paymentPayload: x402PaymentPayload;
  settleResponse: x402SettleResponse;
  verifyResponse?: x402VerifyResponse | undefined;
};

/**
 * Resource context for MPP protocol.
 */
export type ResourceContextMPP = ResourceContextBase & {
  protocolVersion: "mpp";
  credential: mppCredential;
  receipt: mppReceipt;
  verifyReceipt?: mppReceipt | undefined;
};

/**
 * Resource context for x402 protocols (v1 or v2).
 * Use when the handler only needs to work with x402 payment fields.
 */
export type ResourceContextX402 = ResourceContextV1 | ResourceContextV2;

/**
 * Resource context passed to the resource handler after successful payment.
 * Discriminated union based on protocolVersion.
 */
export type ResourceContext = ResourceContextX402 | ResourceContextMPP;

export type ResourceResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type ResourceHandler = (
  ctx: ResourceContext,
) => ResourceResult | Promise<ResourceResult>;

/**
 * Type guard to check if context is v1.
 */
export function isResourceContextV1(
  ctx: ResourceContext,
): ctx is ResourceContextV1 {
  return ctx.protocolVersion === 1;
}

/**
 * Type guard to check if context is v2.
 */
export function isResourceContextV2(
  ctx: ResourceContext,
): ctx is ResourceContextV2 {
  return ctx.protocolVersion === 2;
}

export function isResourceContextMPP(
  ctx: ResourceContext,
): ctx is ResourceContextMPP {
  return ctx.protocolVersion === "mpp";
}

export const defaultResourceHandler: ResourceHandler = (ctx) => {
  if (isResourceContextMPP(ctx)) {
    return {
      status: 200,
      body: {
        success: true,
        resource: ctx.resource,
        reference: ctx.receipt.reference,
      },
    };
  }
  if (isResourceContextV1(ctx)) {
    return {
      status: 200,
      body: {
        success: true,
        resource: ctx.resource,
        transaction: ctx.settleResponse.transaction,
      },
    };
  }
  return {
    status: 200,
    body: {
      success: true,
      resource: ctx.resource,
      transaction: ctx.settleResponse.transaction,
    },
  };
};
