import {
  CheckoutPaymentError,
  NovalnetPaymentService,
} from "../src/services/novalnet-payment.service";
import { PaymentMethodType } from "../src/dtos/novalnet-payment.dto";
import * as Context from "../src/libs/fastify/context/context";
import * as Config from "../src/config/config";
import { projectApiRoot } from "../src/utils/ct-client";
import { paymentSDK } from "../src/payment-sdk";
import { validReturnParameters } from "../src/utils/redirect-return";
import {
  commerce,
  gatewayResponse,
  initialTransaction,
} from "./helpers/commerce";
jest.mock("../src/utils/ct-client", () => ({ projectApiRoot: {} }));
jest.mock("../src/utils/custom-fields", () => ({
  createTransactionCommentsType: jest.fn(async () => undefined),
  createOrderPaymentCommentsType: jest.fn(async () => undefined),
  get apiRoot() {
    return jest.requireMock("../src/utils/ct-client").projectApiRoot;
  },
}));
jest.mock("../src/libs/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));
describe("Novalnet initial payments", () => {
  let ct: ReturnType<typeof commerce>,
    service: NovalnetPaymentService,
    cfg: any;
  beforeEach(() => {
    ct = commerce();
    Object.assign(projectApiRoot, ct.api);
    (paymentSDK as any).ctCartService = ct.ctCartService;
    service = new NovalnetPaymentService(ct);
    cfg = {
      novalnetPublicKey: "public-test",
      novalnetPrivateKey: "test-secret",
      novalnetTariff: "test-tariff",
      novalnetClientkey: "client-test",
    };
    jest.spyOn(Config, "getConfig").mockImplementation(() => cfg);
    jest.spyOn(Context, "getCartIdFromContext").mockReturnValue("cart-a");
    jest
      .spyOn(Context, "getProcessorUrlFromContext")
      .mockReturnValue("https://processor.example");
    jest
      .spyOn(Context, "getCtSessionIdFromContext")
      .mockReturnValue("session-a");
    jest
      .spyOn(Context, "getFutureOrderNumberFromContext")
      .mockReturnValue("test-order");
    jest
      .spyOn(Context, "getPaymentInterfaceFromContext")
      .mockReturnValue("novalnet");
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected HTTP call"));
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const request = (type: string, lang = "en"): any => ({
    data: {
      paymentMethod: { type },
      paymentOutcome: "Authorized",
      lang,
      path: "https://shop.example",
    },
  });
  function reply(status: string, paymentType = "CREDITCARD") {
    (fetch as jest.Mock).mockResolvedValueOnce(
      gatewayResponse({
        result: {
          status: status === "FAILURE" ? "FAILURE" : "SUCCESS",
          status_text: "Provider decline reason",
        },
        transaction: {
          tid: "15453500048018276",
          status,
          status_code: 100,
          amount: 799,
          currency: "EUR",
          payment_type: paymentType,
        },
      }),
    );
  }
  test.each([
    ["ON_HOLD", "Authorization", "Success"],
    ["PENDING", "Authorization", "Pending"],
    ["CONFIRMED", "Charge", "Success"],
    ["FAILURE", "Authorization", "Failure"],
  ])("%s preserves %s / %s", async (status, type, state) => {
    reply(status);
    const result = await service.createDirectPayment(request("CREDITCARD"));
    expect(result.paymentReference).toBe("payment-a");
    expect(ct.state.payment.transactions).toEqual([
      expect.objectContaining({ type, state, timestamp: expect.any(String) }),
    ]);
    expect(ct.state.orderWrites).toHaveLength(0);
  });
  test("a valid Cart totalPrice is used for guarantee eligibility without taxedPrice", async () => {
    ct.state.cart.totalPrice = { centAmount: 1000, currencyCode: "EUR" };
    delete ct.state.cart.taxedPrice;
    reply("PENDING", "GUARANTEED_INVOICE");
    await service.createDirectPayment(request("GUARANTEED_INVOICE"));
    expect(
      JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).transaction
        .payment_type,
    ).toBe("GUARANTEED_INVOICE");
  });
  test("a direct decline returns and records its exact reason", async () => {
    reply("FAILURE");
    expect(
      (await service.createDirectPayment(request("CREDITCARD")))
        .transactionStatusText,
    ).toBe("Provider decline reason");
    expect(
      ct.state.payment.transactions[0].custom.fields.transactionComments,
    ).toContain("Provider decline reason");
  });
  test("the direct company field uses Address.company rather than address instructions", async () => {
    ct.state.cart.billingAddress.company = "Example GmbH";
    ct.state.cart.billingAddress.additionalAddressInfo = "Second floor";
    reply("PENDING", "INVOICE");
    await service.createDirectPayment(request("INVOICE"));
    const billing = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)
      .customer.billing;
    expect(billing.company).toBe("Example GmbH");
    expect(billing.company).not.toContain("floor");
  });
  test("redirect verification persists the provider reference before an Order exists", async () => {
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Initial"),
    ];
    ct.state.order = null;
    reply("ON_HOLD");
    await service.transactionUpdate({
      data: {
        ctPaymentId: "payment-a",
        pspReference: "psp-a",
        interfaceId: "15453500048018276",
        lang: "en",
      },
    });
    expect(
      ct.state.objects.get("nn-private-data/payment-a-psp-a").value.tid,
    ).toBe("15453500048018276");
    expect(ct.state.payment.transactions[0].state).toBe("Success");
  });
  test("a repeated redirect return preserves capture state and follow-up comments", async () => {
    const initial = initialTransaction();
    initial.custom.fields.transactionComments += "\n\n---\nCaptured follow-up";
    ct.state.payment.transactions = [
      initial,
      {
        ...initialTransaction("Charge", "Success"),
        id: "capture-a",
        interactionId: "psp-a-Charge",
      },
    ];
    ct.state.order.paymentState = "Paid";
    reply("ON_HOLD");
    await service.transactionUpdate({
      data: {
        ctPaymentId: "payment-a",
        pspReference: "psp-a",
        interfaceId: "15453500048018276",
        lang: "en",
      },
    });
    expect(ct.state.payment.transactions).toHaveLength(2);
    expect(
      ct.state.payment.transactions[0].custom.fields.transactionComments,
    ).toContain("Captured follow-up");
    expect(ct.state.order.custom.fields.paymentComments).toContain(
      "Captured follow-up",
    );
    expect(ct.state.order.paymentState).toBe("Paid");
  });
  test("a redirect details response for a different provider transaction cannot update the Payment", async () => {
    ct.state.payment.transactions = [initialTransaction()];
    reply("ON_HOLD");
    await expect(
      service.transactionUpdate({
        data: {
          ctPaymentId: "payment-a",
          pspReference: "psp-a",
          interfaceId: "15453500048018277",
          lang: "en",
        },
      }),
    ).rejects.toThrow("does not match");
    expect(ct.state.paymentWrites).toHaveLength(0);
    expect(ct.state.orderWrites).toHaveLength(0);
  });
  test.each(["direct", "redirect"])(
    "%s sends empty missing customer data and defaults an unsupported language to English",
    async (flow) => {
      ct.state.cart.billingAddress = {};
      ct.state.cart.shippingAddress = {};
      delete ct.state.cart.customerEmail;
      jest
        .mocked(Context.getPaymentInterfaceFromContext)
        .mockReturnValue(undefined as any);
      reply("FAILURE");
      const input = request(flow === "direct" ? "INVOICE" : "IDEAL", "fr");
      if (flow === "direct") await service.createDirectPayment(input);
      else await service.createRedirectPayment(input);
      const payload = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
      expect(payload.customer).toMatchObject({
        billing: {
          city: "",
          country_code: "",
          house_no: "",
          street: "",
          zip: "",
        },
        shipping: {
          city: "",
          country_code: "",
          house_no: "",
          street: "",
          zip: "",
        },
        first_name: "",
        last_name: "",
        email: "",
        customer_ip: "",
      });
      expect(payload.custom).toMatchObject({ lang: "EN", inputval3: "en" });
      expect(ct.state.payment.paymentMethodInfo.paymentInterface).toBe("");
      expect(JSON.stringify(payload)).not.toContain("undefined");
    },
  );
  test.each(["DIRECT_DEBIT_SEPA", "GUARANTEED_DIRECT_DEBIT_SEPA"])(
    "%s sends the entered BIC",
    async (type) => {
      ct.state.payment.amountPlanned.centAmount =
        ct.state.cart.taxedPrice.totalGross.centAmount = 1000;
      reply("CONFIRMED", type);
      const data = request(type);
      data.data.paymentMethod = {
        type,
        accHolder: "Müller & Sohn",
        iban: "DE02120300000000202051",
        bic: "BYLADEM1001",
      };
      await service.createDirectPayment(data);
      expect(
        JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).transaction
          .payment_data.bic,
      ).toBe("BYLADEM1001");
    },
  );
  test.each(["en", "de"])(
    "guarantee minimum fails in %s when fallback is disabled",
    async (lang) => {
      await expect(
        service.createDirectPayment(request("GUARANTEED_INVOICE", lang)),
      ).rejects.toBeInstanceOf(CheckoutPaymentError);
      await expect(
        service.createDirectPayment(request("GUARANTEED_INVOICE", lang)),
      ).rejects.toThrow(
        lang === "de" ? "Die Zahlungsbedingungen" : "Payment conditions",
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(ct.state.payment.transactions).toHaveLength(0);
    },
  );
  test("force non-guarantee changes API code and recorded title", async () => {
    cfg.novalnet_GUARANTEED_INVOICE_ForceNonGuarantee = "1";
    reply("PENDING", "INVOICE");
    await service.createDirectPayment(request("GUARANTEED_INVOICE"));
    expect(
      JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).transaction
        .payment_type,
    ).toBe("INVOICE");
    expect(ct.state.payment.paymentMethodInfo.name.en).toBe("Invoice");
  });
  test("mixed-payment carts send Checkout's remaining amount", async () => {
    ct.state.cart.taxedPrice.totalGross.centAmount = 10000;
    reply("CONFIRMED");
    await service.createDirectPayment(request("CREDITCARD"));
    expect(
      JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).transaction.amount,
    ).toBe("799");
    (fetch as jest.Mock).mockResolvedValueOnce(
      gatewayResponse({
        result: { status: "SUCCESS", redirect_url: "https://gateway.example" },
        transaction: { txn_secret: "secret" },
      }),
    );
    await service.createRedirectPayment(request("IDEAL"));
    expect(
      JSON.parse((fetch as jest.Mock).mock.calls[1][1].body).transaction.amount,
    ).toBe("799");
  });
  test.each([
    ["authorize", "0", "authorize"],
    ["authorize", "1000", "payment"],
    ["payment", "0", "payment"],
  ])("PayPal %s threshold %s calls /%s", async (action, minimum, endpoint) => {
    cfg.novalnet_PAYPAL_PaymentAction = action;
    cfg.novalnet_PAYPAL_MinimumAmount = minimum;
    (fetch as jest.Mock).mockResolvedValueOnce(
      gatewayResponse({
        result: { status: "SUCCESS", redirect_url: "https://gateway.example" },
        transaction: { txn_secret: "secret" },
      }),
    );
    expect(
      (await service.createRedirectPayment(request("PAYPAL"))).txnSecret,
    ).toBe("https://gateway.example");
    expect((fetch as jest.Mock).mock.calls[0][0]).toBe(
      `https://payport.novalnet.de/v2/${endpoint}`,
    );
    const payload = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
    expect(payload.cart_info.line_items).toEqual([]);
    const parameters = Object.fromEntries(
      new URL(payload.transaction.error_return_url).searchParams,
    );
    expect(validReturnParameters(parameters)).toBe(true);
    expect(
      validReturnParameters({ ...parameters, path: "https://another.example" }),
    ).toBe(false);
  });
  test("advertises every implemented method", async () => {
    expect(
      (await service.getSupportedPaymentComponents()).components.map(
        (item) => item.type,
      ),
    ).toEqual(Object.values(PaymentMethodType));
  });
  test.each([
    ["DIRECT_DEBIT_SEPA", "", 3],
    ["DIRECT_DEBIT_SEPA", "1", 3],
    ["DIRECT_DEBIT_SEPA", "30", 14],
    ["PREPAYMENT", "", 14],
    ["PREPAYMENT", "1", 7],
    ["PREPAYMENT", "30", 28],
    ["INVOICE", "", 14],
    ["INVOICE", "7", 8],
    ["INVOICE", "21", 21],
    ["INVOICE", "Infinity", 14],
  ])(
    "%s due-date configuration %s yields %s days",
    async (type, configured, days) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date("2026-10-21T12:00:00Z"));
      cfg[`novalnet_${type}_DueDate`] = configured;
      reply("PENDING", type);
      await service.createDirectPayment(request(type));
      const dueDate = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)
        .transaction.due_date;
      expect(dueDate).toBe(
        new Date(Date.now() + Number(days) * 86400000)
          .toISOString()
          .split("T")[0],
      );
    },
  );
  test("the direct attempt is correlated before an ambiguous network failure", async () => {
    await expect(
      service.createDirectPayment(request("CREDITCARD")),
    ).rejects.toThrow("Payment processing failed");
    expect(ct.state.payment.interfaceId).toBeTruthy();
    expect(ct.state.payment.transactions).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test("config exposes only the public client key", async () => {
    expect(await service.config()).toEqual({
      clientKey: "client-test",
      environment: "live",
    });
  });
  test("a stale failure cannot downgrade a successful payment", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    await service.failureResponse({
      data: {
        ctPaymentID: "payment-a",
        pspReference: "psp-a",
        status_text: "old decline",
      },
    });
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("a failure saves the localized reason once", async () => {
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Pending"),
    ];
    const data = {
      ctPaymentID: "payment-a",
      pspReference: "psp-a",
      lang: "de",
      status_text: "Zahlung abgebrochen",
    };
    await service.failureResponse({ data });
    await service.failureResponse({ data });
    expect(ct.state.payment.transactions[0].state).toBe("Failure");
    expect(
      ct.state.payment.transactions[0].custom.fields.transactionComments.match(
        /Zahlung abgebrochen/g,
      ),
    ).toHaveLength(1);
  });
});
