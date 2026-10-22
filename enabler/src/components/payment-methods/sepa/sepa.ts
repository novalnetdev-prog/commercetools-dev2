import { accountHolderValidationMessage, bindAccountHolderValidation, isValidAccountHolder } from "../account-holder";
import {
  ComponentOptions,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentMethod,
} from '../../../payment-enabler/payment-enabler';

import { BaseComponent } from '../../base';

import styles from '../../../style/style.module.scss';
import buttonStyles from '../../../style/button.module.scss';

import {
  PaymentOutcome,
  PaymentRequestSchemaDTO,
} from '../../../dtos/novalnet-payment.dto';

import { BaseOptions } from '../../../payment-enabler/novalnet-payment-enabler';
import { sepaMandateTemplate } from '../sepa-mandate';

const NOVALNET_UTILITY_CDN =
  'https://cdn.novalnet.de/js/v2/NovalnetUtility-1.1.2.js';


export class SepaBuilder
  implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {
    return new Sepa(
      this.baseOptions,
      config
    );
  }
}

export class Sepa extends BaseComponent {
  private formContainer?: Element;

  private showPayButton: boolean;

  private static utilityLoadPromise:
    Promise<void> | null = null;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {

    super(
      PaymentMethod.sepa,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;
  }

  private loadNovalnetUtility():
    Promise<void> {

    if (
      typeof window.NovalnetUtility !==
      'undefined'
    ) {

      return Promise.resolve();
    }

    if (
      Sepa.utilityLoadPromise
    ) {

      return Sepa.utilityLoadPromise;
    }

    Sepa.utilityLoadPromise =
      new Promise<void>(
        (
          resolve,
          reject
        ) => {

          const existingScript =
            document.querySelector(
              `script[src="${NOVALNET_UTILITY_CDN}"]`
            ) as HTMLScriptElement | null;

          if (existingScript) {

            if (
              typeof window.NovalnetUtility !==
              'undefined'
            ) {

              resolve();

              return;
            }

            existingScript.addEventListener(
              'load',
              () => {
                resolve();
              },
              {
                once: true,
              }
            );

            existingScript.addEventListener(
              'error',
              () => {

                console.error(
                  '[SEPA] Failed to load existing NovalnetUtility script'
                );

                reject(
                  new Error(
                    'Failed to load NovalnetUtility'
                  )
                );
              },
              {
                once: true,
              }
            );

            return;
          }

          const script =
            document.createElement(
              'script'
            );

          script.src =
            NOVALNET_UTILITY_CDN;

          script.async = true;

          script.onload = () => {

            if (
              typeof window.NovalnetUtility ===
              'undefined'
            ) {

              reject(
                new Error(
                  'NovalnetUtility is not available after CDN load'
                )
              );

              return;
            }

            resolve();
          };

          script.onerror = () => {
            reject(
              new Error(
                'Failed to load NovalnetUtility CDN'
              )
            );
          };

          document.head.appendChild(
            script
          );
        }
      ).catch(
        (error) => {

          Sepa.utilityLoadPromise =
            null;

          throw error;
        }
      );

    return Sepa.utilityLoadPromise;
  }

  mount(
    selector: string
  ) {

    const safeSelector =
      '#' +
      CSS.escape(
        selector.substring(1)
      );

    const container =
      document.querySelector(
        safeSelector
      );

    if (!container) {

      console.error(
        '[SEPA] Container not found',
        {
          safeSelector,
        }
      );

      return;
    }

    this.formContainer = container;

    container.insertAdjacentHTML(
      'afterbegin',
      this._getTemplate()
    );
    bindAccountHolderValidation(
      container.querySelector<HTMLInputElement>('#nn_account_holder'),
      this.getLanguage(),
      (message) => this.onError(message),
    );

    setTimeout(
      () => {

        const paymentLabel =
          container.querySelector(
            'label'
          );

        if (
          paymentLabel &&
          paymentLabel.textContent
            ?.toLowerCase()
            .includes('sepa')
        ) {

          paymentLabel.textContent =
            'Direct Debit SEPA';

        }
      },
      100
    );

    this.setBicVisibility(
      false
    );

    this.bindIbanEvents();

    void this.loadNovalnetUtility();

    if (
      this.showPayButton
    ) {

      const button =
        document.querySelector(
          '#sepa-payment-button'
        );

      if (button) {
        button.addEventListener(
          'click',
          (event) => {

            event.preventDefault();

            void this.submit();
          }
        );

      } else {
        console.warn(
          '[SEPA] Payment button not found'
        );
      }
    }
  }

  private bindIbanEvents() {

    const ibanInput =
      document.getElementById(
        'nn_sepa_account_no'
      ) as HTMLInputElement | null;

    if (!ibanInput) {

      console.warn(
        '[SEPA] IBAN input not found'
      );

      return;
    }

    const handleIban =
      async (
        event: Event
      ) => {


        try {

          await this.loadNovalnetUtility();

          if (
            !window.NovalnetUtility
              ?.formatIban
          ) {

            console.warn(
              '[SEPA] NovalnetUtility.formatIban() unavailable'
            );

            return;
          }

          window.NovalnetUtility.formatIban(
            event,
            'nn_sepa_bic'
          );

          this.syncBicContainerVisibility();

        } catch (error) {

          console.error(
            '[SEPA] IBAN utility processing failed',
            error
          );
        }
      };

    ibanInput.addEventListener(
      'input',
      (event) => {
        void handleIban(event);
      }
    );

    ibanInput.addEventListener(
      'change',
      (event) => {
        void handleIban(event);
      }
    );

    ibanInput.addEventListener(
      'keypress',
      (event) => {

        if (
          window.NovalnetUtility
            ?.checkIban
        ) {

          const result =
            window.NovalnetUtility
              .checkIban(
                event
              );

          if (
            result === false
          ) {

            event.preventDefault();
          }
        }
      }
    );
  }

  private syncBicContainerVisibility() {

    const bicInput =
      document.getElementById(
        'nn_sepa_bic'
      ) as HTMLInputElement | null;

    const bicContainer =
      document.getElementById(
        'nn_sepa_bic_container'
      ) as HTMLElement | null;

    if (
      !bicInput ||
      !bicContainer
    ) {

      console.warn(
        '[SEPA] BIC input/container not found',
        {
          bicInput:
            !!bicInput,

          bicContainer:
            !!bicContainer,
        }
      );

      return;
    }

    const computedDisplay =
      window.getComputedStyle(
        bicInput
      ).display;

    const inlineDisplay =
      bicInput.style.display;

    const shouldShow =
      computedDisplay !== 'none' &&
      inlineDisplay !== 'none';

    bicContainer.style.display =
      shouldShow
        ? 'flex'
        : 'none';

  }

  private setBicVisibility(
    visible: boolean
  ) {

    const bicContainer =
      document.getElementById(
        'nn_sepa_bic_container'
      ) as HTMLElement | null;

    if (!bicContainer) {

      console.warn(
        '[SEPA] BIC container not found'
      );

      return;
    }

    bicContainer.style.display =
      visible
        ? 'flex'
        : 'none';
  }

  async submit() {

    this.beginPayment();

    const url =
      new URL(
        window.location.href
      );

    const baseSiteUrl =
      url.origin;

    try {

      const accountHolderInput =
        document.getElementById(
          'nn_account_holder'
        ) as HTMLInputElement;

      const ibanInput =
        document.getElementById(
          'nn_sepa_account_no'
        ) as HTMLInputElement;

      const bicInput =
        this.formContainer?.querySelector<HTMLInputElement>('#nn_sepa_bic');

      const accountHolder =
        accountHolderInput
          ?.value
          ?.trim() ?? '';

      const iban =
        ibanInput
          ?.value
          ?.replace(/\s/g, '')
          ?.trim() ?? '';

      const bic =
        bicInput
          ?.value
          ?.replace(/\s/g, '')
          ?.trim() ?? '';

      if (!accountHolder) {

        console.warn(
          '[SEPA] Account holder validation failed'
        );

        this.onError(
          this.getLanguage() === 'de' ? 'Bitte geben Sie den Kontoinhaber ein.' : 'Please enter account holder name'
        );

        return;
      }

      if (!isValidAccountHolder(accountHolder)) {
        this.onError(accountHolderValidationMessage(this.getLanguage()));
        return;
      }

      if (!iban) {

        console.warn(
          '[SEPA] IBAN validation failed'
        );

        this.onError(
          this.getLanguage() === 'de' ? 'Bitte geben Sie die IBAN ein.' : 'Please enter IBAN'
        );

        return;
      }

      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {

          type:
            'DIRECT_DEBIT_SEPA',

          accHolder:
            accountHolder,

          iban:
            iban,

          bic:
            bic,
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
            '/directPayment',
          {
            method:
              'POST',

            headers: {

              'Content-Type':
                'application/json',

              'X-Session-Id':
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
          '[SEPA] HTTP error response',
          {
            status:
              response.status,

            response:
              errorText,
          }
        );

        throw new Error(
          `HTTP error! status: ${response.status}`
        );
      }

      const data =
        await response.json();

      if (String(data?.transactionStatus ?? "").toUpperCase() === "FAILURE") {
        this.onError?.(data?.transactionStatusText || "Payment failed. Please try again.",
          { paymentReference: data?.paymentReference });
        return;
      }

      if (
        data?.paymentReference
      ) {

        this.onComplete?.({
          isSuccess:
            true,

          paymentReference:
            data.paymentReference,
        });

        return;
      }

      console.error(
        '[SEPA] Payment failed',
        {
          response:
            data,
        }
      );

      this.onError(
        data?.transactionStatusText ||
          'Some error occurred. Please try again.'
      );

    } catch (
      error: any
    ) {

      console.error(
        '[SEPA] Submit error',
        {
          message:
            error?.message,

          stack:
            error?.stack,

          error,
        }
      );

      this.onError(
        'Some error occurred. Please try again.'
      );
    }
  }

  private _getTemplate() {

    const locale = this.getLanguage();
    const isGerman = locale === 'de';

    const description =
      locale.startsWith("de")
        ? "Der Betrag wird durch Novalnet von Ihrem Konto abgebucht"
        : "The amount will be debited from your account by Novalnet";

    const payButton =
      this.showPayButton
        ? `
          <button
            class="
              ${buttonStyles.button}
              ${buttonStyles.fullWidth}
              ${styles.submitButton}
            "
            id="sepa-payment-button"
            type="button"
          >
            ${isGerman ? 'Bezahlen' : 'Pay Now'}
          </button>
        `
        : '';

    return `
      <div
        class="${styles.wrapper}"
        style="
          width:100%;
          display:flex;
          flex-direction:column;
          gap:20px;
          margin-top:20px;
        "
      >

      <p>${description}</p>

        <div
          id="nn_sepa_form"
          style="
            width:100%;
            display:flex;
            flex-direction:column;
            gap:20px;
          "
        >

          <!-- Account Holder -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_account_holder"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${isGerman ? 'Kontoinhaber' : 'Account Holder'}
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_account_holder"
              name="nn_account_holder"
              placeholder="${isGerman ? 'Kontoinhaber' : 'Account Holder'}"
              autocomplete="off"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                width:100%;
                box-sizing:border-box;
              "
            />

          </div>

          <!-- IBAN -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_sepa_account_no"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              IBAN
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_sepa_account_no"
              name="nn_sepa_account_no"
              placeholder="DEXX XXXX XXXX XXXX XXXX XX"
              autocomplete="off"
              spellcheck="false"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                text-transform:uppercase;
                width:100%;
                box-sizing:border-box;
              "
            />

          </div>

          <!-- BIC -->
          <div
            id="nn_sepa_bic_container"
            style="
              display:none;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="nn_sepa_bic"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              BIC
              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="nn_sepa_bic"
              name="nn_sepa_bic"
              placeholder="XXXX XX XX XXX"
              autocomplete="off"
              spellcheck="false"
              style="
                padding:12px 14px;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                width:100%;
                box-sizing:border-box;
              "
            />

          </div>

          ${sepaMandateTemplate(locale)}

          ${payButton}

        </div>

      </div>
    `;
  }
}
