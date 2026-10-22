import { NovalnetPaymentEnabler } from './payment-enabler/novalnet-payment-enabler';
import { showReturnedPaymentError } from './payment-enabler/payment-error';

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => showReturnedPaymentError(), { once: true });
  } else {
    showReturnedPaymentError();
  }
}

export { NovalnetPaymentEnabler as Enabler };
