# Controlled owner Nayax provider pilot

> **Retired historical record only.** The 2026-08-30 production policy in `Docs/REFUND_PRODUCTION_POLICY.md` fully retires this owner-self pilot, its runner, amount caps, canary/case allowlist, account-wide circuit breaker, private ceremony, and separate go/no-go steps. Do not run its commands or use any requirement below to delay a customer refund. Only its audit history remains; current transaction-scoped controls are defined in the production policy.

Status: retired historical implementation for issue `#430`; not authority to initialize, arm, call Nayax, change production, or diagnose current account permissions. The migration/function counts and activation prerequisites below describe that older release only.

This was a **provider-only owner smoke**, not “refund and notify.” At that time, the checked-in runner was the only execution surface and never sent Gmail, created a customer delivery, enabled the global official-action gate, enabled broad Nayax execution, or activated a schedule. The normal production manager path now follows `Docs/PRODUCTION_RUNBOOK.md`; do not infer its current availability, identity, roles, or token scope from this retired runner.

## Fixed safety contract

- One current owner-mapped, owner-self-owned, high-confidence card case; one exact disabled machine; one exact amount. The database requires the normalized authenticated-owner email digest to equal the case-customer email digest, recomputes the private case/card-last4/amount attestation, and binds the machine's configured Nayax account key to the dedicated secret suffix before arming.
- One fresh owner-private TOTP atomically transitions the case to `card_refund_pending`, consumes the official-action receipt, and reserves the sole provider attempt. There is no gap between approval and reservation.
- One refund-request POST and at most one refund-approve POST. There is no retry. Duplicate, already-refunded, pending, timeout, malformed, network, and unknown outcomes stop on provider hold.
- The immutable redacted journal records `request_started`, `request_result`, `approve_started`, and `approve_result` in that order. It stores only fixed outcome/status classes, a contract-match boolean, and a classification digest; unmatched provider `Result`/`Status` text is never persisted. It never stores request bodies, card/customer data, credentials, or the original transaction identifier as a provider receipt.
- Confirmed success stores only a redacted evidence digest. A definite configured rejection is terminal but cannot be replayed. Any uncertain outcome requires Dynamic Transactions Monitor evidence and the separately authorized structured resolver; never resend the provider request.
- Hub Gmail/customer delivery remains disabled and the runner proves only a zero Hub-delivery delta. Nayax-originated email is a separate provider behavior: the exact written contract must either prove suppression or record the self-owner's explicit expectation and consent before initialization or live use. For `owner_consented_expected`, the owner-private packet must also contain the exact dedicated provider-email confirmation; the generic transaction confirmation is insufficient. The safe behavior enum is printed in live success or failure output.
- Every consumed attempt carries a durable worker lease. Each external stage is journaled and renews the lease immediately before transport; settlement supplies the same lease identity and records a terminal acknowledgement. Exact close, no-target recovery, and credential retirement cannot report closed while the lease is active. After an expired lost worker, no-ID recovery records an unknown provider hold, disables the exact machine/cap, revokes the executor, and permits no replay.
- Initialization may install only the temporary runner assertion, exact written contract, dedicated request/approve write credentials, executor assertion, and exact one-transaction caps. It must preserve the existing production idempotency secret.
- Terminal settlement and safe close disable the exact machine, clear its pilot cap, and revoke the exact executor row. Post-pilot retirement deletes the temporary runner/contract/request/approve/executor secrets, restores the canonical `1000/5000/10` safe caps, and requires another metadata reconciliation.
- Financial-audit retention is unresolved. `refund_operations_owner` owns a blocking follow-up under legal/incident hold; there is no automatic purge. The migration contains a hard-false live authorization boundary until a separate reviewed record approves a duration and a verified purge/discharge procedure. This implementation, deployment, or initialization must not be described as resolving retention.

## Owner-private ceremony

An agent or shared screen stops before the live command. The owner runs this privately. Never put the env packet, TOTP, case UUID, email, machine identity, amount, token, transaction data, or digests in chat, an issue, a PR, screenshots, or captured logs.

Use one allowlisted env file at an absolute path outside the repository. The runner resolves real paths, rejects repository-contained files and unsupported names, and ignores ambient values. A TOTP is never stored in the packet. Dry-run does not accept or request one. Live completes every release/backup/gate/Auth/DB check, arms the exact two-minute authorization, emits only `ready_for_private_totp`, then prompts once through a no-echo interactive TTY for a fresh six-digit code. Redirected/non-TTY input fails closed and closes the authorization with zero provider calls.

The sequence is deliberately separated by review and metadata checkpoints:

1. Deploy the default-off migration/functions only after the normal migration-52 release review. Prove migration 52 creates no authorization, attempt, journal, enabled machine, active executor, or provider call.
2. Run `initialize` once, owner-private. Before its one Management write, the runner proves strict release alignment, a fresh backup, all relevant GitHub schedules and Edge/DB gates off, zero active/unresolved official/Nayax/Gmail work, no enabled machine/cap/executor, the temporary pilot secrets absent, and the pre-existing idempotency digest unchanged. Its output always requires metadata reconciliation. Do not continue until the post-initialization metadata PR and canonical anchor merge.
3. Run `dry-run`. It performs only fixed read-only release/backup/secret/Auth/DB-owner checks. It creates no authorization, asks for no TOTP, and makes no provider request.
4. Immediately before `live`, re-prove the same release, backup, schedules, gates, zero unresolved work, exact owner identity, self-case/card/amount attestation, exact case/machine/account digests, exact amount, the schema-v2 contract, sponsor/DTM proof digests, and machine/cap count. The schema-v2 contract controls the actual `RefundEmailList` request shape and rejects the former unwired provider-email assertion. Live remains hard-blocked while audit retention is unresolved. After that separate approval, the live runner may create one authorization, send one Edge POST with no retry, close the lane, and poll only the exact durable attempt state.
5. If the host dies after authorization but before TOTP, run `recover` from an owner-private Management packet. It needs no case or authorization ID, cancels only an expired armed pilot, cancels its TOTP intent, disables the exact machine/cap, revokes its executor, writes a permanent one-lifetime closure, and returns counts only. If atomic reservation already committed, recovery refuses while the worker lease is active; after lease expiry it records an unknown provider hold and closes the provider surfaces without replay. That consumed recovery exits non-success with `consumedAttemptCount=1`, `providerCallCountStatus=unknown`, `providerHold=true`, and `manualReconciliationRequired=true`; it never prints a numeric zero provider-call count. A pre-provider cancellation is not evidence that a post-reservation provider call did not occur.
6. Preserve the final aggregate and any DTM/structured-resolution evidence. No blind replay is permitted for success, rejection, no effect, ambiguity, interruption, or unknown state.
7. Run `retire` after the exact lane is closed and no worker lease or unresolved attempt remains. If no authorization was ever created, retirement first writes the no-target permanent closure. It refuses an armed, active-worker, or unsettled consumed lane; removes the temporary credentials; restores canonical safe caps; requires vendor/owner write-role revocation or downgrade with readback; and requires post-retirement metadata reconciliation.
8. Delete every local private packet from its owner-only ACL-protected location. Revoke the short-lived Supabase Management token, allow the owner JWT to expire or revoke it when supported, and revoke/downgrade the vendor request/approval roles with private readback. Do not preserve credentials in shell history, captured output, chat, tickets, screenshots, or repository files.

Checked-in commands:

```powershell
npm run refunds:nayax-controlled-owner-pilot -- --mode initialize --env-file C:\private\nayax-pilot.env
npm run refunds:nayax-controlled-owner-pilot -- --mode dry-run --env-file C:\private\nayax-pilot.env
# Owner-private only; stop agents/shared screen before this line.
npm run refunds:nayax-controlled-owner-pilot -- --mode live --env-file C:\private\nayax-pilot.env
npm run refunds:nayax-controlled-owner-pilot -- --mode recover --env-file C:\private\nayax-pilot-recovery.env
npm run refunds:nayax-controlled-owner-pilot -- --mode retire --env-file C:\private\nayax-pilot-retire.env
```

These are ceremony shapes, not authorization to execute them. Each phase needs its own explicit owner/reviewer go/no-go and current private packet.

## Aggregate-only evidence and stop conditions

Allowed output is limited to fixed phases, booleans, counts/deltas, `noReplay`, `providerHold`, `manualReconciliationRequired`, `effectsClassification`, gate closure, and metadata-reconciliation requirements. It must not include identifiers or provider bodies.

Stop and preserve evidence when any check is unreadable, audit retention remains unapproved, any gate/schedule is on, a backup or release is stale, a second case/machine/attempt appears, the machine or executor remains active after close, a worker lease remains active or lacks a terminal acknowledgement, customer/Gmail deltas change, provider-email behavior is unproved/unaccepted, the Edge response is ambiguous, the stage order differs, a response does not match the written contract, or final closure cannot be proved. A close failure and provider-effects classification are independent: always record both, never infer one from the other.
