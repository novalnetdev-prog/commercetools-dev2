# Local QA — 22 October 2026

Baseline: confirmed old 073245 ZIP. Node 24.19.0 / npm 11.9.0. No live Novalnet financial requests, deployment, browser acceptance run or certification submission was performed.

| Check | Result |
| --- | --- |
| Fresh npm ci, both applications | Passed |
| Processor TypeScript production build | Passed |
| Processor strict unused-local/parameter check | Passed |
| Processor Prettier/ESLint | Passed |
| Processor Jest | 206 tests, 16 suites, zero failures/skips |
| Enabler typecheck and production build | Passed |
| Enabler Jest | 74 tests, 6 suites, zero failures/skips |
| npm audit, full and production-only, both applications | Zero reported vulnerabilities in all four snapshots |
| Configuration interface comparison | Original 63 processor keys; zero enabler keys; two original app types and lifecycle hooks |
| Public bundle/source build match | ES and UMD bytes match generated dist |
| ZIP/source integrity | Verified when packaging; no node_modules, dist, environment secrets or logs included |

Tests cover service-level mappings and refunds, credits/comments/replays, unknown outcomes and pending duplicate guards, provider/reference binding, late initial results, custom Types, authenticated HTTP operation/error-return boundaries, enabler errors/aliases and input validation. Dependencies and external services are mocked in the self-contained integration tests. Test assertions/counts are in qa/test-results.json; audits and hashed change inventory are included. This is not a claim of complete branch or live financial coverage.

## Outstanding acceptance / certification work

Run the deployed matrix in TEST_PLAN.md with test credentials and the real storefront. Verify ingress forwarding/IP isolation, Session remount and cross-origin redirect-error display, real SDK authentication/authorities, webhook retries and live provider response shapes. Run Connect preview/official CLI validation and its SAST/SCA quality gates; npm audit is only a local dependency snapshot. Supply a stable repository tag and creator/contact/paperwork through the normal certification process.

Known limits retained: no repeated portal partial capture; full Intent capture only; uncertain Intent outcomes require provider verification/manual synchronization; own shop_invoked callbacks skip ordinary handlers; no automatic worker or expired-notice sweep; generic Checkout return/resume integration is the merchant frontend's responsibility. Fixed public PSP-origin policy must be confirmed with the Connect team against its broad hardcoded-URL guidance. The connector is not represented as certified or guaranteed to pass certification.
