import { Static, Type } from "@sinclair/typebox";

export enum PaymentOutcome {
  AUTHORIZED = "Authorized",
  REJECTED = "Rejected",
}

export enum PaymentMethodType {
  INVOICE = "Invoice",
  PREPAYMENT = "Prepayment",
  GUARANTEED_INVOICE = "Invoice with payment guarantee",
  GUARANTEED_SEPA = "Direct Debit SEPA with payment guarantee",
  IDEAL = "iDEAL | Wero",
  PAYPAL = "PayPal",
  ONLINE_BANK_TRANSFER = "Online bank transfer",
  ALIPAY = "Alipay",
  BANCONTACT = "Bancontact",
  BLIK = "Blik",
  EPS = "eps",
  MBWAY = "MB Way",
  MULTIBANCO = "Multibanco",
  POSTFINANCE = "PostFinance E-Finance",
  POSTFINANCE_CARD = "PostFinance Card",
  PRZELEWY24 = "Przelewy24",
  TRUSTLY = "Trustly",
  TWINT = "TWINT",
  WECHATPAY = "WeChat Pay",
  SEPA = "Direct Debit SEPA",
  ACH = "Direct Debit ACH",
  CREDITCARD = "Credit/Debit Cards",
  PIX = "Pix",
  BOLETO = "Boleto",
  BIZUM = "Bizum",
  BANCOMATPAY = "BANCOMAT Pay",
  KAKAOPAY = "KakaoPay",
  NAVERPAY = "Naver Pay",
}
export const PaymentResponseSchema = Type.Object({
  paymentReference: Type.String(),
  txnSecret: Type.Optional(Type.String()),
  transactionStatus: Type.Optional(Type.String()),
  transactionStatusText: Type.Optional(Type.String()),
});

export const PaymentOutcomeSchema = Type.Enum(PaymentOutcome);

export const PaymentRequestSchema = Type.Object({
  paymentMethod: Type.Object({
    type: Type.String(),
    accHolder: Type.Optional(Type.String()),
    birthdate: Type.Optional(Type.String()),
    iban: Type.Optional(Type.String()),
    bic: Type.Optional(Type.String()),
    accountNumber: Type.Optional(Type.String()),
    routingNumber: Type.Optional(Type.String()),
    panHash: Type.Optional(Type.String()),
    uniqueId: Type.Optional(Type.String()),
    doRedirect: Type.Optional(Type.String()),
    returnUrl: Type.Optional(Type.String()),
  }),
  paymentOutcome: PaymentOutcomeSchema,
  lang: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
});

export type PaymentRequestSchemaDTO = Static<typeof PaymentRequestSchema>;
export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;
