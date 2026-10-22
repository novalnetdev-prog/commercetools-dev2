import { Type, TypeDraft } from "@commercetools/platform-sdk";
import { projectApiRoot } from "./ct-client";
import { log } from "../libs/logger";

function validateType(existing: Type, draft: TypeDraft): void {
  const field = draft.fieldDefinitions![0];
  const actual = existing.fieldDefinitions.find(
    (entry) => entry.name === field.name,
  );
  if (
    !draft.resourceTypeIds.every((resource) =>
      existing.resourceTypeIds.includes(resource),
    ) ||
    actual?.type.name !== "String"
  ) {
    throw new Error(
      `Custom Type ${draft.key} must support ${draft.resourceTypeIds.join(", ")} with String field ${field.name}`,
    );
  }
}

async function ensureType(draft: TypeDraft): Promise<void> {
  const resource = projectApiRoot.types().withKey({ key: draft.key! });
  try {
    validateType((await resource.get().execute()).body, draft);
    return;
  } catch (error: any) {
    // Permission and network failures do not mean the Type is absent.
    if (error?.statusCode !== 404) throw error;
  }
  try {
    validateType(
      (await projectApiRoot.types().post({ body: draft }).execute()).body,
      draft,
    );
    log.info("[custom-types] Type created", { typeKey: draft.key });
  } catch (error: any) {
    const duplicate =
      error?.statusCode === 409 ||
      error?.body?.errors?.some(
        (entry: any) => entry.code === "DuplicateField",
      );
    if (!duplicate) throw error;
    // Another processor can create the same Type during deployment/scaling.
    validateType((await resource.get().execute()).body, draft);
  }
}

export const createTransactionCommentsType = () =>
  ensureType({
    key: "novalnet-custom-field",
    name: { en: "Novalnet Transaction Comments" },
    resourceTypeIds: ["transaction"],
    fieldDefinitions: [
      {
        name: "transactionComments",
        label: { en: "Transaction Comments" },
        type: { name: "String" },
        required: false,
      },
    ],
  });

export const createOrderPaymentCommentsType = () =>
  ensureType({
    key: "order-payment-comments",
    name: { en: "Order Payment Comments" },
    resourceTypeIds: ["order"],
    fieldDefinitions: [
      {
        name: "paymentComments",
        label: { en: "Payment Comments" },
        type: { name: "String" },
        required: false,
      },
    ],
  });

export const initCustomTypes = async () => {
  await createTransactionCommentsType();
  await createOrderPaymentCommentsType();
};
