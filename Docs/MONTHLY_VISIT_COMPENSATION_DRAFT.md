# Monthly base with included visits — draft support

Status: calculation foundation for #1929. Not available in manager settings,
not connected to payroll, and not approved for release.

## Capability assessment

The current manager form supports effective-dated started-hour and commission
rates. `OperatorCompensationRateType` in `src/lib/operatorPayouts.ts` is limited
to `shift` and `commission`. Recurring items are bonuses, supply credits and
expense reimbursements. None expresses a contractual monthly base, an included
visit allowance, or additional repair time beyond a per-visit threshold.

Per-machine compensation already reached main through #1276. Open #1273 is
older work touching the same manager page, report and PDF files; it should not
be adopted as a separate solution. This draft does not overlap those files,
#1912's freshness fix, or #1925's Home summaries.

## Calculation implemented in this draft

`private.evaluate_monthly_visit_compensation` is pure internal arithmetic.
It takes the monthly base in cents, included visit count, included minutes per
visit, extra-hour rate, exact actual minutes for each visit, and verified full-month
coverage. It reads and writes no records and has no app/worker execution grant.

- Preserve the actual duration of every visit. A short visit is still one visit
  unit; that unit does not turn its actual duration into an hour.
- Calculate extra actual time separately for every visit:
  `max(actual minutes - included minutes per visit, 0)`.
- Pay the base once when a full month has exactly the included visit count.
- Exact whole extra hours use the configured extra-hour rate.
- Fewer or excess visits, partial or unknown coverage, and fractional extra
  hours return specific blockers and null earnings, not an invented rule or zero.
- Keep unresolved policies explicitly unset even when they do not affect the
  selected month. Two fractional visits cannot cancel the rounding uncertainty.
- Commission is outside this function. The existing eligible-sales calculation
  and effective commission rate remain authoritative.

Synthetic example: a $180 monthly base covering three visits, with $24 per
extra hour and 60 included minutes per visit. Visits of 35, 55 and 40 minutes
retain 130 actual minutes and three visit units, yielding $180 time earnings.
Visits of 120, 30 and 20 minutes retain 170 actual minutes but include one extra
hour, yielding $204. Short visits do not offset a longer visit's extra time.

`calculationStatus: ready` means only that this arithmetic case is resolved.
It is not publication permission, scope verification, an issued statement,
or proof that all payroll source data is complete.

## Required integration before manager use

1. **Effective-dated agreement.** Add a payer/profile/machine-scoped monthly
   agreement with explicit base, included visits, included minutes, extra-hour
   rate and nullable policy decisions. Prevent overlapping agreements and
   ambiguous scope. Record who changed it and before/after terms. Do not replace
   a prior contract or migrate a worker automatically. Existing commission
   rules remain separate. Define whether a visit equals one time entry; do not
   silently infer visit grouping for split entries or multiple machines.
2. **Manager configuration.** Extend the existing pay settings with a choice
   between started-hour pay and monthly base plus extra time. Show the monthly
   fields only for that choice. Leave unresolved rules visibly “Not agreed.”
   Derive account permission, assignment coverage, eligibility and complete
   calendar-month scope on the server. A browser-supplied coverage flag or
   duration list must never authorize payment. Allow review before activation.
   Derive exact duration from start/end timestamps: existing
   `time_entries.raw_duration_minutes` already rounds up to a minute. The evaluator
   preserves fractional minutes and blocks fractional extra hours; it does not
   silently use the existing minute or started-hour rounding.
3. **One report calculation.** Integrate into the current outer
   `private.calculate_technician_pay_report` chain. Preserve all existing sales,
   tax, assignment, cutoff and commission blockers. Replace only the applicable
   time-earnings calculation, without double-paying started-hour earnings.
   Keep actual minutes, legacy started-hour units and contractual visit units
   distinct. Persist selected entry IDs and agreement revision in the snapshot.
   Update `scopeTechnicianToMachine` in `Payouts.tsx`, which currently reconstructs
   filtered totals from started-hour pay and commission alone. Define base
   attribution once within the agreement scope, never once per filtered row.
   Voids, late corrections, overlapping terms and multiple machine scopes need
   explicit regression coverage. Unrelated profiles must produce identical reports.
4. **Statement and YTD fields.** Add named base and extra-time earnings to the
   report, payout snapshot, statement payload, PDF and YTD totals. The current
   generation code in `20260908163758_automatic_contractor_pay_stubs.sql` and
   `supabase/functions/_shared/pay-stub-pdf.ts` assumes `shiftEarningsCents`.
   Do not disguise base pay as shifts or a bonus. Version the new payload and
   retain compatibility with old statements. Keep earlier issued PDFs immutable.
   Include `publishedPayStub.ts` and `PayStubDetails.tsx` in the display contract.
5. **Freshness and regeneration.** Agreement revisions must participate in the
   existing source-revision locking and stale-state checks, including later YTD.
   A correction must not silently rewrite an issued statement. Keep this work
   separate from the unmerged timestamp-boundary fix in #1912.
6. **Verify and release separately.** Use disposable fixtures to verify account
   and machine permissions, plan changes, time corrections, historical and
   current months, generation, old/new PDFs and YTD. Render manager settings
   and reports on desktop/mobile. Obtain the remaining business rules and
   explicit release direction before activating any real agreement or regenerating
   any statement. This draft contains no activation, compensation data or release.

## Unresolved business decisions

Treatment of fewer included visits, visits beyond the allowance, partial months,
and fractional extra-hour rounding remains unset. Decisions should say whether
rounding is per visit and how monetary cents are rounded. Additional machine
scope and split-entry visit grouping must also be specified before general rollout.

## Local verification

Run `npm ci`, `npm run db:validate-migrations`, `npm run build`,
`npm test --if-present` and `npm run lint --if-present` from the PR worktree.
The database test is `supabase/tests/monthly_visit_compensation_evaluator.sql`.
All fixtures are synthetic and roll back. No live database or private worker
data is required. `/admin/payouts` is unchanged; this draft adds no user-facing flow.
