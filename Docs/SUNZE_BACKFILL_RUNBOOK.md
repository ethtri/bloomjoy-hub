# Sunze Sales Backfill Runbook

Date: 2026-05-01

Purpose: establish an all-machine Sunze sales baseline from `2025-08-01` forward without committing raw provider workbooks.

## Safety rules

- Keep raw `.xlsx` / `.zip` order exports outside the repo and outside CI artifacts.
- Do not paste order numbers, raw rows, credentials, or source workbook contents into docs, issues, PRs, or chat.
- Use monthly chunks with explicit `--date-start` and `--date-end`.
- Default parser behavior still rejects out-of-window rows. Use `--filter-date-window` only for manually provided multi-month files with `--parse-file`.

## Verify production coverage

Run these in an approved production SQL console.

```sql
with months as (
  select generate_series(
    date '2025-08-01',
    date_trunc('month', current_date)::date,
    interval '1 month'
  )::date as month_start
),
mapped as (
  select
    date_trunc('month', sale_date)::date as month_start,
    count(*) as mapped_rows,
    count(distinct reporting_machine_id) as mapped_machines,
    sum(net_sales_cents) as mapped_net_sales_cents
  from public.machine_sales_facts
  where source = 'sunze_browser'
    and sale_date >= date '2025-08-01'
  group by 1
),
unmapped as (
  select
    date_trunc('month', sale_date)::date as month_start,
    count(*) as pending_unmapped_rows,
    count(distinct lower(sunze_machine_id)) as pending_unmapped_machines,
    sum(net_sales_cents) as pending_unmapped_net_sales_cents
  from public.sunze_unmapped_sales
  where sale_date >= date '2025-08-01'
    and status = 'pending'
  group by 1
)
select
  months.month_start,
  coalesce(mapped.mapped_rows, 0) as mapped_rows,
  coalesce(mapped.mapped_machines, 0) as mapped_machines,
  coalesce(mapped.mapped_net_sales_cents, 0) as mapped_net_sales_cents,
  coalesce(unmapped.pending_unmapped_rows, 0) as pending_unmapped_rows,
  coalesce(unmapped.pending_unmapped_machines, 0) as pending_unmapped_machines,
  coalesce(unmapped.pending_unmapped_net_sales_cents, 0) as pending_unmapped_net_sales_cents
from months
left join mapped using (month_start)
left join unmapped using (month_start)
order by months.month_start;
```

Then check recent import metadata:

```sql
select
  created_at,
  completed_at,
  status,
  rows_seen,
  rows_imported,
  rows_skipped,
  meta->>'sourceWindowStart' as source_window_start,
  meta->>'sourceWindowEnd' as source_window_end,
  meta->>'filteredWindowStart' as filtered_window_start,
  meta->>'filteredWindowEnd' as filtered_window_end,
  meta->>'outOfWindowRowCount' as out_of_window_row_count
from public.sales_import_runs
where source = 'sunze_browser'
  and created_at >= now() - interval '14 days'
order by created_at desc
limit 20;
```

## Use the Jan-Apr local source

Local source found: `C:\Users\ethtr\Downloads\Order Record-1776995822749.xlsx`.

Expected source window: `2026-01-01` through `2026-04-19`.

Dry-run each monthly chunk from the worktree. Replace `path\to\local.env` with a local env file that contains only approved server-side ingest settings.

```powershell
npm run reporting:provider-sync -- --env-file path\to\local.env --parse-file "C:\Users\ethtr\Downloads\Order Record-1776995822749.xlsx" --date-start 2026-01-01 --date-end 2026-01-31 --filter-date-window --dry-run
npm run reporting:provider-sync -- --env-file path\to\local.env --parse-file "C:\Users\ethtr\Downloads\Order Record-1776995822749.xlsx" --date-start 2026-02-01 --date-end 2026-02-28 --filter-date-window --dry-run
npm run reporting:provider-sync -- --env-file path\to\local.env --parse-file "C:\Users\ethtr\Downloads\Order Record-1776995822749.xlsx" --date-start 2026-03-01 --date-end 2026-03-31 --filter-date-window --dry-run
npm run reporting:provider-sync -- --env-file path\to\local.env --parse-file "C:\Users\ethtr\Downloads\Order Record-1776995822749.xlsx" --date-start 2026-04-01 --date-end 2026-04-19 --filter-date-window --dry-run
```

For every dry run, verify the JSON output includes:

- `sourceRowsParsed`, `sourceMachineCount`, `sourceWindowStart`, `sourceWindowEnd`
- `filteredRowsParsed`, `filteredMachineCount`, `filteredWindowStart`, `filteredWindowEnd`
- `outOfWindowRowCount`
- `rowsQuarantined`, `unmappedRowsQueued`, and pending unmapped machine counts when ingest validation is configured

After dry-runs pass, rerun the same monthly commands without `--dry-run` to import. Re-run the production coverage SQL after import and resolve any pending unmapped machines in `/admin/reporting`.

## Missing Aug-Dec 2025 source

If production coverage is missing or low for `2025-08-01` through `2025-12-31`, request an all-machine Sunze Orders export for that exact range.

Preferred request:

- One export per calendar month from August 2025 through December 2025, or one multi-month workbook if monthly exports are unavailable.
- Orders export only, all machines, no machine filter.
- Store the file outside the repo, then dry-run monthly chunks with `--parse-file`, `--date-start`, `--date-end`, and `--filter-date-window`.

Do not proceed to live import for missing months until the dry-run output proves the source window covers the requested month and ingest validation has no unexpected quarantine/unmapped indicators.
