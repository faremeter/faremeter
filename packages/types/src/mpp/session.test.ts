#!/usr/bin/env pnpm tsx

import t from "tap";
import {
  SessionAction,
  sessionOpenBase,
  sessionTopUpBase,
  sessionVoucherBase,
  sessionCloseBase,
  sessionRequestBase,
  invalidChallengeProblem,
  malformedCredentialProblem,
  verificationFailedProblem,
  buildInvalidChallengeProblem,
  buildMalformedCredentialProblem,
  buildVerificationFailedProblem,
  PROBLEM_INVALID_CHALLENGE,
  PROBLEM_MALFORMED_CREDENTIAL,
  PROBLEM_VERIFICATION_FAILED,
} from "./session";
import { isValidationError } from "../validation";

await t.test("SessionAction enumerates all actions", (t) => {
  for (const action of ["open", "topUp", "voucher", "close"]) {
    t.notOk(isValidationError(SessionAction(action)), action);
  }
  t.ok(isValidationError(SessionAction("refund")));
  t.end();
});

await t.test("per-action base validators", (t) => {
  t.notOk(
    isValidationError(
      sessionOpenBase({
        action: "open",
        channelId: "escrow",
        payer: "owner",
        depositAmount: "1000000",
      }),
    ),
  );
  t.notOk(
    isValidationError(
      sessionTopUpBase({
        action: "topUp",
        channelId: "escrow",
        additionalAmount: "1000",
      }),
    ),
  );
  t.notOk(
    isValidationError(
      sessionVoucherBase({
        action: "voucher",
        channelId: "escrow",
      }),
    ),
  );
  t.notOk(
    isValidationError(
      sessionCloseBase({
        action: "close",
        channelId: "escrow",
      }),
    ),
  );
  t.ok(
    isValidationError(
      sessionTopUpBase({
        action: "topUp",
        channelId: "escrow",
        additionalAmount: "not-numeric",
      }),
    ),
  );
  t.end();
});

await t.test(
  "sessionRequestBase requires amount, currency, and recipient",
  (t) => {
    // draft-solana-session-00 §"Request Schema / Shared Fields" makes
    // amount REQUIRED for the session intent ("Price per unit of
    // service in the token's smallest unit").
    t.notOk(
      isValidationError(
        sessionRequestBase({
          amount: "25",
          currency: "mint",
          recipient: "pubkey",
        }),
      ),
    );
    t.notOk(
      isValidationError(
        sessionRequestBase({
          amount: "25",
          unitType: "token",
          suggestedDeposit: "10000",
          currency: "mint",
          recipient: "pubkey",
        }),
      ),
    );
    t.ok(
      isValidationError(
        sessionRequestBase({
          currency: "mint",
          recipient: "pubkey",
        }),
      ),
      "sessionRequestBase must reject a request missing the spec-required amount",
    );
    t.ok(
      isValidationError(
        sessionRequestBase({ amount: "25", recipient: "pubkey" }),
      ),
      "sessionRequestBase must reject a request missing currency",
    );
    t.ok(
      isValidationError(sessionRequestBase({ amount: "25", currency: "mint" })),
      "sessionRequestBase must reject a request missing recipient",
    );
    t.end();
  },
);

await t.test("buildVerificationFailedProblem emits a valid problem", (t) => {
  const problem = buildVerificationFailedProblem({
    title: "Insufficient hold",
    detail: "Amount exceeds deposit",
  });
  t.equal(problem.type, PROBLEM_VERIFICATION_FAILED);
  t.equal(problem.status, 402);
  t.equal(problem.title, "Insufficient hold");
  t.equal(problem.detail, "Amount exceeds deposit");
  t.notOk(isValidationError(verificationFailedProblem(problem)));

  const bare = buildVerificationFailedProblem({});
  t.equal(bare.title, "Verification failed");
  t.equal(bare.detail, undefined);
  t.notOk(isValidationError(verificationFailedProblem(bare)));
  t.end();
});

await t.test("buildMalformedCredentialProblem emits a valid problem", (t) => {
  const problem = buildMalformedCredentialProblem({
    detail: "missing voucher.signature",
  });
  t.equal(problem.type, PROBLEM_MALFORMED_CREDENTIAL);
  t.notOk(isValidationError(malformedCredentialProblem(problem)));
  t.end();
});

await t.test("buildInvalidChallengeProblem emits a valid problem", (t) => {
  const problem = buildInvalidChallengeProblem({ detail: "challenge expired" });
  t.equal(problem.type, PROBLEM_INVALID_CHALLENGE);
  t.notOk(isValidationError(invalidChallengeProblem(problem)));
  t.end();
});
