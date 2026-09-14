# Current Status

Last compacted: 2026-09-14.

GitHub Issues and the Bloomjoy Project board own active priority, status,
blockers, acceptance criteria, and closeout evidence. This file is only a short
orientation snapshot; it is not a backlog or release ledger.

## P0 refund context reset

- Issue [#1364](https://github.com/ethtri/bloomjoy-hub/issues/1364) is replacing
  the accumulated refund policy and runbook drift with one customer-first model.
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
- Nayax may be used for read-only transaction research when the API cannot find a
  match. Never issue or record a refund there. Cash remains a Manager-arranged
  manual payment outside the card attempt queue.
- Open implementation work remains on the issue board. Documentation does not
  certify that every runtime path already follows the workflow.
- The consolidated migration still contains four guarded text-replacement blocks
  tracked by issue #1345; that technical debt does not add workflow authority.

## Current platform notes

- Bloomjoy Hub remains a Vite, React, TypeScript, Tailwind, shadcn/ui application
  backed by Supabase.
- The production Nayax request and approval contract is proved with the current
  credentials. Use
  [NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md) for exact
  API fields and response handling.
- Timekeeping, Technician Pay Reports, Pay Stubs, partner reporting, access
  management, training, commerce, and machine administration remain active
  product areas. Their current work belongs on the board, not in this snapshot.

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
