# Deployed acceptance matrix

Local automated results are in QA_REPORT.md. Use provider test credentials and record Payment/Order IDs, provider TIDs, action identity, expected/actual transactions, comments, timestamps and Order paymentState. Do not use live funds for this matrix.

| Area | Required cases / expected evidence |
| --- | --- |
| Initial direct | Confirmed, ON_HOLD, PENDING, provider failure, guarantee failure/fallback enabled and disabled; German/English exact errors and eight-second alert. No invented currency/IP. |
| Cards | Valid direct and 3DS authorize/capture; invalid number/expiry/CVC/empty, German messages; failed/cancelled 3DS returns. |
| Bank forms | SEPA/G_SEPA BIC show/hide and submitted value; original Utility behavior; holder paste/type umlauts, ampersand/space; reject numbers/special characters; ACH numeric fields and localized DOB. |
| Redirect | Success, failure, cancellation; checkout Session remount; notice visible/acknowledged once; no notice after new attempt; expired notice not shown; tampered return rejected; existing success thank-you path retained. |
| PAYMENT fallback | Lost direct/redirect response; verified failure; duplicate and delayed initial event after follow-up; missing Order retries; no reset of later finance/comments. |
| Capture/cancel | ON_HOLD capture or cancel via portal and Intent; full Intent capture only; initial cancelled/deactivated PAYMENT; no duplicate successful transactions. |
| Normal refunds | Partial, repeated equal partial, final balance, full; new refund TID; Intent and portal; comments in Payment and Order; EUR/USD narrow symbols. |
| Pre-credit refunds | Partial, equal partial, final balance/full DEACTIVATED without refund TID; immediate first comments; cancellation only on DEACTIVATED; partial then balance CREDIT equals net obligation; SEPA existing Charge retained. |
| Credit | Duplicate/reordered deliveries, partial/full accumulated CREDIT; credit subtypes use CREDIT comments; no double counters/comments; remaining obligation after pre-credit reductions. |
| Other webhooks | Reminder 1/2, collection submission, chargeback/return debit/reversal, amount/due-date/status update; preserve agreed financial mapping and fulfillment state. |
| Retry/failure | Provider timeout and local CT write failure; received with pending marker; repeated identical request does not call PSP twice; changed concurrent request blocked; completed same reference returns result; verified manual reconciliation procedure. |
| Security/operational | Missing/wrong Session, JWT/OAuth/authority, wrong checksum/IP, spoofed header prefix, wrong Payment/TID, actual deployed proxy chain, secrets absent from logs, compatible/incompatible Custom Types and transient lookup failures. |
| Checkout integration | Component inventory, actual config/public key, configured custom displayInfo logos/titles, account/MC names, multiple-Payment Order ownership, no connector Cart-to-Order creation. |
| Metadata/comments | Runtime server/customer IP, system version/storefront URL/cart info; bank minor units/due date; Multibanco live supplier/entity reference; initial/follow-up timestamps/comments on both records. |

Before submitting: clean install/build/test in Connect preview; official validate and full SAST/SCA; stable Git tag; license, installation guide and creator/support details. Compare each deployed result against STATUS_MAPPING.md. Do not advertise unsupported partial capture or automatic reconciliation.
