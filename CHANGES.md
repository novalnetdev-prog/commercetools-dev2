# Changes and verified removals

Compared with the confirmed old 073245 ZIP. See qa/change-manifest.json for exact source paths/hashes. Formatting/import ordering also causes mechanical differences; it is not a financial-policy change.

## Removed from the previous expanded submission

- reconciler application, its package/configuration and scheduled execution: optional architecture, not a mandated third application.
- CTP_TRUSTED_PROXY_CIDRS, NOVALNET_API_URL and CTP_CHECKOUT_URL: restore the original configuration interface; regional Checkout origin derives from existing CTP_API_URL.
- IntentJournalService, PaymentLockService, recovery-job endpoint and discovery records: replace with a small safe-dispatch marker in existing private data. No automatic local-write replay is claimed.
- Additional operation-ID webhook fields: gateway custom data again uses only the requested shop_invoked and saved language.
- Generic new returnTo routing and its tests/context getter: preserve original merchant success/failure destinations. Signed return security remains.
- Scheduled redirect-notice sweep: notices retain logical expiry and deletion on retrieval; no background cleanup app.
- Job/lock/journal-only tests: their removed architecture no longer exists. Existing business/failure tests remain and standard operation-route authentication tests remain. No failing business case was hidden by skipping a test.

Original npm install lifecycle hook commands are restored exactly. Existing webhook-ip helper is retained and tightened, not removed. Fastify does not gain an unrequested trustProxy option. connect.yaml keys and app structure are mechanically compared against the old input.

## Retained corrections

Authenticated redirect error retrieval/acknowledgement, eight-second text alerts and matching rebuilt bundles; signed browser return parameters and provider proof; initial correlation before the PSP call; late initial event/return safeguards; pre-credit partial/balance metadata and immediate occurrence-aware refund comments; versioned CREDIT counters; actual payable amount and currency fraction digits/narrow symbols; timestamps and shared Payment/Order comments; missing shop data kept empty; friendly name/component alias separation; custom-Type compatibility and propagation of transient errors; actual configuration/status responses and bounded external requests; sanitized logs. See tests and status mapping for their exact scope.

Payment/authorize choices, guarantee eligibility/fallback, due dates, approved names, method-specific forms, Novalnet Utility CDN/runtime behavior, ON_HOLD/PENDING mapping, normal refund/chargeback merchant policy and fulfillment ownership remain as agreed. Multiple-Payment aggregate Order state is left to Checkout/the merchant rather than declaring an Order paid from this PSP alone. Tooling/lockfiles were updated to remove audited vulnerabilities; SDK remains on the 0.28.x line. There are two lockfiles, not three.

## Verified removals

| Removed item | Evidence / why not needed |
| --- | --- |
| `enabler/src/fake-sdk.ts`, mock fields and 28 calls | Every caller checked: only logged/stored environment, no PSP or UI effect. `beginPayment` now only dismisses an old error; original component requests remain. |
| Unexecuted enabler TypeBox runtime schemas | Callers require only enum/TypeScript types. Processor request validation remains. Removes an undeclared server schema library from the browser bundle. |
| Unused `getOrderDetails()` and four discarded event-handler Order GETs | Sole results were discarded; actual Order comment/state synchronization retains its reads. No payment decision depended on them. |
| Duplicate Payment GET and duplicate redirect private-data write | Reuse the existing updated Payment. The redirect reference write now occurs before Order lookup and includes the same fields, so its later identical write was redundant. |
| Unused locals, transaction comment/template types and broken ambient declarations | Whole-project import search plus strict TypeScript unused checks; retained awaited mutations, actual Fastify context declarations and public routes. |
| Old uncalled CustomObject wrappers / API alias | No remaining consumers. Active keyed reads, versioned update and merge operations remain; financial persistence was not removed. |
| `processor/src/dtos/operations/transaction.dto.ts`, `processor/src/services/types/payment-extension.ts`, `processor/src/i18n/locale.ts` | No runtime/import consumers; unused template DTOs/duplicate locale helper. Active SDK contracts and dictionaries remain. |
| Unread mock config/duplicate endpoint aliases and two `Allowb2bCustomers` fields | No static or dynamic reads. These flags never implemented B2B eligibility. No active guarantee condition is removed. Regional service URLs now use explicit deployment values. |
| `payment-integration-manifest.json` | Unreferenced legacy manifest pointing to a Vercel payment-handler outside this connector. Connect uses connect.yaml; no runtime, build, hook or document consumer used that file. Removes a misleading hardcoded deployment endpoint. |
| `enabler/public/README.txt` | Template placeholder, no application reference or build use; actual public ES/UMD assets retained. |
| Direct dependencies `@fastify/http-proxy`, `@fastify/static`, `msw`, `node-fetch`; dev nodemon | No source/test/hook consumers. Assets are separate; Node provides fetch/watch. SDK-owned transitive requirements remain under its lockfile. |
| Template sample tests and unused mock fixtures | Replaced assertion-free/obsolete sample coverage with Novalnet service, HTTP-boundary and recovery tests. No known business failure was hidden by a skipped test. |
| Unused Intent append-comment helper | No callers after the shared occurrence-aware comment operation. Actual refund/comment synchronization remains. |

The exact removed-file list is included in `qa/change-manifest.json`. We did not delete a public helper route simply because no internal caller was found.

## Operational impact

Deploy both app revisions and start new signed attempts. Use a unique merchantReference per genuinely new Intent operation. An uncertain financial request is not automatically resent: inspect the provider result and synchronize financial records before resolving its pending marker. No scheduled recovery or repeated-partial-capture capability is included. Deployed UI/ingress and official validation remain to be tested.

The existing local enabler dev harness remains because index.html calls it. Removed only its access-token console output; the production library does not import the harness. It must never be exposed with production credentials.
