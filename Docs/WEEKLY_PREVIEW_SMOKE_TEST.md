# Weekly Preview Authenticated Smoke Test

## Purpose
Use this smoke path to verify the admin partner Weekly Preview before relying on reviewed partner PDF reporting.

This is an authenticated super-admin QA path for `/admin/partnerships?partnershipId=<id>&step=preview`. It covers the happy path for week ending `2026-04-19` and the three common blank-preview warning states: no assignment coverage, no active payout rule, and no imported facts.

Do not commit production credentials, raw provider workbooks, service-role keys, or private partner/customer exports. If a fixture ID or test account is sensitive, share it in the UAT packet instead of committing it.

## Fixture Requirements
The happy-path fixture should be a test or launch partnership with:

- `reporting_week_end_day = 0` so the report week ends on Sunday.
- Active machine assignments covering the full week `2026-04-13` through `2026-04-19`.
- An active payout rule covering the same full week.
- At least one assigned machine with imported sales facts between `2026-04-13` and `2026-04-19`.
- Bubble Planet-style assumptions when validating launch math: sales-source order amount as gross, configured machine tax, `$0.40` per-stick fee before split, and the configured partner/Bloomjoy split.

If the happy-path fixture returns no rows, treat the smoke as blocked. Fix the setup dates, payout-rule coverage, machine mapping, or provider import backfill first; do not pass the smoke by changing the expected date.

## Optional Fixture Qualification Query
Run this only in an approved local, preview, or production admin SQL context. It is for finding a qualifying fixture; it is not a migration.

```sql
with target_week as (
  select date '2026-04-13' as week_start, date '2026-04-19' as week_end
),
qualified as (
  select
    partnership.id as partnership_id,
    partnership.name as partnership_name,
    count(distinct assignment.machine_id) as assigned_machine_count,
    count(distinct fact.id) as sales_fact_count,
    coalesce(sum(fact.net_sales_cents), 0) as gross_sales_cents,
    coalesce(sum(fact.item_quantity), 0) as item_quantity
  from public.reporting_partnerships partnership
  cross join target_week
  join public.reporting_machine_partnership_assignments assignment
    on assignment.partnership_id = partnership.id
    and assignment.assignment_role = 'primary_reporting'
    and assignment.status = 'active'
    and assignment.effective_start_date <= target_week.week_start
    and (
      assignment.effective_end_date is null
      or assignment.effective_end_date >= target_week.week_end
    )
  join public.reporting_partnership_financial_rules rule
    on rule.partnership_id = partnership.id
    and rule.status = 'active'
    and rule.effective_start_date <= target_week.week_start
    and (
      rule.effective_end_date is null
      or rule.effective_end_date >= target_week.week_end
    )
  join public.machine_sales_facts fact
    on fact.reporting_machine_id = assignment.machine_id
    and fact.sale_date between target_week.week_start and target_week.week_end
  where partnership.status = 'active'
    and partnership.reporting_week_end_day = 0
  group by partnership.id, partnership.name
)
select *
from qualified
where gross_sales_cents > 0
order by gross_sales_cents desc;
```

Pass condition: at least one row returns with `sales_fact_count > 0` and `gross_sales_cents > 0`.

## Happy Path Smoke

1. Start the app from the PR worktree.
   - `npm ci`
   - `npm run dev`
2. Sign in as a super-admin.
3. Open:
   - `http://localhost:8080/admin/partnerships?partnershipId=<qualified_fixture_partnership_id>&step=preview`
4. Set `Week ending` to `2026-04-19`.
5. Click `Preview`.
6. Expected result:
   - The page shows `<partnership name> weekly preview`.
   - The date range reads `2026-04-13 through 2026-04-19`.
   - The status badge is `Ready`.
   - `Orders` is greater than `0`.
   - `Gross sales` is greater than `$0`.
   - `Sales by Machine` shows at least one assigned machine row.
   - Payout metrics use the configured participant names plus `Bloomjoy`.
   - No setup message says `No machines are assigned for this week`.
   - No setup message says `No active payout rule covers this week`.

## Warning State Smokes

Use local or preview fixtures when possible. In production UAT, do not mutate live setup just to create warning states; use an existing fixture/date that naturally exposes the state, or document that the state was verified in a safe environment.

### No Assignment Coverage

1. Open the Weekly Preview step for a partnership/date where no active machine assignments overlap the selected Sunday week.
2. Expected result:
   - The page shows `Preview setup needs attention`.
   - The warning title says `No machines are assigned for this week`.
   - The warning action links to the Machines step.
   - After clicking `Preview`, the page shows `No sales found for this selected week`.
   - The machine coverage card says no active machine assignments overlap the week.

### No Active Payout Rule

1. Open the Weekly Preview step for a partnership/date where at least one assigned machine overlaps the selected Sunday week, but no active payout rule overlaps that week.
2. Expected result:
   - The page shows `Preview setup needs attention`.
   - The warning title says `No active payout rule covers this week`.
   - The warning action links to the Payout Rules step.
   - If sales exist for that week, the preview warning list includes `This report includes sales without an active partnership financial rule.`

### No Imported Facts

1. Open the Weekly Preview step for a partnership/date where assignments and a payout rule cover the selected Sunday week, but no imported sales facts exist for assigned machines in that date range.
2. Expected result:
   - The setup warnings for missing assignments and missing payout rules are absent.
   - After clicking `Preview`, the badge says `No sales`.
   - The page shows `No sales found for this selected week`.
   - The imported sales card shows either the latest assigned-machine sale date or `No imported sales found for assigned machines yet.`
   - The `Check import status` action links to `/admin/reporting`.

## Smoke Result To Record In PRs
Record:

- Environment: localhost, preview, or production UAT.
- Super-admin test persona used, without password.
- Partnership fixture name or safely shared fixture ID.
- Week ending date.
- Happy-path result: order count, gross sales, and machine-row count.
- Warning states verified and where they were verified.
- Any blockers, such as missing provider import backfill, missing mapping, setup dates, or missing payout-rule coverage.
