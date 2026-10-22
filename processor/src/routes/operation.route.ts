import {
  AuthorityAuthorizationHook,
  JWTAuthenticationHook,
  Oauth2AuthenticationHook,
  SessionHeaderAuthenticationHook,
} from "@commercetools/connect-payments-sdk";
import { Type } from "@sinclair/typebox";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  ConfigResponseSchema,
  ConfigResponseSchemaDTO,
} from "../dtos/operations/config.dto";
import { SupportedPaymentComponentsSchema } from "../dtos/operations/payment-componets.dto";
import {
  PaymentIntentRequestSchema,
  PaymentIntentRequestSchemaDTO,
  PaymentIntentResponseSchema,
  PaymentIntentResponseSchemaDTO,
} from "../dtos/operations/payment-intents.dto";
import {
  StatusResponseSchema,
  StatusResponseSchemaDTO,
} from "../dtos/operations/status.dto";
import { AbstractPaymentService } from "../services/abstract-payment.service";
import { log } from "../libs/logger";

type OperationRouteOptions = {
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
  oauth2AuthHook: Oauth2AuthenticationHook;
  jwtAuthHook: JWTAuthenticationHook;
  authorizationHook: AuthorityAuthorizationHook;
  paymentService: AbstractPaymentService;
};

export const operationsRoute = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & OperationRouteOptions,
) => {
  fastify.get<{ Reply: ConfigResponseSchemaDTO }>(
    "/config",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: ConfigResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const config = await opts.paymentService.config();
      reply.code(200).send(config);
    },
  );

  fastify.get<{ Reply: StatusResponseSchemaDTO }>(
    "/status",
    {
      preHandler: [opts.jwtAuthHook.authenticate()],
      schema: {
        response: {
          200: StatusResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const status = await opts.paymentService.status();
      reply.code(200).send(status);
    },
  );

  fastify.get(
    "/payment-components",
    {
      preHandler: [opts.jwtAuthHook.authenticate()],
      schema: {
        response: {
          200: SupportedPaymentComponentsSchema,
        },
      },
    },
    async (_, reply) => {
      const result = await opts.paymentService.getSupportedPaymentComponents();
      reply.code(200).send(result);
    },
  );

  fastify.post<{
    Body: PaymentIntentRequestSchemaDTO;
    Reply:
      | PaymentIntentResponseSchemaDTO
      | {
          message: string;
        };
    Params: { id: string };
  }>(
    "/payment-intents/:id",
    {
      preHandler: [
        opts.oauth2AuthHook.authenticate(),
        opts.authorizationHook.authorize(
          "manage_project",
          "manage_checkout_payment_intents",
        ),
      ],
      schema: {
        params: {
          $id: "paramsSchema",
          type: "object",
          properties: {
            id: Type.String(),
          },
          required: ["id"],
        },
        body: PaymentIntentRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
          400: Type.Object({
            message: Type.String(),
          }),
          409: Type.Object({ message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      log.info("[PAYMENT_INTENT][ROUTE][REQUEST]", {
        paymentId: id,
        action: request.body.actions?.[0]?.action,
        merchantReference: request.body.actions?.[0]?.merchantReference,
      });

      try {
        const response = await opts.paymentService.modifyPayment({
          paymentId: id,
          data: request.body,
        });

        log.info("[PAYMENT_INTENT][ROUTE][SUCCESS]", {
          paymentId: id,
          outcome: response.outcome,
        });

        return reply.status(200).send(response);
      } catch (err) {
        log.error("[PAYMENT_INTENT][ROUTE][FAILED]", {
          paymentId: id,
          action: request.body.actions?.[0]?.action,
          error: err,
        });

        return reply
          .status(
            (err as { statusCode?: number })?.statusCode === 409 ? 409 : 400,
          )
          .send({
            message:
              err instanceof Error
                ? err.message
                : "Payment modification failed",
          });
      }
    },
  );
};
