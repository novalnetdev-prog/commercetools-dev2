import { mapNovalnetOrderStates } from "../src/services/novalnet-order-state.service";

describe("Novalnet financial Order state mapping", () => {
  test.each([
    ["ON_HOLD", "Pending"],
    ["PENDING", "Pending"],
    ["CONFIRMED", "Paid"],
    ["FAILURE", "Failed"],
  ])("%s maps to paymentState %s", (status, paymentState) => {
    expect(mapNovalnetOrderStates({ status })?.paymentState).toBe(paymentState);
  });

  test("partial capture leaves a balance due", () => {
    expect(
      mapNovalnetOrderStates({
        eventType: "TRANSACTION_CAPTURE",
        status: "CONFIRMED",
        isPartialCapture: true,
      })?.paymentState,
    ).toBe("BalanceDue");
  });

  test("a full capture clears the balance due", () => {
    expect(
      mapNovalnetOrderStates({
        eventType: "TRANSACTION_CAPTURE",
        status: "CONFIRMED",
        isPartialCapture: false,
      }),
    ).toEqual({ paymentState: "Paid" });
  });

  test("a confirmed transaction update after a partial capture keeps a balance due", () => {
    expect(
      mapNovalnetOrderStates({
        eventType: "TRANSACTION_UPDATE",
        status: "CONFIRMED",
        isPartialCapture: true,
      }),
    ).toEqual({ paymentState: "BalanceDue" });
  });

  test("cumulative credits only become paid at the full amount", () => {
    expect(
      mapNovalnetOrderStates({ eventType: "CREDIT", isPartialCredit: true }),
    ).toEqual({ paymentState: "BalanceDue" });
    expect(
      mapNovalnetOrderStates({ eventType: "CREDIT", isPartialCredit: false }),
    ).toEqual({ paymentState: "Paid" });
  });

  test("partial and full refunds preserve Order paymentState", () => {
    expect(
      mapNovalnetOrderStates({
        eventType: "TRANSACTION_REFUND",
        status: "CONFIRMED",
      }),
    ).toBeNull();
  });

  test("cancel is a single authorization cancellation", () => {
    expect(
      mapNovalnetOrderStates({
        eventType: "TRANSACTION_CANCEL",
        status: "DEACTIVATED",
      }),
    ).toEqual({ paymentState: "Failed" });
    expect(
      mapNovalnetOrderStates({
        eventType: "TRANSACTION_CANCEL",
        status: "ON_HOLD",
      }),
    ).toBeNull();
  });

  test("chargebacks leave Order paymentState to the merchant policy", () => {
    expect(
      mapNovalnetOrderStates({
        eventType: "CHARGEBACK",
        isPartialChargeback: true,
      }),
    ).toBeNull();
    expect(mapNovalnetOrderStates({ eventType: "CHARGEBACK" })).toBeNull();
  });

  test("financial events never set fulfillment orderState", () => {
    expect(mapNovalnetOrderStates({ status: "CONFIRMED" })).toEqual({
      paymentState: "Paid",
    });
  });
});
