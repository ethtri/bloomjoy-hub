# Partner Dashboard UX/CX Plan

## Purpose
Issue `#172` defines the reporting tab design track that can run in parallel with the admin reporting and reviewed-PDF work. This plan is the implementation-ready UX/CX source for the future `/portal/reports` experience.

The reporting tab should feel calm, premium, and operationally useful. Users should quickly understand what happened, whether the numbers are current, what changed, and what to do next. The partner dashboard must make the financial math trustworthy without turning the first screen into an accounting worksheet.

This is a design artifact only. It does not introduce production data model changes, new routes, or schema assumptions beyond the reporting concepts already documented in `Docs/DECISIONS.md`.

## Product Principles
- Lead with the answer, then offer proof. The top of the page should answer "How are my machines doing?" or "What is owed for this period?" before exposing detailed rows.
- Keep operator performance and partner settlement separate. Operators need performance insight; partners need explainable settlement math.
- Make freshness visible. Reporting should never hide stale data, failed syncs, missing tax assumptions, or incomplete financial rules.
- Use progressive disclosure. Show the simple formula and performance story in partner-facing surfaces; keep internal data-quality warnings in admin-only review surfaces.
- Use existing app conventions. Future implementation should extend `/portal/reports`, `PortalLayout`, `PortalPageIntro`, shadcn/ui primitives, Recharts via `ChartContainer`, and Supabase-backed reporting helpers.

## Permissioning Model
### V1
- **Default reporting tab**: visible to authenticated users with machine reporting access through the current reporting entitlement model.
- **Operator reporting view**: visible to every reporting-entitled user and scoped only to their accessible machines.
- **Partner dashboard view**: visible only to `super_admin` users in V1.
- **Non-admin partner contacts**: do not receive portal partner-dashboard access in V1. Their partner-facing deliverable remains the reviewed PDF that a super-admin downloads and sends manually.
- **No implicit inheritance**: partnership setup does not grant portal access. Reporting visibility remains machine-level unless a future explicit partner permission is added.

### Future Partner-Viewer Access
- Add an explicit partner-dashboard permission such as `partner_viewer`.
- Scope `partner_viewer` to one or more partnerships, not to all reporting data.
- A partner viewer can open the Partner dashboard for permitted partnerships, see machine performance in volume and dollars, view approved report snapshots, and download approved PDFs only when the snapshot status allows it.
- A partner viewer cannot change machine assignments, tax assumptions, financial rules, import runs, raw sales facts, schedules, recipients, generated snapshot contents, or internal data-quality warnings.
- Super-admin keeps an override for all partner dashboards, warnings, preview generation, and PDF review.

### UX Treatment
- If the user has only operator reporting access, show a single `Reporting` page with no view switcher.
- If the user has partner-dashboard visibility, show a compact segmented switcher near the page title: `Operator view` and `Partner dashboard`.
- If a super-admin opens Partner dashboard before V1 data is ready, show an internal-only setup state that links to the relevant admin surfaces rather than exposing a broken dashboard.
- Do not show disabled partner tabs to normal users. Hidden access is clearer and avoids implying a paid feature upsell.

## Reporting Tab Information Architecture
### Shared Page Frame
- Route: extend the existing `/portal/reports` surface.
- Header: `Reporting`, short operational description, freshness badges, and a primary action area.
- Top controls:
  - Period preset: `This week`, `Last week`, `Last 30 days`, `Month to date`, `Custom`.
  - Date range inputs for custom periods.
  - Location and machine filters.
  - Payment filter for operator view.
  - Partnership selector for Partner dashboard.
- Status rail:
  - Latest sale date.
  - Last successful import.
  - Fresh, stale, failed, or partial-data state.
  - Admin-only data-quality status when the viewer is allowed to manage reporting.

### Component Mapping
- Navigation and view switching: shadcn `Tabs` or `ToggleGroup`; prefer `ToggleGroup` for the two-mode switch.
- Controls: `Select`, `Button`, `Popover` plus existing date inputs or future `Calendar`.
- Metrics: composed `Card` components with small labels, clear values, and one line of context.
- Charts: existing `ChartContainer` and Recharts.
- Tables: shadcn `Table` with responsive card summaries on narrow screens.
- Admin-only warnings: shadcn `Alert`, `Badge`, `Tooltip`, and `Accordion`/`Collapsible` for detail.
- PDF preview/review: `Dialog` on desktop, `Drawer` on mobile.
- Loading: `Skeleton`; no custom pulse blocks in future code.
- Empty states: use the repo's existing empty-state pattern or add shadcn `Empty` if/when available.

## Operator Reporting View
### Job To Be Done
Help an operator or account owner understand assigned machine performance without exposing partner settlement terms.

### Default Layout
1. **Performance summary**
   - Net sales.
   - Gross sales.
   - Units sold or sticks/items sold.
   - Transactions.
   - Average order value.
   - Refund/adjustment impact when available.
2. **Trend**
   - One primary chart showing sales over time for the selected grain.
   - Optional comparison to previous period once the API supports it.
3. **Machine comparison**
   - Ranked list/table of accessible machines.
   - Machine label, location, status, latest sale date, units, gross sales, net sales, transaction count, and share of selected-period sales.
4. **Payment mix and detail**
   - Compact payment breakdown.
   - Detail table grouped by period, machine, location, and payment method.

### Controls
- Default period: last 30 days with weekly grain.
- Grain options: daily, weekly, monthly.
- Filters are sticky within the session but should reset safely when a user loses access to a machine.
- Refresh action updates dimensions, access context, and current report rows.
- Export action creates an operator sales PDF only for the selected filters. It is not the partner settlement PDF.

### States
- **No reporting access**: explain that reporting appears only for machines Bloomjoy has granted to the account. Offer no admin-looking actions.
- **Loading**: show skeleton summary cards, chart frame, and table rows.
- **Empty no machines**: explain that the user has reporting access but no active machines assigned.
- **Empty no sales**: show selected filters, suggest widening period or clearing filters.
- **Error**: show a concise retry state and preserve the selected filters.
- **Stale data**: keep the dashboard visible, but place a warning banner above metrics: `Sales data may be stale. Last successful import was ...`.
- **Partial data**: show warning chips on affected machines and a detail panel describing missing mappings, missing adjustments, or source sync gaps.

### Mobile Behavior
- Header and freshness badges first.
- Period preset control next, full width.
- Metric cards in two-column grid when width allows; single column on narrow phones.
- Trend chart before machine list.
- Machine comparison becomes stacked rows with value pairs.
- Detail table remains available behind `View rows` or a horizontally scrollable table only after the summary content.

## Partner Dashboard View
### Job To Be Done
Help Bloomjoy and future partner viewers understand the settlement outcome for a partnership period, trust the math, and generate or review the formal PDF.

### Top-Level Hierarchy
1. **Settlement answer**
   - Primary number: `Amount owed` for the selected partnership and period.
   - Admin status: `Preview`, `Blocked`, `Ready for review`, `Generated`, `Reviewed`, or `Downloaded`.
   - Partner-facing status: current period, finalized period, or report not available yet. Do not expose internal warning labels to partner viewers.
   - Period and partnership name.
   - Snapshot ID when generated.
2. **Calculation strip**
   - `Gross sales`
   - `Tax impact`
   - `Fees/costs`
   - `Net sales`
   - `Split base`
   - `Partner share`
   - `Bloomjoy retained share`
3. **Trust panel**
   - Last import, latest sale date, rule version, tax method, fee basis, split basis, and generated by.
4. **Machine rollups**
   - Machine label, location, sales dollars, sales volume, week-over-week movement, monthly movement, gross sales, tax, fee/cost deductions, net sales, split base, and partner owed.
5. **Calculation transparency**
   - Plain-language formula.
   - Expandable detail for taxes, paid-order fees, no-pay orders, refunds/adjustments, costs, and split percentages.
6. **PDF review workflow**
   - Preview, admin-only warnings, generate snapshot, review PDF metadata, download, and manual send handoff.

### Partner Performance Views
Partners need to understand machine performance before settlement math. The Partner dashboard should support:
- Weekly view by default, using the partnership's completed reporting week.
- Week-over-week comparison for each machine and the partnership total.
- Monthly view for broader trend review, with month-to-date and completed-month options.
- Sales dollars and sales volume side by side:
  - Dollars: gross sales, net sales, and amount owed.
  - Volume: units sold, sticks/items sold, paid orders, and no-pay orders when available.
- Machine-level performance table:
  - Machine, location, current-week volume, current-week dollars, previous-week volume, previous-week dollars, change in dollars, change in volume, month-to-date dollars, month-to-date volume, and amount owed.
- Trend visuals:
  - Weekly dollars and volume over the last 8-12 completed weeks.
  - Monthly dollars and volume over the last 6-12 months once enough data exists.
- A simple "what changed" summary:
  - Top growing machine.
  - Softest machine.
  - Highest-volume machine.
  - Any machine with zero sales in the selected period.

### Financial Labels
Use neutral, durable labels:
- Gross sales.
- Tax impact.
- Fees.
- Costs.
- Net sales.
- Split base.
- Partner share.
- Bloomjoy retained share.
- Amount owed.

Avoid example-specific names in the reusable UI. Partner-specific names may appear only as selected partnership/participant labels.

### Partner Dashboard Controls
- Partnership selector.
- Period preset defaults to the last completed partnership reporting week.
- Week-ending date must respect the partnership's configured week-ending day.
- View mode supports `Weekly`, `Month to date`, and `Completed month`.
- Date range is read-only for generated snapshots and editable for previews.
- Machine filter supports all partnership machines or a selected subset for browser review only.
- Admin-only warning filter: all, blocking, non-blocking, resolved.
- `Generate PDF snapshot` is disabled when blocking warnings exist. Partner viewers never see the warning filter.

### Admin-Only Warning Model
Warnings are internal data-quality and setup tasks. They should be visible only to super-admins or future users with reporting-management permissions. Partner viewers should not see warning labels, warning counts, warning ledgers, or admin fix links.

Warnings should be resolved or consciously accepted by admins before financial numbers are trusted. Blocking warnings prevent PDF generation and prevent partner-facing publication.

Blocking warnings:
- Missing machine tax rate for a sale date.
- Missing active partnership assignment.
- Missing active financial rule.
- Stale or failed source import for the period.
- Unmapped Sunze machine rows that affect the partnership period.
- Generated snapshot mismatch with current preview inputs.

Non-blocking warnings:
- No sales for one assigned machine in the period.
- Refund/adjustment source unavailable when sales facts are otherwise current.
- Partner recipient metadata missing for future scheduled delivery.
- Manual send not recorded after download.

Warning rows should include:
- Severity.
- Affected machine or partnership.
- Plain-language issue.
- Financial impact if known.
- Admin fix location when the viewer is a super-admin.
- Whether PDF generation is blocked.

Partner-facing behavior:
- If blocking warnings exist, partner viewers see no report for that period yet, with neutral copy such as `This report is not available yet.`
- If non-blocking warnings exist but admins decide the report is ready, the partner-facing dashboard and PDF should present only the polished report content, assumptions, and source context, not the internal warning language.
- A generated partner PDF must not include warnings, warning summaries, warning counts, or warning ledgers.

### Empty, Loading, Error, And Stale States
- **No partner access**: hidden view switcher; user stays in operator view.
- **Super-admin no partnership selected**: show partnership selector and a concise setup checklist.
- **No configured partnerships**: link super-admin to `/admin/partnerships`; future partner viewers see "No partner dashboards are available yet."
- **No machines in partnership**: explain that a dashboard needs assigned machines before reporting can run.
- **No sales in selected period**: show zero-state math with the selected period and keep PDF generation disabled unless business rules explicitly allow zero reports.
- **Loading preview**: skeleton settlement answer, calculation strip, and machine rows.
- **Preview error**: keep controls visible, show retry, and include the backend message only in a details disclosure.
- **Stale data**: super-admins see a prominent freshness warning and PDF generation is blocked if stale data affects the selected period. Partner viewers see no finalized report until the period is ready.

## PDF Export And Review Flow
### V1 Flow
1. Super-admin selects Partner dashboard, partnership, and reporting period.
2. System loads an admin browser preview with calculation strip, weekly/monthly machine performance, freshness state, and admin-only warnings.
3. Super-admin resolves blocking warnings or changes the period/partnership.
4. Super-admin clicks `Generate PDF snapshot`.
5. System creates an immutable snapshot/run with reporting period, rule version, assumptions, generated-by user, status, storage path, internal warning metadata, and snapshot ID.
6. System opens a review dialog or drawer showing:
   - Snapshot ID.
   - Generated timestamp.
   - Generated by.
   - Period.
   - Partnership.
   - Amount owed.
   - Weekly and monthly performance summary.
   - Download action.
   - Manual send checklist.
7. Super-admin downloads the PDF and sends it outside Bloomjoy Hub for V1.
8. UI records or displays manual send status only if/when that audit field exists. Do not imply automated delivery in V1.

### Review Statuses
- `Preview`: browser-only calculation, not a formal artifact.
- `Blocked`: preview has blocking warnings.
- `Generating`: snapshot/PDF generation is in progress.
- `Generated`: PDF exists and can be reviewed/downloaded by super-admin.
- `Reviewed`: super-admin has confirmed the snapshot is ready to send.
- `Downloaded`: PDF was downloaded for manual send.
- `Failed`: generation failed; show retry and error detail.

### Browser Dashboard vs PDF Appendix
Browser dashboard:
- Current preview and selected filters.
- Amount owed.
- Weekly and monthly sales dollars.
- Weekly and monthly sales volume.
- Summary calculations.
- Freshness state.
- Admin-only warning state.
- Machine-level rollup table.
- Expandable formula explanation.
- PDF generation/review controls.

PDF main body:
- Bloomjoy-branded cover/summary.
- Partnership and reporting period.
- Amount owed.
- At-a-glance performance summary for the machines that roll up to the partner.
- Week-over-week sales dollars and sales volume.
- Monthly sales dollars and sales volume.
- Gross sales, tax impact, net sales, fees/costs, split calculation.
- Snapshot ID and generated timestamp.

PDF appendix:
- Machine-level rollups.
- Weekly and monthly machine performance in dollars and volume.
- Calculation assumptions.
- Rule version.
- Tax rates used by machine and date range.
- Fee/cost basis.
- No-pay/refund/adjustment treatment.
- Source freshness and import reference summary.

The PDF should feel like a polished partner settlement and performance report. The intended reaction is: this tells me exactly what I need at a glance, and the details give me confidence in the numbers. It should not contain internal warnings. If unresolved blocking issues would make the report look caveated or unprofessional, the correct behavior is to prevent generation until the admin resolves them.

## Implementation Guidance
### Recommended Sequence
1. Keep the current operator `/portal/reports` working while improving copy, controls, and states.
2. Add internal permission plumbing for `canViewPartnerDashboard`, returning true for super-admin only in V1.
3. Add the two-mode switch only when `canViewPartnerDashboard` is true.
4. Add Partner dashboard using read-only preview data first.
5. Add PDF snapshot generation and review workflow after issue `#169` defines the snapshot/run backend.
6. Add future `partner_viewer` support only after explicit partner-dashboard permissions exist.

### Data Contracts To Confirm Before Coding
- Whether partner preview data comes from an RPC dedicated to partnership weekly reports or from a snapshot table once generated.
- Whether units sold means orders, sticks/items, or both for partner reporting, and which volume metric partners should see first.
- How weekly and monthly partner performance should be represented in the backend response.
- Whether zero-sales reports should be generatable.
- Whether manual send status is tracked in V1 or only handled outside the app.
- How admin-only warning severity is represented by the backend.

### Non-Goals For This UX Slice
- No new reporting platform, CMS, or headless reporting service.
- No direct production data model changes.
- No partner portal invitation flow.
- No scheduled auto-email in V1.
- No editing of admin partnership setup UX owned by PR `#167`.
- No changes to Sunze ingestion/admin reporting internals owned by PR `#161`.

## Acceptance Criteria
### Reporting IA
- Reporting-entitled users can understand the Reporting tab as a machine performance workspace.
- Users with only machine reporting access do not see partner dashboard controls.
- Users with partner-dashboard visibility can switch between operator and partner views without leaving `/portal/reports`.
- The view switcher is hidden, not disabled, when partner-dashboard access is absent.

### Operator View
- Shows assigned-machine performance only for machines the user can access.
- Includes period controls, date range, grain, location, machine, and payment filters.
- Shows sales, units/items, trends, machine comparisons, freshness, and export action.
- Handles no access, no machines, no sales, loading, error, stale, and partial-data states.
- Mobile layout keeps the summary, controls, chart, machine rows, and detail rows readable without horizontal page overflow.

### Partner Dashboard
- V1 access is super-admin only.
- Future partner access is explicit `partner_viewer` permission scoped to partnership.
- Shows amount owed, gross sales, tax impact, net sales, fees/costs, split base, partner share, Bloomjoy retained share, and machine rollups.
- Shows machine sales in both dollars and volume week over week, with a monthly view.
- Explains the calculation in plain language and exposes detailed assumptions through progressive disclosure.
- Clearly distinguishes preview calculations from generated PDF snapshots.
- Shows internal warnings only to admins or reporting managers.
- Blocks PDF generation when blocking warnings affect the selected period.

### PDF Review
- Super-admin can preview the period before generating a PDF.
- Generated PDF workflow exposes snapshot ID, generated timestamp, generated-by user, weekly/monthly performance summary, download action, and manual send handoff.
- Browser dashboard remains the interactive review workspace.
- PDF remains the formal branded settlement and performance artifact with appendix-level calculation detail.
- PDF does not include warnings, warning summaries, warning counts, or warning ledgers.

### Coordination
- This artifact is additive and does not edit active admin files touched by PR `#167`.
- This artifact does not edit reporting ingestion, admin reporting, migrations, or Edge Functions touched by PR `#161`.
- This artifact builds on the roadmap docs merged in PR `#168` without rewriting them.
