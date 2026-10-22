import en from "./en.json";
import de from "./de.json";

/**
 * Supported shop locales
 * Add new languages here only
 */
export type SupportedLocale = "en" | "de";

/**
 * Translation dictionaries
 */
export const translations: Record<SupportedLocale, any> = {
  en,
  de,
};

/**
 * Normalize raw locale string (from order.locale, headers, etc.)
 * Always returns a SupportedLocale
 */
export function normalizeLocale(locale?: string | null): SupportedLocale {
  if (/^de(?:[-_]|$)/i.test(locale ?? "")) return "de";
  return "en"; // default fallback
}

/**
 * Translate helper
 *
 * @param locale - normalized locale (en, de)
 * @param key - dot notation key (payment.transactionId)
 * @param params - placeholder replacements
 */
export function t(
  locale: SupportedLocale,
  key: string,
  params: Record<string, string> = {},
): string {
  const dict = translations[locale];

  let text =
    key
      .split(".")
      .reduce<any>(
        (obj, k) => (obj && obj[k] !== undefined ? obj[k] : undefined),
        dict,
      ) ?? key;

  Object.entries(params).forEach(([k, v]) => {
    text = text.replace(new RegExp(`{{${k}}}`, "g"), v);
  });

  return text;
}

export function getPaymentMethodName(
  locale: SupportedLocale,
  paymentType?: string | null,
): string {
  const code = String(paymentType ?? "").toUpperCase();
  if (!code) return "";
  const key = `paymentMethod.${code}`;
  const translated = t(locale, key);
  return translated === key ? code.replace(/_/g, " ") : translated;
}

export function getPaymentMethodNames(
  paymentType: string,
): Record<SupportedLocale, string> {
  return {
    en: getPaymentMethodName("en", paymentType),
    de: getPaymentMethodName("de", paymentType),
  };
}
