import { showPaymentError } from './payment-error';

type Options = {
  processorUrl: string;
  sessionId: string;
  locale?: string;
  onError?: (error: Error, context: { paymentReference: string }) => void;
};
type Notice = { noticeId: string; paymentReference: string; transactionStatusText?: string };
const reportedNotices = new Set<string>();

async function request(options: Options, noticeId?: string): Promise<Notice | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetch(`${options.processorUrl.replace(/\/$/, '')}/redirectPaymentError`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Id': options.sessionId },
      body: JSON.stringify(noticeId ? { acknowledge: noticeId } : {}),
      signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok || response.status === 204) return;
    const notice = await response.json();
    if (typeof notice?.noticeId === 'string' && typeof notice?.paymentReference === 'string') return notice;
  } catch {
    // Recovery is optional; it must not prevent a shopper from paying.
  } finally { clearTimeout(timer); }
}

/** Cancelling at submit/completion prevents an old response failing a new attempt. */
export function createRedirectPaymentErrorRecovery(options: Options) {
  let pending: Promise<Notice | undefined> | undefined;
  let cancelled = false;
  let scheduled = false;
  return {
    report() {
      if (scheduled || cancelled) return;
      scheduled = true;
      pending ??= request(options);
      void pending.then((notice) => {
        if (!notice) return;
        // Defer until Checkout has received the builder. Recheck the lifecycle
        // inside the timer as a new submit may happen before this callback.
        setTimeout(() => {
          if (!cancelled && !reportedNotices.has(notice.noticeId)) {
            reportedNotices.add(notice.noticeId);
            const fallback = options.locale?.toLowerCase().startsWith('de')
              ? 'Die Zahlung ist fehlgeschlagen oder wurde abgebrochen. Bitte versuchen Sie es erneut.'
              : 'Payment failed or was cancelled. Please try again.';
            const message = notice.transactionStatusText?.trim() || fallback;
            const error = new Error(message.slice(0, 500));
            showPaymentError(error, true);
            try { options.onError?.(error, { paymentReference: notice.paymentReference }); }
            catch { /* A host callback must not block notification acknowledgement. */ }
          }
          // Acknowledge after display (or deliberate dismissal by a new submit),
          // so a dropped read response does not lose the notification.
          void request(options, notice.noticeId);
        }, 0);
      });
    },
    cancel() { cancelled = true; },
  };
}
