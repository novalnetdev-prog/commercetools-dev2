import { createTransactionCommentsType } from "../src/utils/custom-fields";
import { projectApiRoot } from "../src/utils/ct-client";
jest.mock("../src/utils/ct-client", () => ({
  projectApiRoot: { types: jest.fn() },
}));
jest.mock("../src/libs/logger", () => ({ log: { info: jest.fn() } }));
describe("Custom Type initialization", () => {
  const valid = {
    resourceTypeIds: ["transaction"],
    fieldDefinitions: [
      { name: "transactionComments", type: { name: "String" } },
    ],
  };
  let read: jest.Mock, create: jest.Mock;
  beforeEach(() => {
    read = jest.fn().mockResolvedValue({ body: valid });
    create = jest.fn().mockResolvedValue({ body: valid });
    (projectApiRoot.types as jest.Mock).mockReturnValue({
      withKey: () => ({ get: () => ({ execute: read }) }),
      post: () => ({ execute: create }),
    });
  });
  test("uses a compatible existing Type", async () => {
    await createTransactionCommentsType();
    expect(create).not.toHaveBeenCalled();
  });
  test("creates an absent Type", async () => {
    read.mockRejectedValueOnce({ statusCode: 404 });
    await createTransactionCommentsType();
    expect(create).toHaveBeenCalledTimes(1);
  });
  test.each([401, 403, 500])(
    "does not create a Type after HTTP %s",
    async (statusCode) => {
      read.mockRejectedValueOnce({ statusCode });
      await expect(createTransactionCommentsType()).rejects.toMatchObject({
        statusCode,
      });
      expect(create).not.toHaveBeenCalled();
    },
  );
  test("rechecks a Type created concurrently", async () => {
    read.mockRejectedValueOnce({ statusCode: 404 });
    create.mockRejectedValueOnce({ statusCode: 409 });
    await createTransactionCommentsType();
    expect(read).toHaveBeenCalledTimes(2);
  });
  test("does not overwrite an incompatible merchant Custom Type", async () => {
    read.mockResolvedValueOnce({ body: { ...valid, fieldDefinitions: [] } });
    await expect(createTransactionCommentsType()).rejects.toThrow(
      "String field transactionComments",
    );
    expect(create).not.toHaveBeenCalled();
  });
});
