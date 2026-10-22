import { FastifyInstance } from "fastify";
import { paymentSDK } from "../../payment-sdk";
import { paymentRoutes } from "../../routes/novalnet-payment.route";
import { NovalnetPaymentService } from "../../services/novalnet-payment.service";

export default async function (server: FastifyInstance) {
  const novalnetPaymentService = new NovalnetPaymentService({
    ctCartService: paymentSDK.ctCartService,
    ctPaymentService: paymentSDK.ctPaymentService,
  });

  await server.register(paymentRoutes, {
    paymentService: novalnetPaymentService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
  });
}
