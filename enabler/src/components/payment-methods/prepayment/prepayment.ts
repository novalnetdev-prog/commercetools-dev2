import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from "../../../payment-enabler/payment-enabler";

import { BaseComponent } from "../../base";

import styles from "../../../style/style.module.scss";
import buttonStyles from "../../../style/button.module.scss";

import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from "../../../dtos/novalnet-payment.dto";

import { BaseOptions } from "../../../payment-enabler/novalnet-payment-enabler";

export class PrepaymentBuilder implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Prepayment(this.baseOptions, config);
  }
}

export class Prepayment extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(
      PaymentMethod.prepayment,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;
  }

  mount(selector: string) {

    const safeSelector =
      "#" + CSS.escape(selector.substring(1));

    const container =
      document.querySelector(safeSelector);

    if (!container) {
      console.error("[Prepayment] Container not found:", safeSelector);
      return;
    }

    container.insertAdjacentHTML(
      "beforeend",
      this._getTemplate()
    );

    if (this.showPayButton) {

      const button =
        container.querySelector("#purchaseOrderForm-paymentButton");

      if (button) {

        button.addEventListener(
          "click",
          (e) => {
            e.preventDefault();
            this.submit();
          }
        );
      }
    }
  }

  async submit() {

    this.beginPayment();

    const url =
      new URL(window.location.href);

    const baseSiteUrl =
      url.origin;

    try {

      const requestData: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: "PREPAYMENT",
        },

        paymentOutcome: PaymentOutcome.AUTHORIZED,

        lang: this.getLanguage(),

        path: baseSiteUrl,
      };

      const response = await fetch(
        this.processorUrl + "/directPayment",
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "X-Session-Id": this.sessionId,
          },

          body: JSON.stringify(requestData),
        }
      );

      if (!response.ok) {

        const errorText = await response.text();

        console.error("[Prepayment] HTTP error", {
          status: response.status,
          body: errorText,
        });

        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (String(data?.transactionStatus ?? "").toUpperCase() === "FAILURE") {
        this.onError?.(data?.transactionStatusText || "Payment failed. Please try again.",
          { paymentReference: data?.paymentReference });
        return;
      }

      if (data?.paymentReference) {

        this.onComplete?.({
          isSuccess: true,
          paymentReference: data.paymentReference,
        });

        return;
      }

      this.onError("Some error occurred. Please try again.");

    } catch (e) {

      console.error("[Prepayment] Submit error", {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });

      this.onError("Some error occurred. Please try again.");
    }
  }

  private _getTemplate() {

    const locale =
      document.documentElement.lang || "en";

    const description =
      locale.startsWith("de")
        ? "Sie erhalten eine E-Mail mit den Bankdaten von Novalnet, um die Zahlung abzuschließen"
        : "You will receive an e-mail with the Novalnet account details to complete the payment";

    return this.showPayButton
      ? `
      <div class="${styles.wrapper}">
        <p>${description}</p>

        <button
          class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}"
          id="purchaseOrderForm-paymentButton"
          type="button"
        >
          ${locale.startsWith("de") ? "Bezahlen" : "Pay"}
        </button>
      </div>
      `
      : "";
  }
}
