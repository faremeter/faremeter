import { type } from "arktype";
import {
  buildVerificationFailedProblem as buildSpecVerificationFailedProblem,
  type verificationFailedProblem,
} from "@faremeter/types/mpp";
import type { SessionState } from "./state";

export const PENDING_LIMIT_MAX = 16;

/**
 * Faremeter-namespaced extension Problem Details type for the
 * Flex-imposed pending settlement back-pressure. The spec
 * (draft-solana-session-00) has no concept of pending settlements
 * because it assumes a cumulative single-watermark settlement model;
 * this URI marks the response as a Faremeter extension carrying
 * Flex-specific state. See COMPATIBILITY.md.
 */
export const FLEX_PROBLEM_PENDING_LIMIT =
  "https://faremeter.org/problems/flex-pending-limit";

export const flexPendingLimitProblem = type({
  type: `"${FLEX_PROBLEM_PENDING_LIMIT}"`,
  title: "string",
  status: "402",
  channelId: "string",
  pendingCount: "number",
  maxPending: "number",
  "detail?": "string",
});
export type flexPendingLimitProblem = typeof flexPendingLimitProblem.infer;

/**
 * Builds a spec `verification-failed` Problem Details for the
 * "voucher cumulative would exceed escrow deposit" case. Detail
 * carries the running channel state so clients can compute the top-up
 * amount they need.
 */
export function buildInsufficientHoldProblem(
  state: SessionState,
  requiredTopUp: bigint,
): verificationFailedProblem {
  return buildSpecVerificationFailedProblem({
    title: "Insufficient hold",
    detail:
      `channelId=${state.channelId.toString()} ` +
      `acceptedCumulative=${state.acceptedCumulative.toString()} ` +
      `spent=${state.spent.toString()} ` +
      `requiredTopUp=${requiredTopUp.toString()}`,
  });
}

/**
 * Builds a spec `verification-failed` Problem Details for the
 * "no live session for this (channelId, sessionKey)" case.
 */
export function buildSessionNotFoundProblem(
  channelId: string,
  detail?: string,
): verificationFailedProblem {
  return buildSpecVerificationFailedProblem({
    title: "Channel not found",
    detail:
      detail ??
      `channelId=${channelId} not present in session store; re-open required`,
  });
}

/**
 * Builds the Faremeter-extension `flex-pending-limit` Problem Details
 * for the back-pressure case. Not a spec problem type — see
 * COMPATIBILITY.md for why this lives outside the spec catalogue.
 */
export function buildPendingLimitProblem(
  state: SessionState,
): flexPendingLimitProblem {
  return {
    type: FLEX_PROBLEM_PENDING_LIMIT,
    title: "Pending settlement limit reached",
    status: 402,
    channelId: state.channelId.toString(),
    pendingCount: state.inFlightAuthorizationIds.length,
    maxPending: PENDING_LIMIT_MAX,
  };
}
