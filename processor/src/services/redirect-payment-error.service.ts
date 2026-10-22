import { createHash } from "node:crypto";
import { projectApiRoot } from "../utils/ct-client";

const CONTAINER = "novalnet-redirect-errors";
const LIFETIME_MS = 15 * 60 * 1000;
type Notice = {
  noticeId: string;
  paymentReference: string;
  transactionStatusText: string;
  expiresAt: number;
  acknowledged?: boolean;
};
const statusCode = (error: unknown) =>
  (error as { statusCode?: number })?.statusCode;

/** A cart-scoped UI notification. This service never writes financial state. */
export class RedirectPaymentErrorService {
  private resource(cartId: string) {
    return projectApiRoot
      .customObjects()
      .withContainerAndKey({ container: CONTAINER, key: cartId });
  }

  private async get(cartId: string) {
    try {
      return (await this.resource(cartId).get().execute()).body;
    } catch (error) {
      if (statusCode(error) === 404) return;
      throw error;
    }
  }

  async record(
    paymentReference: string,
    pspReference: string,
    message: string,
  ): Promise<void> {
    const payment = (
      await projectApiRoot
        .payments()
        .withId({ ID: paymentReference })
        .get()
        .execute()
    ).body;
    const original = payment.transactions.find(
      (tx) => tx.interactionId === pspReference,
    );
    if (
      !original ||
      original.state === "Success" ||
      payment.transactions.some(
        (tx) => tx.type === "Charge" && tx.state === "Success",
      )
    )
      return;
    const carts = await projectApiRoot
      .carts()
      .get({
        queryArgs: {
          where: `paymentInfo(payments(id=${JSON.stringify(paymentReference)}))`,
          limit: 1,
        },
      })
      .execute();
    const cartId = carts.body.results[0]?.id;
    if (!cartId) return;
    const noticeId = createHash("sha256")
      .update(`${paymentReference}:${pspReference}`)
      .digest("hex");
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await this.get(cartId);
      if (previous?.value?.noticeId === noticeId) return; // Do not re-arm a consumed return URL.
      try {
        await projectApiRoot
          .customObjects()
          .post({
            body: {
              container: CONTAINER,
              key: cartId,
              version: previous?.version ?? 0,
              value: {
                noticeId,
                paymentReference,
                transactionStatusText: message.slice(0, 500),
                expiresAt: Date.now() + LIFETIME_MS,
              } satisfies Notice,
            },
          })
          .execute();
        return;
      } catch (error) {
        if (statusCode(error) !== 409 || attempt === 2) throw error;
      }
    }
  }

  async read(cartId: string): Promise<Notice | undefined> {
    if (!cartId) return;
    const stored = await this.get(cartId);
    if (!stored) return;
    const notice = stored.value as Notice;
    if (
      !notice ||
      typeof notice.expiresAt !== "number" ||
      notice.expiresAt <= Date.now()
    ) {
      try {
        await this.resource(cartId)
          .delete({ queryArgs: { version: stored.version } })
          .execute();
      } catch (error) {
        if (![404, 409].includes(statusCode(error) ?? 0)) throw error;
      }
      return;
    }
    if (notice.acknowledged || !notice.noticeId || !notice.paymentReference)
      return;
    return notice;
  }

  async acknowledge(cartId: string, noticeId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = await this.get(cartId);
      if (
        !stored ||
        stored.value?.noticeId !== noticeId ||
        stored.value.acknowledged
      )
        return;
      try {
        await projectApiRoot
          .customObjects()
          .post({
            body: {
              container: CONTAINER,
              key: cartId,
              version: stored.version,
              value: { ...stored.value, acknowledged: true },
            },
          })
          .execute();
        return;
      } catch (error) {
        if (statusCode(error) !== 409 || attempt === 2) throw error;
      }
    }
  }
}

export default new RedirectPaymentErrorService();
