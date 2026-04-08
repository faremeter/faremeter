// MPP `solana` / `session` intent handler, settled against the
// Faremeter Flex escrow program.
//
// This is NOT a conforming implementation of draft-solana-session-00.
// Flex's on-chain shape is structurally different from a payment-channel
// program, and several spec MUSTs cannot be satisfied without changing
// the program. The wire format will be aligned with the spec where
// possible; the load-bearing divergences are documented in
// COMPATIBILITY.md at the repository root.

export {
  createMPPSolanaSessionHandler,
  VoucherRegistrationError,
  type CreateMPPSolanaSessionHandlerArgs,
  type FlexSessionHandler,
  type TryRegisterResult,
  type VoucherRegistration,
  type VoucherRegistrationReason,
} from "./server";

export {
  createMPPSolanaSessionClient,
  type CreateMPPSolanaSessionClientArgs,
  type MPPSolanaSessionClient,
  type SessionClientWallet,
  SessionExpiredError,
} from "./client";

export {
  createInMemorySessionStore,
  type SessionState,
  type SessionStatus,
  type SessionStore,
} from "./state";

export {
  solanaSessionPayload,
  solanaSessionRequest,
  solanaSessionOpenPayload,
  solanaSessionTopUpPayload,
  solanaSessionVoucherPayload,
  solanaSessionClosePayload,
  type solanaSessionMethodDetails,
} from "./common";

export {
  buildInsufficientHoldProblem,
  buildPendingLimitProblem,
  buildSessionNotFoundProblem,
  PENDING_LIMIT_MAX,
  FLEX_PROBLEM_PENDING_LIMIT,
  flexPendingLimitProblem,
} from "./problem";

export {
  serializeVoucherMessage,
  serializeSpecVoucherMessage,
  verifyVoucherSignature,
  type SerializeVoucherArgs,
  type VoucherSplit,
} from "./verify";

export { FLEX_PROGRAM_ADDRESS } from "@faremeter/flex-solana";

// Re-export the Faremeter session-open batch builder. This composes
// the three on-chain steps a session-open performs (create_escrow,
// deposit, register_session_key) — all from `@faremeter/flex-solana` —
// into a single instruction array suitable for assembly into a
// versioned transaction message.
export {
  buildSessionOpenInstructions,
  type BuildSessionOpenInstructionsArgs,
  type SessionOpenInstructions,
} from "./open";
