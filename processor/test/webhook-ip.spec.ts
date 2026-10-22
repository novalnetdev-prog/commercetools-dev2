import Fastify from "fastify";
import { NovalnetPaymentService } from "../src/services/novalnet-payment.service";
import * as Config from "../src/config/config";
jest.mock("dns/promises", () => ({
  resolve4: jest.fn(async () => ["198.51.100.10"]),
}));
jest.mock("../src/utils/ct-client", () => ({ projectApiRoot: {} }));
jest.mock("../src/libs/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe("existing Connect callback caller convention without merchant proxy configuration", () => {
  beforeEach(() =>
    jest
      .spyOn(Config, "getConfig")
      .mockReturnValue({ novalnetWebhookTestMode: "0" } as any),
  );
  afterEach(() => jest.restoreAllMocks());
  async function call(
    headers: Record<string, string>,
    remoteAddress = "169.254.169.126",
  ) {
    const server = Fastify();
    const service = new NovalnetPaymentService({
      ctCartService: {},
      ctPaymentService: {},
    } as any);
    server.post("/ip", async (req, reply) => {
      try {
        await service.validateIpAddress(req);
        return { accepted: true };
      } catch (error) {
        return reply.code(403).send({ message: (error as Error).message });
      }
    });
    const response = await server.inject({
      method: "POST",
      url: "/ip",
      headers,
      remoteAddress,
    });
    await server.close();
    return response;
  }
  test("the existing GFE client/load-balancer pair resolves the provider", async () => {
    expect(
      (await call({ "x-forwarded-for": "198.51.100.10, 203.0.113.8" }))
        .statusCode,
    ).toBe(200);
  });
  test("a spoofed earlier allowed IP cannot authorize another client", async () => {
    const response = await call({
      "x-forwarded-for": "198.51.100.10, 203.0.113.6, 203.0.113.8",
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toBe(
      "Unauthorized access from IP 203.0.113.6",
    );
  });
  test("the real provider is accepted despite an irrelevant earlier address", async () => {
    expect(
      (
        await call({
          "x-forwarded-for": "203.0.113.6, 198.51.100.10, 203.0.113.8",
        })
      ).statusCode,
    ).toBe(200);
  });
  test.each(["x-forwarded-host", "x-real-ip", "x-client-ip"])(
    "%s cannot authorize a callback",
    async (header) => {
      expect((await call({ [header]: "198.51.100.10" })).statusCode).toBe(403);
    },
  );
  test("a public direct socket cannot supply a trusted forwarding chain", async () => {
    const response = await call(
      { "x-forwarded-for": "198.51.100.10, 203.0.113.8" },
      "203.0.113.6",
    );
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain("203.0.113.6");
  });
  test("a lone client-supplied forwarded address is not a GFE pair", async () => {
    expect(
      (await call({ "x-forwarded-for": "198.51.100.10" })).statusCode,
    ).toBe(403);
  });
  test.each(["198.51.100.10", "::ffff:198.51.100.10"])(
    "direct provider %s remains valid",
    async (remote) => {
      expect((await call({}, remote)).statusCode).toBe(200);
    },
  );
});
