import { executePaymentIntent } from "../src/services/payment-intent.service";
import { projectApiRoot } from "../src/utils/ct-client";
import * as Config from "../src/config/config";
import {
  commerce,
  gatewayResponse,
  initialTransaction,
  seedReference,
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
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe("Payment Intents at API boundaries", () => {
  let ct: ReturnType<typeof commerce>;
  beforeEach(() => {
    ct = commerce();
    Object.assign(projectApiRoot, ct.api);
    seedReference(ct.state);
    ct.state.payment.transactions = [initialTransaction()];
    jest.spyOn(Config, "getConfig").mockReturnValue({
      novalnetPrivateKey: "test-key",
    } as any);
    jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected HTTP"));
  });
  afterEach(() => jest.restoreAllMocks());
  const run = (action: any) =>
    executePaymentIntent(ct.ctPaymentService, "payment-a", {
      actions: [action],
    });
  const amount = (centAmount = 799, currencyCode = "EUR") => ({
    centAmount,
    currencyCode,
  });
  const reply = (transaction: any, status = "SUCCESS") =>
    (fetch as jest.Mock).mockResolvedValueOnce(
      gatewayResponse({
        result: { status, status_code: 100 },
        transaction: {
          tid: "15453500048018276",
          currency: "EUR",
          ...transaction,
        },
      }),
    );

  test("full capture stores Charge / Success, timestamp, comments and Paid", async () => {
    reply({ status: "CONFIRMED", amount: 799 });
    expect(
      (await run({ action: "capturePayment", amount: amount() })).outcome,
    ).toBe("approved");
    expect(ct.state.payment.transactions).toContainEqual(
      expect.objectContaining({
        type: "Charge",
        state: "Success",
        timestamp: expect.any(String),
      }),
    );
    expect(ct.state.order.paymentState).toBe("Paid");
    expect(ct.state.order.orderState).toBe("Open");
    const request = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
    expect(request).toEqual({
      transaction: { tid: "15453500048018276" },
      custom: expect.objectContaining({
        shop_invoked: "1",
        lang: "EN",
      }),
    });
  });
  test("cancel stores CancelAuthorization / Success and Failed without changing fulfillment", async () => {
    reply({ status: "DEACTIVATED", amount: 799 });
    expect((await run({ action: "cancelPayment" })).outcome).toBe("approved");
    expect(ct.state.payment.transactions[1]).toMatchObject({
      type: "CancelAuthorization",
      state: "Success",
    });
    expect(ct.state.order.paymentState).toBe("Failed");
    expect(ct.state.order.orderState).toBe("Open");
  });
  test.each([
    [undefined, "", "EN"],
    ["fr", "Novalnet Transaktions-ID: 123", "EN"],
    ["DE", "", "DE"],
    [undefined, "Novalnet Transaktions-ID: 123", "DE"],
  ])(
    "intent language %s with initial text %s uses %s",
    async (lang, comments, expected) => {
      ct.state.payment.custom = { fields: { lang } };
      ct.state.payment.transactions[0].custom.fields.transactionComments =
        comments;
      reply({ status: "DEACTIVATED", amount: 799 });
      await run({ action: "cancelPayment" });
      const payload = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
      expect(payload.custom.lang).toBe(expected);
    },
  );
  test.each([0, -1, 1.5, 800, Number.MAX_SAFE_INTEGER + 1])(
    "rejects capture amount %s without a PSP call",
    async (cents) => {
      await expect(
        run({ action: "capturePayment", amount: amount(cents) }),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  test("rejects currency mismatch", async () => {
    await expect(
      run({ action: "capturePayment", amount: amount(799, "USD") }),
    ).rejects.toThrow("Currency mismatch");
    expect(fetch).not.toHaveBeenCalled();
  });
  test("Pending authorization cannot be captured", async () => {
    ct.state.payment.transactions[0].state = "Pending";
    await expect(
      run({ action: "capturePayment", amount: amount() }),
    ).rejects.toThrow("Authorization cannot be captured");
  });
  test("regular refund uses the new refund TID and reference comment", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    reply({
      status: "CONFIRMED",
      refund: { tid: "15453500048019999", amount: 499, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(499) })).outcome,
    ).toBe("approved");
    expect(ct.state.payment.transactions[1]).toMatchObject({
      type: "Refund",
      interactionId: "15453500048019999",
      state: "Success",
      amount: amount(499),
    });
    expect(ct.state.order.custom.fields.paymentComments).toContain(
      "15453500048019999",
    );
  });
  test("pre-credit partial plus balance saves both comments and cancels only at DEACTIVATED", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")]; // SEPA may be charged in CT before cash receipt.
    reply({
      status: "PENDING",
      amount: 100,
      refund: { amount: 699, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(699) })).outcome,
    ).toBe("approved");
    const first =
      ct.state.payment.transactions[0].custom.fields.transactionComments;
    expect(first).toContain("6.99");
    expect(ct.state.order.custom.fields.paymentComments).toContain("6.99");
    expect(
      ct.state.payment.transactions.some(
        (tx: any) => tx.type === "CancelAuthorization",
      ),
    ).toBe(false);
    reply({
      status: "DEACTIVATED",
      amount: 100,
      refund: { amount: 100, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(100) })).outcome,
    ).toBe("approved");
    expect(ct.state.order.custom.fields.paymentComments).toContain("6.99");
    expect(ct.state.order.custom.fields.paymentComments).toContain("1.00");
    expect(
      ct.state.payment.transactions.filter((tx: any) => tx.type === "Refund"),
    ).toHaveLength(0);
    expect(ct.state.payment.transactions).toContainEqual(
      expect.objectContaining({
        type: "CancelAuthorization",
        state: "Success",
      }),
    );
    expect(ct.state.order.paymentState).toBe("Failed");
  });
  test("a pending pre-credit Authorization is refundable without inventing a Charge", async () => {
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Pending"),
    ];
    reply({
      status: "PENDING",
      amount: 300,
      refund: { amount: 499, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(499) })).outcome,
    ).toBe("approved");
    expect(ct.state.payment.transactions).toHaveLength(1);
    expect(ct.state.order.paymentState).toBe("Pending");
  });
  test("a malformed provider balance remains unresolved and cannot complete locally", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    reply({
      status: "PENDING",
      amount: 1,
      refund: { amount: 499, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(499) })).outcome,
    ).toBe("received");
    expect(ct.state.payment.transactions).toHaveLength(1);
    expect(
      ct.state.objects.get("nn-private-data/payment-a-psp-a").value
        .pendingModification,
    ).toBeDefined();
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("a failed PSP operation is rejected and does not add a successful transaction", async () => {
    reply({ status: "FAILURE" }, "FAILURE");
    expect((await run({ action: "cancelPayment" })).outcome).toBe("rejected");
    expect(ct.state.payment.transactions).toHaveLength(1);
  });
  test("unknown PSP state is received, not silently completed", async () => {
    reply({ status: "UNKNOWN" });
    expect((await run({ action: "cancelPayment" })).outcome).toBe("received");
    expect(ct.state.payment.transactions).toHaveLength(1);
  });
  test("reverse routes an uncaptured authorization to cancel", async () => {
    reply({ status: "DEACTIVATED" });
    await run({ action: "reversePayment" });
    expect((fetch as jest.Mock).mock.calls[0][0]).toContain(
      "/transaction/cancel",
    );
  });
  test("reverse routes a captured payment to refund", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    reply({
      status: "CONFIRMED",
      refund: { tid: "15453500048019999", amount: 799, currency: "EUR" },
    });
    await run({ action: "reversePayment" });
    expect((fetch as jest.Mock).mock.calls[0][0]).toContain(
      "/transaction/refund",
    );
  });
  test("an ambiguous network failure is not automatically retried against the PSP", async () => {
    expect((await run({ action: "cancelPayment" })).outcome).toBe("received");
    expect((await run({ action: "cancelPayment" })).outcome).toBe("received");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  test("concurrent requests cannot dispatch the same uncertain money movement twice", async () => {
    const results = await Promise.allSettled([
      run({ action: "cancelPayment" }),
      run({ action: "cancelPayment" }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      results.some(
        (result) =>
          result.status === "fulfilled" && result.value.outcome === "received",
      ),
    ).toBe(true);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason.statusCode).toBe(409);
  });
  test("requires exactly one intent action", async () => {
    await expect(
      executePaymentIntent(ct.ctPaymentService, "payment-a", { actions: [] }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  test("equal partial and final pre-credit Intent reductions preserve both refund comments", async () => {
    ct.state.payment.amountPlanned.centAmount = 400;
    ct.state.payment.transactions = [
      initialTransaction("Charge", "Success", 400),
    ];
    reply({
      status: "PENDING",
      amount: 200,
      refund: { amount: 200, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(200) })).outcome,
    ).toBe("approved");
    expect(
      ct.state.order.custom.fields.paymentComments.match(/2\.00/g),
    ).toHaveLength(1);
    reply({
      status: "DEACTIVATED",
      amount: 200,
      refund: { amount: 200, currency: "EUR" },
    });
    expect(
      (await run({ action: "refundPayment", amount: amount(200) })).outcome,
    ).toBe("approved");
    expect(
      ct.state.order.custom.fields.paymentComments.match(/2\.00/g),
    ).toHaveLength(2);
    expect(ct.state.order.paymentState).toBe("Failed");
    expect(
      ct.state.payment.transactions.filter(
        (tx: any) => tx.type === "CancelAuthorization",
      ),
    ).toHaveLength(1);
    expect(
      [...ct.state.objects.values()].every(
        (object: any) => object.container === "nn-private-data",
      ),
    ).toBe(true);
  });
  test("a completed action with the same merchant reference is not dispatched again", async () => {
    reply({ status: "CONFIRMED", amount: 799 });
    const action = {
      action: "capturePayment",
      amount: amount(),
      merchantReference: "capture-1",
    };
    expect((await run(action)).outcome).toBe("approved");
    expect((await run(action)).outcome).toBe("approved");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
