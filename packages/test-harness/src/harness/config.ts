import type { FacilitatorHandler } from "@faremeter/types/facilitator";
import type { PaymentHandler } from "@faremeter/types/client";
import type { x402PaymentRequirements } from "@faremeter/types/x402";
import type { Interceptor } from "../interceptors/types";

export type SettleMode = "settle-only" | "verify-then-settle";

export type TestHarnessConfig = {
  /**
   * Payment requirements the middleware accepts.
   * Uses Partial because the facilitator will fill in missing fields.
   */
  accepts: Partial<x402PaymentRequirements>[];

  /**
   * Facilitator handlers to register.
   * Multiple handlers can be provided for different schemes.
   */
  facilitatorHandlers: FacilitatorHandler[];

  /**
   * Client payment handlers.
   * Multiple handlers can be provided for different schemes.
   */
  clientHandlers: PaymentHandler[];

  /**
   * Settlement mode for the middleware.
   * @default "settle-only"
   */
  settleMode?: SettleMode;

  /**
   * Interceptors between test code and middleware.
   * These see all requests from the wrapped fetch to the Hono app.
   */
  clientInterceptors?: Interceptor[];

  /**
   * Interceptors between middleware and facilitator.
   * These see requests from middleware to facilitator endpoints.
   */
  middlewareInterceptors?: Interceptor[];
};
