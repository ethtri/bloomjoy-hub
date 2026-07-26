# Refund Identification Strategy

Last updated: 2026-07-26

Status: approved direction; implementation is not yet live.

## Plain-English summary

Each participating machine will have its own refund QR code. When a customer scans it, Bloomjoy will know which machine they are standing at and will record the scan time on the server. The QR code itself does not contain the current time; the server records the time when the link is opened.

The customer will still enter:

- the approximate purchase time
- the amount charged
- the payment method
- the card's last four digits

For Apple Pay or another mobile wallet, the form must ask for the virtual card's last four shown in the wallet. Those digits may differ from the physical card and may still be unreliable as a transaction key, so they are supporting evidence rather than the only way to match.

Bloomjoy will compare the claim with recent Nayax transactions for that machine. A manager will see a recommended transaction only when the evidence points to one plausible transaction. If two transactions could fit, Bloomjoy will not guess.

A high-confidence recommendation helps a manager find the charge. It does not prove the product failed to dispense, approve the refund, or authorize an automatic payment.

## What exists today

| Area | Current state | Gap |
| --- | --- | --- |
| Public intake | `/refunds/request` supports both direct intake and an opaque machine-QR path with a short-lived, single-use, server-timestamped claim. | Physical QR generation, rotation, download, and placement controls are tracked separately in `#664`. |
| Wallet guidance | The form asks Apple Pay/mobile-wallet customers for the virtual last four and explains that it may still differ from Nayax. | The digits remain supporting evidence rather than a reliable identity key. |
| Nayax lookup | Server-side read-only Last Sales lookup and machine mappings are available for the current refund cohort. | Deployment and shadow-pilot evidence are still required before relying on the QR-aware policy operationally. |
| Matching | Policy `2026-07-26.v2` separates reported incident time from verified QR-open time and supports strong-card, unique QR/time, and ambiguous/manual classes. | A unique QR/time result is advisory and manual-only; it cannot enable live/one-click execution. |
| Manager workflow | Managers can review cases and use the authorized Nayax portal workflow. | Recommendation confidence must stay separate from manager approval and live in-app execution. |
| Delivery evidence | No reliable machine signal says whether the product was delivered. | Transaction matching cannot establish that a vend failed. The manager still decides the customer-service outcome. |
| Alternative compensation | Cash currently follows the manual cash/Zelle path. | An e-gift card, store credit, machine credit, or other fallback for unmatched wallet/contactless and cash claims is TBD. |

The versioned rules in `Docs/REFUND_NAYAX_MATCHING_RUNBOOK.md` are authoritative for source behavior. Production must not be treated as QR-aware until the migration and related Edge Functions are deployed and the shadow pilot in `#665` passes.

## Target customer flow

1. The customer scans the QR code attached to the machine.
2. Bloomjoy resolves an opaque QR identifier to one refund-enabled machine and records the server time.
3. The refund form shows the machine/location so the customer can confirm they scanned the correct code.
4. The customer enters the approximate purchase time, amount, payment method, and last four.
5. Apple Pay/mobile-wallet customers enter the virtual last four displayed in their wallet, not the physical-card last four.
6. Bloomjoy searches recent Nayax transactions for that machine and applies deterministic, versioned rules.
7. A manager receives either one explainable recommendation or an explicit ambiguous/no-safe-match result.

The direct form remains available for customers who did not scan a QR code, but those cases will not have trusted QR timing evidence.

## Recommendation rules

| Result | Meaning | Manager action |
| --- | --- | --- |
| Strong card evidence | The approved machine, amount, timing, and submitted last four agree with one safe Nayax candidate. | Review the evidence and, if the refund is approved, process it through the authorized Nayax portal workflow. |
| Unique QR/time evidence | The machine, exact amount, customer-reported time, and server-recorded QR time leave exactly one plausible Nayax candidate. A wallet last-four mismatch or unavailable value does not create a second candidate. | Review the explanation and, if approved, process the original-card refund manually in Nayax. Live in-app execution stays disabled. |
| Ambiguous or no safe match | More than one candidate could fit, the scan was too late to be useful, required evidence is missing, the provider response is unsafe, or no candidate fits. | Do not select a transaction. Request more information or use the approved manual/fallback process. The alternative-compensation method is still TBD. |
| Cash | There is no Nayax card transaction to refund. | Continue the current approved manual path until issue `#666` records a replacement decision. |

The exact timing windows must be named, server-controlled, versioned, visible in sanitized audit evidence, and covered by close-transaction fixtures. They must be conservative enough for machines that may process roughly 30 transactions per hour. Changing a threshold requires test evidence and an updated policy version.

The matcher must never:

- describe a score as a probability
- recommend one transaction when another remains plausible
- use browser time as trusted scan evidence
- treat a transaction match as proof of failed delivery
- turn a recommendation into automatic approval
- make wallet cases eligible for live in-app execution without the separate provider and sponsor gates in `#430`

## QR and data safeguards

- The public QR URL uses an opaque, rotatable identifier, not a database ID, Nayax ID, or other provider identifier.
- Each scan creates a new short-lived server-side claim context with the machine and `opened_at` time.
- The intake function verifies the claim context and keeps QR time separate from the customer-reported incident time.
- Disabled, rotated, expired, tampered, refreshed, and duplicate paths fail safely.
- Public endpoints use the existing abuse, rate-limit, and duplicate protections.
- Customer-facing pages, logs, GitHub evidence, and partner reporting must not expose raw Nayax payloads, payment IDs, full card data, or complaint text.
- Managers see only the sanitized evidence allowed by the existing refund visibility decision.

## Scope boundaries

The first rollout covers the six proposed public Commercial/Mini refund machines already backed by the current Bloomjoy/Nayax setup. The exact pilot cohort and named managers still require the normal rollout confirmation in the shadow-pilot process.

Snapcase/phone-case machines stay out of scope until Bloomjoy chooses and models their payment and sales source of truth.

The legacy Google Form/Sheet/AppSheet fallback remains available until the existing cutover gate is approved. This strategy does not enable live Nayax API refunds, Gmail, GPT, or automatic refund approval.

## Delivery plan

Parent plan: [`#661`](https://github.com/ethtri/bloomjoy-hub/issues/661)

| Order | Issue | State | Outcome |
| --- | --- | --- | --- |
| 1 | [`#662`](https://github.com/ethtri/bloomjoy-hub/issues/662) | Implemented and merged | Machine-specific QR intake, trusted server scan time, wallet copy, safe public failure states, and reusable UAT. |
| 2A | [`#663`](https://github.com/ethtri/bloomjoy-hub/issues/663) | Implemented in source; deployment and pilot follow | QR-aware, wallet-safe deterministic recommendations with explainable ambiguity. |
| 2B | [`#664`](https://github.com/ethtri/bloomjoy-hub/issues/664) | Ready after `#662` establishes the QR identifier contract | Admin generation, download, rotation, and physical verification of per-machine QR assets. |
| 3 | [`#665`](https://github.com/ethtri/bloomjoy-hub/issues/665) | Blocked by `#662`-`#664` | Six-machine shadow pilot, aggregate evidence, and rollout/rollback recommendation. |
| Separate decision | [`#666`](https://github.com/ethtri/bloomjoy-hub/issues/666) | Needs owner decision; does not block QR engineering | Select or decline an alternative compensation method for unmatched wallet/contactless and cash claims. |

After `#662` establishes the shared contract, `#663` and `#664` can proceed in parallel. Broader rollout waits for `#665`.

## Pilot success standard

The shadow pilot must include ordinary cards, wallet last-four mismatch, one unique transaction, multiple same-price transactions close together, a late scan, wrong or uncertain amount, missing QR evidence, direct-form intake, and Nayax failure.

The pilot pauses a confidence class if it produces any known false-positive recommendation in the controlled validation set. Evidence shared in GitHub remains aggregate and sanitized. Any live refund continues through the authorized human-reviewed process.

## Open decision

The fallback compensation method is intentionally TBD. No gift-card provider, Nayax/Monyx app flow, stored-value platform, or machine-credit design is approved by this strategy. Issue `#666` owns that research and owner decision.
