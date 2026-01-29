import type {
  x402PaymentRequirements,
  x402PaymentPayload,
  x402SettleResponse,
  x402VerifyResponse,
} from "@faremeter/types/x402";

export type ResourceContext = {
  resource: string;
  request: Request;
  paymentRequirements: x402PaymentRequirements;
  paymentPayload: x402PaymentPayload;
  settleResponse: x402SettleResponse;
  verifyResponse?: x402VerifyResponse | undefined;
};

export type ResourceResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type ResourceHandler = (
  ctx: ResourceContext,
) => ResourceResult | Promise<ResourceResult>;

export const defaultResourceHandler: ResourceHandler = (ctx) => ({
  status: 200,
  body: {
    success: true,
    resource: ctx.resource,
    transaction: ctx.settleResponse.transaction,
  },
});
