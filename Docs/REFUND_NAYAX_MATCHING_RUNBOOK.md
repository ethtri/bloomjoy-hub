# Refund Nayax Matching Runbook

## Purpose

This runbook defines the deterministic, manager-confirmed card-transaction recommendation used by Refund Operations. It is advisory matching, not a probability score and not permission to issue a refund.

This document governs transaction matching only. Its former statement that the production adapter was statically disabled described a pre-`#430` release and is superseded. Current refund execution authority, account identity, response-contract blocker, and safety gates are recorded in `Docs/DECISIONS.md`, `Docs/CURRENT_STATUS.md`, and `Docs/PRODUCTION_RUNBOOK.md`.

## Policy version

Current policy: `2026-08-11.v3`.

Internal ranking points order otherwise-safe candidates. Never show the point total as a percentage or describe it as statistical confidence.

| Evidence | Ranking points |
| --- | ---: |
| Exact mapped machine and location | 40 |
| Exact amount | 25 |
| Amount within 50 cents | 8 |
| Time within 15 minutes | 25 |
| Time within 60 minutes | 18 |
| Time within 3 hours | 8 |
| Time within 6-hour lookup window | 2 |
| Exact card last four | 20 |
| USD currency | 5 |
| Explicit approved provider status | 5 |

## Confidence classes

- `strong_card`: exactly one otherwise-safe sale has the mapped machine, exact amount, exact resolved customer-reported time within 60 minutes, and correlating card last four. This is the only class that may become one-click eligible after manager confirmation, and only for a non-wallet transaction. A manager may still select an otherwise-safe transaction outside this class when the current evidence identifies one purchase.
- `unique_qr_time`: exactly one otherwise-safe sale has the mapped machine, exact amount, exact resolved provider/customer times, occurs no more than 30 minutes before the verified server-recorded QR open, and has no plausible runner-up. It may guide a manager when wallet or contactless digits do not correlate, but it is never selected automatically.
- `ambiguous_manual`: the available evidence does not meet either rule. This includes close-together candidates, a missing/invalid/replayed QR claim, a QR opened more than 30 minutes after the sale, uncertain amount, a customer time that may be off by an hour or is only rough, non-exact time resolution, or provider trouble.

## Recommendation states

- `high_confidence`: exactly one candidate qualifies as `strong_card` or `unique_qr_time`. The confidence class—not this state alone—controls whether guarded execution can ever become eligible.
- `ambiguous`: more than one candidate qualifies under the same safe evidence path. No candidate is labeled recommended or one-click eligible.
- `no_safe_match`: no candidate satisfies the safe recommendation rules. Managers may request more information or use the manual review path.
- `manual_exception`: one or more candidates exist, but missing, late, contradictory, or unsafe evidence requires manual review. One-click stays unavailable.

## Safety rules

The scorer hard-blocks selection for a different provider machine, non-USD currency, a declined/failed/voided sale, a transaction already linked to another case, or existing refund evidence. Negative provider status always overrides positive words in the same status (for example, `not approved` and `successful reversal` are blocked). Missing provider machine identity cannot earn mapped-machine evidence. A suffix mismatch is negative only when the recorded interaction and identifier provenance establish that the customer and provider values should be equivalent; unproved contactless differences remain contextual evidence.

Contactless and wallet last four is supporting evidence, not an identity key. A correlating last four can support `strong_card`. When wallet or contactless evidence does not correlate, the manager may select an otherwise-safe transaction only when the combined evidence identifies one purchase and there is no plausible competing sale. The selected transaction then uses the normal guarded refund path; wallet classification alone does not route it to a separate portal workflow.

QR open time and customer-reported incident time are stored, evaluated, and displayed separately. QR evidence must be a consumed, single-use claim bound to the same machine. Missing, invalid, replayed, future, or late QR evidence never supports `unique_qr_time`.

Exact amount is mandatory for one-click eligibility. An amount mismatch may remain visible as review evidence but cannot be recommended for one-click execution.

Customer time confidence is separate from time-zone resolution. `exact` and `within_15_minutes` may support the existing deterministic rule. `within_1_hour` and `rough` remain useful comparison evidence, but they make the result manager-review-only. Existing records without the field retain their legacy behavior.

The current read-only integration may also snapshot a configured product/selection price, current machine status, and machine alerts within two hours of the sale. These fields do not add ranking points or execution eligibility. They are investigation context only and must always be described as not proving that the purchase failed.

Current Last Sales responses identify a card/prepaid sale and may include card brand, masked digits, recognition/payment text, amount, time, machine, and product text. Bloomjoy's current data does not reliably distinguish a tapped physical card from Apple Pay or Google Wallet. The form records the customer's description separately. Richer transaction-feed fields remain gated by `#751` and require Bloomjoy sample validation before use.

Managers always confirm the transaction. Selecting an alternate requires one structured reason: closer time, correct amount, correct card, customer confirmation, provider data issue, or other reviewed evidence. Free-text and raw provider IDs are not stored in recommendation telemetry.

The system rechecks cross-case use when a manager selects a candidate and again before execution. A partial unique database index is the final race-safe guard: the same provider transaction cannot be linked to two refund cases. If historical duplicates exist, deployment stops with an explicit review requirement instead of silently repairing or deleting them.

## Timezone and DST handling

The browser sends the incident date and local wall-clock time separately. The intake function resolves them using the selected location's canonical IANA timezone and stores the UTC instant plus sanitized resolution metadata.

- Ordinary local time with one possible instant: exact.
- Spring-forward nonexistent time: manual exception.
- Fall-back repeated time: manual exception until an occurrence/fold can be established.
- Legacy absolute timestamps: manual exception.
- Nayax GMT timestamps: preferred.
- Zone-less machine timestamps: resolved with the canonical location timezone only when unambiguous; otherwise manual exception.

## Deterministic ordering

Candidates sort by ranking points, then smallest amount delta, smallest time delta, earliest authorization instant, and finally a server-only transaction identifier. The identifier is used only as a stable tie-breaker and is never returned to the browser.

## Privacy-safe shadow evidence

Record only the policy version, recommendation state, confidence class, redacted reason codes, QR-evidence status, candidate count, recommended rank (when one exists), one-click eligibility, manager selection rank, whether the recommendation was accepted, a structured disagreement reason, time/amount deltas, and redacted factor labels. Do not log customer email, card details beyond approved sanitized fields, free text, QR tokens/hashes, raw Nayax payloads, or provider transaction IDs.

## Verification

Run:

```text
npm run refunds:validate-nayax-matching
npm run refunds:validate-portal-uat -- --app-url <local-or-preview-url>
npm run refunds:validate-nayax-execution
npm run db:validate-migrations
```

Verify strong-card, unique QR/time, two close-together sales, missing QR, late QR, replay attempt, wrong/uncertain amount, lookup failure, duplicate, already-refunded, wallet mismatch, and both DST edge cases. Automatic recommendation remains limited to the strongest evidence class. Any manager-selected transaction must pass the current exact-binding, duplicate, retry-safety, durable-attempt, and unknown-result controls before provider execution.

## Rollback

Set the global Nayax execution kill switch and execution-enabled flag to the fail-closed state first. Roll back the application/functions to the last approved version. Leave the new nullable evidence columns in place; they are backward-compatible, and existing eligibility defaults to false. Do not delete audit evidence during rollback.
