import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod
} from '../../../payment-enabler/payment-enabler';
import { BaseComponent } from "../../base";
import styles from '../../../style/style.module.scss';
import buttonStyles from "../../../style/button.module.scss";
import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from "../../../dtos/novalnet-payment.dto";
import { BaseOptions } from "../../../payment-enabler/novalnet-payment-enabler";


export class GuaranteedInvoiceBuilder
  implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {

    return new GuaranteedInvoice(
      this.baseOptions,
      config
    );
  }
}

export class GuaranteedInvoice extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {

    super(
      PaymentMethod.GuaranteedInvoice,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;
  }

  async mount(selector: string) {

    const safeSelector =
      '#' + CSS.escape(
        selector.substring(1)
      );

    const container =
      document.querySelector(
        safeSelector
      );

    if (!container) {

      console.error(
        "[Guaranteed Invoice] Container not found:",
        safeSelector
      );

      return;
    }

    await this.loadNovalnetUtility();

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
          .includes("guaranteed")
      ) {

        paymentLabel.textContent =
          "Invoice with payment guarantee";
      }

      this.initializeDobHandling();

    }, 100);

    if (this.showPayButton) {

      document
        .querySelector(
          "#GuaranteedInvoiceForm-paymentButton"
        )
        ?.addEventListener(
          "click",
          (e) => {

            e.preventDefault();

            this.submit();
          }
        );
    }
  }

  private async loadNovalnetUtility(): Promise<void> {

    if (window.NovalnetUtility) {

      return;
    }

    await new Promise<void>((resolve, reject) => {

      const script =
        document.createElement("script");

      script.src =
        "https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js";

      script.async = true;

      script.onload = () => {

        resolve();
      };

      script.onerror = reject;

      document.head.appendChild(script);
    });
  }

  private initializeDobHandling() {

    const dobInput =
      document.getElementById(
        "nn_birthdate"
      ) as HTMLInputElement | null;

    if (!dobInput || !window.NovalnetUtility) {

      console.warn(
        "[Guaranteed Invoice] DOB initialization skipped"
      );

      return;
    }

    window.NovalnetUtility.setBirthDateFormat(
      "DD.MM.YYYY"
    );

    dobInput.addEventListener(
      "keydown",
      (event) => {

        window.NovalnetUtility?.isNumericBirthdate(
          dobInput,
          event as KeyboardEvent
        );
      }
    );

    dobInput.addEventListener(
      "blur",
      () => {

        const valid =
          window.NovalnetUtility?.validateDateFormat(
            dobInput.value
          );

        const error =
          document.getElementById(
            "nn_birthdate_error"
          );

        if (error) {

          error.style.display =
            valid ? "none" : "block";
        }
      }
    );
  }

  async submit() {

    this.beginPayment();

    const baseSiteUrl =
      window.location.origin;

    try {

      const birthdate =
        (
          document.getElementById(
            "nn_birthdate"
          ) as HTMLInputElement
        )?.value.trim() ?? "";

      if (!birthdate) {

        this.onError(
          this.getLanguage() === "de" ? "Bitte geben Sie das Geburtsdatum ein." : "Please enter Date of Birth."
        );

        return;
      }

      const valid =
        window.NovalnetUtility?.validateDateFormat(
          birthdate
        );

      if (!valid) {

        this.onError(
          this.getLanguage() === "de" ? "Bitte geben Sie ein gültiges Geburtsdatum ein." : "Please enter a valid Date of Birth."
        );

        return;
      }

      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {

          type:
            "GUARANTEED_INVOICE",

          birthdate,
        },

        paymentOutcome:
          PaymentOutcome.AUTHORIZED,

        lang: this.getLanguage(),

        path:
          baseSiteUrl,
      };

      const response =
        await fetch(
          this.processorUrl +
          "/directPayment",
          {

            method: "POST",

            headers: {

              "Content-Type":
                "application/json",

              "X-Session-Id":
                this.sessionId,
            },

            body:
              JSON.stringify(
                requestData
              ),
          }
        );

      if (!response.ok) {

        const errorText =
          await response.text();

        console.error(
          "[Guaranteed Invoice] HTTP Error",
          errorText
        );

        throw new Error(
          `HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      if (String(data?.transactionStatus ?? "").toUpperCase() === "FAILURE") {
        this.onError?.(data?.transactionStatusText || "Payment failed. Please try again.",
          { paymentReference: data?.paymentReference });
        return;
      }

      if (data?.paymentReference) {

        this.onComplete?.({

          isSuccess: true,

          paymentReference:
            data.paymentReference,
        });

        return;
      }

      this.onError(
        data?.transactionStatusText ||
        "Some error occurred. Please try again."
      );

    } catch (e) {

      console.error(
        "[Guaranteed Invoice] Submit error",
        e
      );

      this.onError(
        "Some error occurred. Please try again."
      );
    }
  }

  private _getTemplate() {

    const locale = this.getLanguage();
    const isGerman = locale === 'de';

    const description =
      locale.startsWith("de")
        ? "Sie erhalten eine E-Mail mit den Bankdaten von Novalnet, um die Zahlung abzuschließen"
        : "You will receive an e-mail with the Novalnet account details to complete the payment";

    const payButton =
      this.showPayButton
        ? `
          <button
            class="${buttonStyles.button} ${buttonStyles.fullWidth} ${styles.submitButton}"
            id="GuaranteedInvoiceForm-paymentButton"
            type="button"
          >
            ${isGerman ? 'Bezahlen' : 'Pay Now'}
          </button>
        `
        : "";

    return `
      <div
        class="${styles.wrapper}"
        style="width:100%;display:flex;flex-direction:column;gap:20px;"
      >

        <p>${description}</p>

        <div
          style="display:flex;flex-direction:column;width:100%;"
        >

          <label
            for="nn_birthdate"
            style="font-size:14px;font-weight:600;color:#333;margin-bottom:6px;"
          >
            ${isGerman ? 'Geburtsdatum (TT.MM.JJJJ)' : 'Date of Birth (DD.MM.YYYY)'}
            <span style="color:red;">*</span>
          </label>

          <input
            type="text"
            id="nn_birthdate"
            name="nn_birthdate"
            placeholder="${isGerman ? 'TT.MM.JJJJ' : 'DD.MM.YYYY'}"
            maxlength="10"
            autocomplete="bday"
            style="padding:12px 14px;border:1px solid #d4d4d4;border-radius:6px;font-size:15px;"
          />

          <span
            id="nn_birthdate_error"
            style="display:none;margin-top:4px;font-size:12px;color:#d70000;"
          >
            ${isGerman ? 'Ungültiges Geburtsdatum' : 'Invalid Date of Birth'}
          </span>

        </div>

        ${payButton}

      </div>
    `;
  }
}
