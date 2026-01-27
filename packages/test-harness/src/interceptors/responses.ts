import type { x402PaymentRequirements } from "@faremeter/types/x402";

export function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function verifyFailedResponse(reason: string): Response {
  return jsonResponse(200, {
    isValid: false,
    invalidReason: reason,
    payer: "",
  });
}

export function verifySuccessResponse(): Response {
  return jsonResponse(200, {
    isValid: true,
    payer: "test-payer",
  });
}

export function settleFailedResponse(errorReason: string): Response {
  return jsonResponse(200, {
    success: false,
    errorReason,
    transaction: "",
    network: "",
    payer: "",
  });
}

export function settleFailedResponseV2(
  errorReason: string,
  network: string,
): Response {
  return jsonResponse(200, {
    success: false,
    errorReason,
    transaction: "",
    network,
  });
}

export function settleSuccessResponse(
  transaction: string,
  network: string,
): Response {
  return jsonResponse(200, {
    success: true,
    transaction,
    network,
    payer: "test-payer",
  });
}

export function settleSuccessResponseV2(
  transaction: string,
  network: string,
): Response {
  return jsonResponse(200, {
    success: true,
    transaction,
    network,
  });
}

export function paymentRequiredResponse(
  accepts: x402PaymentRequirements[],
  error = "",
): Response {
  return jsonResponse(402, {
    x402Version: 1,
    accepts,
    error,
  });
}

export function networkError(message = "Network error"): Error {
  return new Error(message);
}

export function timeoutError(): Error {
  return new Error("Request timed out");
}

export function httpError(status: number, message: string): Response {
  return jsonResponse(status, { error: message });
}
