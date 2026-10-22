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

export class IdealBuilder implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(private baseOptions: BaseOptions) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Ideal(this.baseOptions, config);
  }
}

export class Ideal extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(PaymentMethod.ideal, baseOptions, componentOptions);

    this.showPayButton =
      componentOptions?.showPayButton ?? false;
  }

  mount(selector: string) {
    
    const safeSelector =
      "#" + CSS.escape(selector.substring(1));

    const container =
      document.querySelector(safeSelector);

    if (!container) {
      console.warn("[iDEAL] Container not found:", safeSelector);
      return;
    }

    container.insertAdjacentHTML(
      "afterbegin",
      this._getTemplate()
    );

    setTimeout(() => {
      const labels = container.querySelectorAll("label");

      labels.forEach((label) => {
        const text = label.textContent?.trim().toLowerCase();

        if (text?.includes("ideal")) {
          label.textContent = "iDEAL | Wero";
        }
      });
    }, 100);

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
          type: "IDEAL",
        },

        paymentOutcome: PaymentOutcome.AUTHORIZED,

        lang: this.getLanguage(),

        path: baseSiteUrl,
      };

      const response = await fetch(
        this.processorUrl + "/redirectPayment",
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

        console.error("[iDEAL] HTTP error:", {
          status: response.status,
          body: errorText,
        });

        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data?.txnSecret) {

        window.location.href = data.txnSecret;

      } else {

        this.onError(
          data?.transactionStatusText ||
          "Payment failed. Please try again."
        );
      }

    } catch (e) {

      console.error("[iDEAL] Submit error:", {
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
        ? "Sie werden zu iDEAL | Wero weitergeleitet. Um eine erfolgreiche Zahlung zu gewährleisten, darf die Seite nicht geschlossen oder neu geladen werden, bis die Bezahlung abgeschlossen ist"
        : "You will be redirected to iDEAL | Wero. Please don’t close or refresh the browser until the payment is completed";

    return this.showPayButton
      ? `
      <div class="${styles.wrapper}">
        <p>${description}</p>

        <button
          class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}"
          id="purchaseOrderForm-paymentButton"
          type="button"
        >
          ${locale.startsWith("de") ? "Bezahlen" : "Pay Now"}
        </button>
      </div>
      `
      : "";
  }
}
