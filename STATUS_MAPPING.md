# Financial status mapping

`orderState` is never changed. The financial Order mapping below applies to an Order with a single Payment; the aggregate state of an Order with multiple Payments belongs to Checkout/the merchant. These are the submitted merchant mappings, not mandatory universal commercetools mappings.

## Initial direct/redirect result and PAYMENT reconciliation

| Novalnet transaction status | Initial Payment representation | Order paymentState from PAYMENT |
| --- | --- | --- |
| ON_HOLD | Authorization / Success | Pending |
| PENDING | Authorization / Pending | Pending |
| CONFIRMED | Charge / Success; an existing successful Authorization is retained where applicable | Paid |
| FAILURE | Failed initial transaction, exact provider reason added when supplied | Failed; no Order is required for a failed attempt |
| CANCELLED / DEACTIVATED in initial PAYMENT | Preserve initial history; ensure CancelAuthorization / Success | Failed |
| Unknown/missing | No invented successful financial state | No recognized Order mapping |

The direct/redirect API writes its initial result; PAYMENT repairs/synchronizes that same attempt, including communication failure. It is not reused as the follow-up event. A delayed initial PAYMENT or repeated redirect return must not undo a later capture, cancellation, refund or credited/reduced balance.

## Webhook events

Financial follow-ups normally require `result.status=SUCCESS`. The exception is an initial PAYMENT whose result and transaction are both FAILURE. Every accepted webhook retains checksum and configured IP validation, plus Payment/reference binding.

| Event | Novalnet evidence / partial possibility | Payment operation | Order paymentState |
| --- | --- | --- | --- |
| PAYMENT | See initial table; initial event only | Reconcile the initial transaction and comments | See initial table |
| TRANSACTION_CAPTURE | CONFIRMED; full capture | Charge / Success, timestamp and capture comment | Paid |
| TRANSACTION_CAPTURE | CONFIRMED; first partial capture | Existing portal partial-capture representation | BalanceDue; repeated partial captures are not supported |
| TRANSACTION_CANCEL | CANCELLED or DEACTIVATED; no partial cancel | CancelAuthorization / Success, cancellation comment | Failed |
| TRANSACTION_REFUND | New refund TID; normal partial/full refund | Refund / Success keyed by refund TID, refund comment | Retain current state by merchant policy |
| TRANSACTION_REFUND | No refund TID; PENDING or verified reduced CONFIRMED balance; partial before credit | Persist reduction/remaining amount and refund comment; no successful cash Refund or cancellation | Pending |
| TRANSACTION_REFUND | No refund TID; DEACTIVATED; full/balance before credit | CancelAuthorization / Success with refund wording, no invented new TID | Failed |
| CREDIT | Partial accumulated credit | Persist each credit TID once; original transaction remains pending while obligation is incomplete; credit comment | BalanceDue |
| CREDIT | Accumulated credit equals planned amount minus accepted pre-credit reductions | Complete Charge/Success as required; preserve existing SEPA charge representation; credit comment | Paid |
| TRANSACTION_UPDATE | AMOUNT / DUE_DATE / STATUS changes | Existing transaction update and localized reference comments | Recognized status mapping; confirmed incomplete capture uses BalanceDue |
| CHARGEBACK | Partial/full debit with valid linked amount | Chargeback / Success, reference comment | Retain current state by merchant policy |
| RETURN_DEBIT / RETURN_DEBIT_SEPA / REVERSAL | Same chargeback handling | Chargeback / Success, reference comment | Retain current state by merchant policy |
| PAYMENT_REMINDER_1 / PAYMENT_REMINDER_2 | Informational notification | Localized reminder comments only | Unchanged |
| SUBMISSION_TO_COLLECTION_AGENCY | Informational notification | Localized collection-reference comment only | Unchanged |
| Unknown top-level event | Not implemented | Acknowledge/log skipped | Unchanged |

`CREDIT_ENTRY_CREDITCARD`, `DEBT_COLLECTION_CREDITCARD`, `CREDITCARD_REPRESENTMENT`, `CREDIT_ENTRY_SEPA` and `DEBT_COLLECTION_SEPA` are expected under the provider's CREDIT event envelope and use its credit handling/comment wording. No separate top-level dispatch is added for those strings.

A provider rejection for a follow-up does not fabricate a successful CT transaction. Replay uses financial/event identity, not the visible comment text alone. Equal genuine pre-credit reductions retain equal comment blocks once for each accepted operation; duplicate delivery does not add a third copy.

## Payment Intents

| Action | Provider response | Local result and financial handling |
| --- | --- | --- |
| capturePayment | SUCCESS + CONFIRMED, verified original TID/currency/full amount | approved after CT synchronization; Charge / Success; Order Paid |
| capturePayment | PENDING / ON_HOLD / incomplete proof | received; verify the provider outcome before resolving the pending operation |
| cancelPayment | SUCCESS + CANCELLED / DEACTIVATED | approved after CT synchronization; CancelAuthorization / Success; Order Failed |
| refundPayment | Successful normal refund with new refund TID | approved after CT synchronization; Refund / Success; retain Order state |
| refundPayment | Successful partial pre-credit reduction, no refund TID and verified remaining balance | approved after saving reduction and comments immediately; Order Pending |
| refundPayment | Successful full/balance pre-credit reduction, no refund TID, DEACTIVATED | approved after saving CancelAuthorization / Success; Order Failed; refund wording |
| reversePayment | Existing successful Charge | Existing refund path for the refundable balance |
| reversePayment | Successful uncaptured Authorization | Existing cancellation path |
| Any action | Provider FAILURE | rejected; no successful money movement fabricated |
| Any action | Network-ambiguous result, unknown status or local write not completed | received; existing private-data pending marker retained; never blindly resend PSP money movement |

Intent requests send only custom.shop_invoked=1 and the saved language; no new operation-ID webhook fields are added. Own follow-up callbacks skip the ordinary webhook handlers. The existing private-data pending marker prevents an uncertain operation being blindly sent again; no automatic worker/callback reconciliation is claimed. Full Intent capture only; unsafe partial capture/reversal attempts retain their existing validation.
