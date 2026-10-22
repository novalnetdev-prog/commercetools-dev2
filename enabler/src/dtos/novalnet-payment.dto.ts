export enum PaymentOutcome {
  AUTHORIZED = 'Authorized',
  REJECTED = 'Rejected',
}


export type PaymentRequestSchemaDTO = {
  paymentMethod: {
    type: string;
    accHolder?: string;
    iban?: string;
    bic?: string;
    birthdate?: string;
    accountNumber?: string;
    routingNumber?: string;
    panHash?: string;
    uniqueId?: string;
    doRedirect?: string;
    returnUrl?: string;
  };
  paymentOutcome: PaymentOutcome;
  lang?: string;
  path?: string;
};
