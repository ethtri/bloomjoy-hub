# Current Status

Last compacted: 2026-09-19.

GitHub Issues and the Bloomjoy Project board own active priority, status,
blockers, acceptance criteria, and closeout evidence. This file is only a short
orientation snapshot; it is not a backlog or release ledger.

## Refund workflow (current)

- On 2026-09-26 the authenticated refund list loaded again, but five case
  workflow details were still unavailable. Three traced to a stale Nayax lookup
  projection: two searches need internal machine/duplicate-scope repair before
  any provider read, and one case has confirmed payment that must not reopen
  transaction search. Track the other two fallbacks separately under #628;
  a loading list alone is not completion of the final-decision workflow.
- On 2026-09-25 the authenticated production refund Case list began timing out
  before it could load. P0 issue [#1453](https://github.com/ethtri/bloomjoy-hub/issues/1453)
  tracks the database performance repair and authorized post-release readback;
  a merged migration alone does not establish recovery.
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
- Refund automation authenticates through the Info Gmail account and sends as
  `refunds@bloomjoysweets.com`. P0 #1455 is correcting the deployed filter
  that skipped new Info-only refund inquiries; the three identified customers
  have already received individual form links. Production Info-mailbox journey
  proof and backlog reconciliation remain release checks.
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
