/**
 * @title Test Harness Package
 * @sidebarTitle Test Harness
 * @description In-process test environment for x402 protocol testing
 * @packageDocumentation
 */
export { TestHarness } from "./harness/harness";
export type {
  TestHarnessConfig,
  InProcessConfig,
  HTTPConfig,
  SettleMode,
} from "./harness/config";
export { isInProcessConfig } from "./harness/config";
export type {
  ResourceHandler,
  ResourceContext,
  ResourceContextX402,
  ResourceContextV1,
  ResourceContextV2,
  ResourceContextMPP,
  ResourceResult,
} from "./harness/resource";
export {
  defaultResourceHandler,
  isResourceContextV1,
  isResourceContextV2,
  isResourceContextMPP,
} from "./harness/resource";
export { accepts, acceptsV2 } from "./harness/defaults";

export { TEST_SCHEME, TEST_NETWORK, TEST_ASSET } from "./scheme/constants";
export type { TestPaymentPayload } from "./scheme/types";
export { generateTestId } from "./scheme/types";
export {
  createTestFacilitatorHandler,
  type CreateTestFacilitatorHandlerOpts,
  type AmountPolicy,
} from "./scheme/facilitator";
export {
  createTestPaymentHandler,
  type CreateTestPaymentHandlerOpts,
} from "./scheme/client";
export {
  createTestMPPHandler,
  createTestMPPPaymentHandler,
  TEST_MPP_METHOD,
  TEST_MPP_INTENT,
  TEST_MPP_REALM,
  type CreateTestMPPHandlerOpts,
  type CreateTestMPPPaymentHandlerOpts,
} from "./scheme/mpp";

export type {
  Interceptor,
  RequestMatcher,
  HandlerInterceptor,
} from "./interceptors/types";
export { composeHandlerInterceptors } from "./interceptors/types";
export { composeInterceptors } from "./interceptors/types";

export { getURLFromRequestInfo } from "./interceptors/utils";

export {
  matchFacilitatorAccepts,
  matchFacilitatorVerify,
  matchFacilitatorSettle,
  matchFacilitatorSupported,
  matchFacilitator,
  matchResource,
  and,
  or,
  not,
  matchURL,
  matchMethod,
  matchAll,
  matchNone,
} from "./interceptors/matchers";

export {
  jsonResponse,
  verifyFailedResponse,
  verifySuccessResponse,
  settleFailedResponse,
  settleFailedResponseV2,
  settleSuccessResponse,
  settleSuccessResponseV2,
  paymentRequiredResponse,
  networkError,
  timeoutError,
  httpError,
} from "./interceptors/responses";

export {
  createFailureInterceptor,
  failOnce,
  failNTimes,
  failUntilCleared,
  failWhen,
} from "./interceptors/failures";

export {
  createDelayInterceptor,
  createResponseDelayInterceptor,
  createVariableDelayInterceptor,
} from "./interceptors/delay";

export { createV2ResponseInterceptor } from "./interceptors/v2";

export {
  createRequestHook,
  createResponseHook,
  createHook,
  createCaptureInterceptor,
} from "./interceptors/hooks";

export type { LogEvent } from "./interceptors/logging";
export {
  createLoggingInterceptor,
  createConsoleLoggingInterceptor,
  createEventCollector,
} from "./interceptors/logging";

export {
  chooseFirst,
  chooseCheapest,
  chooseMostExpensive,
  chooseByAsset,
  chooseByNetwork,
  chooseByScheme,
  chooseByIndex,
  chooseNone,
  chooseWithInspection,
  chooseWithFilter,
} from "./choosers";

export { suppressConsoleErrors } from "./testing/console";

export {
  isMatchingRequirement,
  createNonMatchingHandler,
  createThrowingHandler,
  createThrowingExecHandler,
  createNullPayloadHandler,
  createEmptyPayloadHandler,
  createWorkingHandler,
  createInvalidPayloadHandler,
  createSimpleFacilitatorHandler,
  type CreateSimpleFacilitatorHandlerOpts,
} from "./test-handlers";
