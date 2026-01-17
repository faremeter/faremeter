export type TestPaymentPayload = {
  testId: string;
  amount: string;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
};

export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
