import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config/config";

const fields = [
  "paymentReference",
  "ctsid",
  "orderNumber",
  "ctPaymentID",
  "pspReference",
  "lang",
  "path",
] as const;
export type ReturnParameters = Partial<Record<(typeof fields)[number], string>>;

// Bind merchant parameters to the attempt; Novalnet's checksum covers gateway
// parameters, not the Payment ID, session, or return destination we append.
export function signReturnParameters(parameters: ReturnParameters): string {
  const key = getConfig().novalnetPrivateKey;
  if (!key) throw new Error("Novalnet Access Key is missing.");
  return createHmac("sha256", key)
    .update(JSON.stringify(fields.map((name) => parameters[name] ?? "")))
    .digest("hex");
}

export function validReturnParameters(
  parameters: ReturnParameters & { nnReturnToken?: string },
): boolean {
  if (
    !parameters.ctPaymentID ||
    parameters.paymentReference !== parameters.ctPaymentID ||
    !parameters.pspReference ||
    !/^[a-f0-9]{64}$/.test(parameters.nnReturnToken ?? "")
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signReturnParameters(parameters), "hex"),
    Buffer.from(parameters.nnReturnToken!, "hex"),
  );
}

export function returnErrorMessage(message: unknown, lang?: string): string {
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 500)
    : lang?.toLowerCase().startsWith("de")
      ? "Die Zahlung ist fehlgeschlagen oder wurde abgebrochen. Bitte versuchen Sie es erneut."
      : "Payment failed or was cancelled. Please try again.";
}

/** Merchant URL integrity alone does not prove a financial failure at the PSP. */
export function verifiedFailureReturn(query: {
  tid?: string;
  txn_secret?: string;
  status?: string;
  checksum?: string;
}): boolean {
  if (
    !query.tid ||
    !query.txn_secret ||
    !["FAILURE", "CANCELLED", "DEACTIVATED"].includes(
      String(query.status).toUpperCase(),
    ) ||
    !/^[a-f0-9]{64}$/.test(query.checksum ?? "")
  )
    return false;
  const key = getConfig().novalnetPrivateKey;
  if (!key) return false;
  const expected = createHash("sha256")
    .update(
      `${query.tid}${query.txn_secret}${query.status}${key.split("").reverse().join("")}`,
    )
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(query.checksum!, "hex"),
  );
}
