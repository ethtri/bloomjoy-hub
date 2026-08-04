# Refund Cross-Channel Reconciliation

Status: implemented for review; production rollout and synthetic UAT are still approval-gated.

## Plain-English outcome

A customer may submit the same incident through the website, reply by email, and also use the SMS Google Form. The Hub keeps each source record for traceability, but it does not let those records quietly become multiple refundable cases.

- The source importer prevents exact retries from creating new work.
- The Hub compares only the minimum facts needed to notice a likely duplicate.
- A Machine Manager sees the linked case references and the reasons for the match.
- The manager chooses which reference to keep, or confirms that the purchases are different.
- A pending or confirmed duplicate cannot reach a Nayax action, cash completion, or settlement adjustment.

The duplicate decision itself never sends a customer message and never calls Nayax.

## Same-source replay protection

These controls stay independent and authoritative:

| Source | Stable replay boundary | Result |
| --- | --- | --- |
| Website form | Server-side, salted submission fingerprint inside the bounded intake window | An exact retry returns the existing case and does not resend notifications. |
| Gmail | Designated mailbox fingerprint plus provider thread/message IDs | A provider redelivery attaches to the existing thread/case. |
| SMS Google Form | Opaque response-key and payload fingerprints in the import ledger | Sheet retries, row moves, and unchanged responses reuse the existing import/case. |

No provider ID, raw email address, complaint text, card digits, or Sheet value is copied into the reconciliation table.

## Cross-source comparison policy

Policy version: `2026-08-04.v1`.

The database evaluates a candidate only when both cases have the same normalized customer email, the same canonical machine, reported incident times within six hours, and either the same amount or matching card-payment evidence. The saved review contains fixed reason codes only.

An `exact` candidate also requires:

- incident times within 15 minutes;
- equal, non-empty amount and payment method;
- equal wallet answer; and
- for card payments, equal non-empty last four.

Anything less remains `possible`. Different emails, machines, or times outside six hours do not create a candidate under this policy.

### No silent cross-source merge

Even an exact cross-source candidate requires a manager decision during the pilot. This is intentionally more conservative than automatic merging: a legitimate second purchase is never discarded simply because its facts look similar.

## Manager procedure

1. Open the orange **Cross-channel duplicate check** on the selected case.
2. Open the linked case reference in another tab and compare the customer incident and transaction evidence.
3. Choose one:
   - **These are different purchases** — both cases may continue independently.
   - **Keep RF-…** — the chosen reference remains canonical; the other becomes a confirmed duplicate.
4. If new evidence appears before an official action, change the decision. Every decision and reversal writes a redacted event to both case timelines.
5. Do not paste customer details into notes just to explain the decision. Use the fixed decision and existing case evidence.

A case that already has a completed refund, live/ambiguous provider attempt, or reporting adjustment cannot be newly marked as the duplicate. Escalate it instead.

## Fail-closed action boundaries

Duplicate safety is enforced in the database, not only in the UI:

- manager approval/completion transitions;
- Nayax readiness and attempt records; and
- refund settlement adjustment writes.

The portal also disables its main action while reconciliation is loading or unavailable. Customer communication should wait until the duplicate decision is clear so the customer does not receive two parallel case updates.

## Monitoring and service levels

`admin_get_refund_reconciliation_health()` returns manager-scoped aggregate counts only:

- pending reviews;
- exact pending reviews;
- oldest pending timestamp;
- confirmed duplicates; and
- policy version.

Pilot operating target: review exact candidates before other work and resolve all candidates before the same business day's refund action window. A pending candidate older than four business hours is an operational warning; 24 hours is a pilot stop/escalation threshold.

## Synthetic UAT

Use synthetic customer data only.

1. Submit one website case and create one Gmail or SMS-form case with the same customer email, machine, amount, payment method, last four, wallet answer, and time within 15 minutes.
2. Confirm one `exact` review appears, both cases show the linked references, and official actions are disabled.
3. Keep the website case. Confirm the other case becomes a duplicate and cannot approve, execute, complete, or write settlement.
4. Change the decision to **different purchases**. Confirm the duplicate marker clears and both timelines contain redacted audit events.
5. Create a same-customer/same-machine case three hours later with the same amount but different last four. Confirm it is `possible`, not silently merged.
6. Create a different-customer or different-machine case. Confirm no review is created.
7. Repeat an identical delivery through each individual source. Confirm its existing source replay control reuses the original case.
8. Run `npm run refunds:validate-cross-channel-reconciliation` and `npm run db:validate-migrations`.

## Go / no-go

Go only when all of the following are true:

- the website, Gmail, and SMS Google Form synthetic journeys pass their own retry tests;
- exact and possible cross-source candidates appear in the manager portal;
- the manager can open both exact case links and record/reverse a decision;
- database tests prove pending/duplicate blocks for case, provider, and settlement paths;
- the queue source-awareness work in issue `#706` makes SMS Google Form drafts visible in the same manager queue; and
- the pilot owner has named who monitors the aggregate review backlog and the four-hour warning.

No-go if the reconciliation RPC is unavailable, a candidate can reach an official action, the queue hides an intake source, or synthetic replay creates multiple customer/provider actions.

## Recovery

- If matching is too broad, keep live provider execution disabled, resolve affected candidates as distinct, and adjust the versioned comparison policy in a forward migration.
- If matching is unavailable, the portal and database stay fail-closed for affected official actions. Intake records remain available for manual review.
- Never delete duplicate cases to clear the queue. Preserve the source record and manager audit trail.
