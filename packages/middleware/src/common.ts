import { isValidationError } from "@faremeter/types";
import {
  type x402PaymentRequirements as x402PaymentRequirementsV1,
  type x402PaymentPayload as x402PaymentPayloadV1,
  type x402VerifyResponse as x402VerifyResponseV1,
  type x402PaymentRequiredResponse as x402PaymentRequiredResponseV1,
  x402PaymentHeaderToPayload as x402PaymentHeaderToPayloadV1,
  x402SettleResponse as x402SettleResponseV1,
  X_PAYMENT_HEADER,
  X_PAYMENT_RESPONSE_HEADER,
} from "@faremeter/types/x402";
import {
  type x402PaymentRequirements,
  type x402PaymentPayload,
  type x402PaymentRequiredResponse,
  type x402ResourceInfo,
  x402PaymentHeaderToPayload,
  x402SettleResponse,
  x402VerifyResponse,
  V2_PAYMENT_HEADER,
  V2_PAYMENT_REQUIRED_HEADER,
  V2_PAYMENT_RESPONSE_HEADER,
} from "@faremeter/types/x402v2";
import {
  adaptPaymentRequiredResponseV2ToV1,
  adaptSettleResponseV2ToV1,
  adaptVerifyResponseV2ToV1,
} from "@faremeter/types/x402-adapters";
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type {
  ResourcePricing,
  HandlerCapabilities,
} from "@faremeter/types/pricing";
import {
  resolveX402Requirements,
  settleX402Payment,
  verifyX402Payment,
} from "@faremeter/types/x402-handlers";
import type {
  MPPMethodHandler,
  mppChallengeParams,
  mppCredential,
  mppReceipt,
} from "@faremeter/types/mpp";
import {
  parseAuthorizationPayment,
  formatWWWAuthenticate,
  serializeReceipt,
  PAYMENT_RECEIPT_HEADER,
  resolveMPPChallenges,
  settleMPPPayment,
} from "@faremeter/types/mpp";
import { normalizeNetworkId } from "@faremeter/info";
import type { AgedLRUCacheOpts } from "./cache";
import { createHTTPFacilitatorHandler } from "./http-handler";

import { logger } from "./logger";

function buildMPPChallengeHeaders(
  challenges: mppChallengeParams[],
): Record<string, string> {
  if (challenges.length === 0) return {};
  return { "WWW-Authenticate": formatWWWAuthenticate(challenges) };
}

/**
 * Build the X-PAYMENT-RESPONSE header value from a settle response.
 *
 * The header uses spec-compliant field names: `transaction`, `network`,
 * and `errorReason`.
 */
function buildPaymentResponseHeader(
  settlementResponse: x402SettleResponse,
): string {
  const headerPayload: {
    success: boolean;
    transaction: string;
    network: string;
    payer?: string;
    errorReason?: string | null;
  } = {
    success: settlementResponse.success,
    transaction: settlementResponse.transaction ?? "",
    network: settlementResponse.network ?? "",
  };

  if (settlementResponse.payer !== undefined) {
    headerPayload.payer = settlementResponse.payer;
  }

  if (
    !settlementResponse.success &&
    settlementResponse.errorReason !== undefined
  ) {
    headerPayload.errorReason = settlementResponse.errorReason;
  }

  return btoa(JSON.stringify(headerPayload));
}

type MatchCriteria = {
  scheme: string;
  network: string;
  asset?: string;
};

function findMatching<R extends MatchCriteria>(
  accepts: R[],
  criteria: MatchCriteria,
  label: string,
  payload: Record<string, unknown>,
): R | undefined {
  const normalizedNetwork = normalizeNetworkId(criteria.network);
  const possible =
    criteria.asset !== undefined
      ? accepts.filter(
          (x) =>
            normalizeNetworkId(x.network) === normalizedNetwork &&
            x.scheme === criteria.scheme &&
            x.asset === criteria.asset,
        )
      : accepts.filter(
          (x) =>
            normalizeNetworkId(x.network) === normalizedNetwork &&
            x.scheme === criteria.scheme,
        );

  if (possible.length > 1) {
    logger.warning(
      `found ${possible.length} ambiguous matching requirements for ${label} client payment`,
      payload,
    );
  }

  // XXX - If there are more than one, this really should be an error.
  // For now, err on the side of potential compatibility.
  return possible[0];
}

/**
 * Finds the payment requirement that matches the client's v1 payment payload.
 *
 * @param accepts - Array of accepted payment requirements from the facilitator
 * @param payload - The client's payment payload
 * @returns The matching requirement, or undefined if no match found
 */
export function findMatchingPaymentRequirements(
  accepts: x402PaymentRequirementsV1[],
  payload: x402PaymentPayloadV1,
) {
  return findMatching(accepts, payload, "v1", payload);
}

/**
 * Finds the payment requirement that matches the client's v2 payment payload.
 *
 * @param accepts - Array of accepted payment requirements from the facilitator
 * @param payload - The client's v2 payment payload
 * @returns The matching requirement, or undefined if no match found
 */
export function findMatchingPaymentRequirementsV2(
  accepts: x402PaymentRequirements[],
  payload: x402PaymentPayload,
): x402PaymentRequirements | undefined {
  return findMatching(accepts, payload.accepted, "v2", payload);
}

export type RelaxedRequirements = Partial<x402PaymentRequirementsV1>;
export type RelaxedRequirementsV2 = Partial<x402PaymentRequirements>;

/**
 * Converts v1 relaxed requirements to v2 format, preserving all fields
 * including `extra`.
 */
export function relaxedRequirementsToV2(
  req: RelaxedRequirements,
): RelaxedRequirementsV2 {
  const result: RelaxedRequirementsV2 = {};
  if (req.scheme !== undefined) result.scheme = req.scheme;
  if (req.network !== undefined)
    result.network = normalizeNetworkId(req.network);
  if (req.maxAmountRequired !== undefined)
    result.amount = req.maxAmountRequired;
  if (req.asset !== undefined) result.asset = req.asset;
  if (req.payTo !== undefined) result.payTo = req.payTo;
  if (req.maxTimeoutSeconds !== undefined)
    result.maxTimeoutSeconds = req.maxTimeoutSeconds;
  if (req.extra !== undefined) result.extra = req.extra;
  return result;
}

/**
 * Parsed payment header result, discriminated by version.
 */
type ParsedPaymentHeader =
  | { version: 1; payload: x402PaymentPayloadV1; rawHeader: string }
  | { version: 2; payload: x402PaymentPayload; rawHeader: string };

/**
 * Parse a payment header from either v1 (X-PAYMENT) or v2 (PAYMENT-SIGNATURE).
 * Returns the parsed payload with version discriminant, or undefined if no valid header found.
 */
function parsePaymentHeader(
  getHeader: (key: string) => string | undefined,
): ParsedPaymentHeader | undefined {
  // Try v2 header first
  const v2Header = getHeader(V2_PAYMENT_HEADER);
  if (v2Header) {
    const v2Payload = x402PaymentHeaderToPayload(v2Header);
    if (!isValidationError(v2Payload)) {
      return { version: 2, payload: v2Payload, rawHeader: v2Header };
    }
    logger.debug(`couldn't validate v2 client payload: ${v2Payload.summary}`);
  }

  const v1Header = getHeader(X_PAYMENT_HEADER);
  if (v1Header) {
    const v1Payload = x402PaymentHeaderToPayloadV1(v1Header);
    if (!isValidationError(v1Payload)) {
      return { version: 1, payload: v1Payload, rawHeader: v1Header };
    }
    logger.debug(`couldn't validate v1 client payload: ${v1Payload.summary}`);
  }

  return undefined;
}

type PossibleStatusCodes = 400 | 402;
type PossibleJSONResponse = object;

/**
 * Configuration for which x402 protocol versions the middleware supports.
 * At least one version must be enabled.
 */
export type SupportedVersionsConfig = {
  /** Support x402 v1 protocol (JSON body responses, X-PAYMENT header). Default: true */
  x402v1?: boolean;
  /** Support x402 v2 protocol (PAYMENT-REQUIRED header, PAYMENT-SIGNATURE header). Default: false */
  x402v2?: boolean;
};

/**
 * Resolve and validate supported versions config.
 * Returns resolved config with defaults applied.
 * Throws if configuration is invalid.
 */
export function resolveSupportedVersions(
  config?: SupportedVersionsConfig,
): Required<SupportedVersionsConfig> {
  const resolved = {
    x402v1: config?.x402v1 ?? true,
    x402v2: config?.x402v2 ?? false,
  };

  if (!resolved.x402v1 && !resolved.x402v2) {
    throw new Error(
      "Invalid supportedVersions configuration: at least one protocol version must be enabled",
    );
  }

  return resolved;
}

/**
 * Common configuration arguments shared by all middleware implementations.
 * Supports two mutually exclusive modes: in-process handlers or remote facilitator.
 */
export type CommonMiddlewareArgs = {
  /** x402 handlers for in-process settlement. */
  x402Handlers?: FacilitatorHandler[];
  /** MPP method handlers for in-process settlement. */
  mppMethodHandlers?: MPPMethodHandler[];
  /** Protocol-agnostic pricing for in-process handlers. */
  pricing?: ResourcePricing[];

  /** URL of a remote facilitator service (backward compat). */
  facilitatorURL?: string;
  /** Payment requirements for the remote facilitator path. */
  accepts?: (RelaxedRequirements | RelaxedRequirements[])[];
  /** Cache configuration for remote facilitator responses. */
  cacheConfig?: AgedLRUCacheOpts & { disable?: boolean };

  /** Which x402 protocol versions to support. */
  supportedVersions?: SupportedVersionsConfig;
};

/**
 * Validates that CommonMiddlewareArgs has exactly one configuration mode.
 */
export function validateMiddlewareArgs(args: CommonMiddlewareArgs): void {
  const hasX402 = args.x402Handlers !== undefined;
  const hasMPP = args.mppMethodHandlers !== undefined;
  const hasFacilitator = args.facilitatorURL !== undefined;
  const hasInProcess = hasX402 || hasMPP;

  if (!hasInProcess && !hasFacilitator) {
    throw new Error(
      "At least one of x402Handlers, mppMethodHandlers, or facilitatorURL must be provided",
    );
  }
  if (hasFacilitator && hasInProcess) {
    throw new Error(
      "facilitatorURL is mutually exclusive with x402Handlers and mppMethodHandlers",
    );
  }
  if (hasInProcess && (!args.pricing || args.pricing.length === 0)) {
    throw new Error("pricing is required when using in-process handlers");
  }
  if (hasX402 && args.x402Handlers && args.x402Handlers.length === 0) {
    throw new Error("x402Handlers must not be empty");
  }
  if (hasMPP && args.mppMethodHandlers && args.mppMethodHandlers.length === 0) {
    throw new Error("mppMethodHandlers must not be empty");
  }
  if (hasFacilitator && !args.accepts) {
    throw new Error("accepts is required when using facilitatorURL");
  }
}

/**
 * Derives `HandlerCapabilities` from relaxed v1 requirements.
 * Used by framework adapters to construct capabilities for the HTTP wrapper
 * from the legacy `accepts` configuration.
 */
export function deriveCapabilities(
  accepts: RelaxedRequirements[],
): HandlerCapabilities {
  const schemes = new Set<string>();
  const networks = new Set<string>();
  const assets = new Set<string>();

  for (const a of accepts) {
    if (a.scheme !== undefined && a.scheme !== "") schemes.add(a.scheme);
    if (a.network !== undefined && a.network !== "")
      networks.add(normalizeNetworkId(a.network));
    if (a.asset !== undefined && a.asset !== "") assets.add(a.asset);
  }

  return {
    schemes: [...schemes],
    networks: [...networks],
    assets: [...assets],
  };
}

/**
 * Extracts resource info from v1 accepts entries.
 * Used by framework adapters to build the resource info for the 402 response.
 */
export function deriveResourceInfo(
  accepts: RelaxedRequirements[],
  resourceURL: string,
): x402ResourceInfo {
  const firstAccept = accepts.find((a) => a.resource !== undefined);
  const info: x402ResourceInfo = {
    url: firstAccept?.resource ?? resourceURL,
  };
  if (firstAccept?.description) info.description = firstAccept.description;
  if (firstAccept?.mimeType) info.mimeType = firstAccept.mimeType;
  return info;
}

export function acceptsToPricing(
  accepts: RelaxedRequirements[],
): ResourcePricing[] {
  return accepts.map((a) => {
    const p: ResourcePricing = {
      amount: a.maxAmountRequired ?? "0",
      asset: a.asset ?? "",
      recipient: a.payTo ?? "",
      network: a.network ?? "",
    };
    if (a.description) p.description = a.description;
    return p;
  });
}

export type ResolvedConfig = {
  handlers: FacilitatorHandler[];
  pricing: ResourcePricing[];
  mppHandlers: MPPMethodHandler[];
  resourceInfo?: x402ResourceInfo;
};

/**
 * Resolves {@link CommonMiddlewareArgs} into the handlers + pricing tuple
 * that {@link handleMiddlewareRequest} needs. For the `facilitatorURL` path,
 * creates an HTTP handler wrapper and converts accepts to pricing.
 */
export function resolveConfig(args: CommonMiddlewareArgs): ResolvedConfig {
  if (args.x402Handlers || args.mppMethodHandlers) {
    const pricing = args.pricing ?? [];
    return {
      handlers: args.x402Handlers ?? [],
      pricing,
      mppHandlers: args.mppMethodHandlers ?? [],
    };
  }

  if (args.facilitatorURL && args.accepts) {
    const flatAccepts = args.accepts.flat();
    const capabilities = deriveCapabilities(flatAccepts);
    const httpOpts: Parameters<typeof createHTTPFacilitatorHandler>[1] = {
      capabilities,
      acceptsOverride: flatAccepts.map(relaxedRequirementsToV2),
      cacheConfig: args.cacheConfig ?? {},
    };
    return {
      handlers: [createHTTPFacilitatorHandler(args.facilitatorURL, httpOpts)],
      pricing: acceptsToPricing(flatAccepts),
      mppHandlers: [],
      resourceInfo: deriveResourceInfo(flatAccepts, ""),
    };
  }

  throw new Error("failed to resolve middleware configuration");
}

export type SettleResultV1<MiddlewareResponse> =
  | { success: true; facilitatorResponse: x402SettleResponseV1 }
  | { success: false; errorResponse: MiddlewareResponse };

export type SettleResultV2<MiddlewareResponse> =
  | { success: true; facilitatorResponse: x402SettleResponse }
  | { success: false; errorResponse: MiddlewareResponse };

export type SettleResult<MiddlewareResponse> =
  | SettleResultV1<MiddlewareResponse>
  | SettleResultV2<MiddlewareResponse>;

export type VerifyResultV1<MiddlewareResponse> =
  | { success: true; facilitatorResponse: x402VerifyResponseV1 }
  | { success: false; errorResponse: MiddlewareResponse };

export type VerifyResultV2<MiddlewareResponse> =
  | { success: true; facilitatorResponse: x402VerifyResponse }
  | { success: false; errorResponse: MiddlewareResponse };

export type VerifyResult<MiddlewareResponse> =
  | VerifyResultV1<MiddlewareResponse>
  | VerifyResultV2<MiddlewareResponse>;

/**
 * Context provided to the middleware body handler for v1 protocol requests.
 * Contains payment information and functions to verify or settle the payment.
 */
export type MiddlewareBodyContextV1<MiddlewareResponse> = {
  protocolVersion: 1;
  paymentRequirements: x402PaymentRequirementsV1;
  paymentPayload: x402PaymentPayloadV1;
  settle: () => Promise<SettleResultV1<MiddlewareResponse>>;
  verify: () => Promise<VerifyResultV1<MiddlewareResponse>>;
};

/**
 * Context provided to the middleware body handler for v2 protocol requests.
 * Contains payment information and functions to verify or settle the payment.
 */
export type MiddlewareBodyContextV2<MiddlewareResponse> = {
  protocolVersion: 2;
  paymentRequirements: x402PaymentRequirements;
  paymentPayload: x402PaymentPayload;
  settle: () => Promise<SettleResultV2<MiddlewareResponse>>;
  verify: () => Promise<VerifyResultV2<MiddlewareResponse>>;
};

export type SettleResultMPP<MiddlewareResponse> =
  | { success: true; receipt: mppReceipt }
  | { success: false; errorResponse: MiddlewareResponse };

/**
 * Context provided to the middleware body handler for MPP protocol requests.
 */
export type MiddlewareBodyContextMPP<MiddlewareResponse> = {
  protocolVersion: "mpp";
  credential: mppCredential;
  settle: () => Promise<SettleResultMPP<MiddlewareResponse>>;
};

/**
 * Context provided to the middleware body handler.
 * Use protocolVersion to discriminate between v1, v2, and mpp request types.
 */
export type MiddlewareBodyContext<MiddlewareResponse> =
  | MiddlewareBodyContextV1<MiddlewareResponse>
  | MiddlewareBodyContextV2<MiddlewareResponse>
  | MiddlewareBodyContextMPP<MiddlewareResponse>;

/**
 * Arguments for the core middleware request handler.
 * Framework-specific middleware implementations adapt their request/response
 * objects to this interface.
 */
export type HandleMiddlewareRequestArgs<MiddlewareResponse = unknown> = {
  /** x402 handlers for in-process settlement. */
  x402Handlers?: FacilitatorHandler[];
  /** MPP method handlers for in-process settlement. */
  mppMethodHandlers?: MPPMethodHandler[];
  /** Protocol-agnostic pricing entries for the current request. */
  pricing: ResourcePricing[];
  /** The resource URL being accessed. */
  resource: string;
  /** Resolved supported versions configuration. */
  supportedVersions: Required<SupportedVersionsConfig>;
  /** Function to retrieve a request header value. */
  getHeader: (key: string) => string | undefined;
  /** Function to send a JSON response with optional headers. */
  sendJSONResponse: (
    status: PossibleStatusCodes,
    body?: PossibleJSONResponse,
    headers?: Record<string, string>,
  ) => MiddlewareResponse;
  /** Handler function called when a valid payment is received. */
  body: (
    context: MiddlewareBodyContext<MiddlewareResponse>,
  ) => Promise<MiddlewareResponse | undefined>;
  /** Optional function to set a response header. */
  setResponseHeader?: (key: string, value: string) => void;
  /** Optional pre-built resource info for the 402 response. */
  resourceInfo?: x402ResourceInfo;
};

/**
 * Core middleware request handler that processes x402 and MPP payment flows.
 *
 * Delegates to protocol-specific glue layers for challenge generation,
 * settlement, and verification. The middleware formats HTTP responses
 * but never constructs protocol types directly.
 */
export async function handleMiddlewareRequest<MiddlewareResponse>(
  args: HandleMiddlewareRequestArgs<MiddlewareResponse>,
) {
  const {
    supportedVersions,
    x402Handlers = [],
    mppMethodHandlers = [],
    pricing,
    resource,
  } = args;

  const hasX402 = x402Handlers.length > 0;
  const hasMPP = mppMethodHandlers.length > 0;

  // x402: resolve requirements eagerly (needed for matching and 402 response)
  let enrichedRequirements: x402PaymentRequirements[] = [];
  if (hasX402) {
    enrichedRequirements = await resolveX402Requirements(
      x402Handlers,
      pricing,
      resource,
      { logger },
    );
  }

  const resourceInfo: x402ResourceInfo = args.resourceInfo ?? { url: resource };
  if (!args.resourceInfo) {
    const firstDescription = pricing.find((p) => p.description);
    if (firstDescription?.description) {
      resourceInfo.description = firstDescription.description;
    }
  }

  let v2Response: x402PaymentRequiredResponse | undefined;
  let v1Response: x402PaymentRequiredResponseV1 | undefined;

  if (hasX402) {
    v2Response = {
      x402Version: 2,
      resource: resourceInfo,
      accepts: enrichedRequirements,
    };
    v1Response = supportedVersions.x402v1
      ? adaptPaymentRequiredResponseV2ToV1(v2Response)
      : undefined;
  }

  // MPP: check for Authorization: Payment header before x402 headers.
  // Only intercept when MPP handlers are configured.
  if (hasMPP) {
    const authHeader = args.getHeader("Authorization");
    if (authHeader) {
      const credential = parseAuthorizationPayment(authHeader);
      if (credential) {
        return handleMPPRequest(
          args,
          credential,
          mppMethodHandlers,
          pricing,
          resource,
        );
      }
    }
  }

  const parsedHeader = parsePaymentHeader(args.getHeader);

  // Build the 402 challenge response (lazy for MPP, pre-built for x402)
  const sendPaymentRequired = async (): Promise<MiddlewareResponse> => {
    const headers: Record<string, string> = {};
    let body: PossibleJSONResponse | undefined;

    // x402 challenges
    if (hasX402 && v2Response) {
      if (supportedVersions.x402v2) {
        headers[V2_PAYMENT_REQUIRED_HEADER] = btoa(JSON.stringify(v2Response));
      }
      if (supportedVersions.x402v1 && v1Response) {
        body = v1Response;
      }
    }

    // MPP challenges (resolved lazily)
    if (hasMPP) {
      const mppChallenges = await resolveMPPChallenges(
        mppMethodHandlers,
        pricing,
        resource,
        { logger },
      );
      Object.assign(headers, buildMPPChallengeHeaders(mppChallenges));
    }

    const hasHeaders = Object.keys(headers).length > 0;
    if (body) {
      return args.sendJSONResponse(402, body, hasHeaders ? headers : undefined);
    }
    if (!hasHeaders) {
      logger.warning(
        "returning bare 402: no x402 requirements and no MPP challenges available",
      );
    }
    return args.sendJSONResponse(
      402,
      undefined,
      hasHeaders ? headers : undefined,
    );
  };

  if (!parsedHeader) {
    return sendPaymentRequired();
  }

  if (parsedHeader.version === 2 && !supportedVersions.x402v2) {
    return args.sendJSONResponse(400, {
      error: "This server does not support x402 protocol version 2",
    });
  }

  if (parsedHeader.version === 1 && !supportedVersions.x402v1) {
    return args.sendJSONResponse(400, {
      error: "This server does not support x402 protocol version 1",
    });
  }

  if (parsedHeader.version === 2) {
    if (!v2Response) {
      return args.sendJSONResponse(400, {
        error: "This server does not support x402 protocol",
      });
    }
    return handleV2Request(
      args,
      x402Handlers,
      parsedHeader.payload,
      v2Response,
      sendPaymentRequired,
    );
  }

  if (!v1Response || !v2Response) {
    return args.sendJSONResponse(400, {
      error: "This server does not support x402 protocol",
    });
  }
  return handleV1Request(
    args,
    x402Handlers,
    parsedHeader.payload,
    v1Response,
    v2Response,
    sendPaymentRequired,
  );
}

/**
 * Handle v1 protocol request.
 *
 * Matches v1 payload against v1 accepts, then uses the corresponding v2
 * requirement for settlement via the glue layer. Adapts v2 responses
 * back to v1 for the caller.
 */
async function handleV1Request<MiddlewareResponse>(
  args: HandleMiddlewareRequestArgs<MiddlewareResponse>,
  x402Handlers: FacilitatorHandler[],
  paymentPayload: x402PaymentPayloadV1,
  v1Response: x402PaymentRequiredResponseV1,
  v2Response: x402PaymentRequiredResponse,
  sendPaymentRequired: () => Promise<MiddlewareResponse>,
): Promise<MiddlewareResponse | undefined> {
  const v1Requirements = findMatchingPaymentRequirements(
    v1Response.accepts,
    paymentPayload,
  );

  if (!v1Requirements) {
    logger.warning(
      "couldn't find matching payment requirements for v1 payload",
      paymentPayload,
    );
    return await sendPaymentRequired();
  }

  // Find the corresponding v2 requirement for the glue layer.
  // Match by scheme/network/asset since the v1 and v2 accepts are parallel.
  const v2Requirements = findMatching(
    v2Response.accepts,
    {
      scheme: v1Requirements.scheme,
      network: v1Requirements.network,
      asset: v1Requirements.asset,
    },
    "v1-to-v2-lookup",
    paymentPayload,
  );

  if (!v2Requirements) {
    logger.error("matched v1 requirement has no corresponding v2 requirement");
    return await sendPaymentRequired();
  }

  // Build v2 payment payload from v1 for the glue layer
  const v2PaymentPayload: x402PaymentPayload = {
    x402Version: 2,
    accepted: v2Requirements,
    payload: paymentPayload.payload,
    resource: v2Response.resource,
  };

  const settle = async (): Promise<SettleResultV1<MiddlewareResponse>> => {
    const v2Result = await settleX402Payment(
      x402Handlers,
      v2Requirements,
      v2PaymentPayload,
    );

    const settlementResponse = adaptSettleResponseV2ToV1(v2Result);

    if (args.setResponseHeader) {
      args.setResponseHeader(
        X_PAYMENT_RESPONSE_HEADER,
        buildPaymentResponseHeader(v2Result),
      );
    }

    if (!settlementResponse.success) {
      logger.warning(
        "failed to settle payment: {errorReason}",
        settlementResponse,
      );
      return { success: false, errorResponse: await sendPaymentRequired() };
    }

    return { success: true, facilitatorResponse: settlementResponse };
  };

  const verify = async (): Promise<VerifyResultV1<MiddlewareResponse>> => {
    const v2Result = await verifyX402Payment(
      x402Handlers,
      v2Requirements,
      v2PaymentPayload,
    );

    const verifyResponse = adaptVerifyResponseV2ToV1(v2Result);

    if (!verifyResponse.isValid) {
      logger.warning(
        "failed to verify payment: {invalidReason}",
        verifyResponse,
      );
      return { success: false, errorResponse: await sendPaymentRequired() };
    }

    return { success: true, facilitatorResponse: verifyResponse };
  };

  return await args.body({
    protocolVersion: 1,
    paymentRequirements: v1Requirements,
    paymentPayload,
    settle,
    verify,
  });
}

/**
 * Handle v2 protocol request.
 */
async function handleV2Request<MiddlewareResponse>(
  args: HandleMiddlewareRequestArgs<MiddlewareResponse>,
  x402Handlers: FacilitatorHandler[],
  paymentPayload: x402PaymentPayload,
  paymentRequiredResponse: x402PaymentRequiredResponse,
  sendPaymentRequired: () => Promise<MiddlewareResponse>,
): Promise<MiddlewareResponse | undefined> {
  const paymentRequirements = findMatchingPaymentRequirementsV2(
    paymentRequiredResponse.accepts,
    paymentPayload,
  );

  if (!paymentRequirements) {
    logger.warning(
      "couldn't find matching payment requirements for v2 payload",
      paymentPayload,
    );
    return await sendPaymentRequired();
  }

  const settle = async (): Promise<SettleResultV2<MiddlewareResponse>> => {
    const settlementResponse = await settleX402Payment(
      x402Handlers,
      paymentRequirements,
      paymentPayload,
    );

    if (args.setResponseHeader) {
      args.setResponseHeader(
        V2_PAYMENT_RESPONSE_HEADER,
        btoa(JSON.stringify(settlementResponse)),
      );
    }

    if (!settlementResponse.success) {
      logger.warning(
        "failed to settle v2 payment: {errorReason}",
        settlementResponse,
      );
      return { success: false, errorResponse: await sendPaymentRequired() };
    }

    return { success: true, facilitatorResponse: settlementResponse };
  };

  const verify = async (): Promise<VerifyResultV2<MiddlewareResponse>> => {
    const verifyResponse = await verifyX402Payment(
      x402Handlers,
      paymentRequirements,
      paymentPayload,
    );

    if (!verifyResponse.isValid) {
      logger.warning(
        "failed to verify v2 payment: {invalidReason}",
        verifyResponse,
      );
      return { success: false, errorResponse: await sendPaymentRequired() };
    }

    return { success: true, facilitatorResponse: verifyResponse };
  };

  return await args.body({
    protocolVersion: 2,
    paymentRequirements,
    paymentPayload,
    settle,
    verify,
  });
}

/**
 * Handle an MPP protocol request.
 *
 * The credential carries its challenge, so there is no matching step.
 * Settlement routes by method through the MPP glue layer.
 */
async function handleMPPRequest<MiddlewareResponse>(
  args: HandleMiddlewareRequestArgs<MiddlewareResponse>,
  credential: mppCredential,
  mppHandlers: MPPMethodHandler[],
  pricing: ResourcePricing[],
  resource: string,
): Promise<MiddlewareResponse | undefined> {
  const sendPaymentRequired = async (): Promise<MiddlewareResponse> => {
    const mppChallenges = await resolveMPPChallenges(
      mppHandlers,
      pricing,
      resource,
      { logger },
    );
    const headers = buildMPPChallengeHeaders(mppChallenges);
    if (Object.keys(headers).length === 0) {
      logger.warning(
        "returning bare 402: no MPP challenges available for re-challenge",
      );
    }
    return args.sendJSONResponse(402, undefined, headers);
  };

  const settle = async (): Promise<SettleResultMPP<MiddlewareResponse>> => {
    try {
      const receipt = await settleMPPPayment(mppHandlers, credential);

      if (args.setResponseHeader) {
        args.setResponseHeader(
          PAYMENT_RECEIPT_HEADER,
          serializeReceipt(receipt),
        );
      }

      return { success: true, receipt };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warning("failed to settle MPP payment", { error: msg });
      return { success: false, errorResponse: await sendPaymentRequired() };
    }
  };

  return await args.body({
    protocolVersion: "mpp",
    credential,
    settle,
  });
}
