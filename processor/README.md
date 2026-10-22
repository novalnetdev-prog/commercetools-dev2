# Novalnet processor

Connect service for initial direct/redirect payments, verified returns/webhooks, Payment Intents and commercetools synchronization. See the root [README](../README.md) for existing configuration, deployment and retry limitations.

Use Node 22 or 24. Run npm ci, npm run build, npm run lint and npm test -- --runInBand. npm start runs built code. npm run watch uses Node watch/ts-node for local development. Post-deploy initializes compatible Custom Types; pre-undeploy preserves financial records.

| Route | Protection / role |
| --- | --- |
| /directPayment, /redirectPayment | Checkout Session; initial requests. |
| /success, /failure | Signed merchant return fields; provider proof for financial result. |
| /novalnletWebhook | Checksum, existing IP validation and provider-to-Payment reference binding. |
| /redirectPaymentError | Checkout Session; retrieve/acknowledge the authenticated Cart notice. |
| /operations/config | Checkout Session; public configuration. |
| /operations/status, /operations/payment-components | Merchant JWT; status and inventory. |
| /operations/payment-intents/:id | OAuth and payment-intent authority; one financial action. |

Other original compatibility routes remain. No financial health transaction, new recovery endpoint or scheduled application is added. See [QA](../QA_REPORT.md) and [tests](../TEST_PLAN.md).
