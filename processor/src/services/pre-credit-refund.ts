export function reconcilePreCreditRefund(input: {
  originalAmount: number;
  previouslyRefunded: number;
  refundAmount: number;
  expectedCurrency: string;
  transaction?: {
    status?: string;
    amount?: string | number;
    currency?: string;
    refund?: { amount?: string | number; currency?: string };
  };
}): { cancelled: boolean; remaining: number } {
  const {
    originalAmount,
    previouslyRefunded,
    refundAmount,
    expectedCurrency,
    transaction,
  } = input;
  const status = String(transaction?.status ?? "").toUpperCase();
  const cancelled = status === "DEACTIVATED";
  const remaining = originalAmount - previouslyRefunded - refundAmount;
  if (
    !Number.isSafeInteger(originalAmount) ||
    originalAmount <= 0 ||
    !Number.isSafeInteger(previouslyRefunded) ||
    previouslyRefunded < 0 ||
    !Number.isSafeInteger(refundAmount) ||
    refundAmount <= 0 ||
    remaining < 0
  ) {
    throw new Error("Invalid pre-credit refund total.");
  }
  if (
    cancelled
      ? remaining !== 0
      : !["PENDING", "CONFIRMED"].includes(status) ||
        remaining <= 0 ||
        Number(transaction?.amount) !== remaining
  ) {
    throw new Error(
      "Novalnet pre-credit refund does not match the remaining balance.",
    );
  }
  if (
    transaction?.currency !== expectedCurrency ||
    (transaction?.refund?.currency &&
      transaction.refund.currency !== expectedCurrency) ||
    Number(transaction?.refund?.amount) !== refundAmount
  ) {
    throw new Error("Novalnet pre-credit refund amount or currency mismatch.");
  }
  return { cancelled, remaining };
}
