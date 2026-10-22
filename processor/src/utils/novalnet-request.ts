import { networkInterfaces } from "node:os";
import { SupportedLocale, t } from "../i18n";

export function getNovalnetSystemInfo(storefrontUrl: string, version: string) {
  let addresses: ReturnType<typeof networkInterfaces>[string][] = [];
  try {
    addresses = Object.values(networkInterfaces());
  } catch {
    // Some restricted runtimes do not expose network interfaces.
  }
  const interfaces = addresses.flat();
  const address = interfaces.find(
    (entry) => entry?.family === "IPv4" && !entry.internal,
  );
  let origin = "";
  try {
    origin = new URL(storefrontUrl).origin;
  } catch {
    // An absent storefront URL should not break an otherwise valid payment.
  }
  return {
    system_name: "commercetools",
    system_version: version ? "NN-" + version : "",
    system_ip: address?.address ?? "",
    system_url: origin,
  };
}

export function formatNovalnetAmount(
  amount: unknown,
  currency: string,
  locale: SupportedLocale,
): string {
  if (
    amount === undefined ||
    amount === null ||
    (typeof amount === "string" && !amount.trim()) ||
    !currency?.trim()
  )
    return "";
  const cents = Number(amount);
  if (!Number.isFinite(cents)) return String(amount);
  const formatter = new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  });
  // centAmount is a minor-unit integer; KRW/JPY have zero fraction digits,
  // while currencies such as BHD have three. EUR/USD retain two.
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return typeof digits === "number"
    ? formatter.format(cents / 10 ** digits)
    : "";
}

const paymentCommentSeparator = "\n\n---\n";

export function mergeInitialPaymentComments(
  existing: string,
  initial: string,
): string {
  const blocks = existing.split(paymentCommentSeparator).filter(Boolean);
  const initialId = initial.split("\n", 1)[0];
  const isInitial = (block: string) =>
    /^(Novalnet Transaction ID:|Novalnet Transaktions-ID:)/.test(block) ||
    block.startsWith(initialId);
  const previousInitial = blocks.find(isInitial) ?? "";

  const hasMultibancoReference = (comment: string) =>
    comment.includes("Partner Payment Reference:") ||
    comment.includes("Partner-Zahlungsreferenz:");
  const canonical =
    ((!initial.includes("IBAN:") && previousInitial.includes("IBAN:")) ||
      (!hasMultibancoReference(initial) &&
        hasMultibancoReference(previousInitial))) &&
    previousInitial.startsWith(initialId)
      ? previousInitial
      : initial;
  return [canonical, ...blocks.filter((block) => !isInitial(block))].join(
    paymentCommentSeparator,
  );
}

export function bankTransferReference(
  transaction: Record<string, any>,
  locale: SupportedLocale,
): string {
  const currency = String(transaction.currency ?? "");
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(transaction.due_date ?? ""))
    ? new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${transaction.due_date}T00:00:00Z`))
    : "";
  return t(locale, "payment.referenceText", {
    amount: formatNovalnetAmount(transaction.amount, currency, locale),
    dueDateText: dueDate
      ? t(locale, "payment.dueDateText", { date: dueDate })
      : "",
  });
}

export function bankTransferDetails(
  transaction: Record<string, any>,
  locale: SupportedLocale,
): string {
  const details = transaction.bank_details;
  if (!details) return "";
  const lines = [
    bankTransferReference(transaction, locale),
    details.account_holder &&
      t(locale, "payment.accountHolder", {
        accountHolder: String(details.account_holder),
      }),
    details.iban && t(locale, "payment.iban", { iban: String(details.iban) }),
    details.bic && t(locale, "payment.bic", { bic: String(details.bic) }),
    details.bank_name &&
      t(locale, "payment.bankName", { bankName: String(details.bank_name) }),
    details.bank_place &&
      t(locale, "payment.bankPlace", { bankPlace: String(details.bank_place) }),
  ].filter(Boolean) as string[];
  const tid = transaction.tid;
  if (tid || transaction.invoice_ref) {
    lines.push(t(locale, "payment.paymentReferences"));
    if (tid)
      lines.push(
        t(locale, "payment.paymentReferenceTid", { tid: String(tid) }),
      );
    if (transaction.invoice_ref)
      lines.push(
        t(locale, "payment.paymentReferenceInvoice", {
          reference: String(transaction.invoice_ref),
        }),
      );
  }
  return lines.join("\n");
}

export function multibancoReferenceDetails(
  transaction: Record<string, any>,
  locale: SupportedLocale,
): string {
  const reference = String(transaction.partner_payment_reference ?? "").trim();
  if (!reference) return "";
  const entity = String(transaction.service_supplier_id ?? "").trim();
  return [
    t(locale, "payment.multibancoInstructions", {
      amount: formatNovalnetAmount(
        transaction.amount,
        String(transaction.currency ?? ""),
        locale,
      ),
    }),
    t(locale, "payment.multibancoPartnerReference", { reference }),
    entity ? t(locale, "payment.multibancoEntity", { entity }) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function updateBankTransferReference(
  comments: string,
  transaction: Record<string, any>,
  locale: SupportedLocale,
): string {
  if (!transaction.due_date) return comments;
  const referenceMarkers = [
    "Please transfer the amount of",
    "Bitte überweisen Sie den Betrag",
  ];
  const lines = comments.split("\n");
  const index = lines.findIndex((line) =>
    referenceMarkers.some((marker) => line.startsWith(marker)),
  );
  if (index < 0) return comments;
  lines[index] = bankTransferReference(transaction, locale);
  return lines.join("\n");
}

export function buildPayPalCartInfo(cart: any, locale: SupportedLocale) {
  let discount = 0;
  const lineItems = (cart.lineItems ?? []).map((item: any) => ({
    category: "physical",
    description: "",
    name:
      item.name?.[locale] ??
      item.name?.en ??
      Object.values(item.name ?? {})[0] ??
      "",
    price: item.price?.value?.centAmount ?? "",
    quantity: item.quantity,
  }));
  for (const item of cart.lineItems ?? []) {
    discount += Math.max(
      0,
      Number(item.price?.value?.centAmount ?? 0) * Number(item.quantity ?? 0) -
        Number(item.totalPrice?.centAmount ?? 0),
    );
  }
  for (const item of cart.customLineItems ?? []) {
    discount += Math.max(
      0,
      Number(item.money?.centAmount ?? 0) * Number(item.quantity ?? 0) -
        Number(item.totalPrice?.centAmount ?? 0),
    );
    lineItems.push({
      category: "",
      description: "",
      name:
        item.name?.[locale] ??
        item.name?.en ??
        Object.values(item.name ?? {})[0] ??
        "",
      price: item.money?.centAmount ?? "",
      quantity: item.quantity,
    });
  }
  discount += Number(
    cart.discountOnTotalPrice?.discountedAmount?.centAmount ?? 0,
  );
  const shipping = Number(
    cart.shippingInfo?.discountedPrice?.value?.centAmount ??
      cart.shippingInfo?.price?.centAmount ??
      0,
  );
  const tax = cart.taxedPrice
    ? Number(cart.taxedPrice.totalGross?.centAmount ?? 0) -
      Number(cart.taxedPrice.totalNet?.centAmount ?? 0)
    : 0;
  if (discount)
    lineItems.push({
      category: "",
      description: "",
      name: "Discount",
      price: -discount,
      quantity: 1,
    });
  return {
    items_shipping_price: shipping,
    items_tax_price: Math.max(0, tax),
    line_items: lineItems,
  };
}

/** Keep separate operations with identical wording while avoiding copies of
 * the same comment history on more than one transaction. */
export function ensureCommentOccurrences(
  existing: string,
  comment: string,
  count: number,
): string {
  const blocks = existing.split(paymentCommentSeparator).filter(Boolean);
  let present = blocks.filter((block) => block === comment).length;
  while (present++ < count) blocks.push(comment);
  return blocks.join(paymentCommentSeparator);
}

export function paymentTransactionComments(
  transactions: Array<{ custom?: { fields?: Record<string, unknown> } }>,
): string {
  const result: string[] = [];
  const maximum = new Map<string, number>();
  for (const transaction of transactions) {
    const value = transaction.custom?.fields?.transactionComments;
    if (typeof value !== "string") continue;
    const within = new Map<string, number>();
    for (const block of value
      .split(paymentCommentSeparator)
      .map((item) => item.trim())
      .filter(Boolean)) {
      const count = (within.get(block) ?? 0) + 1;
      within.set(block, count);
      if (count > (maximum.get(block) ?? 0)) {
        result.push(block);
        maximum.set(block, count);
      }
    }
  }
  return result.join(paymentCommentSeparator);
}
