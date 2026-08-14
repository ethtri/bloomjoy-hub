# Owner-only Gmail intake-shadow ceremony

Checkpoint: 2026-08-14. This is a reviewed, default-off acceptance lane for one owner-controlled Gmail thread. It is not a schedule, production-label cutover, customer-send approval, legacy-responder replacement, provider action, or authorization to run the live ceremony without a separate owner go/no-go.

## Fixed safety contract

- Default-off means the static `REFUND_GMAIL_INTAKE_ENABLED` availability secret remains `false` **and no DB dispatch authorization is armed**. The static secret is not the live gate and is never changed during a live ceremony.
- The production Gmail label is never changed. A separate server-only shadow label is initialized once; its confirmed SHA-256 digest must differ from the production-label digest. Neither request nor CLI arguments can choose a label, sender, recipient, thread, body, schedule, or endpoint.
- The five-minute fresh query lookback is anchored at owner DB authorization and must contain exactly one matching thread. Because authorization can be consumed later within its ten-minute expiry, do not describe it as five minutes relative to processing time. The dedicated label may retain older content outside that window. Gmail is queried with `maxResults=2`; zero fresh matches, two or more fresh matches, or a continuation token fails before ingestion.
- The thread must contain exactly two ordered messages: one fresh direct-human owner inbound addressed only to the configured support mailbox, followed strictly later by one mailbox-origin Gmail `SENT` acknowledgement addressed only to that owner. One message is HOLD, not success.
- The authenticated owner's normalized Auth email, the DB authorization, and the sole inbound sender must share one SHA-256 digest. No raw sender, thread, message, case, label, JWT, token, address, subject, or body is printed.
- `REFUND_GMAIL_ENABLED=false`, retention false, first-contact mode disabled, the far-future start, cap one, and the zero owner/run sentinels remain unchanged throughout live execution. Schedules, customer contact, GPT, aging, official actions, and Nayax execution remain off.
- The lane copies two messages, creates one Gmail draft case, durably records one first-contact exclusion and one PII-free manager-action shadow event, and proves the authenticated owner can manage the case. It sends no Gmail, Resend, provider, refund, customer, manager, or operations message and performs no mark-read, archive, relabel, delete, or attachment operation.
- The mailbox-origin Gmail `SENT` record proves only that a mailbox acknowledgement was observed. It does not identify the human or legacy actor that sent it.

## Private environment packet

Use an absolute path to a gitignored file outside the repository. A relative/in-repository path, duplicate name, or unrecognized name fails before any client call. The file is the sole authority; ambient process values are ignored rather than merged. Do not pass targets or secrets as CLI arguments.

Populate only the fixed names in `.env.example`, including exact project double confirmation, `refund_gmail_retention_v1`, shadow-label digest double confirmation, owner-sender digest double confirmation, owner JWT, Supabase Management token, sync secret, anon key, and the fixed mode confirmations. The cleanup confirmation is exactly:

`ENABLE_REVIEWED_RETENTION_BEFORE_EARLIEST_VERIFY_AFTER_LATEST_OR_PURGE_AT_DUE`

The database atomically creates a PII-free cleanup task assigned to the Refund Operations owner for the exact run. The owner must either enable reviewed recurring retention before the earliest reported expiry and verify cleanup after the latest, or perform reviewed purge at or after each due time. A run before expiry alone does not delete content.

## One-time closed-state initialization and release rollover

Immediately after the reviewed function and migration deployment, privately create or identify the dedicated shadow label without moving a customer thread into it. Put its raw label ID only in `REFUND_GMAIL_INTAKE_SHADOW_INITIAL_LABEL_ID`, independently hash it, and double-confirm the digest. Then run exactly:

```text
npm run refunds:gmail-intake-shadow -- --mode initialize --env-file <private-absolute-outside-repo-path>
```

The fixed confirmation is `INITIALIZE_CLOSED_OWNER_GMAIL_INTAKE_SHADOW`. Initialization performs one owner Management API write and exact digest readback. It seeds only the static closed settings: intake/delivery/retention false, first contact disabled, far-future start, cap one, dedicated label, and zero owner/run sentinels. It cannot call Auth, DB, Edge, OAuth, or Gmail and never prints the label ID or a secret.

After any initialization write attempt, including a client timeout, the runner makes no blind retry, performs one fixed closed-state readback, and emits `metadataReconciliationRequired=true`. A timeout remains an unknown write outcome even if the readback proves the settings closed, because function versions may have advanced. If readback cannot prove the closed settings, output is fixed `closedStateVerified=false` with emergency independent closed-state verification required; keep all schedules off and do not run initialize, dry-run, or live again until the owner independently verifies the exact closed digests and completes metadata reconciliation.

Supabase secret writes advance function versions. Therefore initialization is incomplete until the exact production versions/bundle hashes/source hashes are captured, reviewed in a metadata-only PR, canonically anchored, and strict local plus read-only production `10/51` validation passes. **Do not run dry-run or live before that post-initialization canonical release exists.**

## Read-only preflight

From that exact reviewed canonical-main worktree:

```text
npm run refunds:validate-gmail-intake-shadow-runner
npm run refunds:gmail-intake-shadow -- --mode dry-run --env-file <private-absolute-outside-repo-path>
```

Require aggregate-only PASS for the exact project, canonical release, fresh completed backup, DB-owner session, distinct label digests, static closed secrets, schedules off, and **zero armed dispatch authorization**. Also require zero proof authorization, unresolved Gmail/first-contact delivery, official-action authorization/step-up intent, Nayax operator/resolution/unresolved attempt, or overdue intake cleanup; approved attachment-free copy health must be current. Historical terminal Nayax attempts may exist.

Dry-run performs no identity lookup, DB authorization, secret change, Edge POST, OAuth request, Gmail query, database write, case/event creation, or send.

## Separately authorized live ceremony

Only after private confirmation of the label, exact two-message shape, owner sender, cleanup obligation, and go/no-go:

```text
npm run refunds:gmail-intake-shadow -- --mode live --env-file <private-absolute-outside-repo-path>
```

The runner generates one run key in-process. The DB owner takes the fixed transaction-scoped global advisory lock, atomically proves there is no armed authorization and no consumed `intake_shadow` run still running, then arms one expiring authorization containing only its digest, the owner-sender digest, and fresh boundary. A partial unique index separately enforces at most one armed authorization. `service_start_refund_gmail_sync` must atomically lock and consume that authorization in the same transaction that inserts the exact truthful `intake_shadow` run; only then can OAuth/provider access occur. The runner performs one authenticated Edge POST with no retry.

In `finally`, the owner cancels any still-armed authorization using at most two fixed idempotent calls. Cancel first takes the same global lock as authorization and creates a durable cancelled tombstone even when the authorization row is not yet visible; a timed-out late authorization for that digest can never arm afterward. Cancel and service start lock the same exact row: a cancelled authorization with zero run proves `no_effect`, and a late gateway worker is rejected at the DB boundary. A consumed authorization must reconcile to one terminal exact run and two unchanged owner snapshots. A running run is bounded from its DB `started_at` by 420 seconds; expiry or unreadable/unstable state is `outcome_unknown`, never a replay signal.

Live execution performs **zero project-secret writes and therefore zero live version mutation**. Postflight must prove the authorization is cancelled with no run, or consumed with one terminal run, while the static secrets still match the reviewed canonical release.

## Evidence and incident handling

Output is aggregate-only and separately reports `effectsClassification` (`no_effect`, `complete_exact`, `partial_incident`, or `outcome_unknown`) and `gatesConclusivelyClosed`. Every classification has `replayAllowed=false`. `ok:true` is possible only for `complete_exact` with conclusive static-secret and DB-authorization closure.

Success requires one terminal run, one thread, two exact messages, one draft/customer-replied Gmail case, one exact run-bound first-contact operation/event, one PII-free action event/notice, one assigned cleanup obligation, one owner-manageable case, zero attachments, zero Hub outbound operation, zero case-delivery row of any status, zero sent/failed manager notice attempt, zero pending/sent/unknown first-contact delivery, zero new Nayax attempt, and zero unresolved delivery. Safe output includes only fixed route class, owner-manageable count, aggregate deltas, earliest/latest retention expiry, and the random PII-free cleanup task handle. It never emits the run, case, message, thread, sender, or dispatch digest.

`partial_incident` proves durable state; `outcome_unknown` means durable state and cleanup need are unknown and must be assumed possible until private reconciliation. When postflight found the exact obligation, both the classification record and final failure record include its PII-free `cleanupTaskHandle`; preserve it for the fixed cleanup command. Safe close is not rollback. Preserve redacted evidence, do not rerun, verify the expected private draft/action queue without exposing an ID, and complete every discovered cleanup obligation.

If authorization cancellation and readback cannot prove closure, output is `gateState:unknown`, `ok:false`, with emergency independent verification required. It never claims closure. Keep schedules off and do not rerun. The owner must use the reviewed fixed DB cancel/readback plus static-secret readback until authorization is conclusively cancelled/consumed and all static settings remain closed.

## Expired hard-stop recovery

If the runner process or host is lost after DB authorization and the private run key is unavailable, do not discover or enter a digest manually. Wait until the ten-minute authorization expiry, keep all schedules and static gates closed, then run:

```text
npm run refunds:gmail-intake-shadow -- --mode recover-expired --env-file <private-absolute-outside-repo-path>
```

The owner-only no-target function takes the same global advisory lock as authorization, records a durable recovery epoch, cancels only expired armed rows, and returns aggregate recovered/armed/consumed-running counts. An authorize request that had already begun waiting on the lock before that epoch is rejected after recovery; only a newly initiated reviewed ceremony can arm later. The function performs no secret, Auth, Edge, OAuth, Gmail, case, event, provider, or send action and emits no digest. Success requires zero armed authorization and zero consumed run still running. An unexpired arm or consumed-running run remains HOLD; never replay.

## Retention cleanup discharge

Privately save the live result's PII-free `cleanupTaskHandle` in `REFUND_GMAIL_INTAKE_SHADOW_CLEANUP_TASK_HANDLE`. At or after the latest due time, after the reviewed retention worker or manual purge has removed both exact messages' retained content, run:

```text
npm run refunds:gmail-intake-shadow -- --mode cleanup-verify --env-file <private-absolute-outside-repo-path>
```

The owner-only completion function takes the same global dispatch lock used by authorization, rejects any armed authorization or consumed-running intake, and then targets only the exact cleanup task handle. It proves both messages have the canonical deleted content, identifiers, sender name, provider/reference headers, CC addresses/count, and linked thread subject before atomically completing the run-bound task. It returns exact-task status plus aggregate overdue and all-assigned outstanding counts. A missing/wrong handle, an assigned current task, or any other assigned task (including one not yet due) fails closed. An exact already-completed handle may idempotently re-prove completion only when `assignedOutstanding=0`, so it cannot hide newer work. Remove the private packet and revoke temporary owner credentials using the established owner procedure only after that proof.
