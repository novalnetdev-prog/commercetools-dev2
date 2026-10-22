import { SessionHeaderAuthenticationHook } from "@commercetools/connect-payments-sdk";
import { getOrderIdFromOrderNumber } from "../services/order.service";
import {
  FastifyInstance,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { getCartIdFromContext } from "../libs/fastify/context/context";
import crypto from "crypto";
import {
  PaymentRequestSchema,
  PaymentRequestSchemaDTO,
  PaymentResponseSchema,
  PaymentResponseSchemaDTO,
} from "../dtos/novalnet-payment.dto";
import {
  CheckoutPaymentError,
  NovalnetPaymentService,
} from "../services/novalnet-payment.service";
import { log } from "../libs/logger";
import { getConfig } from "../config/config";
import { Buffer } from "node:buffer";
import JSONbig from "json-bigint";
import { isIP } from "node:net";
import { Type } from "@sinclair/typebox";
import { webhookCallerIp } from "../utils/webhook-ip";
import redirectPaymentErrorService from "../services/redirect-payment-error.service";
import {
  returnErrorMessage,
  validReturnParameters,
  verifiedFailureReturn,
} from "../utils/redirect-return";

type PaymentRoutesOptions = {
  paymentService: NovalnetPaymentService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};
function customerIpFromRequest(request: FastifyRequest): string | undefined {
  const ip = webhookCallerIp(request.ip, request.headers["x-forwarded-for"]);
  return isIP(ip) ? ip : undefined;
}

export const paymentRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & PaymentRoutesOptions,
) => {
  fastify.post<{
    Body: PaymentRequestSchemaDTO;
    Reply: PaymentResponseSchemaDTO;
  }>(
    "/directPayment",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: PaymentRequestSchema,
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        log.info("Direct payment request received", {
          paymentMethod: request.body?.paymentMethod?.type,
          paymentOutcome: request.body?.paymentOutcome,
        });

        const resp = await opts.paymentService.createDirectPayment({
          data: request.body,
          customerIp: customerIpFromRequest(request),
        });

        log.info("Direct payment response", {
          transactionStatus: resp?.transactionStatus,
          paymentReference: resp?.paymentReference,
        });

        if (resp?.transactionStatus === "FAILURE") {
          log.error("Direct payment failed", {
            transactionStatus: resp?.transactionStatus,
            transactionStatusText: resp?.transactionStatusText,
          });

          return reply.code(200).send(resp);
        }

        return reply.code(200).send(resp);
      } catch (error) {
        log.error("Direct payment processing error", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });

        return reply
          .code(error instanceof CheckoutPaymentError ? 200 : 500)
          .send({
            paymentReference: "",
            transactionStatus: "FAILURE",
            transactionStatusText:
              error instanceof CheckoutPaymentError
                ? error.message
                : "Payment processing failed",
          });
      }
    },
  );

  fastify.post<{
    Body: PaymentRequestSchemaDTO;
    Reply: PaymentResponseSchemaDTO;
  }>(
    "/redirectPayment",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],

      schema: {
        body: PaymentRequestSchema,
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        log.info("Redirect payment request received", {
          paymentMethod: request.body?.paymentMethod?.type,
          paymentOutcome: request.body?.paymentOutcome,
        });
        const resp = await opts.paymentService.createRedirectPayment({
          data: request.body,
          customerIp: customerIpFromRequest(request),
        });
        log.info("Redirect payment response", {
          transactionStatus: resp?.transactionStatus,
          paymentReference: resp?.paymentReference,
        });
        return reply.status(200).send(resp);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        log.error("Error details:", {
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : undefined,
        });
        return reply
          .status(error instanceof CheckoutPaymentError ? 200 : 500)
          .send({
            paymentReference: "",
            transactionStatus: "FAILURE",
            transactionStatusText:
              error instanceof CheckoutPaymentError
                ? error.message
                : "Payment initialization failed",
          });
      }
    },
  );

  fastify.get("/success", async (request, reply) => {
    const query = request.query as {
      tid?: string;
      status?: string;
      checksum?: string;
      txn_secret?: string;
      paymentReference?: string;
      ctsid?: string;
      orderNumber?: string;
      ctPaymentID?: string;
      pspReference?: string;
      lang?: string;
      path?: string;
      nnReturnToken?: string;
    };

    if (!validReturnParameters(query))
      return reply.code(400).send("Invalid payment return parameters");

    const accessKey = String(getConfig()?.novalnetPrivateKey ?? "");
    const reverseKey = accessKey.split("").reverse().join("");

    if (query.tid && query.status && query.checksum && query.txn_secret) {
      const tokenString = `${query.tid}${query.txn_secret}${query.status}${reverseKey}`;
      const orderNumber = query.orderNumber as string | undefined;

      if (!orderNumber) {
        return reply.code(400).send("Missing orderNumber");
      }
      const generatedChecksum = crypto
        .createHash("sha256")
        .update(tokenString)
        .digest("hex");

      if (generatedChecksum === query.checksum) {
        try {
          const requestData = {
            interfaceId: query.tid,
            ctId: query.ctsid,
            ctPaymentId: query.ctPaymentID,
            pspReference: query.pspReference,
            lang: query.lang,
            path: query.path,
          };

          const jsonBody = JSON.stringify(requestData);
          await opts.paymentService.transactionUpdate({
            data: jsonBody,
          });

          const orderId = await getOrderIdFromOrderNumber(orderNumber);
          if (!orderId) return reply.code(404).send("Order not found");
          const requestPath = requestData?.path ?? "";
          const requestlang = requestData?.lang ?? "";
          const thirdPartyUrl =
            requestPath + "/" + requestlang + "/thank-you/?orderId=" + orderId;
          return reply.code(302).redirect(thirdPartyUrl);
        } catch (error) {
          log.error("Error processing payment:", error);
          return reply.code(400).send("Payment processing failed");
        }
      } else {
        log.error("Checksum verification failed", {
          paymentId: query.ctPaymentID,
          expected: generatedChecksum,
          received: query.checksum,
        });
        return reply.code(400).send("Checksum verification failed.");
      }
    } else {
      return reply.code(400).send("Missing required query parameters.");
    }
  });

  fastify.get("/failure", async (request, reply) => {
    const query = request.query as {
      paymentReference?: string;
      ctsid?: string;
      orderNumber?: string;
      ctPaymentID?: string;
      pspReference?: string;
      tid?: string;
      status_text?: string;
      status?: string;
      txn_secret?: string;
      checksum?: string;
      payment_type?: string;
      path?: string;
      lang?: string;
      nnReturnToken?: string;
    };

    if (!validReturnParameters(query))
      return reply.code(400).send("Invalid payment return parameters");

    const baseUrl = query.path + "/checkout";
    const redirectUrl = new URL(baseUrl);

    if (query.paymentReference) {
      redirectUrl.searchParams.set("paymentReference", query.paymentReference);
    }
    if (query.ctsid) {
      redirectUrl.searchParams.set("ctsid", query.ctsid);
    }
    if (query.orderNumber) {
      redirectUrl.searchParams.set("orderNumber", query.orderNumber);
    }
    if (query.ctPaymentID) {
      redirectUrl.searchParams.set("ctPaymentID", query.ctPaymentID);
    }
    if (query.pspReference) {
      redirectUrl.searchParams.set("pspReference", query.pspReference);
    }

    redirectUrl.searchParams.set(
      "novalnetPaymentError",
      returnErrorMessage(query.status_text, query.lang),
    );

    try {
      const requestData = {
        paymentReference: query.paymentReference,
        ctsid: query.ctsid,
        orderNumber: query.orderNumber,
        ctPaymentID: query.ctPaymentID,
        pspReference: query.pspReference,
        tid: query.tid,
        status_text: query.status_text,
        payment_type: query.payment_type,
        lang: query.lang,
      };

      const jsonBody = JSON.stringify(requestData);
      if (verifiedFailureReturn(query)) {
        await opts.paymentService.failureResponse({ data: jsonBody });
      } else {
        log.info(
          "Redirect failure notification awaiting verified PAYMENT webhook",
          { paymentId: query.ctPaymentID },
        );
      }
    } catch (error) {
      log.error("Error recording failed redirect payment:", error);
    }
    try {
      await redirectPaymentErrorService.record(
        query.ctPaymentID!,
        query.pspReference!,
        returnErrorMessage(query.status_text, query.lang),
      );
    } catch (error) {
      log.warn("Unable to save redirect error notification", {
        paymentId: query.ctPaymentID,
        error,
      });
    }
    return reply.code(302).redirect(redirectUrl.toString());
  });

  fastify.post<{ Body: { acknowledge?: string } }>(
    "/redirectPaymentError",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: Type.Object(
          {
            acknowledge: Type.Optional(
              Type.String({ pattern: "^[a-f0-9]{64}$" }),
            ),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const cartId = getCartIdFromContext();
      if (!cartId) return reply.code(204).send();
      try {
        if (request.body.acknowledge) {
          await redirectPaymentErrorService.acknowledge(
            cartId,
            request.body.acknowledge,
          );
          return reply.code(204).send();
        }
        const notice = await redirectPaymentErrorService.read(cartId);
        return notice ? reply.code(200).send(notice) : reply.code(204).send();
      } catch (error) {
        log.warn("Unable to recover redirect error notification", {
          cartId,
          error,
        });
        return reply.code(204).send();
      }
    },
  );

  fastify.post<{ Body: any }>(
    "/novalnletWebhook",
    {
      config: {
        rawBody: true,
      },
    },
    async (req, reply) => {
      try {
        const rawBody =
          typeof req.rawBody === "string"
            ? req.rawBody
            : Buffer.isBuffer(req.rawBody)
              ? req.rawBody.toString("utf8")
              : JSON.stringify(req.body);

        const parsedBody = JSONbig({ storeAsString: true }).parse(rawBody);

        const responseData: Record<string, any>[] = Array.isArray(parsedBody)
          ? parsedBody
          : [parsedBody];

        if (!responseData.length || !responseData[0]) {
          log.error("Webhook received empty payload");

          return reply.code(400).send({
            success: false,
            message: "Empty webhook payload",
          });
        }

        const webhook: Record<string, any> = responseData[0];

        const serviceResponse = await opts.paymentService.createWebhook(
          responseData,
          req,
        );

        log.info("Webhook processed successfully", {
          eventType: webhook.event?.type,
          tid: webhook.transaction?.tid,
        });

        return reply.code(200).send({
          success: true,
          data: serviceResponse,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown webhook error";

        log.error("Webhook processing failed", {
          message,
          stack: error instanceof Error ? error.stack : undefined,
        });

        if (message.includes("Checksum validation failed")) {
          return reply.code(400).send({
            success: false,
            message,
          });
        }

        if (message.includes("Unauthorized access")) {
          return reply.code(403).send({ message });
        }

        if (
          message.includes("Missing") ||
          message.includes("Invalid webhook payload")
        ) {
          return reply.code(400).send({
            success: false,
            message,
          });
        }

        return reply.code(500).send({
          success: false,
          message: "Internal server error",
        });
      }
    },
  );

  fastify.post("/getCreditcardConfig", async (_req, reply) => {
    const config = getConfig();

    const clientKey = String(config?.novalnetClientkey ?? "");

    const inline = String(config?.novalnet_CREDITCARD_DisplayInline ?? "0");

    return reply.code(200).send({
      paymentReference: clientKey,
      inline,
    });
  });

  fastify.post<{ Body: PaymentRequestSchemaDTO }>(
    "/getCustomerAddress",
    { preHandler: [opts.sessionHeaderAuthHook.authenticate()] },
    async (
      req: FastifyRequest<{ Body: PaymentRequestSchemaDTO }>,
      reply: FastifyReply,
    ) => {
      const cartId = getCartIdFromContext();
      const resp = await opts.paymentService.getCustomerAddress({
        data: req.body,
        cartId,
      } as any);
      return reply.code(200).send(resp);
    },
  );
};
