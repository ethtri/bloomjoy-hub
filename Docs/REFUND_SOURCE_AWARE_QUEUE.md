# Refund Source-Aware Queue and Daily Reconciliation

This is the operating contract for issue `#706`. It makes website, designated support-email, and SMS Google Form intake visible in one authorized Refund Operations view without making Gmail or Google Sheets a second system of record.

## Manager experience

- Every Hub case shows a fixed source badge: **Website form**, **Support email**, or **SMS Google Form**.
- Gmail and mapped SMS Google Form drafts join the same manager-scoped queue as website cases.
- Every selected case exposes `/refunds?case=<case-id>` as its exact, copyable portal link. Opening the link performs no official action.
- Saved queue filters cover: needs action, missing information, unmapped machine, import failure, possible duplicate, aging, provider reconciliation hold, waiting on customer, ready to refund, blocked/failed, completed, and all cases.
- Machine Managers see only cases allowed by the current machine-to-manager mapping. Unassigned Gmail drafts and source quarantine totals remain central-admin only.
- A draft may prepare or send a friendly missing-information email through the existing reviewed customer-message path. A Machine Manager still performs every official decision, Nayax refund, or manual completion in the portal UI.

The source snapshot returned to the browser contains case IDs, fixed state codes, timestamps, source labels, and exact case paths. It does not contain customer names, contact details, complaint text, payment details, provider identifiers, raw Gmail content, Sheet IDs, Sheet row numbers, or source fingerprints.

## Queue states

| Signal | Meaning | Manager response |
| --- | --- | --- |
| Missing information | A source draft lacks one or more required transaction details | Review the friendly template and ask the customer only for the missing details |
| Unmapped machine | The submitted location does not map cleanly to one active machine | Central admin repairs the mapping; do not infer a machine |
| Import failure | An accepted source row has invalid fields or a failed import outcome | Review aggregate health and authorized quarantine; do not edit the Sheet into a second queue |
| Possible duplicate | Two source-specific cases may represent one customer incident | Resolve the linked review before any official action |
| Aging | An open case has not changed for 24 hours, or a customer-waiting case for 72 hours | Follow the pilot escalation/reminder procedure |
| Provider reconciliation hold | A Nayax request is requested, ambiguous, or in manual review | Reconcile the provider outcome before retrying or completing |

## Source health and reconciliation

The portal shows one PII-free source panel with last successful ingest, oldest unprocessed item, lag, represented/imported count, failure count, unmapped count, quarantine count where authorized, and pending duplicate count.

The daily equation is:

`accepted source submissions = Hub cases + authorized quarantine items`

For the durable 24-hour window:

- website submissions are canonical website-created cases;
- support-email submissions are canonical Gmail-created cases;
- SMS Google Form submissions are opaque import-ledger rows;
- a Google Form row is represented by either a linked Hub case or its authorized quarantine/rejected state.

The equation intentionally uses durable intake units, not private Sheet contents or transient workflow log totals. A non-zero delta, stale/failing/revoked source, failed import, or unmapped count is an attention signal. The pilot owner must reconcile it before relying on that source for coverage.

The service caller receives `cases: []`. GitHub Actions and Edge logs contain only aggregate counts, fixed source/status labels, timestamps, and fixed reason codes.

## Default-off daily monitor

The `Refund Source Reconciliation` workflow runs daily only when all of these are true:

1. `refund-source-reconciliation` is deployed with JWT verification disabled; its own dedicated bearer-secret check remains mandatory.
2. Supabase secret `REFUND_SOURCE_RECONCILIATION_SECRET` is configured with a dedicated random value.
3. Supabase secret `REFUND_SOURCE_RECONCILIATION_ENABLED=true` is configured.
4. GitHub secret `REFUND_SOURCE_RECONCILIATION_URL` points to that function.
5. GitHub secret `REFUND_SOURCE_RECONCILIATION_TOKEN` matches the dedicated function secret.
6. GitHub variable `REFUND_SOURCE_RECONCILIATION_ENABLED=true` is set only after the synthetic failure test passes.

The GitHub token is not a Supabase service-role key. The Edge Function keeps the built-in service role server-side and allowlists the response before returning it.

First run the workflow manually with `failure_test=true`. It must emit one aggregate warning, succeed as a synthetic test, and print no customer or source-row content. Then run `failure_test=false` with both enable switches approved; a real attention result fails the workflow so it cannot be mistaken for a green daily check.

## Pilot UAT

Use synthetic data only in evidence:

1. Create one website case, one labeled Gmail draft, and one mapped SMS Google Form draft.
2. Confirm all three appear in `/refunds` for an authorized central admin and that a Machine Manager sees only mapped cases.
3. Confirm every queue/detail source badge is stable and non-editable.
4. Open and copy the exact case link. Confirm no decision, provider attempt, settlement, or customer message is created by opening it.
5. Exercise every saved filter, including one unmapped/quarantined aggregate and one provider hold.
6. Send one reviewed missing-information message from a synthetic SMS Google Form draft. Confirm the manager mapping/CC rule and one-message idempotency in the existing customer-communications UAT.
7. Run the daily failure test and a live aggregate check. Confirm the 24-hour equation balances.
8. Capture only the aggregate panel and synthetic references; do not capture customer PII, Gmail content, Sheet content/IDs, payment details, or provider identifiers.

Run locally:

```powershell
npm run refunds:validate-source-aware-queue
npm run db:validate-migrations
npm run db:validate-rpc-surface
npm run refunds:validate-portal-uat
```

## Go / no-go and rollback

This slice is ready for pilot review only when the static/database/browser suites pass, all three sources have synthetic evidence, the daily equation balances, source credentials/approvals are recorded, and the user-facing queue remains manager-scoped.

It is a no-go when an expected source is stale/failing/revoked, the equation has a delta, an unmapped/quarantined item lacks an owner, an exact case link crosses authorization scope, or an official action is available on a draft/duplicate/provider hold.

Rollback is non-destructive:

1. Set GitHub variable `REFUND_SOURCE_RECONCILIATION_ENABLED=false`.
2. Set Supabase `REFUND_SOURCE_RECONCILIATION_ENABLED=false`.
3. Keep the source-specific bridges disabled if their own gates are not satisfied.
4. Preserve cases, import ledgers, reconciliation reviews, and audit rows.
5. Managers continue using existing website cases and manual portal workflows while source health is repaired.
