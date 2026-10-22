# Novalnet enabler

Connect assets application providing the payment-specific forms/builders consumed by commercetools Checkout. It uses Novalnet's existing browser libraries for card/token and SEPA utility behavior. SEPA/ACH bank details required by their APIs pass to the processor; do not log them. This repository makes no standalone PCI certification claim.

Use Node 22 or 24. From this directory:

```bash
npm ci
npm run build
npm test -- --runInBand
npm start
```

The build typechecks source and generates both `public/connector-enabler.es.js` and `public/connector-enabler.umd.js`. `npm start` serves those built public assets on port 8080; `npm run dev` is the Vite development server. Commit both bundles with the matching processor.

Payment methods retain separate component folders and stable identifiers; friendly aliases are resolved by the builder. Friendly Payment names are separate from Checkout integration displayInfo labels, descriptions and logos. Configure custom methods' displayInfo in the merchant integration.

Direct and recovered redirect errors use an accessible text alert and the supplied Checkout onError callback. Redirect notices are retrieved with the active Checkout Session, acknowledged after display and suppressed after another attempt starts. Alerts close after eight seconds. No HTML from a provider message is executed.

The storefront must resume Checkout using the returned paymentReference and original Session/configuration. A top-level URL message by itself may not be accessible inside hosted Checkout; the authenticated recovery endpoint is therefore part of this implementation. See [deployment instructions](../README.md), [QA_REPORT.md](../QA_REPORT.md) and [TEST_PLAN.md](../TEST_PLAN.md).

The index.html/dev-utils harness is local development only and is not in the built public library. It uses development credentials to create Sessions: never expose it with production credentials or publish it as a storefront. Token console logging has been removed. The Connect assets app serves public only.
