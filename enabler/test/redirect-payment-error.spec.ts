import { createRedirectPaymentErrorRecovery } from '../src/payment-enabler/redirect-payment-error';
import { showPaymentError } from '../src/payment-enabler/payment-error';
jest.mock('../src/payment-enabler/payment-error', () => ({ showPaymentError: jest.fn() }));
describe('redirect error recovery lifecycle', () => {
  const originalFetch = globalThis.fetch;
  const options = { processorUrl: 'https://processor.example/', sessionId: 'session-a', locale: 'de' };
  let counter = 0;
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); counter++; });
  afterEach(() => { globalThis.fetch = originalFetch; jest.useRealTimers(); });
  async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); jest.advanceTimersByTime(0); }
  function notice(text?: string) { return { ok: true, status: 200, json: async () => ({ noticeId: `notice-${counter}`, paymentReference: 'payment-a', transactionStatusText: text }) }; }
  test('exact reason is signalled once, then acknowledged using the active session', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(notice('Zahlung abgebrochen')).mockResolvedValue({ ok: true, status: 204 });
    globalThis.fetch = fetchMock; const onError = jest.fn(); const recovery = createRedirectPaymentErrorRecovery({ ...options, onError });
    recovery.report(); recovery.report(); await flush();
    expect(onError).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Zahlung abgebrochen' }), { paymentReference: 'payment-a' });
    expect(fetchMock.mock.calls[0][1].headers['X-Session-Id']).toBe('session-a');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ acknowledge: `notice-${counter}` });
  });
  test('a late response after another payment starts never reports the old failure', async () => {
    let resolve!: (value: any) => void; globalThis.fetch = jest.fn().mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue({ ok: true, status: 204 });
    const onError = jest.fn(), recovery = createRedirectPaymentErrorRecovery({ ...options, onError });
    recovery.report(); recovery.cancel(); resolve(notice('Old failure')); await flush();
    expect(onError).not.toHaveBeenCalled(); expect(showPaymentError).not.toHaveBeenCalled();
  });
  test('a new submit between reading the notice and the scheduled display cancels it', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(notice('Old failure')).mockResolvedValue({ ok: true, status: 204 });
    const onError = jest.fn(), recovery = createRedirectPaymentErrorRecovery({ ...options, onError });
    recovery.report(); for (let i = 0; i < 10; i++) await Promise.resolve(); recovery.cancel(); jest.advanceTimersByTime(0);
    expect(onError).not.toHaveBeenCalled(); expect(showPaymentError).not.toHaveBeenCalled();
  });
  test('an empty reason uses the German failure/cancel fallback', async () => {
    globalThis.fetch = jest.fn().mockResolvedValueOnce(notice()).mockResolvedValue({ ok: true, status: 204 });
    const onError = jest.fn(); createRedirectPaymentErrorRecovery({ ...options, onError }).report(); await flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('abgebrochen') }), { paymentReference: 'payment-a' });
  });
  test.each(['no-notice', 'offline'])('%s does not alter the checkout', async (scenario) => {
    globalThis.fetch = scenario === 'no-notice' ? jest.fn().mockResolvedValue({ ok: true, status: 204 }) : jest.fn().mockRejectedValue(new Error('offline'));
    const onError = jest.fn(); createRedirectPaymentErrorRecovery({ ...options, onError }).report(); await flush();
    expect(onError).not.toHaveBeenCalled(); expect(showPaymentError).not.toHaveBeenCalled();
  });
});
