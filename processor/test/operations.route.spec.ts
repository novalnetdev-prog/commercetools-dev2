import Fastify from "fastify";
import { operationsRoute } from "../src/routes/operation.route";
jest.mock("../src/libs/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe("standard payment operation HTTP contract", () => {
  async function setup() {
    const server = Fastify();
    const modifyPayment = jest.fn(async () => ({
      outcome: "approved",
      paymentReference: "payment-a",
    }));
    await server.register(operationsRoute, {
      paymentService: {
        modifyPayment,
        config: async () => ({ clientKey: "public-test" }),
      } as any,
      oauth2AuthHook: {
        authenticate: () => async (req: any) => {
          if (req.headers.authorization !== "Bearer authorized-test")
            throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
        },
      } as any,
      authorizationHook: {
        authorize: (...scopes: string[]) => {
          expect(scopes).toContain("manage_checkout_payment_intents");
          return async (req: any) => {
            if (req.headers["x-test-authority"] !== "allowed")
              throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
          };
        },
      } as any,
      sessionHeaderAuthHook: {
        authenticate: () => async (req: any) => {
          if (!req.headers["x-session-id"])
            throw Object.assign(new Error("Session required"), {
              statusCode: 401,
            });
        },
      } as any,
      jwtAuthHook: { authenticate: () => async () => undefined } as any,
    });
    return { server, modifyPayment };
  }
  const headers = {
    authorization: "Bearer authorized-test",
    "x-test-authority": "allowed",
  };
  test.each([401, 403])(
    "requires authentication and authority (%s)",
    async (status) => {
      const { server, modifyPayment } = await setup();
      const response = await server.inject({
        method: "POST",
        url: "/payment-intents/payment-a",
        payload: { actions: [{ action: "cancelPayment" }] },
        headers: status === 403 ? { authorization: headers.authorization } : {},
      });
      expect(response.statusCode).toBe(status);
      expect(modifyPayment).not.toHaveBeenCalled();
      await server.close();
    },
  );
  test("one authorized action reaches the existing service contract", async () => {
    const { server, modifyPayment } = await setup();
    const data = {
      actions: [
        {
          action: "refundPayment",
          amount: { centAmount: 100, currencyCode: "EUR" },
          merchantReference: "refund-1",
        },
      ],
    };
    const response = await server.inject({
      method: "POST",
      url: "/payment-intents/payment-a",
      headers,
      payload: data,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe("approved");
    expect(modifyPayment).toHaveBeenCalledWith({
      paymentId: "payment-a",
      data,
    });
    await server.close();
  });
  test.each([
    { name: "empty", actions: [] },
    {
      name: "multiple",
      actions: [{ action: "cancelPayment" }, { action: "reversePayment" }],
    },
    { name: "unsupported", actions: [{ action: "unsupported" }] },
    { name: "missing refund amount", actions: [{ action: "refundPayment" }] },
  ])("rejects $name actions before dispatch", async ({ actions }) => {
    const { server, modifyPayment } = await setup();
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/payment-intents/payment-a",
          headers,
          payload: { actions },
        })
      ).statusCode,
    ).toBe(400);
    expect(modifyPayment).not.toHaveBeenCalled();
    await server.close();
  });
  test("public client configuration still requires a Checkout Session", async () => {
    const { server } = await setup();
    expect((await server.inject("/config")).statusCode).toBe(401);
    const response = await server.inject({
      url: "/config",
      headers: { "x-session-id": "test-session" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clientKey: "public-test" });
    await server.close();
  });
});
