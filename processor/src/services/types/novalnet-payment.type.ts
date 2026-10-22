import { PaymentRequestSchemaDTO } from "../../dtos/novalnet-payment.dto";
import {
  CommercetoolsCartService,
  CommercetoolsPaymentService,
} from "@commercetools/connect-payments-sdk";
export type NovalnetPaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
};

export type CreatePaymentRequest = {
  data: PaymentRequestSchemaDTO;
  cartId?: string;
  customerIp?: string;
};
