import { accountHolderValidationMessage, bindAccountHolderValidation, isValidAccountHolder } from "../account-holder";
import { achNumberValidationMessage, bindAchNumberValidation, isValidAchNumber } from './numeric-field';
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

export class AchBuilder
  implements PaymentComponentBuilder {

  public componentHasSubmit = true;

  constructor(
    private baseOptions: BaseOptions
  ) {}

  build(
    config: ComponentOptions
  ): PaymentComponent {

    return new Ach(
      this.baseOptions,
      config
    );
  }
}

export class Ach extends BaseComponent {

  private showPayButton: boolean;

  constructor(
    baseOptions: BaseOptions,
    componentOptions: ComponentOptions
  ) {

    super(
      PaymentMethod.ach,
      baseOptions,
      componentOptions
    );

    this.showPayButton =
      componentOptions?.showPayButton ?? false;

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
        '[ACH] Container not found:',
        safeSelector
      );

      return;
    }

    container.insertAdjacentHTML(
      'afterbegin',
      this._getTemplate()
    );
    bindAccountHolderValidation(
      container.querySelector<HTMLInputElement>('#achForm-accHolder'),
      this.getLanguage(),
      (message) => this.onError(message),
    );
    bindAchNumberValidation(
      container.querySelector<HTMLInputElement>('#achForm-accountNumber'),
      this.getLanguage(), 'account', (message) => this.onError(message),
    );
    bindAchNumberValidation(
      container.querySelector<HTMLInputElement>('#achForm-routingNumber'),
      this.getLanguage(), 'routing', (message) => this.onError(message),
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
            .includes('ach')
        ) {

          paymentLabel.textContent =
            'Direct Debit ACH';

        }
      },
      100
    );

    if (
      this.showPayButton
    ) {

      const button =
        document.querySelector(
          '#achForm-paymentButton'
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
          '[ACH] Payment button not found'
        );
      }
    }
  }

  async submit() {

    this.beginPayment();

    const baseSiteUrl =
      window.location.origin;

    try {

      const accountHolderInput =
        document.getElementById(
          'achForm-accHolder'
        ) as HTMLInputElement | null;

      const accountNumberInput =
        document.getElementById(
          'achForm-accountNumber'
        ) as HTMLInputElement | null;

      const routingNumberInput =
        document.getElementById(
          'achForm-routingNumber'
        ) as HTMLInputElement | null;

      const accountHolder =
        accountHolderInput
          ?.value
          ?.trim() ?? '';

      const accountNumber =
        accountNumberInput
          ?.value
          ?.trim() ?? '';

      const routingNumber =
        routingNumberInput
          ?.value
          ?.trim() ?? '';

      if (
        !accountHolder ||
        !accountNumber ||
        !routingNumber
      ) {

        console.warn(
          '[ACH] Required field validation failed'
        );

        this.onError(
          this.getLanguage() === 'de' ? 'Bitte füllen Sie alle Pflichtfelder aus.' : 'Please fill all required fields.'
        );

        return;
      }

      if (!isValidAccountHolder(accountHolder)) {
        this.onError(accountHolderValidationMessage(this.getLanguage()));
        return;
      }

      if (!isValidAchNumber(accountNumber)) {
        this.onError(achNumberValidationMessage(this.getLanguage(), 'account'));
        return;
      }

      if (!isValidAchNumber(routingNumber)) {
        this.onError(achNumberValidationMessage(this.getLanguage(), 'routing'));
        return;
      }

      const requestData:
        PaymentRequestSchemaDTO = {

        paymentMethod: {

          type:
            'DIRECT_DEBIT_ACH',

          accHolder:
            accountHolder,

          accountNumber:
            accountNumber,

          routingNumber:
            routingNumber,
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
          '[ACH] HTTP error response',
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

        const paymentReference =
          typeof data.paymentReference ===
          'string'
            ? data.paymentReference
            : data.paymentReference?.id;

        if (!paymentReference) {

          console.error(
            '[ACH] Payment reference exists but could not be resolved',
            {
              paymentReference:
                data.paymentReference,
            }
          );

          this.onError(
            'Payment reference missing.'
          );

          return;
        }

        this.onComplete?.({
          isSuccess:
            true,

          paymentReference,
        });

        return;
      }

      console.error(
        '[ACH] Payment reference missing',
        {
          transactionStatus:
            data?.transactionStatus,

          transactionStatusText:
            data?.transactionStatusText,
        }
      );

      this.onError(
        data?.transactionStatusText ||
          'Payment reference missing.'
      );

    } catch (
      error: unknown
    ) {

      console.error(
        '[ACH] Payment error',
        {
          message:
            error instanceof Error
              ? error.message
              : String(error),

          stack:
            error instanceof Error
              ? error.stack
              : undefined,
        }
      );

      this.onError(
        'Some error occurred. Please try again.'
      );
    }
  }

  private _getTemplate() {

    const locale = this.getLanguage();

    const isGerman =
      locale
        .toLowerCase()
        .startsWith('de');

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

        <div
          style="
            display:flex;
            flex-direction:column;
            gap:20px;
            width:100%;
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
              for="achForm-accHolder"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${
                isGerman
                  ? 'Kontoinhaber'
                  : 'Account Holder'
              }

              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="achForm-accHolder"
              name="accHolder"
              placeholder="${isGerman ? 'Kontoinhaber' : 'Account Holder'}"
              autocomplete="name"
              required
              style="
                width:100%;
                padding:12px 14px;
                margin-top:0;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
              "
            />

          </div>

          <!-- Account Number -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="achForm-accountNumber"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${
                isGerman
                  ? 'Kontonummer'
                  : 'Account Number'
              }

              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="achForm-accountNumber"
              name="accountNumber"
              placeholder="123456789"
              autocomplete="off"
              inputmode="numeric"
              pattern="[0-9]*"
              required
              style="
                width:100%;
                padding:12px 14px;
                margin-top:0;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
              "
            />

          </div>

          <!-- Routing Number -->
          <div
            style="
              display:flex;
              flex-direction:column;
              width:100%;
            "
          >

            <label
              for="achForm-routingNumber"
              style="
                font-size:14px;
                font-weight:600;
                color:#333;
                margin-bottom:6px;
              "
            >
              ${
                isGerman
                  ? 'Bankleitzahl (ABA)'
                  : 'Routing Number (ABA)'
              }

              <span style="color:red;">
                *
              </span>
            </label>

            <input
              type="text"
              id="achForm-routingNumber"
              name="routingNumber"
              placeholder="123456789"
              autocomplete="off"
              inputmode="numeric"
              pattern="[0-9]*"
              required
              style="
                width:100%;
                padding:12px 14px;
                margin-top:0;
                border:1px solid #d4d4d4;
                border-radius:6px;
                font-size:15px;
                box-sizing:border-box;
              "
            />

          </div>

          ${
            this.showPayButton
              ? `
                <button
                  class="
                    ${buttonStyles.button}
                    ${buttonStyles.fullWidth}
                    ${styles.submitButton}
                  "
                  id="achForm-paymentButton"
                  type="button"
                >
                  ${
                    isGerman
                      ? 'Bezahlen'
                      : 'Pay'
                  }
                </button>
              `
              : ''
          }

        </div>

      </div>
    `;
  }
}
