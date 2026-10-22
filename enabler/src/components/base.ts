import { ComponentOptions, PaymentComponent, PaymentMethod, PaymentResult } from '../payment-enabler/payment-enabler';
import { BaseOptions } from "../payment-enabler/novalnet-payment-enabler";


export type ElementOptions = {
  paymentMethod: PaymentMethod;
};

/**
 * Base Web Component
 */
export abstract class BaseComponent implements PaymentComponent {
  protected paymentMethod: ElementOptions['paymentMethod'];
  protected processorUrl: BaseOptions['processorUrl'];
  protected sessionId: BaseOptions['sessionId'];
  private onPaymentStart?: () => void;
  protected locale: BaseOptions['locale'];
  protected onComplete: (result: PaymentResult) => void;
  protected onError: (error: any, context?: { paymentReference?: string }) => void;
  protected clientKey: string = '';
  private paymentCompleted: boolean = false;

  constructor(paymentMethod: PaymentMethod, baseOptions: BaseOptions, _componentOptions: ComponentOptions) {
    this.paymentMethod = paymentMethod;
    this.processorUrl = baseOptions.processorUrl;
    this.sessionId = baseOptions.sessionId;
    this.onPaymentStart = baseOptions.onPaymentStart;
    this.locale = baseOptions.locale;
    this.onComplete = baseOptions.onComplete;
    this.onError = baseOptions.onError;
  }

  protected getLanguage(): 'en' | 'de' {
    const pathLanguage = window.location.pathname.split('/')[1];
    const value = this.locale ||
      (/^(en|de)([-_]|$)/i.test(pathLanguage) ? pathLanguage : document.documentElement.lang);
    return value?.toLowerCase().startsWith('de') ? 'de' : 'en';
  }

  abstract submit(): void;

  protected beginPayment(): void {
    this.onPaymentStart?.();
  }

  abstract mount(selector: string): void ;

  protected completePayment(result: PaymentResult) {
    if (!this.paymentCompleted) {
      this.paymentCompleted = true;
      this.onComplete(result);
    }
  }

  showValidation?(): void;
  isValid?(): boolean;
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate? : string;
    }
  };
  isAvailable?(): Promise<boolean>;
}
