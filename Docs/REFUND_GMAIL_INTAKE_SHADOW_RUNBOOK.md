# Owner-only Gmail intake-shadow ceremony

Checkpoint: 2026-08-14. This is a reviewed, default-off acceptance lane for one owner-controlled Gmail thread. It is not a schedule, production-label cutover, customer-send approval, legacy-responder replacement, provider action, or permission to run the live ceremony without a separate owner go/no-go.

## Fixed safety contract

- The production Gmail label is never changed. The ceremony uses a separate server-only shadow label whose confirmed SHA-256 digest must differ from the production-label digest.
- The five-minute fresh query window must contain exactly one matching thread. The dedicated label may retain older content outside that fixed window. Gmail is queried with `maxResults=2`; zero fresh matches, two fresh matches, or a continuation token fails before ingestion.
- The thread must contain exactly two ordered messages: one fresh direct-human owner inbound addressed only to the configured support mailbox, followed strictly later by one mailbox-origin Gmail `SENT` acknowledgement addressed only to that owner. One message is HOLD, not success.
- The authenticated owner's normalized Auth email must hash to the same owner-sender digest. No raw sender, thread, message, case, label, JWT, token, address, subject, or body is printed.
- `REFUND_GMAIL_ENABLED=false` remains the delivery boundary. Intake temporarily sets only `REFUND_GMAIL_INTAKE_ENABLED=true`, first-contact mode `shadow`, the fresh boundary, cap `1`, and the two run-bound digests. Retention, schedules, customer contact, GPT, aging, official actions, and Nayax execution remain off.
- The lane copies the two messages, creates one Gmail draft case, durably records one first-contact exclusion and one PII-free manager-action shadow event, and proves the authenticated owner can manage the case. It sends no Gmail, Resend, provider, refund, customer, manager, or operations message and performs no mark-read, archive, relabel, delete, or attachment operation.
- The mailbox-origin Gmail `SENT` record proves only that a mailbox acknowledgement was observed. It does not identify the human or legacy actor that sent it.

## Private environment packet

Use an absolute path to a gitignored file outside the repository. Relative and in-repository paths fail before any client call. Do not pass targets or secrets as CLI arguments. Populate only the fixed names documented in `.env.example`, including exact project double confirmation, `refund_gmail_retention_v1`, shadow-label digest double confirmation, owner-sender digest double confirmation, owner JWT, Supabase management token, sync secret, anon key, and the fixed live/cleanup confirmations.

The cleanup confirmation is exactly:

`ENABLE_REVIEWED_RETENTION_BEFORE_EARLIEST_VERIFY_AFTER_LATEST_OR_PURGE_AT_DUE`

The typed confirmation acknowledges the obligation; the database atomically records the durable PII-free assignment against the exact run. The assigned Refund Operations owner must either enable the reviewed recurring retention worker before the earliest reported expiry and verify cleanup after the latest reported expiry, or perform the reviewed manual purge at or after each due time. A run before an expiry alone does not delete content.

## One-time closed-state initialization

After the reviewed function and migration are deployed but before any dry-run, privately create or identify the dedicated shadow label without moving a customer thread into it. Place its raw label ID only in `REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID`, independently hash it, and double-confirm that digest through the two label-digest fields. Then run exactly:

```text
npm run refunds:gmail-intake-shadow -- --mode initialize --env-file <private-absolute-outside-repo-path>
```

The fixed initialization confirmation is `INITIALIZE_CLOSED_OWNER_GMAIL_INTAKE_SHADOW`. Initialization performs one owner Management API write and an exact digest readback. It seeds only intake/delivery/retention false, first contact disabled, the far-future start, cap one, the dedicated label, and zero owner/run sentinels. It cannot call Auth, the database, Edge, OAuth, or Gmail, and it never prints the label ID or a secret. A failed write/readback is HOLD; do not continue to dry-run.

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

The runner generates the run key in-process, arms only its SHA-256 digest, performs one authenticated `intake_shadow` POST with no retry, and immediately enters fail-closed teardown. `finally` closes intake, delivery, and retention; disables first contact; resets the start to the fixed far-future boundary; resets both authorization digests to the zero sentinel; and rereads state. If the first close or state read is ambiguous, exactly one reviewed idempotent close recovery is allowed.

Client timeout does not cancel an already-running Edge worker. With gates held closed, the runner therefore reconciles the exact run key until a terminal `finished_at` and two unchanged owner snapshots are observed. The fixed 420-second dispatch-to-quiescence bound exceeds the hosted 400-second Edge worker wall-clock limit; a missing run may be `no_effect` only after that bound. A running, late, unstable, or unreadable result at the bound is `outcome_unknown`, never a replay signal.

## Evidence and incident handling

Output is aggregate-only and separately reports `effectsClassification` (`no_effect`, `complete_exact`, `partial_incident`, or `outcome_unknown`) and `gatesConclusivelyClosed`. Every classification has `replayAllowed=false`. Never replay or manually reconstruct the Edge POST. `ok:true` is possible only when effects are `complete_exact` and the final gate read proves closed.

Success requires exactly one terminal run, one thread, two exact thread messages (one customer inbound plus one mailbox-origin `SENT` acknowledgement), one new Gmail case in `draft/customer_replied`, one exact run-bound first-contact operation/event, one exact run-bound PII-free manager-action shadow event and notice row, one assigned cleanup-obligation row, one owner-manageable case, zero attachments, zero Hub outbound operation, zero case-delivery row of any status, zero sent or failed manager/ops notice attempt, zero pending/sent/unknown first-contact delivery, zero new Nayax attempt, and zero unresolved delivery. The safe output includes only the fixed route class, owner-manageable count, aggregate deltas, and earliest/latest retention expiry.

`partial_incident` or `outcome_unknown` is an incident even if every gate is conclusively closed. Copied messages, the case, exclusions, events, and cleanup obligation are durable; safe-close is not rollback. Preserve the redacted output, perform private owner reconciliation, verify the case in the expected draft/action queue without exposing its identifier, complete the retention obligation, and do not rerun.

If both bounded close/readback attempts fail, the runner emits `gateState:unknown`, `ok:false`, and requires an emergency independent gate verification. It does not claim closure. Keep every schedule off, do not rerun, and have the owner use the reviewed fixed readback/close procedure until intake, delivery, and retention are conclusively false, first contact is disabled, the start is far-future, and both authorization digests are zero.

After any terminal result, independently reread the final Edge/GitHub/database gates and schedules. Require intake/delivery/retention false, first contact disabled, far-future start, cap one, zero armed owner/run digests, zero unresolved outbound, and no new provider/refund/official-action attempt. Remove the private env file and revoke the temporary owner JWT/token through the established owner procedure.
