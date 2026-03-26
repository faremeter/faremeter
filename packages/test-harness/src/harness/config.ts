/* eslint-disable @typescript-eslint/no-deprecated -- v1 test harness uses v1 types */
import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { PaymentHandlerV1 } from "@faremeter/types/client";
import type { ResourcePricing } from "@faremeter/types/pricing";
import type { x402PaymentRequirements } from "@faremeter/types/x402";
import type { SupportedVersionsConfig } from "@faremeter/middleware/common";
import type { Interceptor, HandlerInterceptor } from "../interceptors/types";

/**
 * How the middleware handles payment verification and settlement.
 *
 * - `"settle-only"` - Skip verification, settle directly (faster tests).
 * - `"verify-then-settle"` - Verify payment before settling (more realistic).
 */
export type SettleMode = "settle-only" | "verify-then-settle";

/**
 * Fields shared by both configuration modes.
 */
type BaseConfig = {
  clientHandlers: PaymentHandlerV1[];
  settleMode?: SettleMode;
  supportedVersions?: SupportedVersionsConfig;
  clientInterceptors?: Interceptor[];
};

/**
 * Configuration for in-process handler testing. Handlers run directly
 * in the middleware with no facilitator HTTP service.
 */
export type InProcessConfig = BaseConfig & {
  x402Handlers: FacilitatorHandler[];
  pricing: ResourcePricing[];
  handlerInterceptors?: HandlerInterceptor[];
};

/**
 * Configuration for HTTP facilitator testing. The test harness mounts
 * facilitator routes and the middleware communicates via HTTP.
 */
export type HTTPConfig = BaseConfig & {
  accepts: Partial<x402PaymentRequirements>[];
  facilitatorHandlers: FacilitatorHandler[];
  middlewareInterceptors?: Interceptor[];
};

/**
 * Configuration for {@link TestHarness}.
 */
export type TestHarnessConfig = InProcessConfig | HTTPConfig;

/**
 * Type guard for in-process handler configuration.
 */
export function isInProcessConfig(
  config: TestHarnessConfig,
): config is InProcessConfig {
  return "x402Handlers" in config;
}
