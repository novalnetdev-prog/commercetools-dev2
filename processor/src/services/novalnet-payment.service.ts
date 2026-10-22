import {
  Cart,
  healthCheckCommercetoolsPermissions,
  statusHandler,
} from "@commercetools/connect-payments-sdk";
import { ConfigResponse, StatusResponse } from "./types/operation.type";
import {
  Address,
  Customer,
  OrderUpdateAction,
} from "@commercetools/platform-sdk";
import { SupportedPaymentComponentsSchemaDTO } from "../dtos/operations/payment-componets.dto";
import packageJSON from "../../package.json";
import { AbstractPaymentService } from "./abstract-payment.service";
import { getConfig } from "../config/config";
import { appLogger, paymentSDK } from "../payment-sdk";
import crypto, { randomUUID } from "crypto";
import dns from "dns/promises";
import { FastifyRequest } from "fastify";
import {
  CreatePaymentRequest,
  NovalnetPaymentServiceOptions,
} from "./types/novalnet-payment.type";
import {
  PaymentMethodType,
  PaymentResponseSchemaDTO,
} from "../dtos/novalnet-payment.dto";
import {
  getCartIdFromContext,
  getFutureOrderNumberFromContext,
  getPaymentInterfaceFromContext,
} from "../libs/fastify/context/context";
import { log } from "../libs/logger";
import * as Context from "../libs/fastify/context/context";
import {
  createOrderPaymentCommentsType,
  createTransactionCommentsType,
} from "../utils/custom-fields";
import { projectApiRoot } from "../utils/ct-client";
import { novalnetEndpoint } from "../utils/novalnet-endpoint";
import { webhookCallerIp } from "../utils/webhook-ip";
import { redirectFailureResponse } from "../utils/redirect-failure";
import { signReturnParameters } from "../utils/redirect-return";
import customObjectService from "./ct-custom-object.service";
import { reconcilePreCreditRefund } from "./pre-credit-refund";
import {
  getPaymentMethodName,
  getPaymentMethodNames,
  normalizeLocale,
  SupportedLocale,
  t,
} from "../i18n";
import { PaymentUpdateAction } from "@commercetools/platform-sdk";
import JSONbig from "json-bigint";
import { mapNovalnetOrderStates } from "./novalnet-order-state.service";
import type {
  NovalnetOrderStateInput,
  NovalnetOrderStates,
} from "./novalnet-order-state.service";
import {
  bankTransferDetails,
  buildPayPalCartInfo,
  ensureCommentOccurrences,
  formatNovalnetAmount,
  getNovalnetSystemInfo,
  mergeInitialPaymentComments,
  multibancoReferenceDetails,
  paymentTransactionComments,
  updateBankTransferReference,
} from "../utils/novalnet-request";

type NovalnetConfig = {
  testMode: string;
  paymentAction: string;
  dueDate: string;
  minimumAmount: string;
  minimumOrderAmount: string;
  enforce3d: string;
  displayInline: string;
  forceNonGuarantee: string;
};

export class CheckoutPaymentError extends Error {}

function getNovalnetConfigValues(
  type: string,
  config: Record<string, any>,
): NovalnetConfig {
  const upperType = type.toUpperCase();
  return {
    testMode: String(config?.[`novalnet_${upperType}_TestMode`] ?? ""),
    paymentAction: String(
      config?.[`novalnet_${upperType}_PaymentAction`] ?? "",
    ),
    dueDate: String(config?.[`novalnet_${upperType}_DueDate`] ?? ""),
    minimumAmount: String(
      config?.[`novalnet_${upperType}_MinimumAmount`] ?? "",
    ),
    minimumOrderAmount: String(
      config?.[`novalnet_${upperType}_MinimumOrderAmount`] ?? "999",
    ),
    enforce3d: String(config?.[`novalnet_${upperType}_Enforce3d`] ?? ""),
    displayInline: String(
      config?.[`novalnet_${upperType}_DisplayInline`] ?? "",
    ),
    forceNonGuarantee: String(
      config?.[`novalnet_${upperType}_ForceNonGuarantee`] ?? "",
    ),
  };
}

function getPaymentDueDate(
  paymentType: string,
  configuredDueDate?: number | string | null,
): string {
  let days = Number(configuredDueDate);
  const type = paymentType.toUpperCase();

  if (!configuredDueDate || !Number.isFinite(days) || days <= 0) {
    days = 14;
    if (
      type === "DIRECT_DEBIT_SEPA" ||
      type === "GUARANTEED_DIRECT_DEBIT_SEPA"
    ) {
      days = 3;
    }
  }

  switch (type) {
    case "DIRECT_DEBIT_SEPA":
    case "GUARANTEED_DIRECT_DEBIT_SEPA":
      days = Math.max(3, Math.min(14, days));
      break;

    case "PREPAYMENT":
      days = Math.max(7, Math.min(28, days));
      break;

    case "INVOICE":
    case "GUARANTEED_INVOICE":
      days = Math.max(8, days);
      break;

    default:
      break;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  return dueDate.toISOString().split("T")[0];
}

export class NovalnetPaymentService extends AbstractPaymentService {
  constructor(opts: NovalnetPaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService);
  }

  public async config(): Promise<ConfigResponse> {
    const config = getConfig();
    return {
      clientKey: config.novalnetClientkey,
      environment: "live",
    };
  }

  public async status(): Promise<StatusResponse> {
    const handler = await statusHandler({
      timeout: getConfig().healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            "manage_payments",
            "view_sessions",
            "view_api_clients",
            "view_customers",
            "manage_orders",
            "introspect_oauth_tokens",
            "manage_checkout_payment_intents",
            "manage_types",
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: getConfig().projectKey,
        }),
        async () => {
          const cfg = getConfig();
          const configured = Boolean(
            cfg.novalnetPublicKey &&
              cfg.novalnetPrivateKey &&
              cfg.novalnetTariff &&
              cfg.novalnetClientkey,
          );
          return {
            name: "Novalnet configuration",
            status: configured ? ("UP" as const) : ("DOWN" as const),
            message: configured
              ? "Required Novalnet credentials are configured; gateway connectivity is not probed."
              : "Required Novalnet configuration is missing.",
            details: { gatewayConnectivityProbed: false },
          };
        },
      ],
      metadataFn: async () => ({
        name: packageJSON.name,
        description: packageJSON.description,
        "@commercetools/connect-payments-sdk":
          packageJSON.dependencies["@commercetools/connect-payments-sdk"],
      }),
    })();
    return handler.body;
  }

  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      components: [
        { type: PaymentMethodType.INVOICE },
        { type: PaymentMethodType.PREPAYMENT },
        { type: PaymentMethodType.GUARANTEED_INVOICE },
        { type: PaymentMethodType.GUARANTEED_SEPA },
        { type: PaymentMethodType.IDEAL },
        { type: PaymentMethodType.PAYPAL },
        { type: PaymentMethodType.ONLINE_BANK_TRANSFER },
        { type: PaymentMethodType.ALIPAY },
        { type: PaymentMethodType.BANCONTACT },
        { type: PaymentMethodType.BLIK },
        { type: PaymentMethodType.EPS },
        { type: PaymentMethodType.MBWAY },
        { type: PaymentMethodType.MULTIBANCO },
        { type: PaymentMethodType.POSTFINANCE },
        { type: PaymentMethodType.POSTFINANCE_CARD },
        { type: PaymentMethodType.PRZELEWY24 },
        { type: PaymentMethodType.TRUSTLY },
        { type: PaymentMethodType.TWINT },
        { type: PaymentMethodType.WECHATPAY },
        { type: PaymentMethodType.SEPA },
        { type: PaymentMethodType.ACH },
        { type: PaymentMethodType.CREDITCARD },
        { type: PaymentMethodType.PIX },
        { type: PaymentMethodType.BOLETO },
        { type: PaymentMethodType.BIZUM },
        { type: PaymentMethodType.BANCOMATPAY },
        { type: PaymentMethodType.KAKAOPAY },
        { type: PaymentMethodType.NAVERPAY },
      ],
    };
  }

  public ctcc(cart: Cart) {
    return paymentSDK.ctCartService.getOneShippingAddress({ cart });
  }

  public ctbb(cart: Cart) {
    return cart.billingAddress ?? null;
  }

  public async failureResponse({ data }: { data: any }) {
    const parsedData = typeof data === "string" ? JSON.parse(data) : data;

    log.info("[failureResponse] Processing payment failure", {
      ctPaymentID: parsedData.ctPaymentID,
      pspReference: parsedData.pspReference,
    });

    await createTransactionCommentsType();

    const raw = await this.ctPaymentService.getPayment({
      id: parsedData.ctPaymentID,
    } as any);

    const payment = (raw as any)?.body ?? raw;
    const version = payment.version;

    const tx = payment.transactions?.find(
      (t: any) => t.interactionId === parsedData.pspReference,
    );

    if (!tx) {
      throw new Error("Transaction not found");
    }

    const txId = tx.id;

    if (!txId) {
      throw new Error("Transaction missing id");
    }

    if (
      tx.state === "Success" ||
      payment.transactions.some(
        (item: any) => item.type === "Charge" && item.state === "Success",
      )
    ) {
      log.warn(
        "[failureResponse] Ignoring a stale failure return for a successful payment",
        { paymentId: payment.id },
      );
      return;
    }

    const locale = normalizeLocale(parsedData.lang);
    const existing = String(tx.custom?.fields?.transactionComments ?? "");
    const initial =
      existing && !existing.includes("N/A")
        ? existing.split("\n\n---\n")[0]
        : [
            t(locale, "payment.transactionId", {
              tid: String(parsedData.tid ?? ""),
            }),
            t(locale, "payment.paymentType", {
              type: getPaymentMethodName(locale, parsedData.payment_type),
            }),
          ].join("\n");
    const reason =
      typeof parsedData.status_text === "string"
        ? parsedData.status_text.trim().slice(0, 500)
        : "";
    const transactionComments = mergeInitialPaymentComments(
      existing,
      initial + (reason && !initial.includes(reason) ? `\n${reason}` : ""),
    );

    const actions: PaymentUpdateAction[] = [];

    if (!tx.custom?.type) {
      actions.push({
        action: "setTransactionCustomType",
        transactionId: txId,
        type: {
          key: "novalnet-custom-field",
          typeId: "type",
        },
      });
    }

    if (tx.custom?.fields?.transactionComments !== transactionComments)
      actions.push({
        action: "setTransactionCustomField",
        transactionId: txId,
        name: "transactionComments",
        value: transactionComments,
      });

    if (tx.state !== "Failure")
      actions.push({
        action: "changeTransactionState",
        transactionId: txId,
        state: "Failure",
      });

    if (actions.length)
      await projectApiRoot
        .payments()
        .withId({ ID: parsedData.ctPaymentID })
        .post({ body: { version, actions } })
        .execute();

    log.info("[failureResponse] Payment failure comments saved", {
      ctPaymentID: parsedData.ctPaymentID,
      transactionId: txId,
    });
  }

  public async getCustomerAddress(
    request: CreatePaymentRequest,
  ): Promise<PaymentResponseSchemaDTO> {
    const cartId = request.cartId;
    if (!cartId) {
      log.warn("service-customer-address - missing cartId");
      return { paymentReference: "customAddress" };
    }
    let ctCart: any;
    try {
      ctCart = await this.ctCartService.getCart({ id: cartId });
    } catch (err) {
      log.error("Failed to fetch cart", err);
      return { paymentReference: "customAddress" };
    }

    const shippingAddress: Address | null = ctCart.shippingAddress ?? null;
    const billingAddress: Address | null = ctCart.billingAddress ?? null;
    let firstName: string =
      shippingAddress?.firstName ?? ctCart.customerFirstName ?? "";
    let lastName: string =
      shippingAddress?.lastName ?? ctCart.customerLastName ?? "";
    let email: string = ctCart.customerEmail ?? "";

    if (ctCart.customerId) {
      try {
        const customerRes = await projectApiRoot
          .customers()
          .withId({ ID: ctCart.customerId })
          .get()
          .execute();

        const ctCustomer: Customer = customerRes.body;
        if (!firstName) firstName = ctCustomer.firstName ?? "";
        if (!lastName) lastName = ctCustomer.lastName ?? "";
        if (!email) email = ctCustomer.email ?? "";
      } catch (err) {
        log.warn("Failed to fetch customer data, using cart only", {
          cartCustomerId: ctCart.customerId,
          error: String(err),
        });
      }
    }
    const result: PaymentResponseSchemaDTO = {
      paymentReference: "customAddress",
      firstName,
      lastName,
      email,
      shippingAddress,
      billingAddress,
    } as any;

    return result;
  }

  public async transactionUpdate({ data }: { data: any }) {
    const parsedData = typeof data === "string" ? JSON.parse(data) : data;
    if (!parsedData?.ctPaymentId) {
      throw new Error("Missing ctPaymentId in transactionUpdate");
    }
    return this.updateRedirectTransaction(parsedData);
  }

  private async updateRedirectTransaction(parsedData: any) {
    try {
      log.info("[transactionUpdate] Starting transaction update", {
        ctPaymentId: parsedData.ctPaymentId,
        pspReference: parsedData.pspReference,
      });

      await createTransactionCommentsType();
      await createOrderPaymentCommentsType();

      const novalnetPayload = {
        transaction: { tid: parsedData?.interfaceId ?? "" },
      };
      const lang = parsedData?.lang as SupportedLocale;

      log.info(
        "[transactionUpdate] Fetching transaction details from Novalnet",
        {
          tid: parsedData?.interfaceId,
        },
      );

      let responseData: any;
      try {
        responseData = await this.callNovalnet(
          novalnetEndpoint("transaction/details"),
          novalnetPayload,
        );
      } catch (err) {
        log.error(
          "[transactionUpdate] Failed to fetch Novalnet transaction details",
          err,
        );
        throw new Error("Payment verification failed");
      }

      const pspReference = parsedData.pspReference;
      if (!pspReference) {
        throw new Error("Missing pspReference");
      }

      const tid = responseData?.transaction?.tid ?? "";
      if (String(tid) !== String(parsedData.interfaceId))
        throw new Error(
          "Novalnet transaction verification does not match the return",
        );
      const payment = (await this.ctPaymentService.getPayment({
        id: parsedData.ctPaymentId,
      } as any)) as any;
      const currentPayment = payment?.body ?? payment;
      if (
        currentPayment.interfaceId !== pspReference &&
        !currentPayment.transactions?.some(
          (tx: any) => tx.interactionId === pspReference,
        )
      )
        throw new Error(
          "Payment return correlation does not match the Payment",
        );
      const privateState = await customObjectService.read(
        "nn-private-data",
        `${parsedData.ctPaymentId}-${pspReference}`,
      );
      if (
        privateState?.value?.tid &&
        String(privateState.value.tid) !== String(tid)
      )
        throw new Error(
          "Novalnet transaction does not match the stored Payment",
        );
      const hasFollowUp =
        currentPayment.transactions?.some(
          (tx: any) =>
            tx.interactionId !== pspReference &&
            ["Charge", "Refund", "CancelAuthorization", "Chargeback"].includes(
              tx.type,
            ) &&
            tx.state === "Success",
        ) ||
        Number(privateState?.value?.creditedAmount ?? 0) > 0 ||
        Number(privateState?.value?.preCreditRefundedAmount ?? 0) > 0;
      if (hasFollowUp) {
        await this.handlePayment({
          ...responseData,
          event: { type: "PAYMENT", tid },
          custom: {
            "ctpayment-id": parsedData.ctPaymentId,
            pspReference,
            lang,
          },
        });
        return { paymentReference: responseData?.custom?.paymentRef ?? "" };
      }
      const paymentType = responseData?.transaction?.payment_type ?? "";
      const isTestMode = responseData?.transaction?.test_mode == 1;
      const status = String(
        responseData?.transaction?.status ?? "",
      ).toUpperCase();
      const { state, transactionType } = this.getTransactionStatus(status);
      const statusCode = responseData?.transaction?.status_code ?? "";
      const locale = normalizeLocale(lang);
      const transactionComments = [
        t(locale, "payment.transactionId", { tid }),
        t(locale, "payment.paymentType", {
          type: getPaymentMethodName(locale, paymentType),
        }),
        isTestMode ? t(locale, "payment.testMode") : "",
        bankTransferDetails(responseData?.transaction ?? {}, locale),
      ].join("\n");

      const { txId } = await this.updatePaymentTransaction({
        paymentId: parsedData.ctPaymentId,
        pspReference,
        transactionComments,
        statusCode,
        state,
        appendComments: false,
        setCustomType: true,
        errorMessage: "Transaction not found for PSP reference",
      });

      await this.addSettlementTransactionIfRequired({
        paymentId: parsedData.ctPaymentId,
        pspReference,
        amount: responseData?.transaction?.amount,
        currency: responseData?.transaction?.currency,
        transactionType,
        status,
      });

      const updatedPaymentRoot = await projectApiRoot
        .payments()
        .withId({ ID: parsedData.ctPaymentId })
        .get()
        .execute();

      await customObjectService.upsert(
        "nn-private-data",
        `${parsedData.ctPaymentId}-${pspReference}`,
        {
          tid,
          paymentMethod: paymentType,
          status,
          orderNo: responseData?.transaction?.order_no ?? "",
          cMail: responseData?.customer?.email ?? "",
          additionalInfo: { comments: transactionComments },
        },
      );

      const orderSearch = await projectApiRoot
        .orders()
        .get({
          queryArgs: {
            where: `paymentInfo(payments(id=${JSON.stringify(parsedData.ctPaymentId)}))`,
            limit: 1,
          },
        })
        .execute();

      const orderRoot = orderSearch.body.results?.[0];
      if (!orderRoot) {
        log.info(
          "[transactionUpdate] No order linked to this payment – nothing to sync yet",
          {
            ctPaymentId: parsedData.ctPaymentId,
          },
        );
        return;
      }

      const orderId = orderRoot.id;
      const updatedTransaction = updatedPaymentRoot.body.transactions?.find(
        (t) => t.id === txId,
      );
      const paymentComment =
        updatedTransaction?.custom?.fields?.transactionComments ??
        transactionComments;

      const order = await projectApiRoot
        .orders()
        .withId({ ID: orderId })
        .get()
        .execute();
      let canWriteOrderComment = true;
      if (order.body.custom?.type) {
        const type = await projectApiRoot
          .types()
          .withKey({ key: "order-payment-comments" })
          .get()
          .execute();
        if (order.body.custom.type.id !== type.body.id) {
          log.warn(
            "[ORDER_SYNC] Order uses another Custom Type; comment remains on Payment",
            { orderId },
          );
          canWriteOrderComment = false;
        }
      }
      const commentActions: OrderUpdateAction[] = [];
      if (!order.body.custom?.type) {
        commentActions.push({
          action: "setCustomType",
          type: { key: "order-payment-comments", typeId: "type" },
        });
      }
      commentActions.push({
        action: "setCustomField",
        name: "paymentComments",
        value: paymentComment,
      });
      if (canWriteOrderComment)
        await projectApiRoot
          .orders()
          .withId({ ID: orderId })
          .post({
            body: {
              version: order.body.version,
              actions: commentActions,
            },
          })
          .execute();

      log.info("[transactionUpdate] Order payment comments synced", {
        orderId,
        ctPaymentId: parsedData.ctPaymentId,
      });

      return {
        paymentReference: responseData?.custom?.paymentRef ?? "",
      };
    } catch (err) {
      log.error("[transactionUpdate] FAILED", err);
      throw err;
    }
  }

  public async createDirectPayment(
    request: CreatePaymentRequest,
  ): Promise<PaymentResponseSchemaDTO> {
    const type = String(request.data?.paymentMethod?.type ?? "");
    const config = getConfig();
    const {
      testMode,
      paymentAction,
      dueDate,
      minimumAmount,
      minimumOrderAmount,
      enforce3d,
      forceNonGuarantee,
    } = getNovalnetConfigValues(type, config);
    await createTransactionCommentsType();
    const ctCart = await this.ctCartService.getCart({
      id: getCartIdFromContext(),
    });

    const deliveryAddress = await this.ctcc(ctCart);
    const billingAddress = await this.ctbb(ctCart);
    const parsedCart = typeof ctCart === "string" ? JSON.parse(ctCart) : ctCart;
    const paymentAmount = await this.ctCartService.getPaymentAmount({
      cart: ctCart,
    });
    const dueDateValue = getPaymentDueDate(type, dueDate);
    const lang = normalizeLocale(request.data?.lang);
    const orderNumber = getFutureOrderNumberFromContext() ?? "";
    const transaction: Record<string, any> = {
      test_mode: Number(testMode) === 1 ? "1" : "0",
      payment_type: String(request.data.paymentMethod.type ?? ""),
      amount: String(paymentAmount.centAmount ?? ""),
      currency: paymentAmount.currencyCode ?? "",
      order_no: String(orderNumber),
      ...getNovalnetSystemInfo(
        request.data.path ?? config.merchantReturnUrl,
        packageJSON.version,
      ),
    };
    const deliveryStreet = this.splitStreetByComma(deliveryAddress?.streetName);
    const billingStreet = this.splitStreetByComma(billingAddress?.streetName);

    const deliveryAddressStreetName = deliveryStreet.streetName;
    const deliveryAddressStreetNumber = deliveryStreet.streetNumber;

    const billingAddressStreetName = billingStreet.streetName;
    const billingAddressStreetNumber = billingStreet.streetNumber;

    if (dueDateValue) {
      transaction.due_date = dueDateValue;
    }

    if (
      ["GUARANTEED_DIRECT_DEBIT_SEPA", "GUARANTEED_INVOICE"].includes(
        String(request.data.paymentMethod.type ?? "").toUpperCase(),
      )
    ) {
      const paymentType = String(
        request.data.paymentMethod.type ?? "",
      ).toUpperCase();

      const sameAddress =
        billingAddress?.city === deliveryAddress?.city &&
        billingAddress?.country === deliveryAddress?.country &&
        billingAddressStreetName === deliveryAddressStreetName &&
        billingAddressStreetNumber === deliveryAddressStreetNumber &&
        billingAddress?.postalCode === deliveryAddress?.postalCode;

      const billingCountry = billingAddress && billingAddress.country;

      const isEur =
        String(
          parsedCart?.taxedPrice?.totalGross?.currencyCode ??
            parsedCart?.totalPrice?.currencyCode ??
            "",
        ) === "EUR";

      const orderTotal = Number(
        parsedCart?.taxedPrice?.totalGross?.centAmount ??
          parsedCart?.totalPrice?.centAmount,
      );

      const configuredMinimum = Number(minimumOrderAmount);
      const guaranteeMinimum =
        Number.isFinite(configuredMinimum) && configuredMinimum > 0
          ? Math.max(999, configuredMinimum)
          : 999;
      const amountValid = orderTotal >= guaranteeMinimum;

      const countryAllowed =
        billingCountry && ["DE", "AT", "CH"].includes(billingCountry);

      const guaranteePayment =
        Boolean(sameAddress) &&
        Boolean(isEur) &&
        Boolean(amountValid) &&
        Boolean(countryAllowed);

      const isForceNonGuarantee =
        forceNonGuarantee !== undefined &&
        forceNonGuarantee !== null &&
        !Number.isNaN(Number(forceNonGuarantee)) &&
        Number(forceNonGuarantee) == 1;

      if (!guaranteePayment) {
        if (!isForceNonGuarantee) {
          throw new CheckoutPaymentError(
            lang === "de"
              ? "Die Zahlungsbedingungen wurden nicht erfüllt. Bitte wählen Sie eine andere Zahlungsmethode aus."
              : "Payment conditions were not met. Please choose another payment method.",
          );
        }

        if (paymentType === "GUARANTEED_DIRECT_DEBIT_SEPA") {
          transaction.payment_type = "DIRECT_DEBIT_SEPA";
        } else if (paymentType === "GUARANTEED_INVOICE") {
          transaction.payment_type = "INVOICE";
        }
      }
    }

    const company = billingAddress?.company ?? "";

    let birthDate: string | undefined;

    const rawBirthDate = request.data.paymentMethod?.birthdate ?? "";

    if (typeof rawBirthDate === "string" && rawBirthDate.trim()) {
      birthDate = this.formatBirthDateToYMD(rawBirthDate);
    }

    if (
      String(request.data.paymentMethod.type ?? "").toUpperCase() ===
        "DIRECT_DEBIT_SEPA" ||
      String(request.data.paymentMethod.type ?? "").toUpperCase() ===
        "GUARANTEED_DIRECT_DEBIT_SEPA"
    ) {
      transaction.payment_data = {
        account_holder: String(request.data.paymentMethod.accHolder ?? ""),
        iban: String(request.data.paymentMethod.iban ?? ""),
        bic: String(request.data.paymentMethod.bic ?? ""),
      };
    }

    if (
      String(request.data.paymentMethod.type ?? "").toUpperCase() ===
      "DIRECT_DEBIT_ACH"
    ) {
      transaction.payment_data = {
        account_holder: String(request.data.paymentMethod.accHolder ?? ""),
        account_number: String(request.data.paymentMethod.accountNumber ?? ""),
        routing_number: String(request.data.paymentMethod.routingNumber ?? ""),
      };
    }

    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned: paymentAmount,
      paymentMethodInfo: {
        paymentInterface: getPaymentInterfaceFromContext() ?? "",
        method: getPaymentMethodName("en", transaction.payment_type),
        name: getPaymentMethodNames(transaction.payment_type),
      },
      ...(ctCart.customerId && {
        customer: { typeId: "customer", id: ctCart.customerId },
      }),
      ...(!ctCart.customerId &&
        ctCart.anonymousId && {
          anonymousId: ctCart.anonymousId,
        }),
    });

    await this.ctCartService.addPayment({
      resource: { id: ctCart.id, version: ctCart.version },
      paymentId: ctPayment.id,
    });

    const pspReference = randomUUID().toString();
    const processorURL = Context.getProcessorUrlFromContext();
    const sessionId = Context.getCtSessionIdFromContext();

    const hookUrl = new URL("/novalnletWebhook", processorURL);

    transaction.hook_url = hookUrl.toString();

    if (
      String(request.data.paymentMethod.type ?? "").toUpperCase() ===
      "CREDITCARD"
    ) {
      transaction.payment_data = {
        pan_hash: String(request.data.paymentMethod.panHash ?? ""),
        unique_id: String(request.data.paymentMethod.uniqueId ?? ""),
      };

      if (String(enforce3d) === "1") {
        const { returnUrl, errorReturnUrl } = this.createPaymentReturnUrls({
          processorURL,
          sessionId,
          paymentReference: ctPayment.id,
          orderNumber,
          ctPaymentID: ctPayment.id,
          pspReference,
          lang,
          path: String(request.data?.path ?? ""),
        });

        transaction.enforce_3d = 1;

        transaction.return_url = returnUrl;

        transaction.error_return_url = errorReturnUrl;
      }
    }

    let firstName = "";
    let lastName = "";

    if (ctCart.customerId) {
      const customerRes = await projectApiRoot
        .customers()
        .withId({ ID: ctCart.customerId })
        .get()
        .execute();

      const ctCustomer: Customer = customerRes.body;

      firstName = ctCustomer.firstName ?? "";
      lastName = ctCustomer.lastName ?? "";
    } else {
      firstName = ctCart.shippingAddress?.firstName ?? "";
      lastName = ctCart.shippingAddress?.lastName ?? "";
    }

    const novalnetPayload = {
      merchant: {
        signature: String(getConfig()?.novalnetPublicKey ?? ""),
        tariff: String(getConfig()?.novalnetTariff ?? ""),
      },
      customer: {
        billing: {
          city: String(billingAddress?.city ?? ""),
          country_code: String(billingAddress?.country ?? ""),
          house_no: String(billingAddressStreetNumber),
          street: String(billingAddressStreetName),
          zip: String(billingAddress?.postalCode ?? ""),
          ...(company && {
            company: company,
          }),
        },
        shipping: {
          city: String(deliveryAddress?.city ?? ""),
          country_code: String(deliveryAddress?.country ?? ""),
          house_no: String(deliveryAddressStreetNumber),
          street: String(deliveryAddressStreetName),
          zip: String(deliveryAddress?.postalCode ?? ""),
        },
        first_name: firstName,
        last_name: lastName,
        email: parsedCart.customerEmail ?? "",
        customer_ip: request.customerIp ?? "",
        ...(birthDate && {
          birth_date: birthDate,
        }),
      },
      transaction,
      custom: {
        lang: String(lang).toUpperCase(),
        input1: "ctpayment-id",
        inputval1: String(ctPayment.id ?? ""),
        input2: "pspReference",
        inputval2: String(pspReference ?? ""),
        input3: "lang",
        inputval3: lang,
      },
    };

    let paymentActionUrl = "payment";

    if (paymentAction?.toLowerCase() === "authorize") {
      const orderTotal = Number(
        parsedCart?.taxedPrice?.totalGross?.centAmount ??
          parsedCart?.totalPrice?.centAmount,
      );

      const authorizeAmount = Number(minimumAmount ?? 0);

      if (authorizeAmount <= 0) {
        paymentActionUrl = "authorize";
      } else {
        paymentActionUrl =
          orderTotal >= authorizeAmount ? "authorize" : "payment";
      }
    }

    const url =
      paymentActionUrl === "payment"
        ? novalnetEndpoint("payment")
        : novalnetEndpoint("authorize");

    // Persist correlation before contacting the PSP. A PAYMENT webhook must be
    // able to recover the result if the direct API response never reaches us.
    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      pspReference,
    });
    let responseData: any;
    try {
      responseData = await this.callNovalnet(url, novalnetPayload);
    } catch (err) {
      log.error("Failed to process payment with Novalnet:", err);
      throw new Error("Payment processing failed");
    }
    const parsedResponse = responseData;
    if (
      String(request.data.paymentMethod.type ?? "").toUpperCase() ===
        "CREDITCARD" &&
      String(enforce3d) === "1" &&
      parsedResponse?.result?.redirect_url
    ) {
      log.info("enfore 3D", {
        status: parsedResponse?.result?.status,
        statusText: parsedResponse?.result?.status_text,
      });

      await this.createPendingPaymentTransaction({
        paymentId: ctPayment.id,
        amount: ctPayment.amountPlanned,
        pspReference,
        paymentMethod:
          parsedResponse?.transaction?.payment_type ??
          request.data.paymentMethod.type,
      });

      const redirectUrl = parsedResponse?.result?.redirect_url;

      return {
        paymentReference: ctPayment.id,
        txnSecret: redirectUrl,
      };
    }

    const statusCode = parsedResponse?.transaction?.status_code;
    const status = String(
      parsedResponse?.transaction?.status ?? "",
    ).toUpperCase();
    const { state, transactionType } = this.getTransactionStatus(status);
    const transactions = parsedResponse?.transaction;
    const tid = transactions?.tid;
    const paymentType = transactions?.payment_type;
    const isTestMode = transactions?.test_mode == 1;
    const bankDetails = transactions?.bank_details;
    const multibancoLive =
      String(paymentType ?? transaction.payment_type).toUpperCase() ===
        "MULTIBANCO" && Number(transactions?.test_mode ?? testMode) !== 1;

    const supportedLocales: SupportedLocale[] = ["en", "de"];
    const localizedTransactionComments = supportedLocales.reduce(
      (acc, locale) => {
        const initialComments = [
          t(locale, "payment.transactionId", { tid }),
          t(locale, "payment.paymentType", {
            type: getPaymentMethodName(locale, paymentType),
          }),
          isTestMode ? t(locale, "payment.testMode") : "",
        ].join("\n");
        const reference = multibancoLive
          ? multibancoReferenceDetails(transactions ?? {}, locale)
          : "";
        acc[locale] = reference
          ? `${initialComments.trimEnd()}\n\n${reference}`
          : initialComments;
        return acc;
      },
      {} as Record<SupportedLocale, string>,
    );

    let localizedBankDetailsComment: Partial<Record<SupportedLocale, string>> =
      {};
    if (bankDetails) {
      localizedBankDetailsComment = supportedLocales.reduce(
        (acc, locale) => {
          acc[locale] = bankTransferDetails(transactions, locale);
          return acc;
        },
        {} as Record<SupportedLocale, string>,
      );
    }

    let transactionComments = localizedTransactionComments[lang];
    if (
      parsedResponse?.result?.status === "FAILURE" &&
      parsedResponse.result.status_text
    ) {
      transactionComments += `\n${String(parsedResponse.result.status_text).slice(0, 500)}`;
    }
    if (localizedBankDetailsComment[lang]) {
      transactionComments += `\n\n${localizedBankDetailsComment[lang]}`;
    }

    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,
      pspReference,
      paymentMethod: request.data.paymentMethod.type,
      transaction: {
        type: transactionType,
        amount: ctPayment.amountPlanned,
        interactionId: pspReference,
        state: state,
        custom: {
          type: {
            typeId: "type",
            key: "novalnet-custom-field",
          },
          fields: {
            transactionComments,
          },
        },
      } as unknown as any,
    } as any);

    const raw = await this.ctPaymentService.getPayment({
      id: ctPayment.id,
    } as any);
    const payment = (raw as any)?.body ?? raw;
    const version = payment.version;
    const tx = payment.transactions?.find(
      (t: any) => t.interactionId === pspReference,
    );
    if (!tx) throw new Error("Transaction not found");
    const transactionCommentsText =
      typeof transactionComments === "string"
        ? transactionComments
        : String(transactionComments ?? "");

    const updatedPayment = await projectApiRoot
      .payments()
      .withId({ ID: ctPayment.id })
      .post({
        body: {
          version,
          actions: [
            {
              action: "setStatusInterfaceCode",
              interfaceCode: String(statusCode),
            },
          ],
        },
      })
      .execute();

    const updatedTransaction = updatedPayment.body.transactions?.find(
      (t) => t.interactionId === pspReference,
    );

    const paymentComment =
      updatedTransaction?.custom?.fields?.transactionComments ??
      transactionCommentsText;

    await customObjectService.upsert(
      "nn-private-data",
      `${ctPayment.id}-${pspReference}`,
      {
        paymentId: ctPayment.id,
        pspReference,
        orderNo: parsedResponse?.transaction?.order_no ?? "",
        tid: parsedResponse?.transaction?.tid ?? "",
        paymentMethod: parsedResponse?.transaction?.payment_type ?? "",
        status: parsedResponse?.transaction?.status ?? "",
        amount: parsedResponse?.transaction?.amount ?? "",
        comments: paymentComment,
        email: parsedResponse?.customer?.email ?? "",
      },
    );

    return {
      paymentReference: ctPayment.id,
      transactionStatus:
        parsedResponse?.result?.status === "FAILURE"
          ? "FAILURE"
          : parsedResponse?.transaction?.status,
      transactionStatusText:
        parsedResponse?.result?.status_text ??
        parsedResponse?.transaction?.status_text,
    };
  }

  private formatBirthDateToYMD(dateStr: string): string | undefined {
    if (!dateStr) return undefined;

    const value = dateStr.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }

    let match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }

    match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }

    match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }

    return undefined;
  }

  public async waitForOrderByPayment(
    paymentId: string,
    retries = 10,
    delayMs = 1500,
  ): Promise<{ id: string; version: number } | null> {
    for (let i = 0; i < retries; i++) {
      const res = await projectApiRoot
        .orders()
        .get({
          queryArgs: {
            where: `paymentInfo(payments(id=${JSON.stringify(paymentId)}))`,
            limit: 1,
          },
        })
        .execute();

      const order = res.body.results?.[0];
      if (order) return { id: order.id, version: order.version };

      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  private async syncPaymentToOrder(
    paymentId: string,
    pspReference: string,
    waitForOrder = true,
  ): Promise<void> {
    log.info("[ORDER_SYNC] START", {
      paymentId,
      pspReference,
    });

    const rawPayment = await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

    const payment = (rawPayment as any)?.body ?? rawPayment;

    const transaction = [...(payment.transactions ?? [])]
      .reverse()
      .find((t: any) => t.interactionId === pspReference);

    if (!transaction) {
      log.warn("[ORDER_SYNC] Matching transaction not found", {
        paymentId,
        pspReference,
      });
      return;
    }

    const orderRef = waitForOrder
      ? await this.waitForOrderByPayment(paymentId)
      : await this.getOrderByPaymentId(paymentId);

    if (!orderRef) {
      log.warn("[ORDER_SYNC] No order linked to payment", {
        paymentId,
        pspReference,
      });
      return;
    }

    const orderResponse = await projectApiRoot
      .orders()
      .withId({ ID: orderRef.id })
      .get()
      .execute();

    const order = orderResponse.body;

    const paymentComment = paymentTransactionComments(
      payment.transactions ?? [],
    );

    log.info("[ORDER_SYNC] Order fetched", {
      orderId: order.id,
      version: order.version,
    });

    const orderCommentType = await projectApiRoot
      .types()
      .withKey({ key: "order-payment-comments" })
      .get()
      .execute()
      .catch((error: any) => {
        if (error?.statusCode === 404) return null;
        throw error;
      });

    const actions: any[] = [];

    if (orderCommentType) {
      if (
        order.custom?.type &&
        order.custom.type.id !== orderCommentType.body.id
      ) {
        log.warn(
          "[ORDER_SYNC] Order uses another Custom Type; comment remains on Payment",
          { orderId: order.id },
        );
        return;
      }

      if (!order.custom?.type)
        actions.push({
          action: "setCustomType",
          type: {
            key: "order-payment-comments",
            typeId: "type",
          },
        });

      if (order.custom?.fields?.paymentComments !== paymentComment)
        actions.push({
          action: "setCustomField",
          name: "paymentComments",
          value: paymentComment,
        });

      log.info("[ORDER_SYNC] Custom type found", {
        orderId: order.id,
        typeKey: "order-payment-comments",
      });
    } else {
      log.log(
        "[ORDER_SYNC] order-payment-comments type not found. Skipping custom field update.",
        {
          orderId: order.id,
          typeKey: "order-payment-comments",
        },
      );
    }

    if (actions.length > 0) {
      log.info("[ORDER_SYNC] Updating Order", {
        orderId: order.id,
        actions: actions.map((a) => a.action),
      });

      await projectApiRoot
        .orders()
        .withId({ ID: order.id })
        .post({
          body: {
            version: order.version,
            actions,
          },
        })
        .execute();
    }

    log.info("[ORDER_SYNC] COMPLETED", {
      orderId: order.id,
      paymentId,
      pspReference,
    });
  }

  private async getOrderByPaymentId(paymentId: string) {
    const result = await projectApiRoot
      .orders()
      .get({
        queryArgs: {
          where: `paymentInfo(payments(id=${JSON.stringify(paymentId)}))`,
          limit: 1,
        },
      })
      .execute();

    return result.body.results[0] ?? null;
  }

  private getTransactionStatus(status?: string): {
    state: "Initial" | "Pending" | "Success" | "Failure";
    transactionType: "Authorization" | "Charge" | "CancelAuthorization";
  } {
    switch (String(status ?? "").toUpperCase()) {
      case "PENDING":
        return {
          state: "Pending",
          transactionType: "Authorization",
        };

      case "ON_HOLD":
        return {
          state: "Success",
          transactionType: "Authorization",
        };

      case "CONFIRMED":
        return {
          state: "Success",
          transactionType: "Charge",
        };

      case "CANCELLED":
        return {
          state: "Failure",
          transactionType: "CancelAuthorization",
        };

      default:
        return {
          state: "Failure",
          transactionType: "Authorization",
        };
    }
  }

  private mapNovalnetOrderStates(
    input: NovalnetOrderStateInput,
  ): NovalnetOrderStates | null {
    return mapNovalnetOrderStates(input);
  }

  private async getModificationFlags(
    paymentId: string,
    eventType: string,
    status?: string,
  ): Promise<{
    isPartialCapture?: boolean;
    isPartialChargeback?: boolean;
  } | null> {
    const captureEvent =
      eventType === "TRANSACTION_CAPTURE" || eventType === "TRANSACTION_UPDATE";
    const chargebackEvent = [
      "CHARGEBACK",
      "RETURN_DEBIT",
      "RETURN_DEBIT_SEPA",
      "REVERSAL",
    ].includes(eventType);
    if (!captureEvent && !chargebackEvent) return {};

    const payment = (
      await projectApiRoot.payments().withId({ ID: paymentId }).get().execute()
    ).body;
    const captured = payment.transactions
      .filter((tx) => tx.type === "Charge" && tx.state === "Success")
      .reduce((sum, tx) => sum + tx.amount.centAmount, 0);
    if (captured > payment.amountPlanned.centAmount) {
      throw new Error("Captured amount exceeds the planned Payment amount");
    }
    if (eventType === "TRANSACTION_CAPTURE" && captured <= 0) return null;
    if (
      eventType === "TRANSACTION_UPDATE" &&
      status === "CONFIRMED" &&
      captured <= 0
    )
      return null;
    if (chargebackEvent) {
      if (captured <= 0) return null;
      const chargedBack = payment.transactions
        .filter((tx) => tx.type === "Chargeback" && tx.state === "Success")
        .reduce((sum, tx) => sum + tx.amount.centAmount, 0);
      if (chargedBack > captured) {
        throw new Error("Chargeback amount exceeds captured Payment amount");
      }
      return { isPartialChargeback: captured > chargedBack };
    }
    return {
      isPartialCapture: captured < payment.amountPlanned.centAmount,
    };
  }

  private async updateOrderStates({
    paymentId,
    paymentState,
    allowMissingOrder = false,
  }: {
    paymentId: string;
    paymentState: NovalnetOrderStates["paymentState"];
    allowMissingOrder?: boolean;
  }): Promise<void> {
    let order = await this.getOrderByPaymentId(paymentId);
    if (!order && allowMissingOrder) return; // A declined initial attempt need not create an Order.
    if (!order) {
      const orderRef = await this.waitForOrderByPayment(paymentId, 5, 1000);
      if (orderRef) {
        order = (
          await projectApiRoot
            .orders()
            .withId({ ID: orderRef.id })
            .get()
            .execute()
        ).body;
      }
    }

    if (!order) throw new Error(`Order not linked to Payment ${paymentId}`);
    // A connector for one PSP cannot derive the aggregate state of other Payments.
    if ((order.paymentInfo?.payments?.length ?? 0) > 1) return;

    const actions: any[] = [];

    if (order.paymentState !== paymentState) {
      actions.push({
        action: "changePaymentState",
        paymentState,
      });
    }

    if (!actions.length) {
      return;
    }

    await projectApiRoot
      .orders()
      .withId({ ID: order.id })
      .post({
        body: {
          version: order.version,
          actions,
        },
      })
      .execute();

    log.info("[ORDER_STATE] Updated", {
      orderId: order.id,
      paymentId,
      paymentState,
    });
  }

  private async callNovalnet<T = any>(
    url: string,
    payload: unknown,
  ): Promise<T> {
    const accessKey = String(getConfig()?.novalnetPrivateKey ?? "");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-NN-Access-Key": btoa(accessKey),
      },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Novalnet API error: ${response.status}`);
    }

    const responseText = await response.text();

    const parsed = JSONbig({ storeAsString: true }).parse(responseText);

    return JSON.parse(JSON.stringify(parsed)) as T;
  }

  private async updatePaymentTransaction({
    paymentId,
    pspReference,
    transactionComments,
    statusCode,
    state,
    appendComments = true,
    replaceInitialComments = false,
    avoidDuplicateComment = false,
    bankReferenceLocale,
    bankReferenceTransaction,
    setCustomType = false,
    setStatusInterfaceCode = true,
    changeTransactionState = true,
    errorMessage = "Transaction not found",
  }: {
    paymentId: string;
    pspReference: string;
    transactionComments: string;
    statusCode?: string;
    state?: "Initial" | "Pending" | "Success" | "Failure";
    appendComments?: boolean;
    replaceInitialComments?: boolean;
    avoidDuplicateComment?: boolean;
    bankReferenceLocale?: SupportedLocale;
    bankReferenceTransaction?: Record<string, any>;
    setCustomType?: boolean;
    setStatusInterfaceCode?: boolean;
    changeTransactionState?: boolean;
    errorMessage?: string;
  }) {
    const raw = await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

    const payment = (raw as any)?.body ?? raw;

    let tx = payment.transactions.find(
      (tx: any) => tx.interactionId === pspReference,
    );

    if (!tx) {
      tx = payment.transactions.find(
        (tx: any) =>
          tx.type === "Charge" && tx.interactionId === `${pspReference}-Charge`,
      );
    }

    if (!tx) {
      log.error("[PAYMENT_TX] Transaction not found", {
        paymentId,
        pspReference,
      });

      throw new Error(errorMessage);
    }

    const existingComments = tx.custom?.fields?.transactionComments ?? "";

    const currentInterfaceCode = payment.paymentStatus?.interfaceCode ?? "";

    const alreadyUpdated =
      tx.state === state &&
      currentInterfaceCode === String(statusCode ?? "") &&
      existingComments === transactionComments;

    if (alreadyUpdated) {
      log.info("[PAYMENT_TX] Already updated", {
        paymentId,
        transactionId: tx.id,
      });

      return {
        txId: tx.id,
        comments: existingComments,
      };
    }

    const previousComments =
      bankReferenceLocale && bankReferenceTransaction
        ? updateBankTransferReference(
            existingComments,
            {
              ...bankReferenceTransaction,
              amount: bankReferenceTransaction.amount ?? tx.amount?.centAmount,
              currency:
                bankReferenceTransaction.currency ?? tx.amount?.currencyCode,
            },
            bankReferenceLocale,
          )
        : existingComments;
    const finalComments = replaceInitialComments
      ? mergeInitialPaymentComments(previousComments, transactionComments)
      : avoidDuplicateComment && previousComments.includes(transactionComments)
        ? previousComments
        : appendComments && previousComments
          ? `${previousComments}\n\n---\n${transactionComments}`
          : transactionComments;

    const actions: PaymentUpdateAction[] = [];

    if (setCustomType && !tx.custom?.type) {
      actions.push({
        action: "setTransactionCustomType",
        transactionId: tx.id,
        type: {
          key: "novalnet-custom-field",
          typeId: "type",
        },
      });
    }

    if (existingComments !== finalComments) {
      actions.push({
        action: "setTransactionCustomField",
        transactionId: tx.id,
        name: "transactionComments",
        value: finalComments,
      });
    }

    if (
      setStatusInterfaceCode &&
      currentInterfaceCode !== String(statusCode ?? "")
    ) {
      actions.push({
        action: "setStatusInterfaceCode",
        interfaceCode: String(statusCode ?? ""),
      });
    }

    if (changeTransactionState && state && tx.state !== state) {
      actions.push({
        action: "changeTransactionState",
        transactionId: tx.id,
        state,
      });
    }

    if (actions.length === 0) {
      log.info("[PAYMENT_TX] Already synchronized", {
        paymentId,
        transactionId: tx.id,
        transactionState: tx.state,
        interfaceCode: currentInterfaceCode,
      });

      return {
        txId: tx.id,
        comments: existingComments,
      };
    }

    log.info("[PAYMENT_TX] Updating Payment", {
      paymentId,
      transactionId: tx.id,
      actions: actions.map((a) => a.action),
    });

    await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({
        body: {
          version: payment.version,
          actions,
        },
      })
      .execute();

    log.info("[PAYMENT_TX] Payment updated", {
      paymentId,
      transactionId: tx.id,
    });

    return {
      txId: tx.id,
      comments: finalComments,
    };
  }

  private async processWebhookTransaction({
    webhook,
    transactionComments,
    state,
    setStatusInterfaceCode = true,
    statusCodeOverride,
    avoidDuplicateComment = false,
    changeTransactionState = true,
    skipSettlement = false,
  }: {
    webhook: any;
    transactionComments: string;
    state?: "Initial" | "Pending" | "Success" | "Failure";
    setStatusInterfaceCode?: boolean;
    statusCodeOverride?: string;
    avoidDuplicateComment?: boolean;
    changeTransactionState?: boolean;
    skipSettlement?: boolean;
  }) {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    const status = String(webhook.transaction?.status ?? "").toUpperCase();

    const mapped = this.getTransactionStatus(status);
    const effectiveState = state ?? mapped.state;

    log.info("[WEBHOOK_TX] START", {
      paymentId,
      pspReference,
      eventType: webhook.event?.type,
      status,
    });

    await this.updatePaymentTransaction({
      paymentId,
      pspReference,
      transactionComments,
      replaceInitialComments:
        String(webhook.event?.type ?? "").toUpperCase() === "PAYMENT",
      avoidDuplicateComment,
      statusCode: statusCodeOverride ?? webhook.transaction?.status_code,
      state: effectiveState,
      setStatusInterfaceCode,
      changeTransactionState,
    });

    if (!skipSettlement && mapped.transactionType !== "CancelAuthorization") {
      log.info("[WEBHOOK_TX] Settlement validation", {
        paymentId,
        transactionType: mapped.transactionType,
      });

      await this.addSettlementTransactionIfRequired({
        paymentId,
        pspReference,
        amount: webhook.transaction?.amount,
        currency: webhook.transaction?.currency,
        transactionType: mapped.transactionType,
        status,
      });
    }

    await this.syncPaymentToOrder(
      paymentId,
      pspReference,
      !(
        String(webhook.event?.type ?? "").toUpperCase() === "PAYMENT" &&
        effectiveState === "Failure"
      ),
    );

    log.info("[WEBHOOK_TX] COMPLETED", {
      paymentId,
      pspReference,
    });

    return transactionComments;
  }

  public async createWebhook(
    webhookData: any[],
    req?: FastifyRequest,
  ): Promise<any> {
    if (!Array.isArray(webhookData) || webhookData.length === 0) {
      log.error("Invalid webhook payload");
      throw new Error("Invalid webhook payload");
    }

    const webhook = webhookData[0];

    await this.validateRequiredParameters(webhook);

    await this.validateChecksum(webhook);

    if (req) {
      await this.validateIpAddress(req);
    }

    const eventType = String(webhook.event?.type ?? "").toUpperCase();
    if (
      String(webhook.custom?.shop_invoked ?? "") === "1" &&
      [
        "TRANSACTION_CAPTURE",
        "TRANSACTION_CANCEL",
        "TRANSACTION_REFUND",
      ].includes(eventType)
    ) {
      log.info("[PAYMENT_INTENT] Webhook already handled in shop", {
        eventType,
        tid: webhook.event?.tid,
      });
      return {
        success: true,
        eventType,
        message: "Already handled in the shop / Payment Intent",
      };
    }

    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;
    if (!paymentId) throw new Error("Missing payment reference");
    const reference = webhook.custom?.pspReference ?? webhook.custom?.inputval2;
    if (!reference) throw new Error("Missing pspReference");
    const stored =
      reference &&
      (await customObjectService.read(
        "nn-private-data",
        `${paymentId}-${reference}`,
      ));
    const expectedTid = String(stored?.value.tid ?? "");
    const rootTid = String(
      webhook.event?.parent_tid ??
        webhook.transaction?.tid ??
        webhook.event?.tid ??
        "",
    );
    if (expectedTid && expectedTid !== rootTid)
      throw new Error("Webhook TID does not match the Payment reference");
    let effectiveWebhook = webhook;
    if (!expectedTid) {
      const payment = (
        await projectApiRoot
          .payments()
          .withId({ ID: paymentId })
          .get()
          .execute()
      ).body;
      if (
        payment.interfaceId !== reference &&
        !payment.transactions.some((tx) => tx.interactionId === reference)
      )
        throw new Error(
          "Initial payment correlation is missing or does not match",
        );
      // The webhook checksum does not cover the custom Payment/reference
      // fields. Bind an unknown TID using an authenticated read at the PSP.
      const details = await this.callNovalnet(
        novalnetEndpoint("transaction/details"),
        { transaction: { tid: rootTid } },
      );
      const verifiedId =
        details?.custom?.["ctpayment-id"] ?? details?.custom?.inputval1;
      const verifiedReference =
        details?.custom?.pspReference ?? details?.custom?.inputval2;
      if (
        String(details?.transaction?.tid ?? "") !== rootTid ||
        verifiedId !== paymentId ||
        verifiedReference !== reference
      )
        throw new Error("Novalnet details do not match the Payment reference");
      if (eventType === "PAYMENT")
        effectiveWebhook = {
          ...webhook,
          result: details.result,
          transaction: details.transaction,
        };
      await this.rememberInitialReference(paymentId, reference, {
        ...webhook,
        transaction: { ...details.transaction, tid: rootTid },
      });
    }
    return this.processVerifiedWebhook(effectiveWebhook);
  }

  private async processVerifiedWebhook(
    webhook: Record<string, any>,
  ): Promise<any> {
    const eventType = String(webhook.event?.type ?? "").toUpperCase();
    const status = String(webhook.result?.status ?? "").toUpperCase();

    log.info("Processing Novalnet webhook", {
      eventType,
      status,
      tid: webhook?.event?.tid,
      paymentType: webhook?.transaction?.payment_type,
    });

    const initialFailure =
      eventType === "PAYMENT" &&
      status === "FAILURE" &&
      String(webhook.transaction?.status ?? "").toUpperCase() === "FAILURE";
    if (status !== "SUCCESS" && !initialFailure) {
      log.warn("Webhook ignored (non-success)", {
        eventType,
        status,
        tid: webhook?.event?.tid,
      });

      return {
        success: true,
        message: "Webhook ignored (non-success)",
      };
    }

    let transactionComments: string | undefined;

    switch (eventType) {
      case "PAYMENT":
        transactionComments = await this.handlePayment(webhook);
        break;

      case "TRANSACTION_CAPTURE":
        transactionComments = await this.handleTransactionCapture(webhook);
        break;

      case "TRANSACTION_CANCEL":
        transactionComments = await this.handleTransactionCancel(webhook);
        break;

      case "TRANSACTION_REFUND":
        transactionComments = await this.handleTransactionRefund(webhook);
        break;

      case "TRANSACTION_UPDATE":
        transactionComments = await this.handleTransactionUpdate(webhook);
        break;

      case "CREDIT":
        transactionComments = await this.handleCredit(webhook);
        break;

      case "PAYMENT_REMINDER_1":
      case "PAYMENT_REMINDER_2":
      case "SUBMISSION_TO_COLLECTION_AGENCY":
        transactionComments = await this.handleInformationalEvent(webhook);
        break;

      case "CHARGEBACK":
      case "RETURN_DEBIT":
      case "RETURN_DEBIT_SEPA":
      case "REVERSAL":
        transactionComments = await this.handleChargeback(webhook);
        break;

      default:
        log.warn("Unhandled Novalnet event type", {
          eventType,
          tid: webhook?.event?.tid,
        });

        return {
          success: true,
          skipped: true,
          eventType,
        };
    }

    if (
      transactionComments !== "Transaction not found" &&
      transactionComments !==
        "Initial payment already superseded by a follow-up" &&
      [
        "PAYMENT",
        "TRANSACTION_CAPTURE",
        "TRANSACTION_CANCEL",
        "TRANSACTION_REFUND",
        "TRANSACTION_UPDATE",
        "CHARGEBACK",
        "RETURN_DEBIT",
        "RETURN_DEBIT_SEPA",
        "REVERSAL",
      ].includes(eventType)
    ) {
      const paymentId =
        webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;
      if (!paymentId)
        throw new Error("Missing payment reference for Order state update");
      try {
        const flags =
          eventType === "PAYMENT"
            ? {}
            : await this.getModificationFlags(
                paymentId,
                eventType,
                String(webhook.transaction?.status ?? "").toUpperCase(),
              );
        if (flags) {
          const states = this.mapNovalnetOrderStates({
            status: webhook.transaction?.status,
            eventType,
            ...flags,
          });
          if (states)
            await this.updateOrderStates({
              paymentId,
              ...states,
              allowMissingOrder:
                eventType === "PAYMENT" &&
                ["FAILURE", "CANCELLED", "DEACTIVATED"].includes(
                  String(webhook.transaction?.status ?? "").toUpperCase(),
                ),
            });
        }
      } catch (error) {
        log.error("[ORDER_STATE] State synchronization failed", {
          paymentId,
          eventType,
          error,
        });
        throw error;
      }
    }
    if (transactionComments === "Already synchronized") {
      const paymentId =
        webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;
      const pspReference =
        webhook.custom?.pspReference ?? webhook.custom?.inputval2;
      if (paymentId && pspReference)
        await this.syncPaymentToOrder(paymentId, pspReference, false);
    }
    log.info("Webhook processed", {
      eventType,
      tid: webhook?.event?.tid,
    });

    return {
      success: true,
      eventType,
      message: transactionComments,
    };
  }

  private async rememberInitialReference(
    paymentId: string,
    pspReference: string,
    webhook: Record<string, any>,
  ): Promise<void> {
    const tid = String(webhook.transaction?.tid ?? webhook.event?.tid ?? "");
    if (!/^\d+$/.test(tid)) throw new Error("Missing initial Novalnet TID");
    const container = "nn-private-data",
      key = `${paymentId}-${pspReference}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      let stored;
      try {
        stored = (
          await projectApiRoot
            .customObjects()
            .withContainerAndKey({ container, key })
            .get()
            .execute()
        ).body;
      } catch (error: any) {
        if (error?.statusCode !== 404) throw error;
      }
      if (stored?.value?.tid) {
        if (String(stored.value.tid) !== tid)
          throw new Error(
            "Initial Novalnet TID does not match stored Payment reference",
          );
        return;
      }
      try {
        await projectApiRoot
          .customObjects()
          .post({
            body: {
              container,
              key,
              version: stored?.version ?? 0,
              value: {
                ...(stored?.value ?? {}),
                paymentId,
                pspReference,
                tid,
                paymentMethod: webhook.transaction?.payment_type,
                status: webhook.transaction?.status,
              },
            },
          })
          .execute();
        return;
      } catch (error: any) {
        if (error?.statusCode !== 409 || attempt === 2) throw error;
      }
    }
  }

  private async handlePayment(webhook: Record<string, any>): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    const tid = String(webhook.event?.tid ?? "");
    const novalnetStatus = String(
      webhook.transaction?.status ?? "",
    ).toUpperCase();

    if (!paymentId || !pspReference) {
      log.error("[PAYMENT] Missing payment reference", {
        paymentId,
        pspReference,
        tid,
      });
      throw new Error("Missing payment reference");
    }

    log.info("[PAYMENT] START", {
      paymentId,
      pspReference,
      tid,
      eventType: webhook.event?.type,
      paymentType: webhook.transaction?.payment_type,
      status: novalnetStatus,
    });

    const raw = await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

    const payment = (raw as any)?.body ?? raw;

    log.info("[PAYMENT] Payment fetched", {
      paymentId,
      version: payment.version,
      interfaceId: payment.interfaceId,
      transactionCount: payment.transactions?.length ?? 0,
    });

    if (payment.interfaceId === pspReference)
      await this.rememberInitialReference(paymentId, pspReference, webhook);

    const tx = [...(payment.transactions ?? [])]
      .reverse()
      .find((t: any) => t.interactionId === pspReference);
    const privateState = await customObjectService.read(
      "nn-private-data",
      `${paymentId}-${pspReference}`,
    );
    const followUp =
      payment.transactions?.some(
        (item: any) =>
          item.interactionId !== pspReference &&
          ["Charge", "Refund", "CancelAuthorization", "Chargeback"].includes(
            item.type,
          ) &&
          item.state === "Success",
      ) ||
      Number(privateState?.value?.creditedAmount ?? 0) > 0 ||
      Number(privateState?.value?.preCreditRefundedAmount ?? 0) > 0;
    if (followUp) {
      if (tx)
        await this.updatePaymentTransaction({
          paymentId,
          pspReference,
          transactionComments: this.buildTransactionComments(
            webhook,
            normalizeLocale(webhook.custom?.lang ?? webhook.custom?.inputval3),
          ),
          replaceInitialComments: true,
          changeTransactionState: false,
          setStatusInterfaceCode: false,
          setCustomType: true,
        });
      const transactions = payment.transactions ?? [];
      const cancelled = transactions.some(
        (item: any) =>
          item.type === "CancelAuthorization" && item.state === "Success",
      );
      const cashReversal = transactions.some(
        (item: any) =>
          ["Refund", "Chargeback"].includes(item.type) &&
          item.state === "Success",
      );
      const captured = transactions
        .filter(
          (item: any) => item.type === "Charge" && item.state === "Success",
        )
        .reduce(
          (total: number, item: any) => total + item.amount.centAmount,
          0,
        );
      const credited = Number(privateState?.value.creditedAmount ?? 0);
      const reduced = Number(privateState?.value.preCreditRefundedAmount ?? 0);
      const currentState = cancelled
        ? "Failed"
        : cashReversal
          ? undefined
          : credited > 0
            ? credited === payment.amountPlanned.centAmount - reduced
              ? "Paid"
              : "BalanceDue"
            : reduced > 0
              ? "Pending"
              : captured > 0
                ? captured < payment.amountPlanned.centAmount
                  ? "BalanceDue"
                  : "Paid"
                : undefined;
      if (currentState)
        await this.updateOrderStates({
          paymentId,
          paymentState: currentState,
          allowMissingOrder: currentState === "Failed",
        });
      await this.syncPaymentToOrder(paymentId, pspReference, false);
      return "Initial payment already superseded by a follow-up";
    }

    if (!tx) {
      log.warn("[PAYMENT] Matching transaction not found", {
        paymentId,
        pspReference,
        availableInteractionIds: payment.transactions?.map(
          (t: any) => t.interactionId,
        ),
      });

      if (payment.interfaceId !== pspReference) {
        throw new Error(
          "Initial payment correlation is missing or does not match",
        );
      }
      const cancelled = ["CANCELLED", "DEACTIVATED"].includes(novalnetStatus);
      if (
        webhook.transaction?.currency !== payment.amountPlanned.currencyCode ||
        (!cancelled &&
          novalnetStatus !== "FAILURE" &&
          Number(webhook.transaction?.amount) !==
            payment.amountPlanned.centAmount)
      ) {
        throw new Error(
          "Initial webhook amount or currency does not match the Payment",
        );
      }
      const mapped = this.getTransactionStatus(novalnetStatus);
      const locale = normalizeLocale(
        webhook.custom?.lang ?? webhook.custom?.inputval3,
      );
      const comments = this.buildTransactionComments(webhook, locale);
      await this.ctPaymentService.updatePayment({
        id: paymentId,
        pspReference,
        transaction: {
          type: cancelled ? "Authorization" : mapped.transactionType,
          state: cancelled ? "Pending" : mapped.state,
          amount: payment.amountPlanned,
          interactionId: pspReference,
          custom: {
            type: { typeId: "type", key: "novalnet-custom-field" },
            fields: { transactionComments: comments },
          },
        },
      } as any);
      await this.updatePaymentTransaction({
        paymentId,
        pspReference,
        transactionComments: comments,
        replaceInitialComments: true,
        setCustomType: true,
        statusCode: webhook.transaction?.status_code,
        changeTransactionState: false,
      });
      return this.handlePayment(webhook);
    }

    const mapped = this.getTransactionStatus(novalnetStatus);

    const locale = normalizeLocale(
      webhook.custom?.lang ?? webhook.custom?.inputval3,
    );

    const transactionComments = this.buildTransactionComments(webhook, locale);

    if (["CANCELLED", "DEACTIVATED"].includes(novalnetStatus)) {
      const cancellationInteractionId = `${pspReference}-CancelAuthorization`;
      if (
        payment.transactions?.some(
          (transaction: any) =>
            transaction.type === "CancelAuthorization" &&
            transaction.state === "Success" &&
            transaction.interactionId === cancellationInteractionId,
        )
      ) {
        return "Already synchronized";
      }

      const cancellationComments = this.buildTransactionComments(
        { ...webhook, event: { ...webhook.event, type: "TRANSACTION_CANCEL" } },
        locale,
      );
      await this.processWebhookTransaction({
        webhook,
        transactionComments: cancellationComments,
        changeTransactionState: false,
        skipSettlement: true,
      });
      await this.addSettlementTransactionIfRequired({
        paymentId,
        pspReference,
        transactionType: "CancelAuthorization",
        amount: webhook.transaction?.amount,
        currency: webhook.transaction?.currency,
        status: novalnetStatus,
      });
      return cancellationComments;
    }

    const currentComments = tx.custom?.fields?.transactionComments ?? "";
    let initialComments =
      novalnetStatus === "FAILURE" &&
      currentComments &&
      !currentComments.includes("N/A")
        ? String(currentComments).split("\n\n---\n")[0]
        : transactionComments;
    const failureReason =
      novalnetStatus === "FAILURE"
        ? String(webhook.result?.status_text ?? "")
            .trim()
            .slice(0, 500)
        : "";
    if (failureReason && !initialComments.includes(failureReason))
      initialComments += `\n${failureReason}`;

    const currentInterfaceCode = payment.paymentStatus?.interfaceCode ?? "";

    const newInterfaceCode = String(webhook.transaction?.status_code ?? "");

    const alreadySynced =
      tx.type === mapped.transactionType &&
      tx.state === mapped.state &&
      currentInterfaceCode === newInterfaceCode;

    if (alreadySynced) {
      log.info("[PAYMENT] Already synchronized", {
        paymentId,
        pspReference,
        transactionType: tx.type,
        transactionState: tx.state,
      });

      await this.updatePaymentTransaction({
        paymentId,
        pspReference,
        transactionComments: initialComments,
        replaceInitialComments: true,
        statusCode: newInterfaceCode,
        state: mapped.state,
        setCustomType: true,
      });

      await this.syncPaymentToOrder(
        paymentId,
        pspReference,
        mapped.state !== "Failure",
      );

      return "Already synchronized";
    }

    await this.processWebhookTransaction({
      webhook,
      transactionComments: initialComments,
      state: mapped.state,
    });

    log.info("[PAYMENT] COMPLETED", {
      paymentId,
      pspReference,
      tid,
    });

    return transactionComments;
  }

  private async handleTransactionCapture(
    webhook: Record<string, any>,
  ): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    const tid = String(webhook.event?.tid ?? "");

    if (!paymentId || !pspReference) {
      log.error("[CAPTURE] Missing payment reference", {
        paymentId,
        pspReference,
        tid,
      });
      throw new Error("Missing payment reference");
    }

    log.info("[CAPTURE] START", {
      paymentId,
      pspReference,
      tid,
      eventType: webhook.event?.type,
      paymentType: webhook.transaction?.payment_type,
      status: webhook.transaction?.status,
    });

    const raw = await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

    const payment = (raw as any)?.body ?? raw;

    const tx = [...(payment.transactions ?? [])]
      .reverse()
      .find((t: any) => t.interactionId === pspReference);

    if (!tx) {
      log.error("[CAPTURE] Matching transaction not found", {
        paymentId,
        pspReference,
        availableInteractionIds: payment.transactions?.map(
          (t: any) => t.interactionId,
        ),
      });
      throw new Error("Transaction not found");
    }

    const currentInterfaceCode = payment.paymentStatus?.interfaceCode ?? "";

    const newInterfaceCode = String(webhook.transaction?.status_code ?? "");

    const alreadyCaptured =
      tx.type === "Charge" &&
      tx.state === "Success" &&
      currentInterfaceCode === newInterfaceCode;

    if (alreadyCaptured) {
      log.info("[CAPTURE] Already synchronized", {
        paymentId,
        pspReference,
        transactionType: tx.type,
        transactionState: tx.state,
      });

      return "Already synchronized";
    }

    const lang = webhook.custom?.lang ?? webhook.custom?.inputval3;
    const locale: SupportedLocale = normalizeLocale(lang);

    const transactionComments = this.buildTransactionComments(webhook, locale);

    await this.processWebhookTransaction({
      webhook,
      transactionComments,
      state: "Success",
    });

    log.info("[CAPTURE] COMPLETED", {
      paymentId,
      pspReference,
      tid,
    });

    return transactionComments;
  }

  private async handleTransactionCancel(
    webhook: Record<string, any>,
  ): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    const tid = String(webhook.event?.tid ?? "");

    if (!paymentId || !pspReference) {
      log.error("[CANCEL] Missing payment reference", {
        paymentId,
        pspReference,
        tid,
      });
      throw new Error("Missing payment reference");
    }

    log.info("[CANCEL] START", {
      paymentId,
      pspReference,
      tid,
      eventType: webhook.event?.type,
      paymentType: webhook.transaction?.payment_type,
      status: webhook.transaction?.status,
    });

    const raw = await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

    const payment = (raw as any)?.body ?? raw;

    const tx = [...(payment.transactions ?? [])]
      .reverse()
      .find((t: any) => t.interactionId === pspReference);

    if (!tx) {
      log.error("[CANCEL] Matching transaction not found", {
        paymentId,
        pspReference,
        availableInteractionIds: payment.transactions?.map(
          (t: any) => t.interactionId,
        ),
      });
      throw new Error("Transaction not found");
    }

    const currentInterfaceCode = payment.paymentStatus?.interfaceCode ?? "";

    const newInterfaceCode = String(webhook.transaction?.status_code ?? "");

    const alreadyCancelled =
      payment.transactions?.some(
        (transaction: any) =>
          transaction.type === "CancelAuthorization" &&
          transaction.state === "Success" &&
          transaction.interactionId === `${pspReference}-CancelAuthorization`,
      ) && currentInterfaceCode === newInterfaceCode;

    if (alreadyCancelled) {
      log.info("[CANCEL] Already synchronized", {
        paymentId,
        pspReference,
        transactionType: tx.type,
        transactionState: tx.state,
      });

      return "Already synchronized";
    }

    const lang = webhook.custom?.lang ?? webhook.custom?.inputval3;
    const locale: SupportedLocale = normalizeLocale(lang);

    const transactionComments = this.buildTransactionComments(webhook, locale);

    await this.processWebhookTransaction({
      webhook,
      transactionComments,
      state: "Failure",
      changeTransactionState: false,
      skipSettlement: true,
    });

    await this.addSettlementTransactionIfRequired({
      paymentId,
      pspReference,
      transactionType: "CancelAuthorization",
      amount: webhook.transaction?.amount,
      currency: webhook.transaction?.currency,
      status: String(webhook.transaction?.status ?? ""),
    });

    log.info("[CANCEL] COMPLETED", {
      paymentId,
      pspReference,
      tid,
    });

    return transactionComments;
  }

  private async handlePreCreditPartialRefund(
    webhook: Record<string, any>,
  ): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;
    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;
    if (!paymentId || !pspReference)
      throw new Error("Missing payment reference");

    const refundAmount = Number(webhook.transaction?.refund?.amount);
    const remainingAmount = Number(webhook.transaction?.amount);
    const currency = String(webhook.transaction?.currency ?? "");
    const payment = (await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any)) as any;
    const currentPayment = payment?.body ?? payment;
    const authorization = currentPayment.transactions?.find(
      (tx: any) =>
        (tx.type === "Authorization" || tx.type === "Charge") &&
        tx.interactionId === pspReference,
    );
    if (!authorization)
      throw new Error("Pre-credit authorization transaction not found");
    if (
      currentPayment.transactions?.some(
        (tx: any) =>
          tx.type === "CancelAuthorization" &&
          tx.state === "Success" &&
          tx.interactionId === `${pspReference}-CancelAuthorization`,
      )
    )
      return "Already synchronized";
    const plannedAmount = Number(authorization.amount.centAmount);
    if (
      !Number.isSafeInteger(plannedAmount) ||
      plannedAmount <= 0 ||
      !Number.isSafeInteger(refundAmount) ||
      refundAmount <= 0 ||
      !Number.isSafeInteger(remainingAmount) ||
      remainingAmount <= 0 ||
      remainingAmount >= plannedAmount ||
      currency !== authorization.amount.currencyCode ||
      webhook.transaction?.refund?.currency !== currency
    ) {
      throw new Error("Invalid pre-credit partial refund amount or currency");
    }

    const container = "nn-private-data";
    const key = `${paymentId}-${pspReference}`;
    let saved: any = null;
    try {
      saved = (
        await projectApiRoot
          .customObjects()
          .withContainerAndKey({ container, key })
          .get()
          .execute()
      ).body;
    } catch (error: any) {
      const status =
        error?.statusCode ?? error?.status ?? error?.body?.statusCode;
      if (status !== 404) throw error;
    }

    const previousRefunded = Number(saved?.value?.preCreditRefundedAmount ?? 0);
    const creditedAmount = Number(saved?.value?.creditedAmount ?? 0);
    const totalRefunded = plannedAmount - remainingAmount;
    if (
      !Number.isSafeInteger(previousRefunded) ||
      previousRefunded < 0 ||
      !Number.isSafeInteger(creditedAmount) ||
      creditedAmount < 0
    ) {
      throw new Error("Invalid stored pre-credit payment amounts");
    }
    if (
      totalRefunded < previousRefunded ||
      (creditedAmount > 0 && totalRefunded === previousRefunded)
    ) {
      return "Already synchronized";
    }
    if (creditedAmount > 0)
      throw new Error("Pre-credit refund received after credit");
    if (
      totalRefunded > previousRefunded &&
      totalRefunded - previousRefunded !== refundAmount
    ) {
      throw new Error(
        "Pre-credit refund amount does not match the remaining balance",
      );
    }

    const lang = webhook.custom?.lang ?? webhook.custom?.inputval3;
    const locale: SupportedLocale = normalizeLocale(lang);
    const comment = this.buildTransactionComments(webhook, locale);

    const savedRefund = await customObjectService.update(
      container,
      key,
      (current) => {
        const events = { ...current.preCreditRefundEvents };
        const eventKey = `balance-${remainingAmount}`;
        if (events[eventKey] && events[eventKey].amount !== refundAmount)
          throw new Error(
            "Pre-credit refund balance already belongs to another amount",
          );
        events[eventKey] = {
          amount: refundAmount,
          remaining: remainingAmount,
          comment,
        };
        return {
          ...current,
          preCreditRefundedAmount: Math.max(
            Number(current.preCreditRefundedAmount ?? 0),
            totalRefunded,
          ),
          preCreditRemainingAmount: Math.min(
            Number(current.preCreditRemainingAmount ?? plannedAmount),
            remainingAmount,
          ),
          preCreditRefundEvents: events,
        };
      },
    );
    const count = Object.values(
      savedRefund.body.value.preCreditRefundEvents,
    ).filter((event: any) => event.comment === comment).length;
    const currentComments = String(
      authorization.custom?.fields?.transactionComments ?? "",
    );
    const combined = ensureCommentOccurrences(currentComments, comment, count);
    if (combined !== currentComments)
      await this.updatePaymentTransaction({
        paymentId,
        pspReference,
        transactionComments: combined,
        appendComments: false,
        statusCode: webhook.transaction?.status_code,
        changeTransactionState: false,
        setCustomType: true,
      });
    await this.syncPaymentToOrder(paymentId, pspReference);
    await this.updateOrderStates({ paymentId, paymentState: "Pending" });

    log.info("[REFUND] Pre-credit partial reduction recorded", {
      paymentId,
      pspReference,
      refundAmount,
      totalRefunded,
      remainingAmount,
    });
    return comment;
  }

  private async handleTransactionRefund(
    webhook: Record<string, any>,
  ): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    const parentTid = String(webhook.event?.parent_tid ?? "");

    const refundTid = String(webhook.transaction?.refund?.tid ?? "");

    const refundAmount = Number(webhook.transaction?.refund?.amount ?? 0);

    const totalRefunded = Number(webhook.transaction?.refunded_amount ?? 0);

    const originalAmount = Number(webhook.transaction?.amount ?? 0);

    log.info("[REFUND] START", {
      paymentId,
      pspReference,
      parentTid,
      refundTid,
      refundAmount,
      totalRefunded,
      originalAmount,
      paymentType: webhook.transaction?.payment_type,
    });

    if (!paymentId || !pspReference) {
      log.error("[REFUND] Missing mandatory data", {
        paymentId,
        pspReference,
        refundTid,
      });
      throw new Error("Missing payment reference");
    }

    const transactionStatus = String(
      webhook.transaction?.status ?? "",
    ).toUpperCase();
    if (!refundTid && transactionStatus === "DEACTIVATED") {
      const payment = (
        await projectApiRoot
          .payments()
          .withId({ ID: paymentId })
          .get()
          .execute()
      ).body;
      const original = payment.transactions.find(
        (tx) => tx.interactionId === pspReference,
      );
      if (!original)
        throw new Error("Original pre-credit payment transaction not found");
      const ledger = await customObjectService.read(
        "nn-private-data",
        `${paymentId}-${pspReference}`,
      );
      const cancelled = payment.transactions.some(
        (tx) =>
          tx.type === "CancelAuthorization" &&
          tx.state === "Success" &&
          tx.interactionId === `${pspReference}-CancelAuthorization`,
      );
      if (cancelled) {
        await this.syncPaymentToOrder(paymentId, pspReference);
        await this.updateOrderStates({ paymentId, paymentState: "Failed" });
        return "Already synchronized";
      }
      const existingEvent = ledger?.value.preCreditRefundEvents?.["balance-0"];
      reconcilePreCreditRefund({
        originalAmount: original.amount.centAmount,
        previouslyRefunded: existingEvent
          ? original.amount.centAmount - refundAmount
          : Number(ledger?.value.preCreditRefundedAmount ?? 0),
        refundAmount,
        expectedCurrency: original.amount.currencyCode,
        transaction: webhook.transaction,
      });
      const comment = this.buildTransactionComments(
        webhook,
        normalizeLocale(webhook.custom?.lang ?? webhook.custom?.inputval3),
      );
      const saved = await customObjectService.update(
        "nn-private-data",
        `${paymentId}-${pspReference}`,
        (current) => ({
          ...current,
          preCreditRefundedAmount: original.amount.centAmount,
          preCreditRemainingAmount: 0,
          preCreditRefundEvents: {
            ...current.preCreditRefundEvents,
            "balance-0": { amount: refundAmount, remaining: 0, comment },
          },
        }),
      );
      const count = Object.values(
        saved.body.value.preCreditRefundEvents,
      ).filter((event: any) => event.comment === comment).length;
      await this.updatePaymentTransaction({
        paymentId,
        pspReference,
        transactionComments: ensureCommentOccurrences(
          String(original.custom?.fields?.transactionComments ?? ""),
          comment,
          count,
        ),
        appendComments: false,
        changeTransactionState: false,
        setCustomType: true,
        statusCode: webhook.transaction?.status_code,
      });
      await this.addSettlementTransactionIfRequired({
        paymentId,
        pspReference,
        transactionType: "CancelAuthorization",
        amount: webhook.transaction?.amount,
        currency: webhook.transaction?.currency,
        status: transactionStatus,
      });
      await this.syncPaymentToOrder(paymentId, pspReference);
      await this.updateOrderStates({ paymentId, paymentState: "Failed" });
      return comment;
    }
    if (!refundTid) {
      return this.handlePreCreditPartialRefund(webhook);
    }
    const payment = (
      await projectApiRoot.payments().withId({ ID: paymentId }).get().execute()
    ).body;

    const chargeTransaction = payment.transactions?.find(
      (t) => t.type === "Charge" && t.state === "Success",
    );

    if (!chargeTransaction) {
      log.error("[REFUND] Charge validation failed", {
        paymentId,
      });
      throw new Error("Successful Charge transaction not found");
    }

    const webhookPspReference = String(webhook.custom?.pspReference ?? "");

    const originalTransaction = payment.transactions.find(
      (tx) =>
        tx.interactionId === webhookPspReference &&
        (tx.type === "Authorization" || tx.type === "Charge"),
    );

    if (!originalTransaction) {
      log.error("[REFUND] Original transaction not found", {
        paymentId,
        webhookPspReference,
        paymentInterfaceId: payment.interfaceId,
        transactions: payment.transactions.map((tx) => ({
          id: tx.id,
          type: tx.type,
          state: tx.state,
          interactionId: tx.interactionId,
        })),
      });

      throw new Error("Original transaction not found");
    }

    const existingRefund = payment.transactions?.find(
      (t) => t.interactionId === refundTid,
    );

    if (existingRefund) {
      log.info("[REFUND] Already synchronized", {
        paymentId,
        refundTid,
      });

      return "Already synchronized";
    }

    const ctRefunded =
      payment.transactions
        ?.filter((t) => t.type === "Refund" && t.state === "Success")
        .reduce((sum, t) => sum + Number(t.amount?.centAmount ?? 0), 0) ?? 0;

    if (refundAmount <= 0) {
      log.error("[REFUND] Invalid refund amount", {
        refundAmount,
      });
      throw new Error("Invalid refund amount");
    }

    if (totalRefunded > originalAmount) {
      log.error("[REFUND] Refunded amount exceeds payment amount", {
        totalRefunded,
        originalAmount,
      });
      throw new Error("Refund exceeds payment amount");
    }

    if (ctRefunded + refundAmount !== totalRefunded) {
      log.error("[REFUND] Refund reconciliation mismatch", {
        paymentId,
        ctRefunded,
        refundAmount,
        totalRefunded,
      });

      throw new Error("Refund reconciliation mismatch");
    }

    const lang = webhook.custom?.lang ?? webhook.custom?.inputval3;
    const locale: SupportedLocale = normalizeLocale(lang);

    const transactionComments = this.buildTransactionComments(webhook, locale);

    await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({
        body: {
          version: payment.version,
          actions: [
            {
              action: "addTransaction",
              transaction: {
                type: "Refund",
                timestamp: new Date().toISOString(),
                amount: {
                  centAmount: refundAmount,
                  currencyCode: webhook.transaction.currency,
                },
                state: "Success",
                interactionId: refundTid,
                custom: {
                  type: {
                    key: "novalnet-custom-field",
                    typeId: "type",
                  },
                  fields: {
                    transactionComments: transactionComments,
                  },
                },
              },
            },
            {
              action: "setStatusInterfaceCode",
              interfaceCode: String(webhook.transaction?.status_code ?? ""),
            },
          ],
        },
      })
      .execute();

    await customObjectService.upsert(
      "nn-private-data",
      `${paymentId}-${pspReference}`,
      {
        tid: parentTid,
        paymentMethod: webhook.transaction?.payment_type,
        status: webhook.transaction?.status,
        orderNo: webhook.transaction?.order_no,
        refundedAmount: totalRefunded,
        lastRefundTid: refundTid,
        lastRefundAmount: refundAmount,
        additionalInfo: {
          comments: transactionComments,
        },
      },
    );

    await this.syncPaymentToOrder(paymentId, pspReference);

    log.info("[REFUND] COMPLETED", {
      paymentId,
      refundTid,
    });

    return transactionComments;
  }

  private async handleTransactionUpdate(
    webhook: Record<string, any>,
  ): Promise<string> {
    const parsedData = webhook.custom;
    const paymentId = parsedData?.["ctpayment-id"];
    const pspReference = parsedData?.pspReference;
    const lang = parsedData?.lang as SupportedLocale;
    const locale = normalizeLocale(lang);

    if (!paymentId || !pspReference) {
      throw new Error("Missing ctpayment-id or pspReference");
    }

    const updateType = String(
      webhook.transaction?.update_type ?? "",
    ).toUpperCase();

    const status = String(webhook.transaction?.status ?? "").toUpperCase();

    const transactionComments = this.buildTransactionComments(webhook, locale);

    log.info("[TRANSACTION_UPDATE] Processing", {
      paymentId,
      pspReference,
      updateType,
      status,
      amount: webhook.transaction?.amount,
      dueDate: webhook.transaction?.due_date,
    });

    const statusCode =
      status === "CONFIRMED"
        ? "100"
        : String(webhook.transaction?.status_code ?? "");

    await this.updatePaymentTransaction({
      paymentId,
      pspReference,
      transactionComments,
      statusCode,
      state:
        status === "CONFIRMED" || status === "ON_HOLD" ? "Success" : "Pending",
      appendComments: true,
      ...(["DUE_DATE", "AMOUNT_DUE_DATE"].includes(updateType) && {
        bankReferenceLocale: locale,
        bankReferenceTransaction: webhook.transaction,
      }),
      setCustomType: true,
      errorMessage: "Authorization transaction not found",
    });

    if (status === "CONFIRMED") {
      const payment = (
        await projectApiRoot
          .payments()
          .withId({ ID: paymentId })
          .get()
          .execute()
      ).body;
      const original = payment.transactions.find(
        (tx) => tx.interactionId === pspReference,
      );
      if (original?.type === "Authorization") {
        await this.addSettlementTransactionIfRequired({
          paymentId,
          pspReference,
          transactionType: "Charge",
          amount: webhook.transaction?.amount,
          currency: webhook.transaction?.currency,
          status,
        });
      }
    }

    await this.syncPaymentToOrder(paymentId, pspReference);

    log.info("[TRANSACTION_UPDATE] Completed", {
      paymentId,
      updateType,
      statusCode,
    });

    return transactionComments;
  }

  public async handleCredit(webhook: Record<string, any>): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    if (!paymentId || !pspReference) {
      throw new Error("Missing ctpayment-id or pspReference");
    }

    const lang = webhook.custom?.lang ?? webhook.custom?.inputval3;
    const locale = normalizeLocale(lang);

    const eventTID = String(webhook.event?.tid ?? "");
    const parentTID = String(webhook.event?.parent_tid ?? eventTID);

    const creditAmount = Number(webhook.transaction?.amount ?? 0); // cents
    const currency = String(webhook.transaction?.currency ?? "");

    let transactionComments = this.buildTransactionComments(webhook, locale);

    log.info("[CREDIT] Webhook received", {
      paymentId,
      pspReference,
      eventTID,
      parentTID,
      paymentType: webhook.transaction?.payment_type,
      creditAmount,
      currency,
      status: webhook.transaction?.status,
    });

    const raw = await this.ctPaymentService.getPayment({
      id: paymentId,
    } as any);

    const payment = (raw as any)?.body ?? raw;

    const authorization = payment.transactions.find(
      (tx: any) =>
        (tx.type === "Authorization" || tx.type === "Charge") &&
        tx.interactionId === pspReference,
    );

    if (!authorization) {
      log.error("[CREDIT] Authorization transaction not found", {
        paymentId,
        pspReference,
      });
      throw new Error("Authorization transaction not found");
    }

    const plannedAmount = authorization.amount.centAmount;

    const container = "nn-private-data";
    const key = `${paymentId}-${pspReference}`;

    let customObject: any = null;
    let creditedAmount = 0;

    try {
      const response = await projectApiRoot
        .customObjects()
        .withContainerAndKey({
          container,
          key,
        })
        .get()
        .execute();

      customObject = response.body;
      creditedAmount = Number(customObject.value?.creditedAmount ?? 0);
    } catch (error: any) {
      const status =
        error?.statusCode ?? error?.status ?? error?.body?.statusCode;
      if (status !== 404) throw error;
      log.info("[CREDIT] No existing credit state found", {
        paymentId,
        key,
      });
      creditedAmount = 0;
    }

    if (
      !eventTID ||
      !Number.isSafeInteger(creditAmount) ||
      creditAmount <= 0 ||
      currency !== payment.amountPlanned.currencyCode
    ) {
      throw new Error("Invalid credit TID, amount or currency");
    }
    const preCreditRefundedAmount = Number(
      customObject?.value?.preCreditRefundedAmount ?? 0,
    );
    if (
      !Number.isSafeInteger(preCreditRefundedAmount) ||
      preCreditRefundedAmount < 0 ||
      preCreditRefundedAmount >= plannedAmount ||
      !Number.isSafeInteger(creditedAmount) ||
      creditedAmount < 0
    ) {
      throw new Error("Invalid stored pre-credit refund or credit amount");
    }
    const remainingPayable = plannedAmount - preCreditRefundedAmount;
    if (creditedAmount > remainingPayable)
      throw new Error("Credit exceeds remaining payable amount");
    const creditEvents: Record<string, number> = {
      ...(customObject?.value?.creditEvents ?? {}),
    };
    const creditEventComments: Record<string, string> = {
      ...(customObject?.value?.creditEventComments ?? {}),
    };
    transactionComments = creditEventComments[eventTID] ?? transactionComments;
    if (
      creditEvents[eventTID] != null &&
      creditEvents[eventTID] !== creditAmount
    ) {
      throw new Error("Credit TID already used for another amount");
    }
    const creditState = await customObjectService.update(
      container,
      key,
      (current) => {
        const events = { ...current.creditEvents };
        const comments = { ...current.creditEventComments };
        if (events[eventTID] != null && events[eventTID] !== creditAmount)
          throw new Error("Credit TID already used for another amount");
        const nextCredit =
          Number(current.creditedAmount ?? 0) +
          (events[eventTID] == null ? creditAmount : 0);
        const payable =
          plannedAmount - Number(current.preCreditRefundedAmount ?? 0);
        if (!Number.isSafeInteger(nextCredit) || nextCredit > payable)
          throw new Error("Credit exceeds remaining payable amount");
        events[eventTID] = creditAmount;
        comments[eventTID] ??= transactionComments;
        return {
          ...current,
          creditedAmount: nextCredit,
          creditEvents: events,
          creditEventComments: comments,
        };
      },
    );
    creditedAmount = creditState.body.value.creditedAmount;
    Object.assign(creditEvents, creditState.body.value.creditEvents);
    Object.assign(
      creditEventComments,
      creditState.body.value.creditEventComments,
    );
    transactionComments = creditEventComments[eventTID];

    const fullyPaid = creditedAmount === remainingPayable;

    log.info("[CREDIT] Credit calculation", {
      paymentId,
      currentCredit: creditAmount,
      totalCredited: creditedAmount,
      plannedAmount,
      preCreditRefundedAmount,
      remainingAmount: Math.max(remainingPayable - creditedAmount, 0),
      fullyPaid,
    });

    log.info("[CREDIT] Payment update decision", {
      paymentId,
      state: fullyPaid ? "Success" : "Pending",
      interfaceCode: fullyPaid ? "100" : "98",
      skipSettlement: true,
    });

    if (fullyPaid && authorization.type === "Authorization") {
      await this.addSettlementTransactionIfRequired({
        paymentId,
        pspReference,
        transactionType: "Charge",
        amount: creditedAmount,
        currency,
        status: "CONFIRMED",
      });
    }

    await this.processWebhookTransaction({
      webhook,
      transactionComments,
      state: fullyPaid ? "Success" : "Pending",
      setStatusInterfaceCode: fullyPaid,
      statusCodeOverride: fullyPaid ? "100" : undefined,
      avoidDuplicateComment: true,
      skipSettlement: true,
    });

    const existingComments =
      customObject?.value?.additionalInfo?.comments ?? "";

    const finalComments = ensureCommentOccurrences(
      existingComments,
      transactionComments,
      1,
    );

    await customObjectService.upsert(container, key, {
      ...(customObject?.value ?? {}),
      creditedAmount,
      creditEvents,
      creditEventComments,
      additionalInfo: {
        ...(customObject?.value?.additionalInfo ?? {}),
        comments: finalComments,
        lastCreditTid: eventTID,
        lastCreditAmount: creditAmount,
      },
    });

    try {
      const states = this.mapNovalnetOrderStates({
        status: webhook.transaction?.status,
        eventType: "CREDIT",
        isPartialCredit: !fullyPaid,
      });
      if (states) await this.updateOrderStates({ paymentId, ...states });
    } catch (error) {
      log.error("[ORDER_STATE] Credit state synchronization failed", {
        paymentId,
        eventTID,
        error,
      });
      throw error;
    }

    log.info("[CREDIT] Completed", {
      paymentId,
      eventTID,
      parentTID,
      creditedAmount,
      plannedAmount,
      remainingAmount: Math.max(remainingPayable - creditedAmount, 0),
      fullyPaid,
      statusCode: fullyPaid ? "100" : "98",
    });

    return transactionComments;
  }

  private async handleInformationalEvent(
    webhook: Record<string, any>,
  ): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;
    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;
    if (!paymentId || !pspReference)
      throw new Error("Missing payment reference");
    const locale = normalizeLocale(
      webhook.custom?.lang ?? webhook.custom?.inputval3,
    );
    const comment = this.buildTransactionComments(webhook, locale);
    await this.updatePaymentTransaction({
      paymentId,
      pspReference,
      transactionComments: comment,
      avoidDuplicateComment: true,
      setCustomType: true,
      setStatusInterfaceCode: false,
      changeTransactionState: false,
    });
    await this.syncPaymentToOrder(paymentId, pspReference);
    return comment;
  }

  public async handleChargeback(webhook: Record<string, any>): Promise<string> {
    const paymentId =
      webhook.custom?.["ctpayment-id"] ?? webhook.custom?.inputval1;

    const pspReference =
      webhook.custom?.pspReference ?? webhook.custom?.inputval2;

    if (!paymentId || !pspReference) {
      throw new Error("Missing ctpayment-id or pspReference");
    }

    const lang = webhook.custom?.lang ?? webhook.custom?.inputval3;
    const locale = normalizeLocale(lang);

    const transactionComments = this.buildTransactionComments(webhook, locale);

    log.info("[CHARGEBACK] Webhook received", {
      paymentId,
      pspReference,
      eventType: webhook.event?.type,
      eventTid: webhook.event?.tid,
      parentTid: webhook.event?.parent_tid,
      amount: webhook.transaction?.amount,
      currency: webhook.transaction?.currency,
      status: webhook.transaction?.status,
    });

    await this.updatePaymentTransaction({
      paymentId,
      pspReference: pspReference,
      transactionComments,
      statusCode: webhook.transaction?.status_code,
      state: "Failure",
      appendComments: true,
      avoidDuplicateComment: true,
      setCustomType: true,
      setStatusInterfaceCode: true,
      changeTransactionState: false,
      errorMessage: "Charge transaction not found",
    });

    const eventTid = String(webhook.event?.tid ?? "");
    if (!eventTid) throw new Error("Missing chargeback event TID");
    const root = projectApiRoot.payments().withId({ ID: paymentId });
    const latest = (await root.get().execute()).body;
    const amount = Number(webhook.transaction?.amount);
    const existing = latest.transactions.find(
      (tx) => tx.type === "Chargeback" && tx.interactionId === eventTid,
    );
    const charged = latest.transactions
      .filter((tx) => tx.type === "Charge" && tx.state === "Success")
      .reduce((total, tx) => total + tx.amount.centAmount, 0);
    const reversed = latest.transactions
      .filter((tx) => tx.type === "Chargeback" && tx.state === "Success")
      .reduce((total, tx) => total + tx.amount.centAmount, 0);
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      webhook.transaction?.currency !== latest.amountPlanned.currencyCode ||
      reversed + (existing ? 0 : amount) > charged
    )
      throw new Error(
        "Chargeback amount or currency does not match the captured Payment",
      );
    if (!existing) {
      await root
        .post({
          body: {
            version: latest.version,
            actions: [
              {
                action: "addTransaction",
                transaction: {
                  type: "Chargeback",
                  state: "Success",
                  interactionId: eventTid,
                  timestamp: new Date().toISOString(),
                  amount: {
                    centAmount: Number(webhook.transaction?.amount),
                    currencyCode: String(
                      webhook.transaction?.currency ??
                        latest.amountPlanned.currencyCode,
                    ),
                  },
                },
              },
            ],
          },
        })
        .execute();
    }

    await this.syncPaymentToOrder(paymentId, pspReference);

    const container = "nn-private-data";
    const key = `${paymentId}-${pspReference}`;

    let customObject: any = null;

    try {
      const response = await projectApiRoot
        .customObjects()
        .withContainerAndKey({
          container,
          key,
        })
        .get()
        .execute();

      customObject = response.body;
    } catch {
      customObject = null;
    }

    const existingComments =
      customObject?.value?.additionalInfo?.comments ?? "";

    const finalComments = existingComments.includes(transactionComments)
      ? existingComments
      : existingComments
        ? `${existingComments}\n\n---\n${transactionComments}`
        : transactionComments;

    await customObjectService.upsert(container, key, {
      ...(customObject?.value ?? {}),
      status: "FAILURE",
      additionalInfo: {
        ...(customObject?.value?.additionalInfo ?? {}),
        comments: finalComments,
        lastChargebackTid: String(webhook.event?.tid ?? ""),
        lastChargebackAmount: Number(webhook.transaction?.amount ?? 0),
      },
    });

    log.info("[CHARGEBACK] Completed", {
      paymentId,
      pspReference,
    });

    return transactionComments;
  }

  public async validateRequiredParameters(payload: any) {
    if (
      !/^\d{1,30}$/.test(String(payload.event?.tid ?? "")) ||
      !/^\d{1,30}$/.test(String(payload.transaction?.tid ?? ""))
    )
      throw new Error("Invalid Novalnet transaction ID");
    const mandatory: Record<string, string[]> = {
      event: ["type", "checksum", "tid"],
      merchant: ["vendor", "project"],
      result: ["status"],
      transaction: ["tid", "payment_type", "status"],
    };
    for (const category of Object.keys(mandatory)) {
      if (!payload[category]) {
        throw new Error(`Missing category: ${category}`);
      }

      for (const param of mandatory[category]) {
        if (!payload[category][param]) {
          log.info(`Missing parameter ${param} in ${category}`);
          throw new Error(`Missing parameter ${param} in ${category}`);
        }
      }
    }
  }

  public async validateIpAddress(req: FastifyRequest): Promise<void> {
    const webhookTestMode = String(getConfig()?.novalnetWebhookTestMode);

    if (webhookTestMode === "1") {
      return;
    }

    const novalnetHostIPs = await dns.resolve4("pay-nn.de");

    if (!novalnetHostIPs.length) {
      log.error("Novalnet HOST IP missing");

      throw new Error("Novalnet HOST IP missing");
    }

    const isAuthorized = this.validateRequestIp(req, novalnetHostIPs);

    if (!isAuthorized) {
      log.warn("Unauthorized webhook IP", {
        requestIp: req.ip,
        forwardedFor: req.headers["x-forwarded-for"],
        realIp: req.headers["x-real-ip"],
        allowedIps: novalnetHostIPs,
      });

      throw new Error(
        `Unauthorized access from IP ${webhookCallerIp(req.ip, req.headers["x-forwarded-for"])}`,
      );
    }
  }

  private validateRequestIp(
    req: FastifyRequest,
    novalnetHostIPs: string[],
  ): boolean {
    const remoteIp = webhookCallerIp(req.ip, req.headers["x-forwarded-for"]);
    return novalnetHostIPs.includes(remoteIp);
  }

  private async validateChecksum(webhook: Record<string, any>): Promise<void> {
    const tid = webhook.event?.tid;
    const eventType = webhook.event?.type;
    const resultStatus = webhook.result?.status;
    const amount = webhook.transaction?.amount;
    const currency = webhook.transaction?.currency;

    let checksumString =
      String(tid ?? "") + String(eventType ?? "") + String(resultStatus ?? "");

    if (amount !== undefined) {
      checksumString += String(amount);
    }

    if (currency) {
      checksumString += String(currency);
    }

    const accessKey = String(getConfig()?.novalnetPrivateKey ?? "").trim();
    if (!accessKey) throw new Error("Novalnet Access Key is missing.");
    const reversedKey = accessKey.split("").reverse().join("");

    if (accessKey) {
      checksumString += reversedKey;
    }

    const generatedChecksum = crypto
      .createHash("sha256")
      .update(checksumString)
      .digest("hex");

    log.info("[CHECKSUM][HASH]", {
      matched: generatedChecksum === webhook.event?.checksum,
    });

    if (generatedChecksum !== webhook.event?.checksum) {
      log.error("[CHECKSUM][FAILED]", { eventType, tid });

      throw new Error("Checksum validation failed");
    }
  }

  public async createRedirectPayment(
    request: CreatePaymentRequest,
  ): Promise<PaymentResponseSchemaDTO> {
    const type = String(request.data?.paymentMethod?.type ?? "");

    const lang = normalizeLocale(request.data?.lang);

    const path = String(request.data?.path ?? "");

    const config = getConfig();

    await createTransactionCommentsType();

    const { testMode, paymentAction, minimumAmount, enforce3d } =
      getNovalnetConfigValues(type, config);

    const cartId = getCartIdFromContext();

    const ctCart = await this.ctCartService.getCart({
      id: cartId,
    });

    const deliveryAddress = await this.ctcc(ctCart);

    const billingAddress = await this.ctbb(ctCart);

    const parsedCart = typeof ctCart === "string" ? JSON.parse(ctCart) : ctCart;

    const processorURL = Context.getProcessorUrlFromContext();

    const sessionId = Context.getCtSessionIdFromContext();

    const paymentAmount = await this.ctCartService.getPaymentAmount({
      cart: ctCart,
    });

    const deliveryStreet = this.splitStreetByComma(deliveryAddress?.streetName);

    const billingStreet = this.splitStreetByComma(billingAddress?.streetName);

    const deliveryAddressStreetName = deliveryStreet.streetName;

    const deliveryAddressStreetNumber = deliveryStreet.streetNumber;

    const billingAddressStreetName = billingStreet.streetName;

    const billingAddressStreetNumber = billingStreet.streetNumber;

    const paymentInterface = getPaymentInterfaceFromContext() ?? "";

    const ctPayment = await this.ctPaymentService.createPayment({
      amountPlanned: paymentAmount,

      paymentMethodInfo: {
        paymentInterface,
        method: getPaymentMethodName("en", type),
        name: getPaymentMethodNames(type),
      },

      ...(ctCart.customerId && {
        customer: {
          typeId: "customer",
          id: ctCart.customerId,
        },
      }),

      ...(!ctCart.customerId &&
        ctCart.anonymousId && {
          anonymousId: ctCart.anonymousId,
        }),
    });

    await this.ctCartService.addPayment({
      resource: {
        id: ctCart.id,
        version: ctCart.version,
      },

      paymentId: ctPayment.id,
    });

    const pspReference = randomUUID().toString();

    const transactionComments = "";

    await this.ctPaymentService.updatePayment({
      id: ctPayment.id,

      pspReference,

      paymentMethod: request.data.paymentMethod.type,

      transaction: {
        type: "Authorization",

        amount: ctPayment.amountPlanned,

        interactionId: pspReference,

        state: "Pending",

        custom: {
          type: {
            typeId: "type",
            key: "novalnet-custom-field",
          },

          fields: {
            transactionComments,
          },
        },
      } as unknown as any,
    } as any);

    const orderNumber = getFutureOrderNumberFromContext() ?? "";

    const ctPaymentId = ctPayment.id;

    let firstName = "";
    let lastName = "";

    if (ctCart.customerId) {
      const customerRes = await projectApiRoot
        .customers()
        .withId({
          ID: ctCart.customerId,
        })
        .get()
        .execute();

      const ctCustomer = customerRes.body;

      firstName = ctCustomer.firstName ?? "";

      lastName = ctCustomer.lastName ?? "";
    } else {
      firstName = ctCart.shippingAddress?.firstName ?? "";

      lastName = ctCart.shippingAddress?.lastName ?? "";
    }

    const { returnUrl, errorReturnUrl } = this.createPaymentReturnUrls({
      processorURL,
      sessionId,
      paymentReference: ctPayment.id,
      orderNumber,
      ctPaymentID: ctPayment.id,
      pspReference,
      lang,
      path: String(request.data?.path ?? ""),
    });

    const hookUrl = new URL("/novalnletWebhook", processorURL);

    const transaction: Record<string, any> = {
      test_mode: Number(testMode) === 1 ? "1" : "0",

      payment_type: type.toUpperCase(),

      amount: String(paymentAmount.centAmount ?? ""),

      currency: paymentAmount.currencyCode ?? "",

      return_url: returnUrl,

      error_return_url: errorReturnUrl,

      hook_url: hookUrl.toString(),

      order_no: orderNumber,

      ...getNovalnetSystemInfo(
        path || config.merchantReturnUrl,
        packageJSON.version,
      ),
    };

    if (type.toUpperCase() === "CREDITCARD") {
      const panHash = String(request.data.paymentMethod?.panHash ?? "");

      const uniqueId = String(request.data.paymentMethod?.uniqueId ?? "");

      if (!panHash || !uniqueId) {
        throw new Error("Credit card pan_hash or unique_id is missing");
      }

      if (enforce3d === "1") {
        transaction.enforce_3d = 1;
      }

      transaction.payment_data = {
        pan_hash: panHash,

        unique_id: uniqueId,
      };
    }

    const novalnetPayload = {
      merchant: {
        signature: String(getConfig()?.novalnetPublicKey ?? ""),

        tariff: String(getConfig()?.novalnetTariff ?? ""),
      },

      customer: {
        billing: {
          city: String(billingAddress?.city ?? ""),

          country_code: String(billingAddress?.country ?? ""),

          house_no: String(billingAddressStreetNumber),

          street: String(billingAddressStreetName),

          zip: String(billingAddress?.postalCode ?? ""),
        },

        shipping: {
          city: String(deliveryAddress?.city ?? ""),

          country_code: String(deliveryAddress?.country ?? ""),

          house_no: String(deliveryAddressStreetNumber),

          street: String(deliveryAddressStreetName),

          zip: String(deliveryAddress?.postalCode ?? ""),
        },

        first_name: firstName,

        last_name: lastName,

        email: parsedCart.customerEmail ?? "",

        customer_ip: request.customerIp ?? "",
      },

      transaction,

      ...(type.toUpperCase() === "PAYPAL" && {
        cart_info: buildPayPalCartInfo(parsedCart, lang === "de" ? "de" : "en"),
      }),

      custom: {
        lang: String(lang).toUpperCase(),
        input1: "ctpayment-id",

        inputval1: String(ctPaymentId ?? ""),

        input2: "pspReference",

        inputval2: String(pspReference ?? ""),

        input3: "lang",

        inputval3: lang,
      },
    };

    const authorizationMinimum = Number(minimumAmount);
    const orderAmount = Number(
      parsedCart?.taxedPrice?.totalGross?.centAmount ??
        parsedCart?.totalPrice?.centAmount,
    );
    const authorizeRedirect =
      ["PAYPAL", "CREDITCARD"].includes(type.toUpperCase()) &&
      paymentAction?.toLowerCase() === "authorize" &&
      Number.isFinite(authorizationMinimum) &&
      (authorizationMinimum <= 0 || orderAmount >= authorizationMinimum);

    let parsedResponse: any = {};

    try {
      parsedResponse = await this.callNovalnet(
        authorizeRedirect
          ? novalnetEndpoint("authorize")
          : novalnetEndpoint("payment"),
        novalnetPayload,
      );
    } catch (err) {
      log.error("Failed to process redirect payment with Novalnet:", err);

      throw new Error("Payment initialization failed");
    }

    if (parsedResponse?.result?.status !== "SUCCESS") {
      log.error("Novalnet API error - Status not SUCCESS:", {
        status: parsedResponse?.result?.status,

        statusText: parsedResponse?.result?.status_text,
      });

      return redirectFailureResponse(ctPaymentId, parsedResponse)!;
    }

    const redirectUrl = parsedResponse?.result?.redirect_url;

    const txnSecret = parsedResponse?.transaction?.txn_secret;

    if (!txnSecret) {
      log.error("No txn_secret in Novalnet response:", {
        transaction: parsedResponse?.transaction,
      });

      throw new Error(
        "Payment initialization failed - missing transaction secret",
      );
    }

    return {
      paymentReference: ctPaymentId,

      txnSecret: redirectUrl,
    };
  }

  public createPaymentReturnUrls({
    processorURL,
    sessionId,
    paymentReference,
    orderNumber,
    ctPaymentID,
    pspReference,
    lang,
    path,
  }: {
    processorURL: string;
    sessionId: string;
    paymentReference: string;
    orderNumber: string;
    ctPaymentID: string;
    pspReference: string;
    lang: string;
    path: string;
  }): {
    returnUrl: string;
    errorReturnUrl: string;
  } {
    const shopUrl = new URL(path);
    if (
      !["https:", "http:"].includes(shopUrl.protocol) ||
      shopUrl.username ||
      shopUrl.password
    )
      throw new Error("Invalid storefront URL");
    const successUrl = new URL("/success", processorURL);

    successUrl.searchParams.set("paymentReference", paymentReference);

    successUrl.searchParams.set("ctsid", sessionId);

    successUrl.searchParams.set("orderNumber", orderNumber);

    successUrl.searchParams.set("ctPaymentID", ctPaymentID);

    successUrl.searchParams.set("pspReference", pspReference);

    successUrl.searchParams.set("lang", lang);

    successUrl.searchParams.set("path", path);

    const failureUrl = new URL("/failure", processorURL);

    failureUrl.searchParams.set("paymentReference", paymentReference);

    failureUrl.searchParams.set("ctsid", sessionId);

    failureUrl.searchParams.set("orderNumber", orderNumber);

    failureUrl.searchParams.set("ctPaymentID", ctPaymentID);

    failureUrl.searchParams.set("pspReference", pspReference);

    failureUrl.searchParams.set("lang", lang);

    failureUrl.searchParams.set("path", path);

    const token = signReturnParameters({
      paymentReference,
      ctsid: sessionId,
      orderNumber,
      ctPaymentID,
      pspReference,
      lang,
      path,
    });
    successUrl.searchParams.set("nnReturnToken", token);
    failureUrl.searchParams.set("nnReturnToken", token);

    return {
      returnUrl: successUrl.toString(),
      errorReturnUrl: failureUrl.toString(),
    };
  }

  private async createPendingPaymentTransaction({
    paymentId,
    amount,
    pspReference,
    paymentMethod,
  }: {
    paymentId: string;
    amount: any;
    pspReference: string;
    paymentMethod: string;
  }) {
    await this.ctPaymentService.updatePayment({
      id: paymentId,
      pspReference,
      paymentMethod,
      transaction: {
        type: "Authorization",
        amount,
        interactionId: pspReference,
        state: "Pending",
      },
    } as any);
  }

  private async addSettlementTransactionIfRequired({
    paymentId,
    pspReference,
    amount,
    currency,
    transactionType,
  }: {
    paymentId: string;
    pspReference: string;
    amount?: string | number;
    currency?: string;
    transactionType: "Authorization" | "Charge" | "CancelAuthorization";
    status: string;
  }) {
    if (transactionType === "Authorization") return;

    const paymentRes = await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .get()
      .execute();

    const payment = paymentRes.body;
    const interactionId = `${pspReference}-${transactionType}`;
    const alreadyAdded = payment.transactions?.some(
      (transaction) =>
        transaction.interactionId === interactionId ||
        (transactionType === "Charge" &&
          transaction.type === "Charge" &&
          transaction.state === "Success" &&
          transaction.interactionId === pspReference),
    );

    if (alreadyAdded) {
      log.info("Settlement transaction already exists", {
        paymentId,
        transactionType,
        interactionId,
      });
      return;
    }

    const transactionAmount =
      amount != null
        ? {
            centAmount: Number(amount),
            currencyCode: String(
              currency ?? payment.amountPlanned.currencyCode,
            ),
          }
        : payment.amountPlanned;
    if (
      !Number.isSafeInteger(transactionAmount.centAmount) ||
      transactionAmount.centAmount < 0 ||
      transactionAmount.currencyCode !== payment.amountPlanned.currencyCode ||
      transactionAmount.centAmount > payment.amountPlanned.centAmount
    )
      throw new Error("Invalid settlement amount or currency");

    await projectApiRoot
      .payments()
      .withId({ ID: paymentId })
      .post({
        body: {
          version: payment.version,
          actions: [
            {
              action: "addTransaction",
              transaction: {
                type: transactionType,
                timestamp: new Date().toISOString(),
                amount: transactionAmount,
                interactionId,
                state: "Success",
              },
            },
          ],
        },
      })
      .execute();
  }

  private buildTransactionComments(
    webhook: Record<string, any>,
    locale: SupportedLocale,
  ): string {
    const eventType = String(webhook.event?.type ?? "");
    const eventTID = String(webhook.event?.tid ?? "");
    const parentTID = String(webhook.event?.parent_tid ?? "");

    const paymentType = webhook.transaction?.payment_type ?? "";
    const isTestMode = Number(webhook.transaction?.test_mode) === 1;

    const localeCode = locale === "de" ? "de-DE" : "en-GB";

    let date = "";
    let time = "";

    if (webhook.transaction?.date) {
      [date, time] = String(webhook.transaction.date).split(" ");
    } else {
      const now = new Date();

      date = new Intl.DateTimeFormat(localeCode, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Europe/Berlin",
      }).format(now);

      time = new Intl.DateTimeFormat(localeCode, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Europe/Berlin",
      }).format(now);
    }

    switch (eventType) {
      case "PAYMENT": {
        const comments: string[] = [
          t(locale, "payment.transactionId", { tid: eventTID }),
          t(locale, "payment.paymentType", {
            type: getPaymentMethodName(locale, paymentType),
          }),
        ];

        if (isTestMode) {
          comments.push(t(locale, "payment.testMode"));
        }

        const bankDetails = webhook.transaction?.bank_details;

        if (bankDetails) {
          comments.push("", bankTransferDetails(webhook.transaction, locale));
        }

        if (String(paymentType).toUpperCase() === "MULTIBANCO" && !isTestMode) {
          const reference = multibancoReferenceDetails(
            webhook.transaction ?? {},
            locale,
          );
          if (reference) comments.push("", reference);
        }

        return comments.join("\n");
      }

      case "TRANSACTION_CAPTURE":
        return t(locale, "callback.captureComment", {
          date,
          time,
        });

      case "TRANSACTION_CANCEL":
        return t(locale, "callback.cancelComment", {
          date,
          time,
        });

      case "TRANSACTION_REFUND":
        return (
          t(locale, "callback.refundComment", {
            eventTID: parentTID,
            formattedAmount: formatNovalnetAmount(
              webhook.transaction?.refund?.amount,
              String(
                webhook.transaction?.refund?.currency ??
                  webhook.transaction?.currency ??
                  "",
              ),
              locale,
            ),
          }) +
          (webhook.transaction?.refund?.tid
            ? t(locale, "callback.refundTidSuffix", { refundTID: eventTID })
            : "")
        );

      case "PAYMENT_REMINDER_1":
      case "PAYMENT_REMINDER_2":
        return t(locale, "callback.paymentRemainderComment", {
          reminderIndex: eventType.slice(-1),
        });

      case "SUBMISSION_TO_COLLECTION_AGENCY":
        return t(locale, "callback.collectionSubmissionComment", {
          collectionReference: String(webhook.collection?.reference ?? ""),
        });

      case "CREDIT": {
        return t(locale, "callback.creditComment", {
          parentTID,
          formattedAmount: formatNovalnetAmount(
            webhook.transaction?.amount,
            String(webhook.transaction?.currency ?? ""),
            locale,
          ),
          date,
          time,
          transactionID: eventTID,
        });
      }

      case "TRANSACTION_UPDATE": {
        const updateType = String(
          webhook.transaction?.update_type ?? "",
        ).toUpperCase();

        const formattedAmount = formatNovalnetAmount(
          webhook.transaction?.amount,
          String(webhook.transaction?.currency ?? ""),
          locale,
        );

        switch (updateType) {
          case "AMOUNT":
            return t(locale, "callback.amountUpdateComment", {
              eventTID,
              formattedAmount,
              date,
              time,
            });

          case "DUE_DATE":
            return t(locale, "callback.dueDateUpdateComment", {
              dueDate: String(webhook.transaction?.due_date ?? ""),
            });
          case "AMOUNT_DUE_DATE":
            return t(locale, "callback.amountAndDueDateUpdateComment", {
              formattedAmount,
              date,
              time,
              dueDate: String(webhook.transaction?.due_date ?? ""),
            });

          case "STATUS":
            return t(locale, "callback.onholdToComplete", {
              eventTID,
              date,
              time,
            });

          default:
            return "";
        }
      }
      case "CHARGEBACK":
      case "RETURN_DEBIT":
      case "RETURN_DEBIT_SEPA":
      case "REVERSAL":
        return t(locale, "callback.chargebackComment", {
          parentTID,
          formattedAmount: formatNovalnetAmount(
            webhook.transaction?.amount,
            String(webhook.transaction?.currency ?? ""),
            locale,
          ),
          date,
          time,
          eventTID,
        });

      default:
        return "";
    }
  }

  public splitStreetByComma(street?: string): {
    streetName: string;
    streetNumber: string;
  } {
    if (!street) {
      return { streetName: "", streetNumber: "" };
    }

    const parts = street.split(",");

    if (parts.length < 2) {
      return { streetName: street.trim(), streetNumber: "" };
    }

    return {
      streetName: parts[0].trim(),
      streetNumber: parts.slice(1).join(",").trim(),
    };
  }
}
