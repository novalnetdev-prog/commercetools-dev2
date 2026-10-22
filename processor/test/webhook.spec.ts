import { createHash } from "node:crypto";
import { NovalnetPaymentService } from "../src/services/novalnet-payment.service";
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
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));
describe("webhook reconciliation", () => {
  let ct: ReturnType<typeof commerce>, service: NovalnetPaymentService;
  beforeEach(() => {
    ct = commerce();
    Object.assign(projectApiRoot, ct.api);
    seedReference(ct.state);
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Pending"),
    ];
    service = new NovalnetPaymentService(ct);
    jest.spyOn(Config, "getConfig").mockReturnValue({
      novalnetPrivateKey: "test-key",
      novalnetWebhookTestMode: "1",
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());
  function event(type: string, transaction: any = {}, result: any = {}) {
    const value: any = {
      custom: {
        "ctpayment-id": "payment-a",
        inputval1: "payment-a",
        pspReference: "psp-a",
        inputval2: "psp-a",
        lang: "en",
      },
      event: {
        type,
        tid: "15453500048018276",
        parent_tid: "15453500048018276",
      },
      merchant: { vendor: 4, project: 6120 },
      result: { status: "SUCCESS", ...result },
      transaction: {
        tid: "15453500048018276",
        payment_type: "DIRECT_DEBIT_SEPA",
        amount: 799,
        currency: "EUR",
        status: "CONFIRMED",
        status_code: 100,
        ...transaction,
      },
    };
    value.event.checksum = createHash("sha256")
      .update(
        `${value.event.tid}${type}${value.result.status}${value.transaction.amount}${value.transaction.currency}yek-tset`,
      )
      .digest("hex");
    return value;
  }
  test("rejects a tampered checksum before writing a Payment", async () => {
    const payload = event("PAYMENT");
    payload.transaction.amount = 800;
    await expect(service.createWebhook([payload])).rejects.toThrow(
      "Checksum validation failed",
    );
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("ON_HOLD authorizes successfully without charging, and updates initial Order comments", async () => {
    await service.createWebhook([event("PAYMENT", { status: "ON_HOLD" })]);
    expect(ct.state.payment.transactions[0].state).toBe("Success");
    expect(
      ct.state.payment.transactions.some((tx: any) => tx.type === "Charge"),
    ).toBe(false);
    expect(ct.state.order.paymentState).toBe("Pending");
    expect(ct.state.order.custom.fields.paymentComments).toContain(
      "15453500048018276",
    );
  });
  test("initial FAILURE reconciles its status text even after a communication failure", async () => {
    await service.createWebhook([
      event(
        "PAYMENT",
        { status: "FAILURE" },
        { status: "FAILURE", status_text: "Provider decline" },
      ),
    ]);
    expect(ct.state.payment.transactions[0].state).toBe("Failure");
    expect(ct.state.order.paymentState).toBe("Failed");
    expect(ct.state.order.custom.fields.paymentComments).toContain(
      "Provider decline",
    );
  });
  test("replayed initial webhook does not repeat comments or Charge", async () => {
    const value = event("PAYMENT");
    await service.createWebhook([value]);
    await service.createWebhook([value]);
    expect(
      ct.state.payment.transactions.filter((tx: any) => tx.type === "Charge"),
    ).toHaveLength(1);
    expect(
      ct.state.order.custom.fields.paymentComments.match(
        /Novalnet Transaction ID/g,
      ),
    ).toHaveLength(1);
  });
  test("an Order Type permission outage is retried rather than acknowledged with missing comments", async () => {
    jest.mocked(projectApiRoot.types).mockImplementationOnce((() => ({
      withKey: () => ({
        get: () => ({
          execute: async () => {
            throw Object.assign(new Error("Permission unavailable"), {
              statusCode: 403,
            });
          },
        }),
      }),
    })) as any);
    const payload = event("PAYMENT");
    await expect(service.createWebhook([payload])).rejects.toMatchObject({
      statusCode: 403,
    });
    await service.createWebhook([payload]);
    expect(ct.state.order.custom.fields.paymentComments).toContain(
      "15453500048018276",
    );
    expect(
      ct.state.payment.transactions.filter((tx: any) => tx.type === "Charge"),
    ).toHaveLength(1);
  });
  test.each(["CANCELLED", "DEACTIVATED"])(
    "initial %s adds successful cancellation",
    async (status) => {
      await service.createWebhook([event("PAYMENT", { status })]);
      expect(ct.state.payment.transactions).toContainEqual(
        expect.objectContaining({
          type: "CancelAuthorization",
          state: "Success",
        }),
      );
      expect(ct.state.order.paymentState).toBe("Failed");
      expect(ct.state.order.orderState).toBe("Open");
    },
  );
  test("a SEPA CT Charge does not block partial pre-credit refund and its balance credit", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    const payload = event("TRANSACTION_REFUND", {
      status: "PENDING",
      amount: 300,
      refund: { amount: 499, currency: "EUR" },
    });
    await service.createWebhook([payload]);
    await service.createWebhook([payload]);
    expect(
      ct.state.order.custom.fields.paymentComments.match(/4.99/g),
    ).toHaveLength(1);
    expect(ct.state.order.paymentState).toBe("Pending");
    const credit = event("CREDIT", { amount: 300 });
    credit.event.tid = "15453500048019999";
    credit.event.checksum = createHash("sha256")
      .update(`${credit.event.tid}CREDITSUCCESS300EURyek-tset`)
      .digest("hex");
    await service.createWebhook([credit]);
    await service.createWebhook([credit]);
    expect(ct.state.order.paymentState).toBe("Paid");
    expect(
      ct.state.objects.get("nn-private-data/payment-a-psp-a").value
        .creditedAmount,
    ).toBe(300);
  });
  test("full pre-credit refund cancels and keeps refund wording without a new TID", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    await service.createWebhook([
      event("TRANSACTION_REFUND", {
        status: "DEACTIVATED",
        refund: { amount: 799, currency: "EUR" },
      }),
    ]);
    expect(
      ct.state.payment.transactions.some((tx: any) => tx.type === "Refund"),
    ).toBe(false);
    expect(ct.state.payment.transactions).toContainEqual(
      expect.objectContaining({
        type: "CancelAuthorization",
        state: "Success",
      }),
    );
    expect(ct.state.order.custom.fields.paymentComments).toContain("7.99");
    expect(ct.state.order.paymentState).toBe("Failed");
  });
  test.each([
    "PAYMENT_REMINDER_1",
    "PAYMENT_REMINDER_2",
    "SUBMISSION_TO_COLLECTION_AGENCY",
  ])("%s only writes comments", async (type) => {
    const before = ct.state.payment.transactions[0].state;
    await service.createWebhook([event(type)]);
    expect(ct.state.payment.transactions).toHaveLength(1);
    expect(ct.state.payment.transactions[0].state).toBe(before);
    expect(ct.state.order.orderState).toBe("Open");
  });
  test.each(["CONFIRMED", "ON_HOLD", "PENDING", "FAILURE"])(
    "a missing direct response is recovered by initial %s",
    async (status) => {
      ct.state.payment.interfaceId = "psp-a";
      ct.state.payment.transactions = [];
      ct.state.objects.clear();
      if (status === "FAILURE") ct.state.order = null;
      const payload = event(
        "PAYMENT",
        { status },
        status === "FAILURE"
          ? { status: "FAILURE", status_text: "Declined" }
          : {},
      );
      jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        gatewayResponse({
          custom: payload.custom,
          transaction: payload.transaction,
          result: payload.result,
        }),
      );
      await service.createWebhook([payload]);
      expect(ct.state.payment.transactions).toHaveLength(1);
      expect(
        ct.state.objects.get("nn-private-data/payment-a-psp-a").value.tid,
      ).toBe("15453500048018276");
      expect(ct.state.payment.transactions[0].state).toBe(
        status === "FAILURE"
          ? "Failure"
          : status === "PENDING"
            ? "Pending"
            : "Success",
      );
      expect(ct.state.payment.transactions[0].type).toBe(
        status === "CONFIRMED" ? "Charge" : "Authorization",
      );
    },
  );
  test("a missing initial transaction with wrong correlation is rejected for retry", async () => {
    ct.state.payment.interfaceId = "another-psp";
    ct.state.payment.transactions = [];
    await expect(service.createWebhook([event("PAYMENT")])).rejects.toThrow(
      "correlation",
    );
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("a replayed chargeback does not repeat the financial row or comments", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    const payload = event("CHARGEBACK");
    await service.createWebhook([payload]);
    await service.createWebhook([payload]);
    expect(
      ct.state.payment.transactions.filter(
        (tx: any) => tx.type === "Chargeback",
      ),
    ).toHaveLength(1);
    const comments =
      ct.state.payment.transactions[0].custom.fields.transactionComments;
    const expected = (service as any).buildTransactionComments(payload, "en");
    expect(comments.split(expected)).toHaveLength(2);
  });
  test("shop_invoked keeps the existing skip policy", async () => {
    const value = event("TRANSACTION_REFUND");
    value.custom.shop_invoked = "1";
    expect((await service.createWebhook([value])).message).toContain(
      "Already handled",
    );
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("a late initial ON_HOLD cannot undo a captured Payment or its Order state", async () => {
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Success"),
    ];
    await service.createWebhook([event("TRANSACTION_CAPTURE")]);
    const captured = ct.state.payment.transactions.find(
      (tx: any) => tx.type === "Charge",
    );
    await service.createWebhook([event("PAYMENT", { status: "ON_HOLD" })]);
    expect(ct.state.order.paymentState).toBe("Paid");
    expect(captured.state).toBe("Success");
    expect(
      ct.state.payment.transactions.filter((tx: any) => tx.type === "Charge"),
    ).toHaveLength(1);
  });
  test("initial reconciliation cannot add a second Charge when the interface code write was lost", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    ct.state.payment.paymentStatus = { interfaceCode: "" };
    await service.createWebhook([event("PAYMENT")]);
    expect(
      ct.state.payment.transactions.filter((tx: any) => tx.type === "Charge"),
    ).toHaveLength(1);
    expect(ct.state.order.paymentState).toBe("Paid");
  });
  test("a stale initial event after a partial reduction keeps Pending and the refund reference", async () => {
    ct.state.payment.transactions = [initialTransaction("Charge")];
    await service.createWebhook([
      event("TRANSACTION_REFUND", {
        status: "PENDING",
        amount: 599,
        refund: { amount: 200, currency: "EUR" },
      }),
    ]);
    await service.createWebhook([event("PAYMENT")]);
    expect(ct.state.order.paymentState).toBe("Pending");
    expect(ct.state.order.custom.fields.paymentComments).toContain("2.00");
  });
  test("equal admin partial and final balance reductions keep both existing refund texts", async () => {
    ct.state.payment.amountPlanned.centAmount = 400;
    ct.state.payment.transactions = [
      initialTransaction("Charge", "Success", 400),
    ];
    await service.createWebhook([
      event("TRANSACTION_REFUND", {
        status: "PENDING",
        amount: 200,
        refund: { amount: 200, currency: "EUR" },
      }),
    ]);
    const final = event("TRANSACTION_REFUND", {
      status: "DEACTIVATED",
      amount: 200,
      refund: { amount: 200, currency: "EUR" },
    });
    await service.createWebhook([final]);
    await service.createWebhook([final]);
    expect(
      ct.state.order.custom.fields.paymentComments.match(/2\.00/g),
    ).toHaveLength(2);
    expect(
      ct.state.payment.transactions.filter(
        (tx: any) => tx.type === "CancelAuthorization",
      ),
    ).toHaveLength(1);
    expect(ct.state.order.paymentState).toBe("Failed");
  });
  test("a signed payload cannot be rebound to another saved provider TID", async () => {
    const payload = event("TRANSACTION_CAPTURE");
    payload.event.parent_tid = "15453500048019999";
    await expect(service.createWebhook([payload])).rejects.toThrow(
      "TID does not match",
    );
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("a missing initial reference requires PSP details that match the Payment", async () => {
    ct.state.payment.interfaceId = "psp-a";
    ct.state.payment.transactions = [];
    ct.state.objects.clear();
    const payload = event("PAYMENT");
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      gatewayResponse({
        custom: { inputval1: "different-payment", inputval2: "psp-a" },
        transaction: payload.transaction,
        result: payload.result,
      }),
    );
    await expect(service.createWebhook([payload])).rejects.toThrow(
      "details do not match",
    );
    expect(ct.state.paymentWrites).toHaveLength(0);
  });
  test("a captured Order with other Payments keeps its aggregate payment state", async () => {
    ct.state.order.paymentInfo = {
      payments: [{ id: "payment-a" }, { id: "other-payment" }],
    };
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Success"),
    ];
    await service.createWebhook([event("TRANSACTION_CAPTURE")]);
    expect(
      ct.state.payment.transactions.some((tx: any) => tx.type === "Charge"),
    ).toBe(true);
    expect(ct.state.order.paymentState).toBe("Pending");
  });
});
