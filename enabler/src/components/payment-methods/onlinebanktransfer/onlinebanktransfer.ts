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

export class OnlinebanktransferBuilder
  implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {

    return new Onlinebanktransfer(
      this.baseOptions,
      config
    );
  }
}

export class Onlinebanktransfer
  extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {

    super(
      PaymentMethod.onlinebanktransfer,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;
  }

  mount(selector: string) {

    const safeSelector =
      "#" + CSS.escape(
        selector.substring(1)
      );

    const container =
      document.querySelector(
        safeSelector
      );

    if (!container) {

      console.warn(
        "[Online Bank Transfer] Container not found:",
        safeSelector
      );

      return;
    }

    container.insertAdjacentHTML(
      "afterbegin",
      this._getTemplate()
    );

    setTimeout(() => {

      const paymentLabel =
        container.querySelector("label");

      if (
        paymentLabel &&
        paymentLabel.textContent
          ?.toLowerCase()
          .includes("onlinebanktransfer")
      ) {

        paymentLabel.textContent =
          "Online bank transfer";
      }

    }, 100);

    if (this.showPayButton) {

      const button =
        container.querySelector(
          "#onlinebanktransfer-paymentButton"
        );

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

      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {
          type: "ONLINE_BANK_TRANSFER",
        },

        paymentOutcome:
          PaymentOutcome.AUTHORIZED,

        lang:
          this.getLanguage(),

        path:
          baseSiteUrl,
      };

      const response = await fetch(
        this.processorUrl + "/redirectPayment",
        {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Session-Id":
              this.sessionId,
          },

          body: JSON.stringify(
            requestData
          ),
        }
      );

      if (!response.ok) {

        const errorText =
          await response.text();

        console.error(
          "[Online Bank Transfer] HTTP error:",
          {
            status: response.status,
            body: errorText,
          }
        );

        throw new Error(
          `HTTP error! status: ${response.status}`
        );
      }

      const data =
        await response.json();

      if (data?.txnSecret) {

        window.location.href =
          data.txnSecret;

      } else {

        this.onError(
          data?.transactionStatusText ||
          "Payment failed. Please try again."
        );
      }

    } catch (e) {

      console.error(
        "[Online Bank Transfer] Submit error:",
        {
          message:
            e instanceof Error
              ? e.message
              : String(e),

          stack:
            e instanceof Error
              ? e.stack
              : undefined,
        }
      );

      this.onError(
        "Some error occurred. Please try again."
      );
    }
  }

  private _getTemplate() {

    const locale =
      document.documentElement.lang || "en";

    const description =
      locale.startsWith("de")
        ? "Sie werden auf die Banking-Seite weitergeleitet. Bitte schließen oder aktualisieren Sie den Browser nicht, bis die Zahlung abgeschlossen ist"
        : "You will be redirected to banking page. Please don’t close or refresh the browser until the payment is completed";

    return `
      <div
        id="novalnet-onlinebanktransfer-wrapper"
        class="${styles.wrapper}"
      >

        <p>
          ${description}
        </p>

        ${
          this.showPayButton
            ? `
            <button
              class="${buttonStyles.button}
              ${buttonStyles.fullWidth}
              ${styles.submitButton}"

              type="button"

              id="onlinebanktransfer-paymentButton"
            >
              ${
                locale.startsWith("de")
                  ? "Bezahlen"
                  : "Pay Now"
              }
            </button>
            `
            : ""
        }

      </div>
    `;
  }
}
