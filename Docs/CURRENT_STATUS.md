# Current Status

Last compacted: 2026-09-28.

GitHub Issues and the Bloomjoy Project board own active priority, status,
blockers, acceptance criteria, and closeout evidence. This file is only a short
orientation snapshot; it is not a backlog or release ledger.

## Refund workflow (current)

- The cross-case Nayax card blocker is removed: another refund case's
  reference to the same purchase is audit context rather than a payment veto.
  Nayax owns the original-purchase total limit; same-case replay protection,
  exact purchase binding, unknown-result holds, and receipts remain.
- A fresh read-only provider result exposed a broad, ambiguous wallet candidate
  set with no independently corroborated purchase. The current
  reviewed-set proof would otherwise route it to a Manager before internal
  research. Issue #1359 tracks the backend readiness guard and case recovery;
  a completed lookup alone is not authority to choose a purchase or pay.
- On 2026-09-26 the deployed reply worker applied a verified customer time and
  settled its task, but the production portal still projected
  both a stale reply-review step and a contradictory customer-wait warning.
  The next safe step is the existing scheduled read-only purchase recheck;
  issue #1361 tracks the owner/state correction and live case readback.
- On 2026-09-26 the authenticated refund list loaded again, but five case
  workflow details were still unavailable. Three traced to a stale Nayax lookup
  projection: two searches need internal machine/duplicate-scope repair before
  any provider read, and one case has confirmed payment that must not reopen
  transaction search. Track the other two fallbacks separately under #628;
  a loading list alone is not completion of the final-decision workflow.
- The September 28 production timeout is recovered. The read-only admin overview
  has a bounded 20-second function budget, and fresh authenticated production
  checks returned all 71 operational cases plus 11 internal/test cases in
  9.13-9.70 seconds. The Refunds page rendered 58 active and 13 closed cases
  without console errors. The long wrapper chain remains performance debt; this
  recovery does not widen any payment, refund, or customer-message timeout.
- Production recovery on 2026-09-19 restored the System card-attempt queue for
  the TGPaci enterprise account. Approval and processing now use the same queue
  readiness contract, and deterministic completion delivery claims the database
  identity before it adds a customer status link. Customer intake visibility
  follows the reviewed refund inventory product category independently of the
  reporting-machine family used by other operations such as Timekeeping.
- Issue [#1364](https://github.com/ethtri/bloomjoy-hub/issues/1364) completed the
  refund-context reset, and PR
  [#1348](https://github.com/ethtri/bloomjoy-hub/pull/1348) merged the one-decision
  card workflow on 2026-09-14. Neither is an open rollout program.
- [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) is the durable product source of truth:
  the System investigates and saves the exact evidence for a routine clear match.
  A case worker chooses only when the result is genuinely ambiguous. The Manager
  then makes one decision; card approval uses the selected Nayax transaction, and
  cash confirmation means Zelle was already sent. The triage actor may differ
  from the assigned Machine Manager or Super-admin who approves.
- A routine clear match is saved by the System. Ambiguous results stay available
  for a case worker to choose and save before approval.
- Read-only transaction recovery and exact payment-result review are ordinary
  in-scope case work. An in-scope case worker, including a Scoped Admin, may
  record exact Nayax evidence for the existing System-owned attempt; this never
  creates another approval. The legacy `refundOperationsAccess` flag is only for
  the internal/test archive and cannot block ordinary case work.
- One assigned Machine Manager or Super-admin click atomically consumes one card
  approval and queues one System-owned attempt. The System executes and settles
  it. An unknown outcome holds that same attempt for verification. Exact later
  proof that no refund occurred lets the System continue the same attempt under
  the original approval; a rejected label alone does not. There is no blind
  retry, browser continuation, manual card completion, or second approval.
- Matching should resolve at least 95% of ordinary valid cases without customer
  clarification. Timezones, approximate amounts, and contactless number
  provenance are System responsibilities, not reasons for customer rework. A
  reported $10.00 purchase may correctly match and refund the selected $10.90
  provider total when the remaining evidence identifies that purchase.
- P0 issue [#1360](https://github.com/ethtri/bloomjoy-hub/issues/1360) adds an
  explicit customer/venue/provider timestamp contract and keeps ambiguous or
  noncomparable same-card candidates available for manager selection. The code
  and migration are not production behavior until their PR is merged and the
  normal release verification is complete.
- Nayax may be used for read-only transaction research when the API cannot find a
  match. Never issue or record a refund there. Cash remains a Manager-arranged
  manual payment outside the card attempt queue.
- The retired refund TOTP and step-up endpoints remain inert `410 Gone`
  compatibility tombstones for one release. Their historical names do not add a
  Manager step or authorize agents to restore that workflow.
- Open implementation work remains on the issue board. Documentation does not
  certify that every runtime path already follows the workflow.
- The consolidated migration still contains four guarded text-replacement blocks
  tracked by issue #1345; that technical debt does not add workflow authority.
- Issue [#1366](https://github.com/ethtri/bloomjoy-hub/issues/1366) is a P1 sweep
  of active agent context and the assistant-manager procedure. It is not a new
  payment safeguard or P0 launch gate.

## Current platform notes

- Bloomjoy Hub remains a Vite, React, TypeScript, Tailwind, shadcn/ui application
  backed by Supabase.
- Nayax scheduled transaction reports now stage exact settled card sales for
  active, published Sunze mappings. All 16 current exact mappings have a
  prospective machine-local authority date: older Sunze card history remains in
  place, while Nayax supplies card money and Sunze supplies cash on and after the
  boundary. One daily fact combines the Nayax amount with paid Sunze order/item/tax
  metrics while zero-value operational rows stay separate, and original values
  remain reversible. Publishing a future exact active mapping defaults the same
  boundary to the next local day; withdrawing the mapping restores Sunze, and an
  explicit boundary clear remains the rollback. Thirteen other active Sunze
  machines still lack an exact published Nayax mapping, including ten with recent
  Sunze card sales, so they remain on Sunze until their provider identities are
  mapped rather than guessed.
- Sunze cash-sale evidence now has a private, server-owned timestamp, freshness,
  coverage, and five-state match contract. Timezone-less `Payment time` values
  remain an explicitly unvalidated compatibility assumption and cannot prove a
  missing sale. Match confidence and coverage state explain the evidence; they
  do not decide whether a Manager may complete a reviewed cash refund. When an
  exact sale is selected, it cannot support a second non-duplicate completion.
- The production Nayax request and approval contract is proved with the current
  credentials. Use
  [NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md) for exact
  API fields and response handling.
- Timekeeping, Technician Pay Reports, Pay Stubs, partner reporting, access
  management, training, commerce, and machine administration remain active
  product areas. Their current work belongs on the board, not in this snapshot.
- Issue #1480 keeps normal open-month SnapCase sales and commission estimates
  visible without a SnapCase-specific warning. Closed positive-commission dates
  block only when their mapped machine lacks a completed payment import and
  successful cash publication. Production behavior still requires the related
  migrations to merge and deploy.
- Issue #1569 tracks six exact SnapCase source identities that currently point
  at duplicate Hub machines instead of their existing Nayax-linked records. Its
  repair must pass the private bounded dry run after release before any mapping
  changes. Assignments, compensation, tax rules, access grants, and completed-import
  business evidence remain intact. The established mapping trigger may regenerate
  completion-receipt UUIDs and timestamps while revalidating that evidence.
- Issue #1478 now has a source-connected projection contract for Kexiaozhan cash only;
  existing Nayax scheduled facts remain the sole card authority and existing
  sales adjustments remain the sole refund deduction. Gross cash amount and
  half-open payment query bounds are supported, and the owner confirmed provider
  timestamps use each machine's IANA timezone. Complete acknowledged per-machine
  payment windows, including zero rows, bind normalized cash publication before
  they can release the matching closed payroll dates.
  Unknown item quantity uses a marked zero storage fallback without hiding gross
  cash, and later unproved source revisions preserve known gross as review work.
- Refund automation authenticates through the Info Gmail account and sends as
  `refunds@bloomjoysweets.com`. P0 #1455's deployed Info filter and classifier
  passed a controlled non-manager real-mailbox journey: the form link was sent
  once in the original thread, no case was created from email, and five later
  scheduled syncs recorded no duplicate reply or failure. A full Info To/Cc
  backlog pass, including read, archived, and spam mail, found no unanswered new
  refund inquiry; the hourly manual fallback is paused. Two older refund-status
  conversations remain separate follow-up work, not new form-link candidates.
- The merged refund workflow-health migrations are live. Two paid cases retain
  unresolved customer-status obligations because their historical completion
  copies cannot be bound to a reversible provider or Gmail identifier. The
  refunds and receipts are complete; delivery remains unknown, and another
  payment or replacement message is not authorized. The final historical
  no-safe-match message asked for zero fields and the current case also has no
  customer-correctable field, so health classifies that clarification as
  resolved obsolete while preserving its unknown-delivery audit evidence.
- The natural daily Manager digest passed on both September 27 and 28. Recent
  scheduler runs are healthy and suppress ineligible duplicate work, but a
  no-op run is not evidence that a case progressed; real action outcomes remain
  separately visible in the action ledger.
- Historical no-safe-match follow-up cycles that stopped before creating any
  customer question project as internal purchase research only when current
  facts still have no correctable field and no cycle-bound message exists.
  Their historical failure evidence remains unchanged; the task no longer
  suggests recovering delivery of a nonexistent question.
- Technician wall-clock entries are interpreted in the selected machine
  location's IANA timezone. This keeps completed Eastern and Central work from
  being rejected as future merely because Bloomjoy's month-close policy and
  headquarters clock are Pacific; the month-close cutoff itself remains Pacific.
- Technician contact records now keep operational email, phone, and mailing-address
  details in a separate directory limited to the technician and pay-authorized
  managers. Machine-only managers cannot read them, and audit records store only
  redacted presence flags. Machine records have
  a separate operational phase, so a Setup-phase provisional machine remains
  assignable for Timekeeping without being represented as live or given invented
  provider identifiers.

## Durable references

- Product and design: `PRODUCT.md`, `DESIGN.md`
- Durable decisions: `Docs/DECISIONS.md`
- Refund product workflow: `Docs/REFUND_WORKFLOW.md`
- Live refund case procedure: `Docs/REFUND_AGENT_OPERATIONS.md`
- Nayax API execution contract: `Docs/NAYAX_REFUND_WORKING_CONTRACT.md`
- Local setup and agent preflight: `Docs/LOCAL_DEV.md`
- Production operations: `Docs/PRODUCTION_RUNBOOK.md`
- Reusable smoke coverage: `Docs/QA_SMOKE_TEST_CHECKLIST.md`

## Safety

Never paste secrets, raw customer data, payment identifiers, vendor exports, or
free-text complaint content into documentation, issues, pull requests, or chat.
