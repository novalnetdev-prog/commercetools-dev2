export type NovalnetOrderStates = {
  paymentState: "Pending" | "Paid" | "BalanceDue" | "Failed";
};

export type NovalnetOrderStateInput = {
  status?: string;
  eventType?: string;
  isPartialCapture?: boolean;
  isPartialCredit?: boolean;
  isPartialChargeback?: boolean;
};

export function mapNovalnetOrderStates({
  status,
  eventType,
  isPartialCapture = false,
  isPartialCredit = false,
}: NovalnetOrderStateInput): NovalnetOrderStates | null {
  const paymentStatus = String(status ?? "").toUpperCase();
  const event = String(eventType ?? "").toUpperCase();

  switch (event) {
    case "TRANSACTION_CAPTURE":
      if (paymentStatus !== "CONFIRMED") return null;
      return isPartialCapture
        ? { paymentState: "BalanceDue" }
        : { paymentState: "Paid" };
    case "TRANSACTION_CANCEL":
      return paymentStatus === "CANCELLED" || paymentStatus === "DEACTIVATED"
        ? { paymentState: "Failed" }
        : null;
    case "CHARGEBACK":
    case "RETURN_DEBIT":
    case "RETURN_DEBIT_SEPA":
    case "REVERSAL":
      return null;
    case "CREDIT":
      if (paymentStatus === "FAILURE") return null;
      return isPartialCredit
        ? { paymentState: "BalanceDue" }
        : { paymentState: "Paid" };
    case "TRANSACTION_REFUND":
      return null;
    case "TRANSACTION_UPDATE":
      if (paymentStatus === "CONFIRMED" && isPartialCapture) {
        return { paymentState: "BalanceDue" };
      }
      break;
  }

  switch (paymentStatus) {
    case "CONFIRMED":
      return { paymentState: "Paid" };
    case "PENDING":
    case "ON_HOLD":
      return { paymentState: "Pending" };
    case "FAILURE":
    case "CANCELLED":
    case "DEACTIVATED":
      return { paymentState: "Failed" };
    default:
      return null;
  }
}
