# Refund Nayax Inventory Runbook

## Purpose

This server-only inventory makes every active Nayax machine visible to Refund Operations. It is the authoritative public-eligibility gate for both cotton-candy and Snapcase machines. It does not change sales/reporting provenance and does not call the refund endpoint.

## Safe rollout order

1. Merge and deploy the database migration and `refund-nayax-inventory-sync` function with `REFUND_NAYAX_INVENTORY_SYNC_ENABLED=false`.
2. Configure the server-only sync URL/token, account list, and account-specific Nayax tokens. Never use `VITE_` variables.
3. Manually enable the Edge switch for one reviewed inventory run while the GitHub schedule variable remains false.
4. In Admin > Machines, reconcile every active row as Published, Needs setup, or Excluded. Exclusions require a specific reason; machine name/type is not evidence.
5. For each published row, verify the exact account + immutable Nayax ID mapping, explicit category, customer label, active location, and current Machine Manager route.
6. Explicitly classify Snapcase 03, SnapCase Gilroy, and SnapCase Great Mall as `snapcase`. Keep their reporting/payment source separate from Sunze.
7. Run selector and database safety tests, then perform one controlled read-only Snapcase transaction lookup. Keep live refund execution off.
8. After reviewed UAT evidence, enable the hourly GitHub schedule as a separate production activation. Monitor the first two successful snapshots before declaring the inventory stable.

## Alerts and response

- **Needs setup:** complete the exact mapping, category, customer label, and manager route, then publish.
- **Explicitly excluded:** confirm the audit reason is still valid; never exclude by a name/type heuristic.
- **Failed or stale last run:** keep the prior inventory; repair credentials/provider access and rerun with a fresh key.
- **Large active-count drop:** do not reconcile removals from that snapshot. Check provider completeness before a new run.
- **Missing once:** no action is taken. A machine becomes inactive only after it is missing from two consecutive complete successful snapshots.
- **Public inactive/stale:** the selector fails closed. Inspect the last two successful runs and restore only after the provider again reports the exact machine active.

## Rollback

Set both `REFUND_NAYAX_INVENTORY_SYNC_ENABLED` controls false. This stops provider reads and writes without deleting history. Do not delete inventory rows or reset absence counters. The public selector remains fail-closed to the last explicitly published, active inventory state; if the release must be reverted, use a reviewed forward migration and preserve the audit/history tables.

## Pilot exclusions

This runbook does not require TOTP, temporary operators, GPT, QR codes, Kexiazhan reporting, cash fallback, or a new SMS platform. Duplicate transaction selection, idempotency, amount/cap, manager, and provider-outcome protections remain separate launch gates.
