import { createHash } from "node:crypto";
import Fastify from "fastify";
import { paymentRoutes } from "../src/routes/novalnet-payment.route";
import redirectErrors from "../src/services/redirect-payment-error.service";
import { signReturnParameters } from "../src/utils/redirect-return";
import * as Context from "../src/libs/fastify/context/context";
import * as Config from "../src/config/config";
jest.mock("../src/services/novalnet-payment.service", () => ({
  CheckoutPaymentError: class extends Error {},
}));
jest.mock("../src/services/redirect-payment-error.service", () => ({
  __esModule: true,
  default: { record: jest.fn(), read: jest.fn(), acknowledge: jest.fn() },
}));
jest.mock("../src/libs/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
describe("return error HTTP integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(Config, "getConfig")
      .mockReturnValue({ novalnetPrivateKey: "test-secret" } as any);
  });
  afterEach(() => jest.restoreAllMocks());
  async function setup() {
    const server = Fastify(),
      failureResponse = jest.fn(async () => undefined);
    await server.register(paymentRoutes, {
      paymentService: { failureResponse } as any,
      sessionHeaderAuthHook: {
        authenticate: () => async (req: any) => {
          if (req.headers["x-session-id"] !== "session-a")
            throw Object.assign(new Error("Inactive session"), {
              statusCode: 401,
            });
        },
      } as any,
    });
    return { server, failureResponse };
  }
  function url(reason?: string) {
    const query = {
      paymentReference: "payment-a",
      ctPaymentID: "payment-a",
      pspReference: "psp-a",
      ctsid: "session-a",
      lang: "de",
      path: "https://shop.example/de",
    };
    return (
      "/failure?" +
      new URLSearchParams({
        ...query,
        nnReturnToken: signReturnParameters(query),
        tid: "15453500048018276",
        txn_secret: "gateway-test",
        status: "FAILURE",
        checksum: createHash("sha256")
          .update("15453500048018276gateway-testFAILUREterces-tset")
          .digest("hex"),
        ...(reason ? { status_text: reason } : {}),
      })
    );
  }
  test("records and redirects a signed failure, preserving the gateway reason", async () => {
    const { server, failureResponse } = await setup();
    const response = await server.inject(url("Zahlung abgebrochen"));
    expect(response.statusCode).toBe(302);
    expect(failureResponse).toHaveBeenCalledTimes(1);
    expect(redirectErrors.record).toHaveBeenCalledWith(
      "payment-a",
      "psp-a",
      "Zahlung abgebrochen",
    );
    expect(
      new URL(response.headers.location!).searchParams.get(
        "novalnetPaymentError",
      ),
    ).toBe("Zahlung abgebrochen");
    await server.close();
  });
  test("rejects tampered payment IDs and destinations before recording financial failure", async () => {
    const { server, failureResponse } = await setup();
    const response = await server.inject(
      url().replace("payment-a", "payment-b"),
    );
    expect(response.statusCode).toBe(400);
    expect(failureResponse).not.toHaveBeenCalled();
    expect(redirectErrors.record).not.toHaveBeenCalled();
    await server.close();
  });
  test("cancellation without a reason uses the German fallback", async () => {
    const { server } = await setup();
    expect((await server.inject(url())).statusCode).toBe(302);
    expect(redirectErrors.record).toHaveBeenCalledWith(
      "payment-a",
      "psp-a",
      expect.stringContaining("abgebrochen"),
    );
    await server.close();
  });
  test("merchant-signed cancellation without gateway proof only records a UI notification", async () => {
    const { server, failureResponse } = await setup();
    const value = new URL(url(), "https://processor.example");
    for (const key of ["tid", "txn_secret", "status", "checksum"])
      value.searchParams.delete(key);
    expect(
      (await server.inject(value.pathname + value.search)).statusCode,
    ).toBe(302);
    expect(failureResponse).not.toHaveBeenCalled();
    expect(redirectErrors.record).toHaveBeenCalled();
    await server.close();
  });
  test("notification endpoint requires an active Checkout session", async () => {
    const { server } = await setup();
    const response = await server.inject({
      method: "POST",
      url: "/redirectPaymentError",
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(redirectErrors.read).not.toHaveBeenCalled();
    await server.close();
  });
  test("uses the authenticated cart, ignoring a cart supplied by query parameter", async () => {
    const { server } = await setup();
    jest.spyOn(Context, "getCartIdFromContext").mockReturnValue("cart-a");
    (redirectErrors.read as jest.Mock).mockResolvedValueOnce({
      noticeId: "a".repeat(64),
      paymentReference: "payment-a",
      transactionStatusText: "Declined",
    });
    const response = await server.inject({
      method: "POST",
      url: "/redirectPaymentError?cartId=another",
      payload: {},
      headers: { "X-Session-Id": "session-a" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(redirectErrors.read).toHaveBeenCalledWith("cart-a");
    await server.close();
  });
  test("a notification store outage does not break ordinary payment component loading", async () => {
    const { server } = await setup();
    jest.spyOn(Context, "getCartIdFromContext").mockReturnValue("cart-a");
    (redirectErrors.read as jest.Mock).mockRejectedValueOnce(
      new Error("Unavailable"),
    );
    const response = await server.inject({
      method: "POST",
      url: "/redirectPaymentError",
      payload: {},
      headers: { "X-Session-Id": "session-a" },
    });
    expect(response.statusCode).toBe(204);
    await server.close();
  });
});
