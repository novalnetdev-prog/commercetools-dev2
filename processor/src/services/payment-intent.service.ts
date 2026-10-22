import { CommercetoolsPaymentService } from "@commercetools/connect-payments-sdk";
import {
  Payment,
  PaymentUpdateAction,
  Transaction,
} from "@commercetools/platform-sdk";
import JSONbig from "json-bigint";
import { createHash, randomUUID } from "node:crypto";
import { getConfig } from "../config/config";
import {
  PaymentIntentRequestSchemaDTO,
  PaymentIntentResponseSchemaDTO,
  PaymentModificationStatus,
} from "../dtos/operations/payment-intents.dto";
import { normalizeLocale, SupportedLocale, t } from "../i18n";
import { log } from "../libs/logger";
import { projectApiRoot } from "../utils/ct-client";
import {
  createOrderPaymentCommentsType,
  createTransactionCommentsType,
} from "../utils/custom-fields";
import customObjectService from "./ct-custom-object.service";
import { mapNovalnetOrderStates } from "./novalnet-order-state.service";
import { reconcilePreCreditRefund } from "./pre-credit-refund";
import {
  ensureCommentOccurrences,
  formatNovalnetAmount,
  paymentTransactionComments,
} from "../utils/novalnet-request";

import { novalnetEndpoint } from "../utils/novalnet-endpoint";
type Action = PaymentIntentRequestSchemaDTO["actions"][number];
type Modification = "capture" | "cancel" | "refund";
type NovalnetReply = {
  result?: {
    status?: string;
    status_text?: string;
    status_code?: string | number;
  };
  transaction?: {
    tid?: string;
    status?: string;
    status_code?: string | number;
    amount?: string | number;
    currency?: string;
    refunded_amount?: string | number;
    refund?: {
      tid?: string;
      status?: string;
      amount?: string | number;
      currency?: string;
    };
  };
  refund?: {
    tid?: string;
    status?: string;
    amount?: string | number;
    currency?: string;
  };
};

type Reference = {
  original: Transaction;
  pspReference: string;
  tid: string;
  privateData: Record<string, any>;
};

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sum(
  payment: Payment,
  type: Transaction["type"],
  states: Transaction["state"][] = ["Success"],
): number {
  return (payment.transactions ?? [])
    .filter(
      (transaction) =>
        transaction.type === type && states.includes(transaction.state),
    )
    .reduce((total, transaction) => total + transaction.amount.centAmount, 0);
}

function kindOf(action: Action): Modification {
  if (action.action === "capturePayment") return "capture";
  if (action.action === "refundPayment") return "refund";
  return "cancel";
}

function modificationFor(payment: Payment, action: Action): Modification {
  if (action.action === "reversePayment" && sum(payment, "Charge") > 0)
    return "refund";
  return kindOf(action);
}

function validate(payment: Payment, action: Action): void {
  const kind = modificationFor(payment, action);
  const authorized = sum(payment, "Authorization", ["Success"]);
  const charged = sum(payment, "Charge");
  const chargeStarted = sum(payment, "Charge", ["Pending", "Success"]) > 0;
  const refundedOrPending = sum(payment, "Refund", ["Pending", "Success"]);
  const cancelled =
    sum(payment, "CancelAuthorization", ["Pending", "Success"]) > 0;
  const preCreditAuthorization = (payment.transactions ?? []).find(
    (tx) =>
      tx.type === "Authorization" && ["Pending", "Success"].includes(tx.state),
  );
  const preCredit =
    action.action === "refundPayment" &&
    charged === 0 &&
    !!preCreditAuthorization;

  if ("amount" in action) {
    requireValue(
      Number.isSafeInteger(action.amount.centAmount) &&
        action.amount.centAmount > 0,
      "Invalid amount.",
    );
    requireValue(
      action.amount.currencyCode === payment.amountPlanned.currencyCode,
      "Currency mismatch.",
    );
  }
  if (kind === "capture") {
    requireValue(
      authorized > 0 && !cancelled && !chargeStarted,
      "Authorization cannot be captured.",
    );
    requireValue(
      action.action === "capturePayment" &&
        action.amount.centAmount === authorized,
      "Novalnet requires full authorization capture.",
    );
  } else if (kind === "cancel") {
    requireValue(
      authorized > 0 && !cancelled && !chargeStarted,
      "Authorization cannot be cancelled.",
    );
  } else {
    const refundAmount =
      action.action === "refundPayment"
        ? action.amount.centAmount
        : charged - refundedOrPending;
    requireValue(
      preCredit
        ? !cancelled &&
            refundAmount > 0 &&
            refundAmount <= preCreditAuthorization!.amount.centAmount
        : charged > 0 &&
            refundAmount > 0 &&
            refundAmount <= charged - refundedOrPending,
      "Refund exceeds the remaining captured amount.",
    );
    requireValue(
      action.action !== "reversePayment" ||
        authorized === 0 ||
        charged === authorized,
      "Partially captured payment requires separate refund and authorization cancellation.",
    );
  }
}

async function findReference(
  payment: Payment,
  kind: Modification,
  action: Action,
): Promise<Reference> {
  const matches = [...(payment.transactions ?? [])]
    .reverse()
    .filter((transaction) =>
      kind === "refund"
        ? ((transaction.type === "Charge" && transaction.state === "Success") ||
            (action.action === "refundPayment" &&
              sum(payment, "Charge") === 0 &&
              transaction.type === "Authorization" &&
              ["Pending", "Success"].includes(transaction.state))) &&
          (action.action !== "refundPayment" ||
            !action.transactionId ||
            transaction.id === action.transactionId)
        : transaction.type === "Authorization" &&
          transaction.state === "Success",
    );

  const original =
    kind === "refund"
      ? (matches.find(
          (transaction) => !transaction.interactionId?.endsWith("-Charge"),
        ) ?? matches[0])
      : matches[0];
  requireValue(
    original?.interactionId,
    "Original payment transaction not found.",
  );

  const pspReference =
    original.type === "Charge" && original.interactionId.endsWith("-Charge")
      ? original.interactionId.slice(0, -"-Charge".length)
      : original.interactionId;
  const privateObject = (
    await projectApiRoot
      .customObjects()
      .withContainerAndKey({
        container: "nn-private-data",
        key: `${payment.id}-${pspReference}`,
      })
      .get()
      .execute()
  ).body;
  requireValue(privateObject?.value, "Private payment data not found.");
  const tid = String(privateObject.value.tid ?? "");
  requireValue(/^\d+$/.test(tid), "Novalnet TID missing.");
  return { original, pspReference, tid, privateData: privateObject.value };
}

async function callNovalnet(
  endpoint: string,
  transaction: object,
  custom: Record<string, string>,
  timeoutMs = 20000,
): Promise<NovalnetReply> {
  const accessKey = getConfig().novalnetPrivateKey;
  requireValue(accessKey, "Novalnet Access Key is missing.");
  const controller = new AbortController();
  // Checkout times out a Payment Intent after 30 seconds; reserve time to save
  // the result locally. Never retry an ambiguous financial request here.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(novalnetEndpoint(endpoint), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-NN-Access-Key": Buffer.from(accessKey).toString("base64"),
      },
      body: JSON.stringify({ transaction, custom }),
    });
    if (!response.ok) throw new Error(`Novalnet HTTP ${response.status}`);
    const parsed = JSONbig({ storeAsString: true }).parse(
      await response.text(),
    );
    return JSON.parse(JSON.stringify(parsed)) as NovalnetReply;
  } finally {
    clearTimeout(timer);
  }
}

function getOutcome(
  kind: Modification,
  reply: NovalnetReply,
): PaymentModificationStatus {
  const apiStatus = String(reply.result?.status ?? "").toUpperCase();
  if (apiStatus === "FAILURE") return PaymentModificationStatus.REJECTED;
  if (apiStatus !== "SUCCESS") return PaymentModificationStatus.RECEIVED;

  const status = String(
    kind === "refund"
      ? (reply.transaction?.refund?.status ??
          reply.refund?.status ??
          reply.transaction?.status ??
          "")
      : (reply.transaction?.status ?? ""),
  ).toUpperCase();
  if (status === "FAILURE") return PaymentModificationStatus.REJECTED;
  if (status === "PENDING" || status === "ON_HOLD")
    return PaymentModificationStatus.RECEIVED;
  if (kind === "capture" && status === "CONFIRMED")
    return PaymentModificationStatus.APPROVED;
  if (
    kind === "cancel" &&
    (status === "CANCELLED" || status === "DEACTIVATED")
  ) {
    return PaymentModificationStatus.APPROVED;
  }
  if (kind === "refund" && (status === "CONFIRMED" || status === "SUCCESS")) {
    return PaymentModificationStatus.APPROVED;
  }
  return PaymentModificationStatus.RECEIVED; // Unknown statuses must not complete CT transactions.
}

function localeOf(payment: Payment, reference: Reference): SupportedLocale {
  const locale = (payment.custom?.fields?.lang ??
    payment.custom?.fields?.language) as string | undefined;
  if (locale !== undefined && locale !== null) return normalizeLocale(locale);
  const initial = String(
    reference.original.custom?.fields?.transactionComments ?? "",
  );
  return initial.includes("Novalnet Transaktions-ID:") ? "de" : "en";
}

function commentFor(
  kind: Modification,
  payment: Payment,
  reference: Reference,
  amount: number,
  refundTid?: string,
): string {
  const locale = localeOf(payment, reference);
  if (kind === "refund") {
    return (
      t(locale, "callback.refundComment", {
        eventTID: reference.tid,
        formattedAmount: formatNovalnetAmount(
          amount,
          payment.amountPlanned.currencyCode,
          locale,
        ),
      }) +
      (refundTid
        ? t(locale, "callback.refundTidSuffix", { refundTID: refundTid })
        : "")
    );
  }
  const now = new Date();
  const localeCode = locale === "de" ? "de-DE" : "en-GB";
  const date = new Intl.DateTimeFormat(localeCode, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Berlin",
  }).format(now);
  const time = new Intl.DateTimeFormat(localeCode, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Europe/Berlin",
  }).format(now);
  return t(
    locale,
    kind === "capture" ? "callback.captureComment" : "callback.cancelComment",
    { date, time },
  );
}

async function syncOrderComment(
  paymentId: string,
  pspReference: string,
  requiredComment?: string,
): Promise<void> {
  const payment = (
    await projectApiRoot.payments().withId({ ID: paymentId }).get().execute()
  ).body;
  const original = [...payment.transactions]
    .reverse()
    .find((tx) => tx.interactionId === pspReference);
  if (!original) return;
  const comment = paymentTransactionComments(payment.transactions);
  requireValue(
    !requiredComment ||
      String(original.custom?.fields?.transactionComments ?? "").includes(
        requiredComment,
      ),
    "Pre-credit refund comment was not saved on the original Payment transaction.",
  );
  let commentTypeId: string | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    const orderResults = await projectApiRoot
      .orders()
      .get({
        queryArgs: {
          where: `paymentInfo(payments(id=${JSON.stringify(paymentId)}))`,
          limit: 1,
        },
      })
      .execute();
    const orderRef = orderResults.body.results[0];
    if (!orderRef) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      log.warn("[PAYMENT_INTENT] Order not yet linked to payment", {
        paymentId,
      });
      throw new Error(
        "Order not yet linked to payment for comment synchronization",
      );
    }
    const order = (
      await projectApiRoot.orders().withId({ ID: orderRef.id }).get().execute()
    ).body;
    if (!commentTypeId) {
      await createOrderPaymentCommentsType();
      commentTypeId = (
        await projectApiRoot
          .types()
          .withKey({ key: "order-payment-comments" })
          .get()
          .execute()
      ).body.id;
    }
    if (order.custom?.type && order.custom.type.id !== commentTypeId) {
      log.warn(
        "[PAYMENT_INTENT] Order has another Custom Type; comment remains on Payment",
        { paymentId },
      );
      return;
    }
    const actions: any[] = [];
    if (order.custom?.type?.id !== commentTypeId) {
      actions.push({
        action: "setCustomType",
        type: { key: "order-payment-comments", typeId: "type" },
      });
    }
    if (order.custom?.fields?.paymentComments !== comment) {
      actions.push({
        action: "setCustomField",
        name: "paymentComments",
        value: comment,
      });
    }
    if (!actions.length) return;
    try {
      await projectApiRoot
        .orders()
        .withId({ ID: order.id })
        .post({
          body: { version: order.version, actions },
        })
        .execute();
      return;
    } catch (error: any) {
      const status =
        error?.statusCode ?? error?.status ?? error?.body?.statusCode;
      if (status !== 409 || attempt === 3) throw error;
    }
  }
}

async function syncIntentOrderStates(
  paymentId: string,
  kind: Modification | "preCredit",
  reply: NovalnetReply,
): Promise<void> {
  const states =
    kind === "preCredit"
      ? { paymentState: "Pending" as const }
      : mapNovalnetOrderStates({
          status: reply.transaction?.status,
          eventType:
            kind === "capture"
              ? "TRANSACTION_CAPTURE"
              : kind === "cancel"
                ? "TRANSACTION_CANCEL"
                : "TRANSACTION_REFUND",
          isPartialCapture: false,
        });
  if (!states) return;

  const results = await projectApiRoot
    .orders()
    .get({
      queryArgs: {
        where: `paymentInfo(payments(id=${JSON.stringify(paymentId)}))`,
        limit: 1,
      },
    })
    .execute();
  const order = results.body.results[0];
  if (!order) {
    log.warn("[PAYMENT_INTENT] Order not linked to Payment for state sync", {
      paymentId,
      kind,
    });
    throw new Error(
      "Order not yet linked to Payment for state synchronization",
    );
  }

  if ((order.paymentInfo?.payments?.length ?? 0) > 1) return;
  const actions: any[] = [];
  if (order.paymentState !== states.paymentState) {
    actions.push({
      action: "changePaymentState",
      paymentState: states.paymentState,
    });
  }
  if (actions.length) {
    await projectApiRoot
      .orders()
      .withId({ ID: order.id })
      .post({
        body: { version: order.version, actions },
      })
      .execute();
  }
}

async function saveCaptureOrCancel(
  payment: Payment,
  reference: Reference,
  kind: "capture" | "cancel",
  reply: NovalnetReply,
  commentOverride?: string,
  commentOccurrences = 1,
): Promise<void> {
  await createTransactionCommentsType();
  const root = projectApiRoot.payments().withId({ ID: payment.id });
  const latest = (await root.get().execute()).body;
  const original = latest.transactions.find(
    (tx) => tx.id === reference.original.id,
  );
  requireValue(original, "Original payment transaction disappeared.");
  const comment =
    commentOverride ??
    commentFor(kind, latest, reference, original.amount.centAmount);
  const actions: PaymentUpdateAction[] = [];
  if (!original.custom?.type) {
    actions.push({
      action: "setTransactionCustomType",
      transactionId: original.id,
      type: { key: "novalnet-custom-field", typeId: "type" },
    });
  }
  const combined = ensureCommentOccurrences(
    String(original.custom?.fields?.transactionComments ?? ""),
    comment,
    commentOccurrences,
  );
  if (combined !== original.custom?.fields?.transactionComments) {
    actions.push({
      action: "setTransactionCustomField",
      transactionId: original.id,
      name: "transactionComments",
      value: combined,
    });
  }
  const statusCode =
    reply.transaction?.status_code ?? reply.result?.status_code;
  if (
    statusCode != null &&
    latest.paymentStatus?.interfaceCode !== String(statusCode)
  ) {
    actions.push({
      action: "setStatusInterfaceCode",
      interfaceCode: String(statusCode),
    });
  }
  if (kind === "capture") {
    const interactionId = `${reference.pspReference}-Charge`;
    if (
      !latest.transactions.some(
        (tx) => tx.type === "Charge" && tx.interactionId === interactionId,
      )
    ) {
      actions.push({
        action: "addTransaction",
        transaction: {
          type: "Charge",
          amount: {
            centAmount: original.amount.centAmount,
            currencyCode: original.amount.currencyCode,
          },
          interactionId,
          state: "Success",
          timestamp: new Date().toISOString(),
        },
      });
    }
  } else {
    const interactionId = `${reference.pspReference}-CancelAuthorization`;
    if (
      !latest.transactions.some(
        (tx) =>
          tx.type === "CancelAuthorization" &&
          tx.interactionId === interactionId,
      )
    ) {
      actions.push({
        action: "addTransaction",
        transaction: {
          type: "CancelAuthorization",
          amount: original.amount,
          interactionId,
          state: "Success",
          timestamp: new Date().toISOString(),
        },
      });
    }
  }
  if (actions.length)
    await root.post({ body: { version: latest.version, actions } }).execute();
  await syncOrderComment(payment.id, reference.pspReference);
}

async function savePreCreditRefund(
  payment: Payment,
  reference: Reference,
  reply: NovalnetReply,
  amount: number,
): Promise<void> {
  const status = String(reply.transaction?.status ?? "").toUpperCase();
  const originalAmount = reference.original.amount.centAmount;
  let previouslyRefunded = Number(
    reference.privateData.preCreditRefundedAmount ?? 0,
  );
  if (
    status === "DEACTIVATED" &&
    originalAmount - previouslyRefunded !== amount &&
    Number(reply.transaction?.amount) === amount
  ) {
    const reportedPrevious = originalAmount - amount;
    if (
      Number.isSafeInteger(reportedPrevious) &&
      reportedPrevious > previouslyRefunded &&
      Number(reference.privateData.creditedAmount ?? 0) === 0
    ) {
      log.warn(
        "[PAYMENT_INTENT] Reconciling missing pre-credit reduction from Novalnet balance",
        {
          paymentId: payment.id,
          previouslyRefunded,
          reportedPrevious,
        },
      );
      previouslyRefunded = reportedPrevious;
    }
  }
  const { cancelled, remaining } = reconcilePreCreditRefund({
    originalAmount,
    previouslyRefunded,
    refundAmount: amount,
    expectedCurrency: payment.amountPlanned.currencyCode,
    transaction: reply.transaction,
  });
  const root = projectApiRoot.payments().withId({ ID: payment.id });
  const latest = (await root.get().execute()).body;
  requireValue(
    Number(reference.privateData.creditedAmount ?? 0) === 0,
    "Pre-credit reduction received after credit.",
  );
  const comment = commentFor("refund", latest, reference, amount);
  const eventKey = `balance-${remaining}`;
  const saved = await customObjectService.update(
    "nn-private-data",
    `${payment.id}-${reference.pspReference}`,
    (current) => {
      const events = { ...current.preCreditRefundEvents };
      if (events[eventKey] && events[eventKey].amount !== amount)
        throw new Error(
          "Pre-credit refund balance already belongs to another amount.",
        );
      events[eventKey] = { amount, remaining, comment };
      const occurrences = Object.values(events).filter(
        (event: any) => event.comment === comment,
      ).length;
      return {
        ...current,
        status,
        preCreditRefundedAmount: Math.max(
          Number(current.preCreditRefundedAmount ?? 0),
          originalAmount - remaining,
        ),
        preCreditRemainingAmount: Math.min(
          Number(current.preCreditRemainingAmount ?? originalAmount),
          remaining,
        ),
        preCreditRefundEvents: events,
        additionalInfo: {
          ...current.additionalInfo,
          comments: ensureCommentOccurrences(
            current.additionalInfo?.comments ?? "",
            comment,
            occurrences,
          ),
        },
      };
    },
  );
  const occurrences = Object.values(
    saved.body.value.preCreditRefundEvents,
  ).filter((event: any) => event.comment === comment).length;
  if (cancelled) {
    await saveCaptureOrCancel(
      latest,
      reference,
      "cancel",
      reply,
      comment,
      occurrences,
    );
  } else {
    await createTransactionCommentsType();
    const original = latest.transactions.find(
      (tx) => tx.id === reference.original.id,
    );
    requireValue(original, "Original payment transaction disappeared.");
    const actions: PaymentUpdateAction[] = [];
    if (!original.custom?.type) {
      actions.push({
        action: "setTransactionCustomType",
        transactionId: original.id,
        type: { key: "novalnet-custom-field", typeId: "type" },
      });
    }
    const combined = ensureCommentOccurrences(
      String(original.custom?.fields?.transactionComments ?? ""),
      comment,
      occurrences,
    );
    if (combined !== original.custom?.fields?.transactionComments) {
      actions.push({
        action: "setTransactionCustomField",
        transactionId: original.id,
        name: "transactionComments",
        value: combined,
      });
    }
    const statusCode =
      reply.transaction?.status_code ?? reply.result?.status_code;
    if (
      statusCode != null &&
      latest.paymentStatus?.interfaceCode !== String(statusCode)
    ) {
      actions.push({
        action: "setStatusInterfaceCode",
        interfaceCode: String(statusCode),
      });
    }
    if (actions.length)
      await root.post({ body: { version: latest.version, actions } }).execute();
  }
  if (!cancelled)
    await syncOrderComment(payment.id, reference.pspReference, comment);
}

async function saveRefund(
  payment: Payment,
  reference: Reference,
  reply: NovalnetReply,
  amount: number,
): Promise<boolean> {
  const refund = reply.transaction?.refund ?? reply.refund;
  const refundTid = String(refund?.tid ?? "");
  if (!/^\d+$/.test(refundTid)) {
    log.warn(
      "[PAYMENT_INTENT] Refund accepted without refund TID; awaiting reconciliation",
      {
        paymentId: payment.id,
        tid: reference.tid,
      },
    );
    return false;
  }
  if (refund?.amount != null && Number(refund.amount) !== amount) {
    throw new Error(
      "Novalnet refund amount differs from the requested amount.",
    );
  }
  if (reply.transaction?.refunded_amount != null) {
    const reportedTotal = Number(reply.transaction.refunded_amount);
    requireValue(
      Number.isSafeInteger(reportedTotal) &&
        reportedTotal <= sum(payment, "Charge") &&
        reportedTotal >= amount,
      "Invalid Novalnet total refunded amount.",
    );
  }
  const currency =
    refund?.currency ??
    reply.transaction?.currency ??
    payment.amountPlanned.currencyCode;
  requireValue(
    currency === payment.amountPlanned.currencyCode,
    "Novalnet refund currency mismatch.",
  );
  await createTransactionCommentsType();
  const root = projectApiRoot.payments().withId({ ID: payment.id });
  const latest = (await root.get().execute()).body;
  const existing = latest.transactions.find(
    (tx) => tx.type === "Refund" && tx.interactionId === refundTid,
  );
  if (existing) {
    requireValue(
      existing.amount.centAmount === amount &&
        existing.amount.currencyCode === currency,
      "Refund TID already belongs to another amount.",
    );
  }
  const comment = commentFor("refund", latest, reference, amount, refundTid);
  const actions: PaymentUpdateAction[] = [];
  if (!existing) {
    actions.push({
      action: "addTransaction",
      transaction: {
        type: "Refund",
        amount: { centAmount: amount, currencyCode: currency },
        state: "Success",
        interactionId: refundTid,
        timestamp: new Date().toISOString(),
        custom: {
          type: { key: "novalnet-custom-field", typeId: "type" },
          fields: { transactionComments: comment },
        },
      },
    });
  } else if (existing.state !== "Success") {
    actions.push({
      action: "changeTransactionState",
      transactionId: existing.id,
      state: "Success",
    });
  }
  const statusCode =
    reply.transaction?.status_code ?? reply.result?.status_code;
  if (
    statusCode != null &&
    latest.paymentStatus?.interfaceCode !== String(statusCode)
  ) {
    actions.push({
      action: "setStatusInterfaceCode",
      interfaceCode: String(statusCode),
    });
  }
  if (actions.length)
    await root.post({ body: { version: latest.version, actions } }).execute();

  {
    const refundedAmount =
      sum(latest, "Refund") + (existing?.state === "Success" ? 0 : amount);
    await customObjectService.upsert(
      "nn-private-data",
      `${payment.id}-${reference.pspReference}`,
      {
        ...reference.privateData,
        tid: reference.tid,
        status: reply.transaction?.status ?? reference.privateData.status,
        refundedAmount: reply.transaction?.refunded_amount ?? refundedAmount,
        lastRefundTid: refundTid,
        lastRefundAmount: amount,
        additionalInfo: {
          ...(reference.privateData.additionalInfo ?? {}),
          comments: comment,
        },
      },
    );
  }
  await syncOrderComment(payment.id, reference.pspReference);
  return true;
}

export async function executePaymentIntent(
  ctPaymentService: CommercetoolsPaymentService,
  paymentId: string,
  data: PaymentIntentRequestSchemaDTO,
): Promise<PaymentIntentResponseSchemaDTO> {
  requireValue(data.actions.length === 1, "Exactly one action required.");
  const action = data.actions[0];
  const raw = await ctPaymentService.getPayment({ id: paymentId });
  const payment = ((raw as any).body ?? raw) as Payment;
  const kind = modificationFor(payment, action);
  let reference: Reference;
  try {
    reference = await findReference(payment, kind, action);
  } catch (error) {
    validate(payment, action);
    throw error;
  }
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        action: action.action,
        amount: "amount" in action ? action.amount.centAmount : undefined,
        currency: "amount" in action ? action.amount.currencyCode : undefined,
        transactionId:
          "transactionId" in action ? action.transactionId : undefined,
        merchantReference: action.merchantReference,
      }),
    )
    .digest("hex");
  const savedResult =
    action.merchantReference &&
    reference.privateData.modificationResults?.[fingerprint];
  if (savedResult) return savedResult;
  if (reference.privateData.pendingModification) {
    if (reference.privateData.pendingModification.fingerprint !== fingerprint)
      throw Object.assign(
        new Error(
          "A previous payment operation requires verification before another action.",
        ),
        { statusCode: 409 },
      );
    return {
      outcome: PaymentModificationStatus.RECEIVED,
      paymentReference: payment.id,
    };
  }
  validate(payment, action);
  const endpoint =
    kind === "capture"
      ? "/transaction/capture"
      : kind === "cancel"
        ? "/transaction/cancel"
        : "/transaction/refund";
  const transaction: { tid: string; amount?: number } = { tid: reference.tid };
  const refundAmount =
    kind === "refund"
      ? action.action === "refundPayment"
        ? action.amount.centAmount
        : sum(payment, "Charge") -
          sum(payment, "Refund", ["Pending", "Success"])
      : 0;
  if (kind === "refund") {
    const alreadyReduced = Number(
      reference.privateData.preCreditRefundedAmount ?? 0,
    );
    requireValue(
      Number.isSafeInteger(alreadyReduced) &&
        alreadyReduced >= 0 &&
        refundAmount <= reference.original.amount.centAmount - alreadyReduced,
      "Refund exceeds the remaining pre-credit amount.",
    );
  }
  if (kind === "refund") transaction.amount = refundAmount;
  requireValue(
    getConfig().novalnetPrivateKey,
    "Novalnet Access Key is missing.",
  );
  const privateKey = `${payment.id}-${reference.pspReference}`;
  const owner = randomUUID();
  // Guard the EXISTING private-data record against duplicate uncertain money
  // movements. No worker, expiring lease, separate container or extra route.
  await customObjectService.update("nn-private-data", privateKey, (current) => {
    if (current.pendingModification)
      throw Object.assign(
        new Error("Another payment operation is in progress."),
        { statusCode: 409 },
      );
    return {
      ...current,
      pendingModification: {
        owner,
        fingerprint,
        action: action.action,
        amount:
          kind === "refund"
            ? refundAmount
            : reference.original.amount.centAmount,
        currency: reference.original.amount.currencyCode,
        createdAt: new Date().toISOString(),
      },
    };
  });
  const finish = async (outcome: PaymentModificationStatus) => {
    const result = { outcome, paymentReference: payment.id };
    await customObjectService.update(
      "nn-private-data",
      privateKey,
      (current) => {
        if (current.pendingModification?.owner !== owner)
          throw new Error(
            "Payment operation ownership changed during synchronization.",
          );
        const next = { ...current };
        delete next.pendingModification;
        if (action.merchantReference)
          next.modificationResults = {
            ...current.modificationResults,
            [fingerprint]: result,
          };
        return next;
      },
    );
    return result;
  };
  let reply: NovalnetReply;
  try {
    reply = await callNovalnet(endpoint, transaction, {
      shop_invoked: "1",
      lang: localeOf(payment, reference).toUpperCase(),
    });
  } catch (error) {
    // A transport failure is not proof that Novalnet rejected the operation.
    // Keep the existing synchronous flow; never resend the financial request here.
    log.error("[PAYMENT_INTENT] Provider outcome must be verified", {
      paymentId: payment.id,
      kind,
      tid: reference.tid,
      error,
    });
    return {
      outcome: PaymentModificationStatus.RECEIVED,
      paymentReference: payment.id,
    };
  }
  if (
    kind !== "refund" &&
    reply.transaction?.tid &&
    String(reply.transaction.tid) !== reference.tid
  ) {
    throw new Error(
      "Novalnet response TID does not match the original transaction.",
    );
  }
  if (
    reply.transaction?.currency &&
    reply.transaction.currency !== payment.amountPlanned.currencyCode
  )
    throw new Error("Novalnet response currency does not match the Payment.");
  if (
    kind === "capture" &&
    String(reply.transaction?.status).toUpperCase() === "CONFIRMED" &&
    reply.transaction?.amount != null &&
    Number(reply.transaction.amount) !== reference.original.amount.centAmount
  )
    throw new Error(
      "Novalnet capture amount does not match the full authorization.",
    );
  const responseStatus = String(reply.transaction?.status ?? "").toUpperCase();
  const previousPreCreditRefund = Number(
    reference.privateData.preCreditRefundedAmount ?? 0,
  );
  const confirmedPreCreditReduction =
    responseStatus === "CONFIRMED" &&
    Number(reference.privateData.creditedAmount ?? 0) === 0 &&
    Number(reply.transaction?.amount) ===
      reference.original.amount.centAmount -
        previousPreCreditRefund -
        refundAmount &&
    Number(reply.transaction?.refund?.amount) === refundAmount;
  const preCredit =
    kind === "refund" &&
    String(reply.result?.status ?? "").toUpperCase() === "SUCCESS" &&
    (["DEACTIVATED", "PENDING"].includes(responseStatus) ||
      confirmedPreCreditReduction) &&
    !reply.transaction?.refund?.tid &&
    !reply.refund?.tid;
  const outcome = preCredit
    ? PaymentModificationStatus.APPROVED
    : getOutcome(kind, reply);
  log.info("[PAYMENT_INTENT] Novalnet modification result", {
    paymentId,
    kind,
    tid: reference.tid,
    outcome,
    apiStatus: reply.result?.status,
    transactionStatus: reply.transaction?.status,
    refundTid: reply.transaction?.refund?.tid ?? reply.refund?.tid,
  });
  if (outcome !== PaymentModificationStatus.APPROVED) {
    if (outcome === PaymentModificationStatus.REJECTED) return finish(outcome);
    return { outcome, paymentReference: payment.id };
  }
  try {
    if (kind === "refund") {
      if (preCredit) {
        await savePreCreditRefund(payment, reference, reply, refundAmount);
      } else if (!(await saveRefund(payment, reference, reply, refundAmount))) {
        return {
          outcome: PaymentModificationStatus.RECEIVED,
          paymentReference: payment.id,
        };
      }
    } else {
      await saveCaptureOrCancel(payment, reference, kind, reply);
    }
    await syncIntentOrderStates(
      payment.id,
      preCredit
        ? String(reply.transaction?.status).toUpperCase() === "DEACTIVATED"
          ? "cancel"
          : "preCredit"
        : kind,
      reply,
    );
    return await finish(PaymentModificationStatus.APPROVED);
  } catch (error) {
    log.error(
      "[PAYMENT_INTENT] Provider response could not be fully synchronized",
      {
        paymentId: payment.id,
        kind,
        error,
      },
    );
    return {
      outcome: PaymentModificationStatus.RECEIVED,
      paymentReference: payment.id,
    };
  }
}
