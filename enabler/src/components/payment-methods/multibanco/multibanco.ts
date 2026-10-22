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

export class MultibancoBuilder implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(config: ComponentOptions): PaymentComponent {
    return new Multibanco(this.baseOptions, config);
  }
}

export class Multibanco extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {
    super(
      PaymentMethod.multibanco,
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
      console.warn("[Multibanco] Container not found:", safeSelector);
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
          type: "MULTIBANCO",
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

        const errorText =
          await response.text();

        console.error("[Multibanco] HTTP error:", {
          status: response.status,
          body: errorText,
        });

        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data =
        await response.json();

      if (data?.paymentReference) {

        this.onComplete?.({
          isSuccess: true,
          paymentReference: data.paymentReference,
        });

      } else {

        this.onError(
          data?.transactionStatusText ||
          "Payment failed. Please try again."
        );
      }

    } catch (e) {

      console.error("[Multibanco] Submit error:", {
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
        ? "Nach erfolgreichem Bestellabschluss erhalten Sie eine Zahlungsreferenz. Damit können Sie entweder an einem Multibanco-Geldautomaten oder im Onlinebanking bezahlen"
        : "On successful checkout, you will receive a payment reference. Using this payment reference, you can either pay in the Multibanco ATM or through your online bank account";

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
