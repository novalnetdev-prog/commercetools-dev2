import {
  returnErrorMessage,
  signReturnParameters,
  validReturnParameters,
} from "../src/utils/redirect-return";
import * as Config from "../src/config/config";
describe("signed return parameters", () => {
  beforeEach(() =>
    jest
      .spyOn(Config, "getConfig")
      .mockReturnValue({ novalnetPrivateKey: "test-key" } as any),
  );
  afterEach(() => jest.restoreAllMocks());
  const query = {
    paymentReference: "p1",
    ctPaymentID: "p1",
    pspReference: "psp1",
    ctsid: "s1",
    orderNumber: "o1",
    path: "https://shop.example/de",
    lang: "de",
  };
  test("all merchant return fields are bound to one payment attempt", () => {
    const signed = { ...query, nnReturnToken: signReturnParameters(query) };
    expect(validReturnParameters(signed)).toBe(true);
    for (const field of Object.keys(query))
      expect(validReturnParameters({ ...signed, [field]: "changed" })).toBe(
        false,
      );
  });
  test.each([undefined, "", "123", "z".repeat(64)])(
    "rejects malformed token %s",
    (token) => {
      expect(validReturnParameters({ ...query, nnReturnToken: token })).toBe(
        false,
      );
    },
  );
  test("cancel fallback and length are localized and bounded", () => {
    expect(returnErrorMessage("", "de")).toContain("abgebrochen");
    expect(returnErrorMessage("", "en")).toContain("cancelled");
    expect(returnErrorMessage("x".repeat(501))).toHaveLength(500);
  });
});
