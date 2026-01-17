export { TestHarness } from "./harness/harness";
export type { TestHarnessConfig, SettleMode } from "./harness/config";
export type {
  ResourceHandler,
  ResourceContext,
  ResourceResult,
} from "./harness/resource";
export { defaultResourceHandler } from "./harness/resource";
export { accepts } from "./harness/defaults";

export { TEST_SCHEME, TEST_NETWORK, TEST_ASSET } from "./scheme/constants";
export type { TestPaymentPayload } from "./scheme/types";
export { generateTestId } from "./scheme/types";
export {
  createTestFacilitatorHandler,
  type CreateTestFacilitatorHandlerOpts,
} from "./scheme/facilitator";
export {
  createTestPaymentHandler,
  type CreateTestPaymentHandlerOpts,
} from "./scheme/client";

export type { Interceptor, RequestMatcher } from "./interceptors/types";
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
  settleSuccessResponse,
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
