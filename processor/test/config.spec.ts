import { checkoutUrlFromApiUrl } from "../src/config/config";

describe("Checkout region from the existing API configuration", () => {
  test.each([
    [
      "https://api.europe-west1.gcp.commercetools.com",
      "https://checkout.europe-west1.gcp.commercetools.com",
    ],
    [
      "https://api.us-central1.gcp.commercetools.com/",
      "https://checkout.us-central1.gcp.commercetools.com",
    ],
    [
      "https://api.us-east-2.aws.commercetools.com",
      "https://checkout.us-east-2.aws.commercetools.com",
    ],
    ["", ""],
  ])("uses the actual API Region from %s", (api, checkout) => {
    expect(checkoutUrlFromApiUrl(api)).toBe(checkout);
  });
  test("a missing/invalid API host does not invent a Region", () => {
    expect(() => checkoutUrlFromApiUrl("https://other.example")).toThrow(
      "CTP_API_URL",
    );
  });
});
