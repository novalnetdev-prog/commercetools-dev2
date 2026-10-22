/** @jest-environment jsdom */
import { clearPaymentError, readProcessorPaymentError, showPaymentError, showReturnedPaymentError } from '../src/payment-enabler/payment-error';
describe('checkout payment alerts', () => {
  beforeEach(() => { jest.useFakeTimers(); history.replaceState({}, '', '/de/checkout'); clearPaymentError(true); });
  afterEach(() => { clearPaymentError(true); jest.useRealTimers(); });
  test('shows provider text safely and automatically closes after eight seconds', () => {
    showPaymentError('<img src=x onerror=alert(1)>'); const alert = document.getElementById('novalnet-payment-error')!;
    expect(alert.getAttribute('role')).toBe('alert'); expect(alert.textContent).toContain('<img'); expect(alert.querySelector('img')).toBeNull();
    jest.advanceTimersByTime(7999); expect(document.getElementById('novalnet-payment-error')).not.toBeNull();
    jest.advanceTimersByTime(1); expect(document.getElementById('novalnet-payment-error')).toBeNull();
  });
  test('a return error survives component setup and removes only its own URL parameter', () => {
    history.replaceState({}, '', '/de/checkout?paymentReference=p1&ctsid=s1&novalnetPaymentError=Abgebrochen');
    showReturnedPaymentError(); clearPaymentError(); expect(document.getElementById('novalnet-payment-error')?.textContent).toBe('Abgebrochen');
    showReturnedPaymentError(true); const query = new URL(location.href).searchParams;
    expect(query.get('novalnetPaymentError')).toBeNull(); expect(query.get('paymentReference')).toBe('p1'); expect(query.get('ctsid')).toBe('s1');
    jest.advanceTimersByTime(8000); expect(document.getElementById('novalnet-payment-error')).toBeNull();
  });
  test('a new attempt can force-dismiss the return error immediately', () => {
    showPaymentError('Previous decline', true); clearPaymentError(true); expect(document.getElementById('novalnet-payment-error')).toBeNull();
  });
  test('a malformed server response uses the localized fallback', async () => {
    const response = { json: async () => { throw new Error('Invalid JSON'); } } as unknown as Response;
    expect(await readProcessorPaymentError(response, 'Zahlung fehlgeschlagen')).toBe('Zahlung fehlgeschlagen');
  });
  test('a host DOM redraw does not immediately discard the alert', async () => {
    showPaymentError('Declined'); document.getElementById('novalnet-payment-error')!.remove(); await Promise.resolve();
    expect(document.getElementById('novalnet-payment-error')?.textContent).toBe('Declined');
  });
});
