# Refund Nayax inventory operations

This server-only inventory gives the System and current Machine Managers the
exact Nayax machine mapping needed for card research. It is subordinate to
[REFUND_WORKFLOW.md](REFUND_WORKFLOW.md): inventory state cannot add a customer
question, Manager approval, pilot, cohort, or account-wide payment gate.

## Current operation

- Preserve the existing scheduled-sync state during compatible changes. A code
  or documentation release does not require another activation step.
- Reconcile active rows as **Published**, **Needs setup**, or **Excluded**.
  Exclusions require a specific factual reason; machine name or type is not one.
- For every published row, verify the exact account and immutable Nayax ID,
  explicit category, customer label, active location, canonical IANA timezone,
  and current Machine Manager route.
- Keep Snapcase 03, SnapCase Gilroy, and SnapCase Great Mall classified as
  `snapcase`. Keep their reporting/payment source separate from Sunze.
- A missing or stale mapping is Bloomjoy setup work. It may make that machine's
  card execution unavailable, but it must not make the customer repeat known
  facts or block unrelated machines and refunds.

## Changing the inventory integration

For a change to the sync, schema, or reconciliation UI:

1. Deploy any reviewed migration before the dependent function or UI.
2. Run one read-only or synthetic verification appropriate to the change.
3. Reconcile only the affected rows and confirm their exact account/machine,
   timezone, category, location, and Manager route.
4. Return the scheduler to its existing operating state.

Do not create a pilot cohort, owner ceremony, live-refund canary, or separate
Manager approval. Inventory verification never calls the refund endpoint.

## Alerts and response

- **Needs setup:** repair the exact mapping, category, label, timezone, location,
  or Manager route shown, then publish.
- **Explicitly excluded:** confirm the recorded reason is still true.
- **Failed or stale last run:** retain the prior inventory, repair the provider
  read/configuration problem, and rerun with a fresh run key.
- **Large active-count drop:** do not reconcile removals from that snapshot.
  Confirm provider completeness first.
- **Missing once:** take no destructive action. A machine becomes inactive only
  after two consecutive complete successful snapshots omit it.
- **Public inactive/stale:** inspect the last two successful runs and restore the
  row only after the provider again reports the exact machine active.

## Rollback

If the inventory integration itself is causing harm, disable its scheduled and
Edge sync controls while preserving history and the last known inventory. Do not
delete rows or reset absence counters. Keep customer intake available, isolate
the affected machine, and use a reviewed forward migration for schema repair.
