import customObjects from "../src/services/ct-custom-object.service";
import { projectApiRoot } from "../src/utils/ct-client";
import { commerce, seedReference } from "./helpers/commerce";
jest.mock("../src/utils/ct-client", () => ({ projectApiRoot: {} }));
jest.mock("../src/libs/logger", () => ({ log: { warn: jest.fn() } }));
describe("versioned existing private-data storage", () => {
  let ct: ReturnType<typeof commerce>;
  beforeEach(() => {
    ct = commerce();
    Object.assign(projectApiRoot, ct.api);
  });
  afterEach(() => jest.useRealTimers());
  test("concurrent counter updates recompute from the committed value", async () => {
    await Promise.all(
      [1, 2, 3].map(() =>
        customObjects.update("test", "counter", (value) => ({
          count: (value.count ?? 0) + 1,
        })),
      ),
    );
    expect(ct.state.objects.get("test/counter").value.count).toBe(3);
  });
  test("a stale initial write cannot erase follow-up metadata", async () => {
    seedReference(ct.state, {
      creditedAmount: 100,
      preCreditRefundedAmount: 200,
      preCreditRemainingAmount: 599,
      creditEvents: { "111": 100 },
    });
    await customObjects.upsert("nn-private-data", "payment-a-psp-a", {
      paymentMethod: "INVOICE",
      creditedAmount: 0,
      preCreditRefundedAmount: 0,
      creditEvents: {},
      additionalInfo: { comments: "Initial reference" },
    });
    expect(
      ct.state.objects.get("nn-private-data/payment-a-psp-a").value,
    ).toMatchObject({
      creditedAmount: 100,
      preCreditRefundedAmount: 200,
      preCreditRemainingAmount: 599,
      creditEvents: { "111": 100 },
    });
  });
  test("permission or network errors are not retried as conflicts", async () => {
    ct.objectWrite.mockImplementationOnce(() => ({
      execute: async () => {
        throw Object.assign(new Error("Denied"), { statusCode: 403 });
      },
    }));
    await expect(
      customObjects.update("test", "key", () => ({ value: 1 })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(ct.objectWrite).toHaveBeenCalledTimes(1);
  });
  test("a late webhook merge cannot resurrect a finished operation or erase its result", async () => {
    seedReference(ct.state, {
      modificationResults: { current: { outcome: "approved" } },
    });
    await customObjects.upsert("nn-private-data", "payment-a-psp-a", {
      pendingModification: { owner: "old-request" },
      modificationResults: {},
      status: "CONFIRMED",
    });
    const value = ct.state.objects.get("nn-private-data/payment-a-psp-a").value;
    expect(value.pendingModification).toBeUndefined();
    expect(value.modificationResults.current.outcome).toBe("approved");
  });
});
