import {
  CommercetoolsCartService,
  CommercetoolsPaymentService,
} from "@commercetools/connect-payments-sdk";

import {
  ConfigResponse,
  ModifyPayment,
  StatusResponse,
} from "./types/operation.type";

import { SupportedPaymentComponentsSchemaDTO } from "../dtos/operations/payment-componets.dto";
import { PaymentIntentResponseSchemaDTO } from "../dtos/operations/payment-intents.dto";

import { executePaymentIntent } from "./payment-intent.service";

export abstract class AbstractPaymentService {
  protected ctCartService: CommercetoolsCartService;
  protected ctPaymentService: CommercetoolsPaymentService;

  protected constructor(
    ctCartService: CommercetoolsCartService,
    ctPaymentService: CommercetoolsPaymentService,
  ) {
    this.ctCartService = ctCartService;
    this.ctPaymentService = ctPaymentService;
  }

  /**
   * Get configurations
   *
   * @remarks
   * Abstract method to get configuration information
   *
   * @returns Promise with object containing configuration information
   */
  abstract config(): Promise<ConfigResponse>;

  /**
   * Get status
   *
   * @remarks
   * Abstract method to get status of external systems
   *
   * @returns Promise with a list of status from different external systems
   */
  abstract status(): Promise<StatusResponse>;

  /**
   * Get supported payment components
   *
   * @remarks
   * Abstract method to fetch the supported payment components by the processor. The actual invocation should be implemented in subclasses
   *
   * @returns Promise with a list of supported payment components
   */
  abstract getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO>;

  /**
   * Modify payment
   *
   * @remarks
   * This method is used to execute Capture/Cancel/Refund payment in external PSPs and update composable commerce. The actual invocation to PSPs should be implemented in subclasses
   *
   * @param opts - input for payment modification including payment ID, action and payment amount
   * @returns Promise with outcome of payment modification after invocation to PSPs
   */
  public async modifyPayment(
    opts: ModifyPayment,
  ): Promise<PaymentIntentResponseSchemaDTO> {
    return executePaymentIntent(
      this.ctPaymentService,
      opts.paymentId,
      opts.data,
    );
  }
}
