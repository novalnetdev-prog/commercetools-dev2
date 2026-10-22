# Scope correction and provider comparison — 22 October 2026

Authoritative old Novalnet input: commercetools-testing-main(20261022-073245).zip, SHA-256 89c4673e55b4e6d26b2a6d32d86e5c9acab79ba0f6ac074c3f03e9e89502badc. It contains 120 files. The earlier 073000 upload matched the previous expanded submission rather than this old baseline. The supplied Adyen and PayPal sources were read as architecture/comparison references; their certification status was reported by the merchant, not independently verified here.

| Area | Evidence / conclusion | This revision |
| --- | --- | --- |
| Applications | Official template and supplied Adyen/PayPal use enabler + processor. A third scheduled app is not named as mandatory. | Original two apps only. |
| Configuration | Neither supplied example mandates CTP_TRUSTED_PROXY_CIDRS or NOVALNET_API_URL. PayPal has its own Checkout URL setting; that does not make a new Novalnet setting necessary. | Original 63 processor keys and zero enabler keys; original hooks retained. Removed all three added keys, including CTP_CHECKOUT_URL. |
| Idempotency/fault tolerance | Official best practices require attention to duplicate submissions and errors, not a prescribed journal/worker design. | Remove the separate journal, distributed lock, operation-ID callback fields and recovery job. Retain a minimal CAS pending/result marker in existing private data to prevent double financial dispatch. Unknown outcomes require operator verification. |
| Provider API origins | Supplied PayPal uses fixed live/test public API origins; Adyen uses provider environment configuration. Exact NOVALNET_API_URL is not an explicit documented requirement. | Original Novalnet public origin retained. Certification documentation also contains broad wording against hardcoded URLs: get Connect-team confirmation of that policy's application to a fixed public PSP endpoint. Example code is not an exemption or certification guarantee. |
| Proxy/IP security | Supplied Adyen enables trustProxy; PayPal does not. Copying either blindly is not evidence of a secure Novalnet webhook client-IP check. | No new proxy field. Existing GFE appended-client convention tightened and tested against injected prefixes; deployed ingress verification remains necessary. |
| Cart/Order ownership | Official template excludes Cart-to-Order conversion. PSP status names and capture/refund details differ by provider. | No Cart-to-Order creation, no fulfillment orderState writes. Keep Novalnet mappings and merchant financial-state policy. |
| Error handling | A return query cannot render an error inside a separate hosted Checkout frame. | Retain authenticated Cart notice recovery, source and rebuilt bundles; original merchant return destinations retained. Verify actual storefront remount/session behavior. |
| Validation | Published examples cannot certify another connector. Official pipeline validates structure, builds, tests, SCA and SAST. | Local evidence supplied; official preview, deployed financial tests and Connect review remain outstanding. |

No payment method, guarantee policy or financial mapping was copied from Adyen/PayPal. No new product feature is presented as a certification requirement.

## Primary references checked

- https://docs.commercetools.com/connect/templates/payment-integration
- https://docs.commercetools.com/connect/certification
- https://docs.commercetools.com/connect/validation-pipeline
- https://docs.commercetools.com/checkout/browser-sdk
- https://docs.commercetools.com/checkout/payment-intents-api
- https://docs.cloud.google.com/appengine/docs/standard/reference/request-headers
- https://docs.cloud.google.com/load-balancing/docs/ipv6

The certification decision belongs to commercetools. Local test/audit success does not replace that decision.
