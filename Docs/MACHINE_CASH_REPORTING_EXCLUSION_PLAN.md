# Per-machine cash reporting exclusion

Date: 2026-10-06

Implementation issue: [#1795](https://github.com/ethtri/bloomjoy-hub/issues/1795)

Status: implementation plan; no feature or production settings have been changed.

## Outcome and owner requirements

Five cotton-candy machines cannot accept cash, but Sunze records engineers' free test candies as cash sales. Those observations must contribute nothing to revenue recognition, commissionable sales, partner revenue shares or other sales-derived financial totals. Preserve the source observations for diagnostics and actual production/consumable tracking.

Add one per-machine toggle, **Exclude cash from financial reporting**, default **off**. Enable it for the five machines below when the feature is deployed. Nayax remains the card-sales authority. Other machines continue using their existing cash sources, including Sunze and Kexiaozhan.

This owner direction supersedes the requirement to include vendor cash for these exact machines in `Docs/SALES_SOURCE_FIELD_CONTRACT.md`, including its Livermore/Great Mall comparison row. Update that contract and the durable decision when implementing; the old rule remains valid for machines outside this exception.

## Exact initial machines

Read-only production inventory verification on October 6 identified these five active commercial machines. Their Nayax account is `TGPACI_USA_DB`. The owner added Eastridge to the initial four during planning.

| Current Machine name | Canonical Hub machine ID | Nayax machine ID | Sunze machine ID |
| --- | --- | --- | --- |
| BS02 1st Livermore | `8eda5a29-1718-4c70-9993-7c7e2fd6c65a` | `434553783` | `1671607902715237973220935` |
| BS03 2nd Livermore | `91bae5ac-4ba6-4378-91f0-ef266bdd4d7a` | `573162825` | `168057312500385538295135` |
| BS06 Great mall | `4a868e7b-59ae-4162-af97-8e369c3e1779` | `781160259` | `1708677712532943266393287` |
| BS07 Eastridge center | `18ec7a81-d4a7-4c8e-85f2-19d0e7c9b439` | `627583676` | `1722481640201597347886822` |
| BS09 2nd Stoneridge mall | `4396fc79-478a-4490-80af-02d0fedfc66b` | `369651526` | `17224944213813514960176` |

Great Mall also has separate SnapCase records. The owner confirmed that the Great Mall SnapCase was removed several months ago and is inactive. Do not reactivate it or count it as part of the five-machine active rollout. The read-only Hub inventory still labels both Great Mall SnapCase records active; this discrepancy needs reconciliation with the existing source-first retirement workflow, rather than being treated as evidence the physical machine is operating. No lifecycle or mapping changes are part of this plan. Historical cash exclusion for that retired machine is a separate scope clarification; absent further owner direction, the initial seed is limited to the five cotton-candy machines.

Do not apply the exception to every machine at a venue or an entire source account. Resolve initialization through exact provider/account identities and corroborating Sunze IDs; the Hub IDs above document the verified mapping, rather than serving as unexplained generated-ID literals in a migration. Resolve exactly one canonical machine per target and report a changed/ambiguous target without expanding the update.

The original four already have imported cash observations from 2025 through October 2026. A future-only change would leave historical live reports inflated. Apply the same all-date policy to Eastridge.

## Financial behavior

- The exclusion is a machine-wide rule for **all dates in newly calculated reports**, including historical recalculations, new imports and late backfills. No date picker or test-session classifier is needed for these machines, which the owner says do not accept cash.
- Preserve `machine_sales_facts`, amounts, raw payloads, IDs, import lineage and source telemetry. Exclude eligible cash sale inputs in the server-side calculation layer before normalization and aggregation; do not zero or delete stored sales.
- Excluded cash contributes zero recorded receipts, sales excluding tax, sales tax, paid-sale transaction counts, paid-sales quantities, commission basis and revenue-share basis. It must not inflate averages or inferred financial costs based on paid-sales quantities. Raw production counts and actual costs remain available through their existing operational sources.
- Mark the reason as an explicit machine cash exclusion. Deliberately excluded observations are not missing/unresolved cash and must not make otherwise valid totals unknown. Existing card coverage and tax-evidence requirements still apply.
- Apply the setting to cash tender regardless of importer. Preserve existing card-source deduplication and source-tax normalization. Do not infer that `other` or `unknown` tender means cash; retain current treatment and identify any separate misclassification during verification.
- Refund requests, paid refunds, recognition/reversal dates and real expenses remain separate facts under the existing contracts. Filter cash **sale inputs**, not entire cash component rows that may contain a legitimate adjustment. Do not erase financial obligations or change refund matching/approval policy through this setting.

Synthetic acceptance example: an excluded machine has $110 card receipts with $10 evidenced card tax, $20 fabricated cash and an $11 card refund request ($10 excluding tax). Recognized receipts before refunds are $110; sales excluding tax before refunds are $100; commissionable sales after the request are $90. At a 10% technician commission, earnings are $9. The $20 contributes nothing. Paying that request later causes no second deduction.

## Implementation sequence

### 1. Persist and audit the setting

Add `reporting_machines.exclude_cash_from_financial_reporting boolean not null default false`. Reuse the existing machine workspace metadata and source-first catalogue so the setting is attached to a configured canonical machine and shown consistently on its imported-source row.

Add a narrowly scoped save RPC, following existing `admin_set_machine_display_name` / `admin_save_machine_refund_settings` patterns. Reuse super-admin and scoped machine-admin authorization and `admin_audit_log`; do not widen who can edit financial settings. Accept the expected previous value to detect stale saves, and return the saved state. Record machine, old/new value, actor, timestamp and reason. Prevent mapping, rename, import, archive/restore and ordinary machine saves from resetting the value.

Initialize only the five verified identities to true in a repeatable deployment step with audit provenance. Keep all other existing and new machines false. Preserve existing API/RLS grants; a browser must not be able to bypass RPC authorization with a direct field update.

### 2. Enforce one rule in every financial path

Use one private eligibility predicate for cash sale facts and reuse it at each fact-input seam. Apply it before sums, normalization, source counts and completeness checks. Inspect current function definitions before writing a new migration; do not modify historical migrations.

The current implementation has two important daily adapters: `private.machine_sales_daily_components` feeds Sales and compensation, while `private.machine_sales_daily_waterfall_components` feeds Finance. The latter was derived separately in `20261005201736_finance_source_tax_cash_waterfall.sql`; changing only one leaves inconsistent totals. Also check `private.machine_sales_calculation_candidates`, legacy/direct fact readers and dashboard aggregates for bypasses.

| Consumer | Required result and current integration seam |
| --- | --- |
| Sales reports and sales analytics | Shared rows in `private.sales_report_rows_for_actor`, `get_sales_report` and the scheduler; all-payment and cash-only views agree. Legacy raw-fact paths also honor the rule. |
| Finance and financial models | `get_finance_reporting` and the waterfall use eligible receipts, deductions and remaining tax; company/machine totals reconcile with Sales for equivalent scopes. |
| Technician commissions | `operator_revenue_snapshot_source_values`, `private.operator_machine_tax_snapshot`, `private.operator_machine_tax_commission`, `private.calculate_technician_pay_report`, and their shared wrappers exclude cash. Verify both snapshot and per-rate/date-segment paths. |
| Partner commission/revenue share | `admin_preview_partner_period_report_internal` and snapshot generation use the corrected base while preserving contracted fees, cost methods, split bases and fixed amounts. Check its direct fact reads for quantities/amounts. |
| Dashboards, exports and summaries | Existing report PDFs/CSV, scheduled reports and machine financial email summaries use corrected server results; no client or export layer adds raw cash back. Source-import diagnostics may still display raw evidence with its exclusion explained. |

Use integer cents and existing machine-local dates/access scope. Preserve current unknown-tax behavior for admitted card sales. Update calculation/policy metadata so changed results are distinguishable and cached/saved draft calculations can be refreshed consistently.

### 3. Refresh reports while preserving issued versions

Changing the toggle invalidates machine metadata, Sales, Finance and compensation query caches. Reuse existing payout reconciliation to refresh missing/stale revenue snapshots; include the applied cash policy in snapshot metadata/freshness so a setting change cannot leave an apparently current commission base. Source row counts and latest eligible sale date must reflect admitted inputs, while source ingestion diagnostics remain raw.

Recompute open/draft reports and commission inputs for affected periods. Live historical reports use the current setting. Preserve already-issued pay stubs, stored partner statements and saved exports as historical versions. Inventory affected issued periods and provide the existing revision/reissue path for corrections; do not silently rewrite, resend or pay them. Draft/month-to-date calculations and revised statement previews must agree with live Sales/Finance.

### 4. Add the small Machines UI control

Reuse the existing Switch, save/toast and dirty-form patterns in `src/pages/admin/Machines.tsx` and RPC wrappers in `src/lib/machineWorkspace.ts`. Place the setting in the existing machine settings surface, with a compact **Cash excluded** indicator in the catalogue/detail view when enabled.

Suggested helper text: “Reported cash is excluded from revenue, commissions and revenue shares for this machine. Applies to all dates in recalculated reports. Card sales continue normally.”

Persist through the existing save interaction. Show success only after the server saves; show an actionable save/conflict error without misrepresenting the stored setting. Keep keyboard labels, focus and mobile layout accessible. Show the active policy in financial/source detail where it explains a discrepancy, without adding a warning dashboard or another approval flow.

### 5. Verify and release

Use the existing stack and browser verification path. Add focused SQL regression coverage, such as `supabase/tests/machine_cash_reporting_exclusion.sql`, and extend existing shared-consumer/finance/payout tests where useful:

- Default false preserves an ordinary cash-accepting machine; on excludes cash; off restores raw cash eligibility in live recalculations. On/off never mutates raw imports.
- Exact-five initialization includes Eastridge and leaves other cotton-candy and retired Great Mall SnapCase records unchanged. Renaming, mapping saves, archive/restore, duplicate import and late cash backfill preserve the setting.
- Zero-money cash still contributes no paid-sale count. Unknown-tax excluded cash contributes no unresolved blocker. Existing eligible card counts/tax and other/unknown tender are preserved.
- Mixed-machine and cash/card/all-payment filters, machine/day/month/company totals, Finance waterfall, exports and email financial summaries agree.
- Technician snapshots and both commission calculation paths agree, including effective-rate segments; partner splits and quantity-based financial inputs cannot include test cash vends. Fixed pay, actual costs and legitimate refund deductions remain intact.
- Setting changes refresh draft inputs; issued statement payloads stay identical; corrected revisions use the new policy once.
- Unauthorized and out-of-scope writes fail; authorized saves and conflicts follow existing access/audit patterns.

Run repo verification (`npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`), migration validation and relevant SQL/financial suites. Perform authenticated desktop/mobile checks for `/admin/machines`, a selected machine, Sales/Finance reporting, technician pay and partner report previews. Extend `Docs/QA_SMOKE_TEST_CHECKLIST.md` with reusable checks.

Before deployment, capture bounded before/after calculations for each target and one unaffected cash machine. Use historical and current periods, prove card parity and calculate the exact removed cash contribution. After deployment, verify the five stored settings, report parity and unchanged source facts read-only. Production setting activation belongs to the implementation release, not this planning task.

## Delivery, overlap and rollback

Deliver one focused feature PR on an `agent/` branch in a dedicated worktree, covering schema, shared financial integration, UI, tests and the contract exception. Planning is a separate documentation PR. Keep #1795 open/Todo until implementation and runtime verification are complete.

Open PR #1273 touches per-machine technician compensation and payout foundations; #503 touches payout review UI. Recheck their state and files at implementation kickoff. Reuse current main, avoid broad payout/UI refactors, and re-run verification after any overlapping merge. Update `Docs/DECISIONS.md` and `Docs/SALES_SOURCE_FIELD_CONTRACT.md` during implementation so old all-cash assumptions cannot override this exception.

Rollback uses the preserved raw observations and recorded setting changes. Revert only the new calculation/UI integration or restore the prior audited setting values, then refresh affected draft caches/snapshots. Keep the additive column/audit evidence and issued versions; no source-data restoration or destructive rollback is necessary. Turning exclusion off intentionally restores raw cash to newly calculated historical reports, so the five cashless machines should remain on unless their reporting policy is deliberately changed.
