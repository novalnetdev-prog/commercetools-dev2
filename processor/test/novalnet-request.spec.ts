import {
  bankTransferDetails,
  buildPayPalCartInfo,
  formatNovalnetAmount,
  getNovalnetSystemInfo,
  mergeInitialPaymentComments,
  multibancoReferenceDetails,
  updateBankTransferReference,
} from "../src/utils/novalnet-request";
import { reconcilePreCreditRefund } from "../src/services/pre-credit-refund";
import * as os from "node:os";
jest.mock("node:os", () => ({ networkInterfaces: jest.fn() }));

describe("request metadata without invented shop values", () => {
  afterEach(() => jest.restoreAllMocks());
  test("missing runtime IP, storefront and version remain empty", () => {
    jest.mocked(os.networkInterfaces).mockReturnValue({});
    expect(getNovalnetSystemInfo("", "")).toEqual({
      system_name: "commercetools",
      system_version: "",
      system_ip: "",
      system_url: "",
    });
  });
  test("unavailable network interfaces do not invent a loopback IP", () => {
    jest.mocked(os.networkInterfaces).mockImplementation(() => {
      throw new Error("Restricted runtime");
    });
    expect(getNovalnetSystemInfo("invalid-url", "1.0.0").system_ip).toBe("");
  });
  test("actual runtime IP and storefront origin are retained", () => {
    jest.mocked(os.networkInterfaces).mockReturnValue({
      eth0: [
        {
          address: "192.0.2.10",
          family: "IPv4",
          internal: false,
        } as os.NetworkInterfaceInfo,
      ],
    });
    expect(
      getNovalnetSystemInfo("https://shop.example/de/checkout", "1.0.0"),
    ).toMatchObject({
      system_ip: "192.0.2.10",
      system_url: "https://shop.example",
      system_version: "NN-1.0.0",
    });
  });
  test("a missing PayPal item price stays empty", () => {
    expect(
      buildPayPalCartInfo({ lineItems: [{ name: {}, quantity: 1 }] }, "en")
        .line_items[0].price,
    ).toBe("");
  });
});

describe("payment comment formatting", () => {
  test.each([undefined, null, "", " "])(
    "missing amount %s is not shown as zero",
    (amount) => {
      expect(formatNovalnetAmount(amount, "EUR", "en")).toBe("");
    },
  );
  test.each([undefined, null, "", " "])(
    "missing currency %s is not shown as EUR",
    (currency) => {
      expect(formatNovalnetAmount(1799, currency as string, "en")).toBe("");
    },
  );
  test("a real zero amount is retained", () => {
    expect(formatNovalnetAmount(0, "EUR", "en")).toContain("0.00");
  });
  test("bank and Multibanco comments do not invent a missing currency", () => {
    const bank = bankTransferDetails(
      { amount: 1799, bank_details: { iban: "DE123" } },
      "en",
    );
    const multibanco = multibancoReferenceDetails(
      { amount: 1799, partner_payment_reference: "123" },
      "en",
    );
    for (const comment of [bank, multibanco])
      expect(comment).not.toMatch(/EUR|€/);
    expect(bank).toContain("DE123");
    expect(multibanco).toContain("123");
  });
  test.each(["en", "de"] as const)(
    "USD has a symbol without US in %s",
    (locale) => {
      expect(formatNovalnetAmount(1799, "USD", locale)).toContain("$");
      expect(formatNovalnetAmount(1799, "USD", locale)).not.toContain("US");
    },
  );
  test.each([
    [10000, "JPY", "10,000"],
    [10000, "KRW", "10,000"],
    [1234, "BHD", "1.234"],
  ])("ISO minor units %s %s", (amount, currency, expected) => {
    expect(formatNovalnetAmount(amount, currency as string, "en")).toContain(
      expected,
    );
  });
  test("bank details show decimal amounts and the latest due date", () => {
    const transaction = {
      amount: 1799,
      currency: "EUR",
      due_date: "2026-10-28",
      tid: "15453500048018276",
      invoice_ref: "BNR-1",
      bank_details: {
        iban: "DE13740201500003119724",
        bic: "RZOODE77050",
        account_holder: "Novalnet AG",
      },
    };
    const original = bankTransferDetails(transaction, "en");
    expect(original).toContain("17.99");
    expect(original).toContain("28 October 2026");
    expect(
      updateBankTransferReference(
        original,
        { ...transaction, due_date: "2026-11-01" },
        "en",
      ),
    ).toContain("1 November 2026");
  });
  test("reconciliation keeps bank references and follow-ups without repeating initial comments", () => {
    const initial = "Novalnet Transaction ID: 123\nIBAN: DE123";
    const comments = mergeInitialPaymentComments(
      `${initial}\n\n---\nRefund reference`,
      "Novalnet Transaction ID: 123",
    );
    expect(comments.match(/Novalnet Transaction ID/g)).toHaveLength(1);
    expect(comments).toContain("IBAN: DE123");
    expect(comments).toContain("Refund reference");
  });
  test.each(["en", "de"] as const)(
    "Multibanco includes partner reference and entity in %s",
    (locale) => {
      const result = multibancoReferenceDetails(
        {
          amount: 1799,
          currency: "EUR",
          partner_payment_reference: "12345",
          service_supplier_id: "99999",
        },
        locale,
      );
      expect(result).toContain("12345");
      expect(result).toContain("99999");
      expect(result).toContain(locale === "de" ? "17,99" : "17.99");
    },
  );
});
describe("pre-credit response reconciliation", () => {
  test.each([
    [0, 499, 9000, "PENDING", false],
    [499, 9000, 9000, "DEACTIVATED", true],
  ])(
    "refund progression %s + %s",
    (previous, refund, remaining, status, cancelled) => {
      expect(
        reconcilePreCreditRefund({
          originalAmount: 9499,
          previouslyRefunded: previous as number,
          refundAmount: refund as number,
          expectedCurrency: "EUR",
          transaction: {
            status: status as string,
            amount: remaining as number,
            currency: "EUR",
            refund: { amount: refund as number, currency: "EUR" },
          },
        }).cancelled,
      ).toBe(cancelled);
    },
  );
});
