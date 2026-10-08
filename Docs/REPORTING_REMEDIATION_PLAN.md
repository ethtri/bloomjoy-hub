# Reporting root cause and remediation plan

October 8 update: the owner confirmed stable machine rates and selected Nayax's
7.5% for The Avenues, superseding the artificial historical observation cutoff
described below. Annual query/loading, machine/receipt UI and CSV/PDF, stable-rate
and exact original-reader SQL repairs are deployed (export v138, scheduler v134).
The original-import lookup uses an indexed, bounded identity probe and an atomic
eight-second annual reporting guard. Exact original case and Sheet payment
repairs are deployed through #1848/#1849 (Sheet worker v133). Latest January
1–October 7 reporting has 9,511 rows/59,837 transactions, zero unresolved imported
sales and 33 unresolved refund components. All 54 reviewed Sheet repairs changed
only payment evidence/audit timestamps, with financial amounts, dates, hashes
and populated/NULL fingerprints preserved; replay changed zero. The supported
refund recovery is $550.82 ex-tax and the annual deployment rehearsal took
2.200 seconds. Supported receipts remain partial where source amount basis is
unknown. Remaining refund evidence, the explicit Eastridge correction and the
separate Machine rate editor are tracked in #1824/#1850. Final browser/PDF
acceptance follows those reviews. The investigation below is historical.

Reporting has two confirmed failures: long periods exceed the database request
timeout, while shorter periods load records whose tax split cannot be calculated
for their original dates. The UI turns incomplete monetary rows into unavailable
totals and an unexplained blank trend. These failures reproduce on desktop and a
390×844 mobile viewport; the evidence does not point to a mobile layout defect.

Track remediation in [#1824](https://github.com/ethtri/bloomjoy-hub/issues/1824).
This is the original investigation and proposed implementation sequence; use the
October 8 update above and issue acceptance evidence for current release status.

## Confirmed production evidence

Evidence was captured October 7, 2026 Pacific time, October 8 UTC, against
`main` at `b382c847` and the live Hub database. Dates below are inclusive
machine-local business dates. The owner's screenshots and an authenticated
business Chrome session establish the visible symptom; read-only database and
API checks establish its cause.

| Scope | Observed result | Meaning |
| --- | --- | --- |
| September 30–October 6, all accessible companies | 225 report rows, 1,040 transactions, 90 rows with null net amounts, $6,133.47 known net subtotal | Records load. The subtotal exactly matches the owner's screenshot and live desktop view; it is not the complete net total. |
| Same period, underlying components | 508 unresolved sales across 24 machines; five unresolved refund components across five machines; 26 affected machines in total | The 90 displayed rows are aggregate report rows, not 90 transactions. All unresolved components lack applicable dated source-tax coverage. |
| Same period, unresolved sales dates | September 30–October 4; 304 `card_authority_daily` transactions and 204 `nayax_scheduled_report` transactions | These dates precede the current API tax observations, which first become effective October 5. Refund normalization also depends on the original purchase date. |
| January 1–October 7, Sales | Read-only `EXPLAIN ANALYZE`: 9,509 rows, 8,208.844 ms; 313,824 shared buffer hits and temporary reads/writes | The standalone query already exceeds the authenticated eight-second timeout. Its inner execution plan still needs profiling before choosing an index or SQL rewrite. |
| Same annual range, live mobile request | Sales, Labor and Refunds summary requests return HTTP 500 at roughly 8.1–8.3 seconds; database logs report statement timeout | Three independent report domains fail. Automatic retries repeat the same expensive work even with comparison disabled. |
| Imported source freshness | Nayax, Sunze, SnapCase cash and card-authority facts all include October 7 sales | A general import outage does not explain this incident. A recent import does not prove complete machine coverage. |

The investigation changed no production facts, tax settings, reader mappings,
refund decisions, payments, function definitions or timeout configuration.

## Root causes

### Historical tax coverage is narrower than the report period

[PR #1767](https://github.com/ethtri/bloomjoy-hub/pull/1767), merged October 5,
changed shared normalization to source-backed card tax. The current
`private.normalize_reporting_treated_amount_cents` resolves dated source
observations rather than using the passed manual rate. Without applicable
evidence, inclusive card amounts remain unresolved. This follows the owner's
October 5 decision: current reader settings cannot establish historical tax.

Production has verified API observations for 40 readers starting October 5,
plus separately dated Finance or portal history for six readers. That coverage
does not resolve all older sales or purchases underlying current refund
requests. The resolver reports `missing` for every unresolved component in the
September 30–October 6 reproduction.

Relevant paths:

- `supabase/migrations/20261005201647_nayax_source_tax_observations.sql`
- `supabase/migrations/20261005201736_finance_source_tax_cash_waterfall.sql`
- `private.machine_sales_daily_components` and
  `private.sales_report_rows_for_actor`
- The October 5 decision in `Docs/DECISIONS.md` and
  `Docs/SALES_SOURCE_FIELD_CONTRACT.md`

### Supported annual periods exceed the request budget

The workspace requests daily rows across every accessible machine. Sales
materializes a per-machine call to `machine_sales_daily_components`; location
and tender filtering occur after component construction. Labor and Refunds
summaries load for the same range alongside Sales. Comparison can add another
Sales request, but the annual failure reproduces with comparison disabled.

The authenticated and authenticator roles have an eight-second statement
timeout. Annual Sales needs 8.21 seconds in the direct read-only benchmark;
concurrent browser calls are canceled. The precise expensive joins inside each
report function are not established by the outer function-scan plan. Profile
those statements before selecting a repair. Raising the global timeout would
leave the repeated work and poor response margin unresolved.

Relevant paths:

- `src/components/portal/reports/ReportingWorkspace.tsx`
- `src/components/portal/reports/ReportingOperations.tsx`
- `src/lib/reporting.ts`, `src/lib/laborAnalytics.ts` and
  `src/lib/refundAnalytics.ts`
- `supabase/migrations/20260929010931_align_shared_sales_consumers.sql`

### Partial monetary data becomes an unavailable total and blank chart

`knownMoney` returns a complete value only when every row is known.
`alignedTrend` applies that rule to each day. One unresolved contributor can
therefore make an entire company, daily point or headline total null even when
other transactions are loaded and calculable. Refund impact and sales per
transaction also become unavailable through their dependent monetary inputs.

The chart says “Gaps mean no loaded rows,” although the reproduced gaps include
loaded rows with unknown tax. The top net card has a small known-subtotal note;
the other cards and chart provide too little explanation. Successful partial
data, no records and request failure must remain distinct.

Relevant paths: `src/lib/reportingWorkspace.ts` and
`src/components/portal/reports/ReportingSalesAnalytics.tsx`.

## Remediation sequence

| Slice | Priority and proposed owner | Implementation | Acceptance |
| --- | --- | --- | --- |
| Restore long-period loading | P0, backend/reporting | Profile inner Sales, Labor and Refunds statements with representative volume. Push authorized date/machine/location scope earlier where equivalent; batch repeated source-tax and refund lookups; add only plan-supported indexes. Optimize the common calculation before considering chunked reads. Preserve complete annual results and avoid repeated automatic retries for deterministic statement timeouts. | All three annual calls complete below eight seconds with representative concurrency; target four seconds for headroom. Reconcile complete results against the 9,509-row reference, including the actual deployed row cap/pagination. Preserve exact cents, counts and role scope. |
| Make partial reports useful on mobile | P1, frontend/reporting; can proceed alongside profiling | Put known subtotals and omitted component counts/reasons in the primary reading path. Retain independently known transaction counts and recorded receipts with accurate labels. Distinguish partial, empty and failed states in cards, chart, daily table and exports. If showing a partial trend, label it as a known subtotal rather than complete net sales. Keep comparison independent of current-period success. | Both screenshot periods explain the state on mobile and desktop. Unknown complete totals stay null; no missing amount becomes zero. Tables, chart, briefing, PDF and CSV agree on completeness and scope. |
| Recover supported historical tax | P1, source integration/Finance | Inventory affected account/reader/date intervals and refund purchase dates. Recover original transaction tax first, then dated Nayax history and existing Finance evidence through the audited observation path. Recalculate only supported intervals. Reuse #1592 for specific evidence that internal research cannot recover. | Each correction has exact source identity, effective dates and provenance. Affected unknown counts fall only where evidence supports it. Current settings are never backdated; unsupported amounts remain visibly partial. |

Do not remove annual presets or introduce a shorter date cap as the repair.
Do not restore arbitrary manual rates, guess tax exemptions, change the approved
cash treatment or hold unrelated refund operations while reports are repaired.
Existing issued statements and report snapshots retain their original versions.

## Verification and release

1. Reproduce `/portal/reports?from=2026-09-30&to=2026-10-06` and
   `/portal/reports?from=2026-01-01&to=2026-10-07&compare=none` on localhost or
   staging, then through the authenticated API under the existing timeout.
   Test comparison enabled separately.
2. Cover All companies, one company, one machine, cash and card; include
   super-admin, scoped-admin and report-viewer permissions. Verify access loss
   cannot expose retained results from a wider scope.
3. Add meaningful fixtures for loaded partial days, no records, complete zero,
   request timeout, missing historical tax and a failed comparison with a
   successful current period. Use representative annual database volume and
   complete-result reconciliation; tiny UI fixtures cannot prove performance.
4. Run the required npm checks and `npm run reporting:test-analytics`; for SQL
   changes run the existing disposable database suite and preserve shared
   Sales/Finance/payroll/partner component parity. Verify request-month
   deductions, later reversals and no second deduction on payment.
5. Render at 390×844 and desktop; check clear errors/retry, partial daily values,
   keyboard controls, overflow and screen/export agreement. Deploy backend
   changes before their dependent frontend, following the existing production
   runbook and release authority. This plan grants no production deployment.

Rollback should restore only the changed query/UI definitions through a forward
migration or prior release. Keep recovered evidence, raw facts and immutable
issued artifacts. Do not use a timeout increase or data deletion as rollback.

Existing unit checks pass despite the incident: they intentionally preserve
nullable totals and use small fixtures. Add integrated partial-data and annual
volume coverage to the existing reporting checks so those two failure modes
cannot pass unnoticed again.
