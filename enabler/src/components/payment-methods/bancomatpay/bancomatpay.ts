import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod
} from "../../../payment-enabler/payment-enabler";

import { BaseComponent } from "../../base";

import styles from "../../../style/style.module.scss";
import buttonStyles from "../../../style/button.module.scss";

import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from "../../../dtos/novalnet-payment.dto";

import { BaseOptions } from "../../../payment-enabler/novalnet-payment-enabler";

export class BancomatpayBuilder implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Bancomatpay(this.baseOptions, config);
  }
}

export class Bancomatpay extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(
      PaymentMethod.bancomat,
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
      console.warn("[BANCOMAT Pay] Container not found:", safeSelector);
      return;
    }

    container.insertAdjacentHTML(
      "afterbegin",
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
          type: "BANCOMATPAY",
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

        console.error("[BANCOMAT Pay] HTTP error:", {
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

      console.error("[BANCOMAT Pay] Submit error:", {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });

      this.onError("Some error occurred. Please try again.");
    }
  }

  private _getTemplate() {

    const locale = this.getLanguage();

    const description =
      locale.startsWith("de")
        ? "Sie werden zu BANCOMAT Pay weitergeleitet. Um eine erfolgreiche Zahlung zu gewährleisten, darf die Seite nicht geschlossen oder neu geladen werden, bis die Bezahlung abgeschlossen ist"
        : "You will be redirected to BANCOMAT Pay. Please don’t close or refresh the browser until the payment is completed";

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
