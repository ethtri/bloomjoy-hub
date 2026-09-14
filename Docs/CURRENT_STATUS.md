# Current Status

Last compacted: 2026-09-13.

GitHub Issues and the Bloomjoy Project board own active priority, status,
blockers, acceptance criteria, and closeout evidence. This file is only a short
orientation snapshot; it is not a backlog or release ledger.

## P0 refund context reset

- Issue [#1364](https://github.com/ethtri/bloomjoy-hub/issues/1364) is replacing
  the accumulated refund policy and runbook drift with one customer-first model.
- [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) is the durable product source of truth:
  the System investigates, the Manager makes one decision, card approval uses the
  selected Nayax transaction, and cash confirmation means Zelle was already sent.
- Matching should resolve at least 95% of ordinary valid cases without customer
  clarification. Timezones, approximate amounts, and contactless number
  provenance are System responsibilities, not reasons for customer rework.
- Open implementation work remains on the issue board. Documentation does not
  certify that every runtime path already follows the workflow.

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
