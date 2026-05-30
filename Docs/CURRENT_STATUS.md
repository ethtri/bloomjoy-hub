# Current Status

Last compacted: 2026-05-29

GitHub Issues and the Bloomjoy Project board are the operational source of truth for active work, priority, blockers, acceptance criteria, and closeout evidence.

## Snapshot

- Bloomjoy Hub is past MVP and is being operated through focused PRs into `main`.
- Static docs are now durable references and compact snapshots, not the active task ledger.
- Workflow upgrade issue: https://github.com/ethtri/bloomjoy-hub/issues/459
- Board audit at workflow-upgrade kickoff: 179 items, 46 Todo, 7 In Progress, 126 Done. Treat these counts as time-sensitive and verify against the live board before planning.
- Open PRs at kickoff included stacked Operator Payouts PRs `#451` through `#457` and Mini draft `#442`.

## Current Work Themes

- Refund operations and customer-refund pilot readiness remain high-sensitivity operational surfaces.
- Operator payouts, partner reporting, and scheduled exports are active shared foundations.
- Operator payouts foundation sprint: PR `#451` adds the first schema/access/audit slice for epic `#443` and issue `#444`; later payout PRs build on it.
- Frontend work should use existing app patterns plus `PRODUCT.md`, `DESIGN.md`, and `impeccable` when the visible experience matters.

## Blocker Policy

- Put live blockers on the GitHub issue or PR where the work is happening.
- Use this file only for compact launch-level blockers or cross-cutting context that should survive beyond a single issue.
- Never paste secrets, raw customer data, payment IDs, vendor exports, or free-text complaint content into docs, issues, PRs, or chat.
