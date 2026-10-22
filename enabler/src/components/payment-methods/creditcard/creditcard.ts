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
import { readProcessorPaymentError } from "../../../payment-enabler/payment-error";

type CardTokenData = {
  hash: string;
  unique_id: string;
  do_redirect?: string | boolean;
};

export class CreditcardBuilder
  implements PaymentComponentBuilder
{
  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions,
  ) {}

  build(
    config: ComponentOptions,
  ): PaymentComponent {
    return new Creditcard(
      this.baseOptions,
      config,
    );
  }
}

export class Creditcard extends BaseComponent {
  private showPayButton: boolean;

  private panHashPromise:
    | Promise<CardTokenData>
    | null = null;

  private panHashResolve:
    | ((data: CardTokenData) => void)
    | null = null;

  private panHashReject:
    | ((error: Error) => void)
    | null = null;

  private isSubmitting = false;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions,
  ) {
    super(
      PaymentMethod.creditcard,
      baseOptions,
      componentOptions,
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;
  }

  async mount(selector: string) {
    const safeSelector =
      "#" +
      CSS.escape(
        selector.substring(1),
      );

    const container =
      document.querySelector(
        safeSelector,
      );

    if (!container) {
      console.error(
        "Container not found:",
        safeSelector,
      );

      return;
    }

    if (
      container.querySelector(
        "#novalnet_iframe",
      )
    ) {
      return;
    }

    container.insertAdjacentHTML(
      "beforeend",
      this._getTemplate(),
    );

    const iframe =
      document.getElementById(
        "novalnet_iframe",
      );

    if (!iframe) {
      console.error(
        "Novalnet iframe not found",
      );

      return;
    }

    const payButton =
      document.querySelector(
        "#purchaseOrderForm-paymentButton",
      ) as HTMLButtonElement | null;

    try {
      await this._loadNovalnetScriptOnce();

      await this._initNovalnetCreditCardForm(
        payButton,
      );
    } catch (err) {
      console.error(
        "Failed to initialize Novalnet form:",
        err,
      );
    }

    const payButtonAfterInit =
      document.querySelector(
        "#purchaseOrderForm-paymentButton",
      ) as HTMLButtonElement | null;

    if (
      this.showPayButton &&
      payButtonAfterInit &&
      !(payButtonAfterInit as any)._nnBound
    ) {
      (payButtonAfterInit as any)._nnBound = true;

      payButtonAfterInit.addEventListener(
        "click",
        async (e) => {
          e.preventDefault();

          try {
            await this.submit();
          } catch (error) {
            console.error(
              "[CC] Pay button submission error:",
              error,
            );
          }
        },
      );
    }
  }

  private _isRedirectRequired(
    value: string | boolean | undefined,
  ): boolean {
    if (value === true) {
      return true;
    }

    if (
      typeof value === "string" &&
      (
        value.toLowerCase() === "true" ||
        value === "1"
      )
    ) {
      return true;
    }

    return false;
  }

  private async _getPanHash(): Promise<CardTokenData> {
    const NovalnetUtility =
      (window as any)
        .NovalnetUtility;

    if (!NovalnetUtility) {
      throw new Error(
        "NovalnetUtility is not available",
      );
    }

    if (
      !NovalnetUtility.getPanHash
    ) {
      throw new Error(
        "NovalnetUtility.getPanHash is not available",
      );
    }

    if (this.panHashPromise) {
      return this.panHashPromise;
    }

    this.panHashPromise =
      new Promise<CardTokenData>(
        (resolve, reject) => {
          this.panHashResolve =
            resolve;

          this.panHashReject =
            reject;
        },
      );

    const currentPromise =
      this.panHashPromise;

    try {
      await NovalnetUtility.getPanHash();
      const result =
        await currentPromise;

      return result;
    } catch (error) {
      this.panHashPromise = null;
      this.panHashResolve = null;
      this.panHashReject = null;

      throw error;
    }
  }

  async submit() {
    if (this.isSubmitting) {
      console.warn(
        "[CC] Payment submission already in progress",
      );

      return;
    }

    this.isSubmitting = true;

    try {
      this.beginPayment();

      const url =
        new URL(
          window.location.href,
        );

      const baseSiteUrl =
        url.origin;

      const panhashInput =
        document.getElementById(
          "pan_hash",
        ) as HTMLInputElement | null;

      const uniqueIdInput =
        document.getElementById(
          "unique_id",
        ) as HTMLInputElement | null;

      const doRedirectInput =
        document.getElementById(
          "do_redirect",
        ) as HTMLInputElement | null;

      let panhash =
        panhashInput?.value.trim() ??
        "";

      let uniqueId =
        uniqueIdInput?.value.trim() ??
        "";

      let doRedirect =
        doRedirectInput?.value.trim() ??
        "";

      if (!panhash || !uniqueId) {
        const cardData =
          await this._getPanHash();

        panhash =
          cardData.hash;

        uniqueId =
          cardData.unique_id;

        doRedirect =
          String(
            cardData.do_redirect ??
              "",
          );

        if (panhashInput) {
          panhashInput.value =
            panhash;
        }

        if (uniqueIdInput) {
          uniqueIdInput.value =
            uniqueId;
        }

        if (doRedirectInput) {
          doRedirectInput.value =
            doRedirect;
        }
      }

      if (!panhash || !uniqueId) {
        throw new Error(
          "Credit card tokenization failed. pan_hash or unique_id is missing.",
        );
      }

      const redirectRequired =
        this._isRedirectRequired(
          doRedirect,
        );

      const requestData:
        PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: "CREDITCARD",
          panHash:
            panhash,
          uniqueId:
            uniqueId,
          doRedirect:
            doRedirect,
        },
        paymentOutcome:
          PaymentOutcome.AUTHORIZED,
        lang:
          this.getLanguage(),
        path:
          baseSiteUrl,
      };

      if (redirectRequired) {

        const response =
          await fetch(
            this.processorUrl +
              "/redirectPayment",
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
                  requestData,
                ),
            },
          );

        if (!response.ok) {
          throw new Error(
            await readProcessorPaymentError(response, `Redirect payment failed. HTTP ${response.status}`),
          );
        }

        const data =
          await response.json();

        if (String(data?.transactionStatus ?? "").toUpperCase() === "FAILURE") {
          this.onError(data?.transactionStatusText || "Payment failed. Please try again.",
            { paymentReference: data?.paymentReference });
          return;
        }

        console.log(
          "[CC] Redirect payment response received",
          {
            hasTxnSecret:
              !!data?.txnSecret,
          },
        );

        if (!data?.txnSecret) {
          throw new Error(
            "Redirect payment response does not contain txnSecret.",
          );
        }

        window.location.assign(
          data.txnSecret,
        );

        return;
      }

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
                requestData,
              ),
          },
        );

      if (!response.ok) {
        throw new Error(
          await readProcessorPaymentError(response, `Direct payment failed. HTTP ${response.status}`),
        );
      }

      const data = await response.json();

      if (String(data?.transactionStatus ?? "").toUpperCase() === "FAILURE") {
        this.onError?.(data?.transactionStatusText || "Payment failed. Please try again.",
          { paymentReference: data?.paymentReference });
        return;
      }

		if (data?.txnSecret) {
		  window.location.assign(data.txnSecret);
		  return;
		}

		if (data?.paymentReference && !data?.txnSecret) {
		  this.onComplete?.({
			isSuccess: true,
			paymentReference: data.paymentReference,
		  });
		  return;
		}

		if (!data?.paymentReference && !data?.txnSecret) {
		  this.onError(
			data?.transactionStatusText ||
			  "Payment failed. Please try again.",
		  );
		  return;
		}
    } catch (e) {
      console.error(
        "[CC] Payment submit error:",
        e,
      );

      this.onError(
        e instanceof Error
          ? e.message
          : "Some error occurred. Please try again.",
      );
    } finally {
      this.isSubmitting =
        false;

      const payButton =
        document.querySelector(
          "#purchaseOrderForm-paymentButton",
        ) as HTMLButtonElement | null;

      if (payButton) {
        payButton.disabled =
          false;
      }
    }
  }

  private _getTemplate() {

    const locale =
      document.documentElement.lang || "en";

    const description =
      locale.startsWith("de")
        ? "Der Betrag wird Ihrer Kredit-/Debitkarte belastet"
        : "The amount will be debited from your credit/debit card";

    const payButton =
      this.showPayButton
        ? `
          <button
            class="
              ${buttonStyles.button}
              ${buttonStyles.fullWidth}
              ${styles.submitButton}
            "
            id="purchaseOrderForm-paymentButton"
            type="button"
          >
            ${this.getLanguage() === "de" ? "Bezahlen" : "Pay"}
          </button>
        `
        : "";

    return `
      <div class="${styles.wrapper}">
        <p>${description}</p>
        
        <iframe
          id="novalnet_iframe"
          frameborder="0"
          scrolling="no"
          style="
            min-width: 40%;
            border:none;
            display:block;
          "
        ></iframe>

        <input
          type="hidden"
          id="pan_hash"
          name="pan_hash"
        />

        <input
          type="hidden"
          id="unique_id"
          name="unique_id"
        />

        <input
          type="hidden"
          id="do_redirect"
          name="do_redirect"
        />

        ${payButton}
      </div>
    `;
  }

  private async _loadNovalnetScriptOnce():
    Promise<void> {
    if (
      (window as any)
        .NovalnetUtility
    ) {
      return;
    }

    const src =
      "https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js";

    const existing =
      document.querySelector(
        `script[src="${src}"]`,
      ) as HTMLScriptElement | null;

    if (existing) {
      if (
        (window as any)
          .NovalnetUtility
      ) {
        return;
      }

      await new Promise<void>(
        (resolve, reject) => {
          existing.addEventListener(
            "load",
            () => resolve(),
            { once: true },
          );

          existing.addEventListener(
            "error",
            (event) =>
              reject(event),
            { once: true },
          );
        },
      );

      return;
    }

    const script =
      document.createElement(
        "script",
      );

    script.src = src;

    script.crossOrigin =
      "anonymous";

    const loadPromise =
      new Promise<void>(
        (resolve, reject) => {
          script.onload =
            () => resolve();

          script.onerror =
            (e) => reject(e);
        },
      );

    document.head.appendChild(
      script,
    );

    await loadPromise;
  }

  private async _initNovalnetCreditCardForm(
    payButton: HTMLButtonElement | null,
  ): Promise<void> {
    const NovalnetUtility =
      (window as any)
        .NovalnetUtility;

    if (!NovalnetUtility) {
      console.warn(
        "NovalnetUtility not available.",
      );

      return;
    }

    const res =
      await fetch(
        this.processorUrl +
          "/getCreditcardConfig",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          body: JSON.stringify({
            paymentMethod: {
              type: "CREDITCARD",
            },
            paymentOutcome:
              "AUTHORIZED",
          }),
        },
      );

    if (!res.ok) {
      const errorText =
        await res.text();

      console.error(
        "[CC] failed:",
        errorText,
      );

      throw new Error(
        `Unable to get Novalnet client key. HTTP ${res.status}`,
      );
    }

    const json =
      await res.json();

    if (
      !json?.paymentReference
    ) {
      throw new Error(
        "Missing client key",
      );
    }

    this.clientKey =
      String(
        json.paymentReference,
      );

    const inline =
      String(
        json?.inline ?? "1",
      ) === "1"
        ? 1
        : 0;

    NovalnetUtility.setClientKey(
      this.clientKey,
    );

    const configurationObject = {
      callback: {
        on_success:
          async (data: any) => {
            if (
              !data?.hash ||
              !data?.unique_id
            ) {
              const error =
                new Error(
                  "Novalnet did not return pan_hash or unique_id.",
                );

              this.panHashReject?.(
                error,
              );

              this.panHashPromise =
                null;

              this.panHashResolve =
                null;

              this.panHashReject =
                null;

              if (payButton) {
                payButton.disabled =
                  false;
              }

              return false;
            }

            const panHashInput =
              document.getElementById(
                "pan_hash",
              ) as HTMLInputElement | null;

            const uniqueIdInput =
              document.getElementById(
                "unique_id",
              ) as HTMLInputElement | null;

            const doRedirectInput =
              document.getElementById(
                "do_redirect",
              ) as HTMLInputElement | null;

            if (panHashInput) {
              panHashInput.value =
                data.hash;
            }

            if (uniqueIdInput) {
              uniqueIdInput.value =
                data.unique_id;
            }

            if (doRedirectInput) {
              doRedirectInput.value =
                String(
                  data.do_redirect ??
                    "",
                );
            }

            if (
              this.panHashResolve
            ) {
              this.panHashResolve({
                hash:
                  data.hash,
                unique_id:
                  data.unique_id,
                do_redirect:
                  data.do_redirect,
              });
            }

            this.panHashPromise =
              null;

            this.panHashResolve =
              null;

            this.panHashReject =
              null;

            if (payButton) {
              payButton.disabled =
                false;
            }

            return true;
          },

        on_error:
          (data: any) => {
            console.error(
              "[CC] Novalnet card validation error:",
              data,
            );

            const errorMessage =
              data?.error_message ||
              "Unable to validate credit card.";

            if (
              this.panHashReject
            ) {
              this.panHashReject(
                new Error(
                  errorMessage,
                ),
              );
            }

            this.panHashPromise =
              null;

            this.panHashResolve =
              null;

            this.panHashReject =
              null;

            if (payButton) {
              payButton.disabled =
                false;
            }

            return false;
          },
      },

      iframe: {
        id:
          "novalnet_iframe",

        inline,

        style: {
          container: "",
          input: "",
          label: "",
        },

        text: {
          lang:
            this.getLanguage().toUpperCase(),

          card_holder: {
            label:
              this.getLanguage() === "de" ? "Name des Karteninhabers" : "Card holder name",

            place_holder:
              this.getLanguage() === "de" ? "Name auf der Karte" : "Name on card",
          },

          card_number: {
            label:
              this.getLanguage() === "de" ? "Kreditkartennummer" : "Card number",

            place_holder:
              "XXXX XXXX XXXX XXXX",
          },

          expiry_date: {
            label:
              this.getLanguage() === "de" ? "Ablaufdatum" : "Expiry date",
            place_holder: "MM/YY",
          },

          cvc: {
            label:
              "CVC/CVV/CID",

            place_holder:
              "XXX",
          },
        },
      },
    };

    NovalnetUtility.createCreditCardForm(
      configurationObject,
    );
  }
}
