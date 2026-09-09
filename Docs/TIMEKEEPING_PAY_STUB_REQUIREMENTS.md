# Timekeeping and Pay Stub MVP Requirements

## Product outcome

Replace Bloomjoy's technician Google Form, manual Google Sheets compilation, and manually exported monthly PDFs with one simple portal workflow:

1. Technicians record actual time by machine.
2. Managers see and correct the resulting monthly pay report.
3. The system calculates paid shifts and commission transparently.
4. The system automatically publishes monthly contractor Pay Stubs.
5. Technicians view and download their own historical Pay Stubs.

The MVP is a lightweight timekeeping and contractor-statement product. It is not a payroll processor, payment service, tax-withholding engine, or tax-form generator.

## People and access

### Technician

- Every active Technician has access to Timekeeping and Pay Stubs.
- A Technician can see and change only their own time and can select only machines in their effective assignment scope.
- A Technician can view and download only their own published Pay Stubs.

### Authorized manager

- A manager sees Technicians and machines only within the manager's effective scope.
- A manager can view and correct time entries before or after the Technician cutoff without approving entries or entering a correction reason.
- When a Technician misses the cutoff entirely, a manager can add the missing completed-time entry on the Technician's behalf using the same historical assignment, future-time, overlap, and per-entry shift rules, even if that Technician is now inactive. The action records the manager and before/after audit evidence without requiring an approval or written reason.
- A manager can maintain authorized pay inputs, investigate generation exceptions, and regenerate affected Pay Stubs.
- Sensitive pay configuration and statement access must remain within the existing owner/scoped-manager authorization boundary.

## Timekeeping

### Technician experience

- The primary experience is a mobile-friendly weekly calendar.
- Each entry requires a work date, one assigned machine, an actual start time, and an actual end time.
- Time is entered after the work is completed; the MVP has no live timer or clock-in/clock-out mode.
- The calendar shows each entry's actual duration and calculated paid shifts before saving and after saving.
- Before the monthly cutoff, a Technician can add, edit, or delete their own entry.
- No entry has an approval, rejection, submitted-for-review, or returned state.

### Validation and shift calculation

- End time must be after start time and a completed entry must contain positive worked minutes.
- A Technician cannot have overlapping entries, including entries for different machines. Touching boundaries are allowed: an entry ending at 10:00 does not overlap one starting at 10:00.
- A **shift** is a one-hour pay unit calculated independently for each machine-specific entry:

  `paid shifts = ceiling(actual worked minutes / 60)`

- Examples: 1-60 minutes is 1 shift; 61-120 minutes is 2 shifts; three separate 20-minute machine entries are 3 shifts.
- The system stores actual start/end time and the calculation inputs; it does not replace actual time with the rounded shift value.
- Date and cutoff behavior use `America/Los_Angeles` unless Bloomjoy later adopts an explicit per-account operating timezone.

### Monthly cutoff

- Pay periods are calendar months.
- Technician editing closes at 11:59 p.m. Pacific on the fourth calendar day after month-end. December entries, for example, remain Technician-editable through January 4 at 11:59 p.m. and lock at the start of January 5.
- Managers retain correction access after the Technician cutoff.
- Manager correction access includes adding an entirely missing entry, not only editing an entry that already exists.
- Every manager correction retains before/after audit history even though no written reason is required.
- A voided monthly pay period rejects Technician and manager time-entry writes atomically. Managers must reopen or replace the pay period before correcting its time.

## Compensation inputs and calculations

### Shift earnings

- The shift rate belongs to the Technician and is effective-dated.
- Each entry uses the rate effective on its work date.
- Shift earnings equal paid shifts multiplied by the applicable per-shift rate.
- If a rate changes during a month, the manager report and Pay Stub separate the shift quantities and earnings by rate rather than presenting one misleading blended calculation.

### Commission

- Commissionable sales come from Bloomjoy's authoritative machine reporting facts; Technicians do not enter sales manually.
- The period includes eligible sales from the machines in the Technician's effective compensation scope for the applicable dates.
- The commission rate is an effective-dated compensation rule. A machine-specific override is used only where one is explicitly configured; otherwise the Technician's default rate applies.
- Commission is calculated per machine and then totaled so assignment windows, rate changes, and machine-specific rules remain accurate.
- The manager report and Pay Stub identify the sales measure consistently as **Commissionable Sales** and separately show the sales basis, commission rate, and resulting commission.
- Refund or reporting adjustments that affect the existing eligible-revenue snapshot affect commission once and remain visible in the source report; they are not silently deducted again on the Pay Stub.

### Other earnings and credits

- The MVP supports the categories present in Bloomjoy's current manual Pay Stubs: Bonus, Supply Credit, and Expense Reimbursement.
- An authorized manager enters or configures these items; Technicians do not add them through Timekeeping.
- Each item has a Technician-visible description and amount. A recurring supply credit may be effective-dated rather than re-entered every month.
- Adding or correcting one of these items does not create an approval workflow. Existing audit history for compensation changes remains in place.

## Manager monthly pay report

- The report defaults to the current pay period and supports selecting another calendar month.
- Managers can filter by Technician and machine.
- For each Technician, the report shows:
  - actual worked time;
  - paid shifts;
  - shift rate and shift earnings;
  - machine sales, refunds, estimated sales tax, commissionable sales, commission rate, and commission;
  - bonus, supply credit, expense reimbursement, or other authorized adjustments;
  - current-period total; and
  - any missing or stale input that prevents accurate publication.
- The report provides a machine breakdown of actual time, paid shifts, sales, refunds, estimated sales tax, commissionable sales, and commission contribution. Commissionable sales equal `sales - refunds - estimated sales tax`; commission equals that nonnegative basis multiplied by the Technician's effective commission rate. Sales tax uses the effective machine tax rate on each sale date and rounds to cents per machine/day. A missing tax rate on a date with sales blocks publication, while an explicit `0%` rate is valid.
- Managers correct source time or compensation inputs from the report context. There is no per-entry or monthly approval action.
- Publishing a Pay Stub does not mark a person paid and requires no proof of payment.

## Pay Stub generation and content

### Automatic publication

- At the start of the fifth calendar day after month-end, the system idempotently generates and publishes one Pay Stub for each payable Technician whose required inputs are complete.
- Publication is automatic and does not wait for manager approval or payment evidence.
- Missing rates, unresolved assignment scope, unavailable required sales data, or another calculation-blocking condition creates a manager-visible exception and is retried safely; the system does not publish a knowingly incomplete or misleading Pay Stub.

### Pay Stub presentation

- The user-facing name is **Pay Stub**.
- The layout follows the clear one-page hierarchy of the owner-provided July 2026 reference PDFs, with additional detail when a Technician has multiple machines or rates.
- The header shows Bloomjoy as payer plus the contractor's ID, name, email, and position/title.
- The period section shows period beginning, period ending, and **Statement Date**. A payment method may be shown as informational profile data, but the MVP does not show a Payment Date or otherwise assert that payment occurred.
- The earnings section shows, as applicable:
  - Regular: actual worked time, paid shifts, shift rate, current earnings, and year-to-date earnings;
  - Commission: commissionable sales, commission rate, current commission, and year-to-date commission;
  - Bonus;
  - Supply Credit; and
  - Expense Reimbursement.
- A commission appendix shows each machine's sales, refunds, effective tax rate and estimated tax, commissionable sales, effective commission rate, and resulting commission without exposing unrelated machines or another Technician's data.
- The statement shows a current-period total and calendar-year-to-date total. Empty optional categories are omitted or consistently shown as zero; the same rule applies throughout the product.
- Contractor profiles receive the current independent-contractor/no-withholding notice. Worker classification and notice selection are profile-driven rather than hard-coded globally; the initial recipient population is entirely contractors.
- Dates, currency, quantity labels, spelling, and rounding are consistent. The mixed manual-sheet label `Hours / Sales` is replaced by explicit **Paid Shifts** and **Commissionable Sales** labels.

### Regeneration and history

- An authorized manager can regenerate a Pay Stub after correcting time, machine scope, a rate, sales inputs, or another compensation item.
- If time changes after the current Pay Stub calculation was generated, Pay Reports persistently marks that Technician's stub as needing regeneration until a newer version is published. Freshness is based on a monotonic audited source revision serialized with statement calculation, so transaction timing cannot make an omitted change appear current. A machine-only manager is told to contact an account pay manager rather than being given pay access.
- Regeneration creates an immutable new version and never overwrites the previously published artifact.
- The newest published version is the current Technician copy and is clearly labeled when revised.
- When an earlier period changes, that period and every later issued statement in the same calendar year are explicitly held as stale until each affected statement is recalculated and republished as a new version. Successfully regenerating the earlier month does not by itself clear later statements, and a failed regeneration clears nothing.
- A midyear launch supports manager-entered opening year-to-date balances so the first portal-generated statement can continue the totals from prior manual statements.
- Technicians see a newest-first history by pay period and can view or download the current published PDF for each period. Superseded versions remain available only to authorized managers for audit purposes.

## Privacy, audit, and failure behavior

- Time, pay rates, sales attribution, compensation, and Pay Stubs are private and fail closed outside the existing Technician and manager scopes.
- Pay Stub files use private storage and short-lived authorized download access.
- Direct requests for another Technician's statement, an unpublished draft, or an unauthorized superseded version fail without revealing whether the artifact exists.
- Automatic generation and regeneration are idempotent and leave an auditable outcome. A retry cannot create duplicate current statements or double-count an adjustment.

## Explicit non-goals

- Manager approval of time or a monthly pay run
- Live clock-in/clock-out tracking
- Payment execution, direct deposit, or proof-of-payment collection
- Tax withholding or payroll tax calculations
- Tax filing, W-2 generation, or 1099 generation
- Benefits, leave, overtime, scheduling, or a general HR system

## MVP acceptance summary

The MVP is ready for a controlled Technician pilot when a Technician can record machine-specific time in the weekly calendar, the expected per-entry rounding and overlap rules are enforced, an authorized manager can reproduce shifts and commission from the monthly report, automatic post-cutoff generation produces an accurate private Pay Stub matching the agreed information hierarchy, regeneration preserves versions and year-to-date integrity, and the Technician can retrieve only their own historical statements.
