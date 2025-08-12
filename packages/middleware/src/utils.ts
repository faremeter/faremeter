import type {
  x402PaymentRequirements,
  x402PaymentPayload,
} from "@faremeter/types";

export function findMatchingPaymentRequirements(
  accepts: x402PaymentRequirements[],
  payload: x402PaymentPayload,
) {
  // XXX - This is naive, and doesn't consider `asset` because that information
  // isn't available here.
  return accepts.filter(
    (x) => x.network === payload.network && x.scheme === payload.scheme,
  )[0];
}
