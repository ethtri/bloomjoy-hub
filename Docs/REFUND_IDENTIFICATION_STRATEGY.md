# Refund Identification Strategy

Last updated: 2026-08-03

Status: approved direction; identification and the provider-outcome safety model are implemented for review in an unmerged candidate, while live refund execution remains statically disabled.

## Plain-English summary

Each participating machine will have its own refund QR code. When a customer scans it, Bloomjoy will know which machine they are standing at and will record the scan time on the server. The QR code itself does not contain the current time; the server records the time when the link is opened.

The customer will still enter:

- the approximate purchase time
- the amount charged
- the payment method
- the card's last four digits

For Apple Pay or another mobile wallet, the form must ask for the virtual card's last four shown in the wallet. Those digits may differ from the physical card and may still be unreliable as a transaction key, so they are supporting evidence rather than the only way to match.

Bloomjoy will compare the claim with recent Nayax transactions for that machine. A manager will see a recommended transaction only when the evidence points to one plausible transaction. If two transactions could fit, Bloomjoy will not guess.

A high-confidence recommendation does not prove the product failed to dispense or approve the refund. It does let Bloomjoy put one clear decision in front of the manager. Approval authorizes one provider attempt after every gate passes; it is not completion or customer-success evidence. Only token-bound confirmed provider success plus atomic case/reporting completion may send one original-thread customer confirmation with the current active mapped managers CC'd and no separate manager completion email.

## What exists today

| Area | Current state | Gap |
| --- | --- | --- |
| Public intake | `/refunds/request` supports both direct intake and an opaque machine-QR path with a short-lived, single-use, server-timestamped claim. | Physical QR generation, rotation, download, and placement controls are tracked separately in `#664`. |
| Wallet guidance | The form asks Apple Pay/mobile-wallet customers for the virtual last four and explains that it may still differ from Nayax. | The digits remain supporting evidence rather than a reliable identity key. |
| Nayax lookup | Server-side read-only Last Sales lookup and machine mappings are available for the current refund cohort. | Deployment and shadow-pilot evidence are still required before relying on the QR-aware policy operationally. |
| Matching | Policy `2026-07-26.v2` separates reported incident time from verified QR-open time and supports strong-card, unique QR/time, and ambiguous/manual classes. | The current policy keeps unique QR/time results manual-only. Issue `#674` must add tested execution eligibility without weakening ambiguity rules. |
| Customer correction | The intake form explains that wallet/device digits may differ from the physical card. | Issue `#673` must automatically collect corrected virtual last four through a secure self-service link and re-run matching. |
| Manager workflow | The unmerged candidate enforces mapped-manager-only official actions and fresh per-action TOTP, but the production gate remains statically false. Exact case links, queue selection, and filters are navigation-only; the manager explicitly chooses **Check Nayax transaction**. | Live provider execution, owner enrollment/UAT, and gate-on work remain in `#430`, `#674`, `#689`, and `#692`. |
| Delivery evidence | No reliable machine signal says whether the product was delivered. | Transaction matching cannot establish that a vend failed. The manager still decides the customer-service outcome. |
| Alternative compensation | Cash currently follows the manual cash/Zelle path. | Issue `#666` is a P0 decision for the terminal unmatched/contactless and cash path. The provider and business rules remain TBD. |

The versioned rules in `Docs/REFUND_NAYAX_MATCHING_RUNBOOK.md` are authoritative for source behavior. Production must not be treated as QR-aware until the migration and related Edge Functions are deployed and the shadow pilot in `#665` passes.

## Target customer flow

1. The customer scans the QR code attached to the machine.
2. Bloomjoy resolves an opaque QR identifier to one refund-enabled machine and records the server time.
3. The refund form shows the machine/location so the customer can confirm they scanned the correct code.
4. The customer enters the approximate purchase time, amount, payment method, and last four.
5. Apple Pay/mobile-wallet customers enter the virtual last four displayed in their wallet, not the physical-card last four.
6. Bloomjoy searches recent Nayax transactions through an approved backend workflow or after the manager explicitly chooses **Check Nayax transaction**. Opening an email link, selecting a queue row, or changing a filter never starts that search.
7. If the wallet details may be wrong, Bloomjoy automatically asks the customer to provide the virtual/device last four through a secure correction link and then repeats the search.
8. A manager receives one explainable recommendation only when the evidence leaves one plausible transaction.
9. The manager chooses **Approve refund** or **Decline**. The match never makes that decision for them.
10. After approval and every separate gate, Bloomjoy may execute one token-bound server-side provider attempt. Only confirmed success atomically completes the case/reporting and sends one customer-facing confirmation operation in the original thread with the active mapped-manager set CC'd; it does not send a second manager completion email.
11. If bounded matching and correction attempts still cannot identify one transaction, Bloomjoy offers the approved alternative-compensation route. If Nayax's result is unknown, Bloomjoy reconciles it before any retry or fallback.

The direct form remains available for customers who did not scan a QR code, but those cases will not have trusted QR timing evidence.

## Recommendation rules

| Result | Meaning | Manager action |
| --- | --- | --- |
| Strong card evidence | The approved machine, amount, timing, and submitted last four agree with one safe Nayax candidate. | Decide **Approve refund** or **Decline**. After approval and the `#430` release gate, Bloomjoy executes the refund and sends the single customer-facing completion operation with active mapped-manager CC. |
| Unique QR/time evidence | The machine, exact amount, customer-reported time, and server-recorded QR time leave exactly one plausible Nayax candidate. Wallet evidence does not leave another plausible transaction. | Make the same one-approval decision. Once the tested `#674` eligibility and `#430` provider gates pass, the manager does not need to process the transaction in Nayax. |
| Correctable wallet details | The customer may have entered the physical-card last four instead of the virtual/device last four, and corrected evidence could safely resolve the case. | Bloomjoy automatically sends the secure correction request in `#673`, receives the limited update, and re-runs matching without manager correspondence. |
| Ambiguous or no safe match | More than one candidate could fit, the scan was too late to be useful, required evidence is missing, the provider response is unsafe, or no candidate fits. | Do not guess or execute a card refund. Run any useful bounded correction step, then offer the approved `#666` fallback only when the case is terminally unmatched. |
| Cash | There is no Nayax card transaction to refund. | Use the approved `#666` fallback when available. Until then, continue the current approved manual cash/Zelle path. |

The exact timing windows must be named, server-controlled, versioned, visible in sanitized audit evidence, and covered by close-transaction fixtures. They must be conservative enough for machines that may process roughly 30 transactions per hour. Changing a threshold requires test evidence and an updated policy version.

The matcher must never:

- describe a score as a probability
- recommend one transaction when another remains plausible
- use browser time as trusted scan evidence
- treat a transaction match as proof of failed delivery
- turn a recommendation into automatic approval
- make any wallet or QR/time case execution-eligible when another transaction remains plausible
- treat manager approval as provider success
- retry an unknown provider result or issue fallback compensation before reconciliation

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

The legacy Google Form/Sheet/AppSheet fallback remains available until the existing cutover gate is approved. This strategy does not enable production Nayax API refunds, Gmail, GPT, or automatic refund approval. It defines the one-approval target; provider execution remains disabled until `#430` passes its separate release gate.

## Email assistant integration

The approved operating model for mailbox triage, deterministic customer clarification, manager CC, aging reminders, and exact case links is documented in `Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md` and tracked by `#683`. The email assistant may help the customer reach a safe match and help a mapped Machine Manager reach the right case, but the link is navigation-only: the manager explicitly chooses **Check Nayax transaction**, makes the official decision, and personally completes any TOTP step-up in the portal. GPT-authored text remains human-reviewed and cannot obtain a provider/settlement claim.

## Delivery plan

End-to-end parent: [`#674`](https://github.com/ethtri/bloomjoy-hub/issues/674)

| Order | Issue | State | Outcome |
| --- | --- | --- | --- |
| 1 | [`#661`](https://github.com/ethtri/bloomjoy-hub/issues/661), [`#662`](https://github.com/ethtri/bloomjoy-hub/issues/662), [`#663`](https://github.com/ethtri/bloomjoy-hub/issues/663), [`#664`](https://github.com/ethtri/bloomjoy-hub/issues/664), [`#665`](https://github.com/ethtri/bloomjoy-hub/issues/665) | Foundation partly merged; QR asset and shadow-pilot work remains | Prove machine-specific QR intake, trusted timing, conservative recommendations, printable assets, and the six-machine pilot. |
| 2 | [`#673`](https://github.com/ethtri/bloomjoy-hub/issues/673) | Ready for implementation | Secure customer correction, bounded reminders, and automatic re-matching without manager correspondence. |
| 3 | [`#430`](https://github.com/ethtri/bloomjoy-hub/issues/430) | Fail-closed foundation exists; account contract and integrated implementation remain | One mapped Machine Manager approval triggers idempotent Nayax execution; confirmed success sends one customer-facing completion with mapped-manager CC and writes reporting once. |
| 4 | [`#666`](https://github.com/ethtri/bloomjoy-hub/issues/666) | P0 owner decision required | Select and implement the terminal alternative-compensation method and controls. |
| 5 | [`#674`](https://github.com/ethtri/bloomjoy-hub/issues/674) | In progress | Integrate the slices and pass the end-to-end controlled pilot before production enablement. |

## Pilot success standard

The shadow pilot must include ordinary cards, a wallet with correct virtual last four, a wallet with physical last four corrected through self-service, one unique QR/time transaction, multiple same-price transactions close together, a late scan, wrong or uncertain amount, missing QR evidence, correction timeout, direct-form intake, provider rejection, provider timeout/unknown status, and a manager double-click.

The pilot pauses a confidence class if it produces any known false-positive recommendation in the controlled validation set. Evidence shared in GitHub remains aggregate and sanitized. Any live refund continues through the authorized human-reviewed process.

## How this should play out

**Physical card, one clear sale:** The customer scans the machine QR and submits the last four. Bloomjoy finds one sale. The mapped Machine Manager approves once. After the provider gate passes, Bloomjoy attempts the Nayax refund; only token-bound confirmed success and atomic case/reporting completion send one original-thread customer completion with the active mapped managers CC'd.

**Apple Pay, correct virtual last four:** Bloomjoy finds one sale using the machine, timing, amount, and wallet evidence. The manager sees the same one-button decision and never opens Nayax.

**Apple Pay, physical last four entered by mistake:** Bloomjoy emails the customer a secure correction link explaining where to find the virtual/device last four. The customer corrects it, Bloomjoy re-runs the search, and the manager is notified only when one safe match exists.

**Several same-price sales close together:** Bloomjoy does not guess. It attempts the useful correction step automatically. If the case remains ambiguous or the customer does not respond within the bounded window, Bloomjoy offers the approved alternative compensation.

**Nayax does not return a clear result:** Bloomjoy tells neither party that the refund succeeded, does not retry blindly, and does not issue a gift card. It reconciles the original attempt first so the customer cannot be paid twice.

## Open decision

The fallback compensation method is intentionally TBD but now blocks the complete terminal flow. No gift-card provider, Nayax/Monyx app flow, stored-value platform, or machine-credit design is approved by this strategy. Issue `#666` owns that research and owner decision.
