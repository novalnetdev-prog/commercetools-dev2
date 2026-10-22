import { ConfigResponseSchemaDTO } from "../../dtos/operations/config.dto";
import { PaymentIntentRequestSchemaDTO } from "../../dtos/operations/payment-intents.dto";
import { StatusResponseSchemaDTO } from "../../dtos/operations/status.dto";
export type ConfigResponse = ConfigResponseSchemaDTO;

export type StatusResponse = StatusResponseSchemaDTO;

export type ModifyPayment = {
  paymentId: string;
  data: PaymentIntentRequestSchemaDTO;
};
