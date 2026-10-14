# Monthly base with included visits — integrated draft

Status: implementation for #1929 in draft PR #1930. Not merged, deployed, or
activated. No real compensation terms, time records, issued statements,
regeneration requests, payments, email or access grants are changed.

## Manager workflow

At `/admin/payouts`, choose a Technician and **Adjust pay → Monthly base plus
extra time**. Save the assigned machine, monthly base, included visits, minutes
per visit, extra hourly rate and effective dates. Reopen an agreement to inspect,
revise or deactivate it. A stale loaded revision is rejected rather than silently
overwriting another manager's changes. Existing commission settings stay separate.

The server checks account pay authority and machine assignment. Deactivating an
existing agreement after assignment revocation is allowed only for the same saved
machine scope. New or retargeted inactive agreements still require valid scope.
No technician receives compensation-management permission through this feature.

One effective monthly agreement may overlap a date for each Technician profile.
It belongs to one machine. This limited scope prevents multiplying one monthly
base across machine filters or competing agreements. Ordinary started-hour pay
for other machines remains separate. Cross-payer changes with monthly agreement
history require reconciliation before the existing payer-correction operation.

## Calculation and unresolved rules

The trusted adapter reads persisted agreements, assignment coverage and nonvoided
time entries. Browser-supplied durations or coverage flags never authorize pay.
Exact elapsed minutes come from timestamps, including seconds; existing rounded
minute and shift records are not rewritten. The report, saved statement and PDF
show actual time separately from contractual visit units.

- One unambiguous recorded visit counts as one visit, including a short visit.
- Extra time is `max(actual minutes - included minutes per visit, 0)`, per visit.
  A short visit cannot offset extra repair time on another visit.
- A complete calendar month with exactly the included visits pays the base once.
- Whole extra hours use the agreed extra-hour rate. Commission retains the existing
  tax-exclusive eligible-sales calculation.
- Monthly-covered entries contribute no legacy started-hour earnings or units.
- Missing/excess visits, partial month/assignment coverage and fractional extra-hour
  rounding remain explicitly unset. Affected months show an issue, a null payable
  total and blocked generation. Unaffected complete months can be calculated.
- Multiple time entries on a visit date, including another machine that day, require
  explicit visit attribution. This conservative rule can block separate same-day
  visits; general split/session grouping is not inferred in this draft.

The report labels monthly base, extra time, commission and other earnings
separately. Machine filtering attributes the base only to its agreement machine;
Technician-level other earnings remain excluded from a machine-filtered view.

## Saved statements, YTD and freshness

The existing publication workflow is retained. New payloads use
`operator-pay-stub-v2` plus `earningsSchemaVersion: monthly-visits-v1`. They persist
the evaluated agreement, source visit IDs/timestamps, separate earnings and exact
actual minutes. The portal and PDF validate the saved payload; neither recalculates
published amounts from current settings. Genuine older statement payloads and their
PDF-download fallback remain supported. Earlier issued statement versions are
unchanged and only the current issued version contributes to following-month YTD.

Monthly base and extra time have dedicated run/item columns. Existing integer
minute counters remain compatible; new exact-minute columns and saved payloads
retain seconds. The following month carries previous base, extra time and actual
minutes even when its current pay is ordinary started-hour pay.

Agreement revisions share the existing monotonic time-change sequence. Old and new
effective windows invalidate affected statements and later YTD. Assignment scope
fingerprints provide an additional check. Source locks serialize preparation,
publication, agreement saves and assignment changes. A source change while a PDF
is being produced rejects completion; it does not replace the earlier issued PDF.
Zero-visit months with an agreement remain eligible for normal scheduler evaluation
and surface a missing-visit blocker rather than silently disappearing.

## Verification and review

All data is synthetic and isolated. No live database is needed.

- `npm ci`
- `npm run build`
- `npm test --if-present`
- `npm run lint --if-present`
- `npx tsc --noEmit`
- `deno test --no-lock supabase/functions/_shared/pay-stub-pdf.test.ts supabase/functions/_shared/pay-stub-worker.test.ts`
- `deno check --no-lock supabase/functions/pay-stub-generator/index.ts`
- `npm run db:validate-migrations` (disposable database; hosted replay is used when
  local Docker/WSL resources are unavailable)
- Start local Vite with synthetic Supabase URL/key; run
  `APP_URL=http://127.0.0.1:8099 node scripts/validate-monthly-visit-compensation-uat.mjs`
  and `scripts/validate-manager-time-pay-reports-uat.mjs` against that server.

The SQL workflow fixture includes the anonymous four-visit acceptance case:
45/50/45/45 actual minutes, four units, 20000-cent base, zero extra,
3103-cent unchanged commission and 23103-cent total with no 8000-cent shift addition.
It also exercises fractional short visits, whole-hour repair, real preparation,
following-month YTD, old version preservation, source edits during PDF generation,
authority, stale saves, assignment gaps and ambiguous/missing visits. A separate
two-connection regression checks preparation/assignment and save/payer-correction
serialization. Renderer fixtures use different synthetic terms.

Browser evidence is local under `output/playwright/monthly-visits/`; synthetic PDF
proof is under `output/pdf/`. Verification results and exact source are recorded
in the PR after the final replay. This document does not itself claim hosted checks
have passed.

## Overlaps and eventual release order

Per-machine compensation is already integrated via #1276. Do not replay old #1273.
This integration touches the same manager page/report/PDF areas as that older PR,
#1906/#1907 manager recovery, and portions of draft #1912 freshness. #1925 Home
summary work is adjacent. #1912 remains a separate draft and is not released here.
Sync from main and rerun checks if those foundations change.

Release requires separate authorization. Deploy a compatible PDF worker before
any database begins emitting the new earnings payload, then the reviewed migrations
and UI; verify before enabling a real agreement. Do not regenerate real statements
until the contract for the affected month is confirmed. The unresolved rules above
must be agreed before affected months or broader visit grouping are supported.
