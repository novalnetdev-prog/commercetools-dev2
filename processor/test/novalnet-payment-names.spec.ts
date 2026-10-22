import {
  getPaymentMethodName,
  getPaymentMethodNames,
  normalizeLocale,
} from "../src/i18n";

describe("Novalnet payment names", () => {
  test("an absent payment method has an empty display name", () => {
    expect(getPaymentMethodName("en", undefined)).toBe("");
  });
  test.each([
    [undefined, "en"],
    [null, "en"],
    ["", "en"],
    ["fr", "en"],
    ["en-GB", "en"],
    ["de", "de"],
    ["DE", "de"],
    ["de-DE", "de"],
  ])("locale %s normalizes to %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
  test.each([
    ["DIRECT_DEBIT_SEPA", "Direct Debit SEPA", "SEPA-Lastschrift"],
    [
      "GUARANTEED_DIRECT_DEBIT_SEPA",
      "Direct Debit SEPA with payment guarantee",
      "SEPA-Lastschrift mit Zahlungsgarantie",
    ],
    ["BANCOMATPAY", "BANCOMAT Pay", "BANCOMAT Pay"],
    ["KAKAOPAY", "KakaoPay", "KakaoPay"],
    ["NAVERPAY", "Naver Pay", "Naver Pay"],
    ["PIX", "Pix", "Pix"],
    ["BOLETO", "Boleto", "Boleto"],
    ["BIZUM", "Bizum", "Bizum"],
  ])("%s uses localized display names", (code, en, de) => {
    expect(getPaymentMethodNames(code)).toEqual({ en, de });
    expect(getPaymentMethodName("de", code)).toBe(de);
  });
});
