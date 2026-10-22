import { paymentSDK } from "../payment-sdk";
import { NovalnetPaymentService } from "../services/novalnet-payment.service";

const paymentService = new NovalnetPaymentService({
  ctCartService: paymentSDK.ctCartService,
  ctPaymentService: paymentSDK.ctPaymentService,
});

export const app = {
  services: {
    paymentService,
  },
};
