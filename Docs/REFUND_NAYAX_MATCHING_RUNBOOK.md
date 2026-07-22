# Refund Nayax Matching Runbook

## Purpose

This runbook defines the deterministic, manager-confirmed card-transaction recommendation used by Refund Operations. It is advisory matching, not a probability score and not permission to issue a refund.

Live Nayax refund execution remains controlled by the separate sponsor gate, machine allowlist, environment flags, caps, kill switch, and execution runbook.

## Policy version

Current policy: `2026-07-21.v1`.

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

## Recommendation states

- `high_confidence`: one safe candidate has at least 80 ranking points, exact amount, an exact resolved time within 60 minutes, matching card evidence, no safety/manual flags, and at least a 15-point lead over the next eligible candidate. Only this recommended candidate can become one-click eligible after manager confirmation.
- `ambiguous`: at least two otherwise eligible candidates are separated by fewer than 15 points. No candidate is labeled recommended or one-click eligible.
- `no_safe_match`: no candidate satisfies the safe recommendation rules. Managers may request more information or use the manual review path.
- `manual_exception`: provider, duplicate/refund, wallet, missing evidence, or timezone evidence requires manual review. One-click stays unavailable.

## Safety rules

The scorer hard-blocks selection for a different provider machine, non-USD currency, a declined/failed/voided sale, a transaction already linked to another case, or existing refund evidence. Negative provider status always overrides positive words in the same status (for example, `not approved` and `successful reversal` are blocked). Missing provider machine identity cannot earn mapped-machine points and requires manual review. A non-wallet card-last-four mismatch is not eligible. All wallet transactions, missing provider site identity, duplicate provider records, missing provider last four, unconfirmed provider status, missing currency, and non-exact incident/provider time resolution require manual review during this pilot.

Exact amount is mandatory for one-click eligibility. An amount mismatch may remain visible as review evidence but cannot be recommended for one-click execution.

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

Record only the policy version, recommendation state, candidate count, recommended rank (when one exists), one-click eligibility, manager selection rank, whether the recommendation was accepted, a structured disagreement reason, time/amount deltas, and redacted factor labels. Do not log customer email, card details beyond approved sanitized fields, free text, raw Nayax payloads, tokens, or provider transaction IDs.

## Verification

Run:

```text
npm run refunds:validate-nayax-matching
npm run refunds:validate-portal-uat -- --app-url <local-or-preview-url>
npm run refunds:validate-nayax-execution
npm run db:validate-migrations
```

Before a live pilot, verify ambiguous, no-safe-match, manual-exception, duplicate, already-refunded, wallet mismatch, and both DST edge cases all keep one-click execution closed.

## Rollback

Set the global Nayax execution kill switch and execution-enabled flag to the fail-closed state first. Roll back the application/functions to the last approved version. Leave the new nullable evidence columns in place; they are backward-compatible, and existing eligibility defaults to false. Do not delete audit evidence during rollback.
