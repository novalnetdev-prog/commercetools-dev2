import { Static, Type } from "@sinclair/typebox";

export const AmountSchema = Type.Object({
  centAmount: Type.Integer({
    description: "Amount in the smallest currency unit.",
  }),
  currencyCode: Type.String({
    description: "ISO 4217 currency code.",
  }),
});

export const ActionCapturePaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal("capturePayment"),
  }),
  Type.Object({
    amount: AmountSchema,
    merchantReference: Type.Optional(Type.String()),
  }),
]);

export const ActionRefundPaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal("refundPayment"),
  }),
  Type.Object({
    amount: AmountSchema,
    transactionId: Type.Optional(Type.String()),
    merchantReference: Type.Optional(Type.String()),
  }),
]);

export const ActionCancelPaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal("cancelPayment"),
    merchantReference: Type.Optional(Type.String()),
  }),
]);

export const ActionReversePaymentSchema = Type.Composite([
  Type.Object({
    action: Type.Literal("reversePayment"),
    merchantReference: Type.Optional(Type.String()),
  }),
]);

export const PaymentIntentRequestSchema = Type.Object({
  actions: Type.Array(
    Type.Union([
      ActionCapturePaymentSchema,
      ActionRefundPaymentSchema,
      ActionCancelPaymentSchema,
      ActionReversePaymentSchema,
    ]),
    {
      minItems: 1,
      maxItems: 1,
    },
  ),
});

export enum PaymentModificationStatus {
  APPROVED = "approved",
  REJECTED = "rejected",
  RECEIVED = "received",
}

const PaymentModificationSchema = Type.Enum(PaymentModificationStatus);

export const PaymentIntentResponseSchema = Type.Object({
  outcome: PaymentModificationSchema,
  paymentReference: Type.Optional(Type.String()),
});

export type PaymentIntentRequestSchemaDTO = Static<
  typeof PaymentIntentRequestSchema
>;

export type PaymentIntentResponseSchemaDTO = Static<
  typeof PaymentIntentResponseSchema
>;

export type AmountSchemaDTO = Static<typeof AmountSchema>;
