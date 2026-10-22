import { RedirectPaymentErrorService } from "../src/services/redirect-payment-error.service";
import { projectApiRoot } from "../src/utils/ct-client";
import { commerce, initialTransaction } from "./helpers/commerce";
jest.mock("../src/utils/ct-client", () => ({ projectApiRoot: {} }));
describe("cart-scoped return error notifications", () => {
  let ct: ReturnType<typeof commerce>, service: RedirectPaymentErrorService;
  beforeEach(() => {
    ct = commerce();
    Object.assign(projectApiRoot, ct.api);
    service = new RedirectPaymentErrorService();
    ct.state.payment.transactions = [
      initialTransaction("Authorization", "Failure"),
    ];
  });
  test("a dropped read response remains readable until the browser acknowledges display", async () => {
    await service.record("payment-a", "psp-a", "Zahlung abgebrochen");
    const first = await service.read("cart-a");
    expect(first?.transactionStatusText).toBe("Zahlung abgebrochen");
    expect(await service.read("cart-a")).toEqual(first);
    await service.acknowledge("cart-a", first!.noticeId);
    expect(await service.read("cart-a")).toBeUndefined();
  });
  test("another cart cannot read or acknowledge this notice", async () => {
    await service.record("payment-a", "psp-a", "Declined");
    const first = await service.read("cart-a");
    expect(await service.read("cart-other")).toBeUndefined();
    await service.acknowledge("cart-other", first!.noticeId);
    expect(await service.read("cart-a")).toEqual(first);
  });
  test("a stale acknowledgement cannot erase a newer notice", async () => {
    await service.record("payment-a", "psp-a", "Declined");
    await service.acknowledge("cart-a", "wrong-id");
    expect(await service.read("cart-a")).toBeDefined();
  });
  test("repeated failure return does not re-arm an acknowledged notice", async () => {
    await service.record("payment-a", "psp-a", "Declined");
    const first = await service.read("cart-a");
    await service.acknowledge("cart-a", first!.noticeId);
    await service.record("payment-a", "psp-a", "Declined");
    expect(await service.read("cart-a")).toBeUndefined();
  });
  test("expired notices are removed without being displayed", async () => {
    await service.record("payment-a", "psp-a", "Declined");
    ct.state.objects.get("novalnet-redirect-errors/cart-a").value.expiresAt = 0;
    expect(await service.read("cart-a")).toBeUndefined();
    expect(ct.state.objects.has("novalnet-redirect-errors/cart-a")).toBe(false);
  });
  test.each(["successful", "wrong-reference", "no-cart"])(
    "does not record %s",
    async (scenario) => {
      if (scenario === "successful")
        ct.state.payment.transactions[0].state = "Success";
      if (scenario === "no-cart") ct.state.cart = null;
      await service.record(
        "payment-a",
        scenario === "wrong-reference" ? "wrong" : "psp-a",
        "Declined",
      );
      expect(await service.read("cart-a")).toBeUndefined();
    },
  );
});
