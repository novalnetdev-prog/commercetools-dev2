/** @jest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('deployed UMD bundle smoke test', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => { cleanup?.(); cleanup = undefined; });
  beforeEach(() => {
    history.replaceState({}, '', '/de/checkout'); document.body.innerHTML = '<div id="container-Invoice-a"></div>';
    (window as any).CSS = { escape: (value: string) => value }; // IDs used here need no escaping.
    window.eval(readFileSync(resolve(__dirname, '../public/connector-enabler.umd.js'), 'utf8'));
  });
  test('a returned failure is visible even without a storefront URL error parameter', async () => {
    const error = jest.fn(); let acknowledge = false;
    globalThis.fetch = jest.fn(async (_url: any, request: any) => {
      if (JSON.parse(request.body).acknowledge) { acknowledge = true; return { ok: true, status: 204 }; }
      return { ok: true, status: 200, json: async () => ({ noticeId: 'compiled-return-a', paymentReference: 'payment-a', transactionStatusText: 'Zahlung abgebrochen' }) };
    }) as any;
    const enabler = new (window as any).Connector.Enabler({ processorUrl: 'https://processor.example', sessionId: 'session-a', locale: 'de', onError: error });
    cleanup = (await enabler.setupData).baseOptions.onPaymentStart;
    await enabler.createComponentBuilder('Invoice');
    await new Promise((done) => setTimeout(done, 20));
    expect(document.getElementById('novalnet-payment-error')?.textContent).toBe('Zahlung abgebrochen');
    expect(error).toHaveBeenCalledTimes(1); expect(acknowledge).toBe(true);
  });
  test('the compiled direct payment flow preserves a gateway decline and does not complete', async () => {
    const error = jest.fn(), complete = jest.fn();
    globalThis.fetch = jest.fn(async (url: any) => String(url).endsWith('/redirectPaymentError') ? { ok: true, status: 204 } : {
      ok: true, status: 200, json: async () => ({ paymentReference: 'payment-a', transactionStatus: 'FAILURE', transactionStatusText: 'Karte abgelehnt' }),
    }) as any;
    const enabler = new (window as any).Connector.Enabler({ processorUrl: 'https://processor.example', sessionId: 'session-a', locale: 'de', onError: error, onComplete: complete });
    cleanup = (await enabler.setupData).baseOptions.onPaymentStart;
    const component = (await enabler.createComponentBuilder('Invoice')).build({}); component.mount('#container-Invoice-a'); await component.submit();
    expect(error).toHaveBeenCalledWith('Karte abgelehnt', { paymentReference: 'payment-a' }); expect(complete).not.toHaveBeenCalled();
    expect(document.getElementById('novalnet-payment-error')?.textContent).toBe('Karte abgelehnt');
  });
});
