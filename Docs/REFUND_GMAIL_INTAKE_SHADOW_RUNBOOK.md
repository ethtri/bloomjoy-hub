# Owner-only Gmail intake-shadow ceremony

Checkpoint: 2026-08-14. This is a reviewed, default-off acceptance lane for one owner-controlled Gmail thread. It is not a schedule, production-label cutover, customer-send approval, legacy-responder replacement, provider action, or permission to run the live ceremony without a separate owner go/no-go.

## Fixed safety contract

- The production Gmail label is never changed. The ceremony uses a separate server-only shadow label whose confirmed SHA-256 digest must differ from the production-label digest.
- The label must contain exactly one thread. Gmail is queried with `maxResults=2`; zero threads, two threads, or a continuation token fails before ingestion.
- The thread must contain exactly two ordered messages: one fresh direct-human owner inbound addressed only to the configured support mailbox, followed strictly later by one mailbox-origin Gmail `SENT` acknowledgement addressed only to that owner. One message is HOLD, not success.
- The authenticated owner's normalized Auth email must hash to the same owner-sender digest. No raw sender, thread, message, case, label, JWT, token, address, subject, or body is printed.
- `REFUND_GMAIL_ENABLED=false` remains the delivery boundary. Intake temporarily sets only `REFUND_GMAIL_INTAKE_ENABLED=true`, first-contact mode `shadow`, the fresh boundary, cap `1`, and the two run-bound digests. Retention, schedules, customer contact, GPT, aging, official actions, and Nayax execution remain off.
- The lane copies the two messages, creates one Gmail draft case, durably records one first-contact exclusion and one PII-free manager-action shadow event, and proves the authenticated owner can manage the case. It sends no Gmail, Resend, provider, refund, customer, manager, or operations message and performs no mark-read, archive, relabel, delete, or attachment operation.
- The mailbox-origin Gmail `SENT` record proves only that a mailbox acknowledgement was observed. It does not identify the human or legacy actor that sent it.

## Private environment packet

Use a gitignored file outside the repository. Do not pass targets or secrets as CLI arguments. Populate only the fixed names documented in `.env.example`, including exact project double confirmation, `refund_gmail_retention_v1`, shadow-label digest double confirmation, owner-sender digest double confirmation, owner JWT, Supabase management token, sync secret, anon key, and the fixed live/cleanup confirmations.

The cleanup confirmation is exactly:

`ENABLE_REVIEWED_RETENTION_BEFORE_EARLIEST_VERIFY_AFTER_LATEST_OR_PURGE_AT_DUE`

It assigns a durable owner obligation: either enable the reviewed recurring retention worker before the earliest reported expiry and verify cleanup after the latest reported expiry, or perform the reviewed manual purge at or after each due time. A run before an expiry alone does not delete content.

## Read-only preflight

From the exact reviewed canonical-main worktree:

```text
npm run refunds:validate-gmail-intake-shadow-runner
npm run refunds:gmail-intake-shadow -- --mode dry-run --env-file <private-absolute-path>
```

Require aggregate-only PASS for the exact production project, current canonical release and fresh completed backup, database/session owner, distinct label digests, closed intake/delivery/retention gates, future-safe start boundary, zero armed owner/run digests, schedules off, zero proof authorization, zero unresolved Gmail/first-contact delivery, official actions off, no active official authorization or step-up intent, Nayax resolution/execution/operator/unresolved attempt state off, and healthy approved attachment-free copy policy. Historical terminal Nayax attempts may exist; unresolved/active attempts may not.

Dry-run performs no identity lookup, secret change, Edge POST, OAuth request, Gmail query, database write, case creation, event creation, or send.

## Separately authorized live ceremony

Only after the owner has privately confirmed the exact shadow label, the exact two-message shape, the owner-controlled sender, the fixed cleanup obligation, and the go/no-go:

```text
npm run refunds:gmail-intake-shadow -- --mode live --env-file <private-absolute-path>
```

The runner generates the run key in-process, arms only its SHA-256 digest, performs one authenticated `intake_shadow` POST with no retry, and immediately enters fail-closed teardown. `finally` closes intake, delivery, and retention; disables first contact; resets the start to the fixed far-future boundary; resets both authorization digests to the zero sentinel; and rereads state. If the first close or state read is ambiguous, exactly one reviewed idempotent close recovery is allowed. It never exits with unknown gate state.

## Evidence and incident handling

Output is aggregate-only and classifies the exact run as `no_effect`, `complete_exact`, `partial_incident`, or `outcome_unknown`. Every classification has `replayAllowed=false`. Never replay or manually reconstruct the Edge POST.

Success requires exactly one run, one thread, two exact thread messages (one customer inbound plus one mailbox-origin `SENT` acknowledgement), one new Gmail case in `draft/customer_replied`, one first-contact shadow exclusion, one PII-free manager-action shadow event and ledger row, one owner-manageable case, zero attachments, zero Hub outbound operation, zero case-delivery row of any status, zero sent or failed manager/ops notice attempt, zero pending/sent/unknown first-contact delivery, zero new Nayax attempt, and zero unresolved delivery. The safe output includes only the fixed route class, owner-manageable count, aggregate deltas, and earliest/latest retention expiry.

`partial_incident` or `outcome_unknown` is an incident even if every gate is conclusively closed. Copied messages, the case, exclusions, and events are durable; safe-close is not rollback. Preserve the redacted output, perform private owner reconciliation, verify the case in the expected draft/action queue without exposing its identifier, complete the retention obligation, and do not rerun.

After any terminal result, independently reread the final Edge/GitHub/database gates and schedules. Require intake/delivery/retention false, first contact disabled, far-future start, cap one, zero armed owner/run digests, zero unresolved outbound, and no new provider/refund/official-action attempt. Remove the private env file and revoke the temporary owner JWT/token through the established owner procedure.
