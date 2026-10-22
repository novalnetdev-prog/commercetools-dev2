import { PaymentResponseSchemaDTO } from "../dtos/novalnet-payment.dto";

/** Preserve Novalnet's decline reason in the processor's normal payment response. */
export function redirectFailureResponse(
  paymentReference: string,
  gatewayResponse: any,
): PaymentResponseSchemaDTO | null {
  if (gatewayResponse?.result?.status === "SUCCESS") return null;

  return {
    paymentReference,
    transactionStatus: "FAILURE",
    transactionStatusText:
      gatewayResponse?.result?.status_text || "Payment initialization failed",
  };
}
