# SnapCase staging runner

This runner is inactive by default. It stages private observations only; it does
not map machines, publish sales, reconcile payments, or prove business coverage.

## Local synthetic check

Run without credentials or network access:

```powershell
node scripts/snapcase/sync-snapcase.mjs
node --test scripts/snapcase/*.test.mjs
deno test --no-lock supabase/functions/snapcase-data-ingest/handler.test.ts
```

The first command uses the checked-in synthetic fixture and performs no write.
Its output contains counts and `businessCoverageStatus: "unverified"` only.

## Future private staging run

The operator must deliberately provide `--live-provider --ingest` together and
configure these server or GitHub environment values privately:

- `KEXIAOZHAN_REPORTING_USERNAME`
- `KEXIAOZHAN_REPORTING_PASSWORD`
- `SNAPCASE_ACCOUNT_KEY`
- `REPORTING_ROW_HASH_SALT`
- `SNAPCASE_INGEST_URL`
- `REPORTING_INGEST_TOKEN`

The Edge Function also needs the standard server-only `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and existing `REPORTING_INGEST_TOKEN`. Never use a
`VITE_` variable for any of them.

```powershell
node scripts/snapcase/sync-snapcase.mjs --live-provider --ingest
```

The CLI sends batches sequentially and reports success only after every batch is
acknowledged with matching counts. A retry reuses the exact batch key and digest.
Errors expose only a bounded code.

## Disabled schedule

`SnapCase Sync` has two UTC triggers per day. The scheduled job exits without a
provider call while repository variable `SNAPCASE_SYNC_ENABLED` is absent or not
`true`. No activation values are configured by this change. Activation, secret
provisioning, deployment, and live imports require a separate reviewed release.

## Import health and recovery

`SnapCase Import Health` runs independently after each expected sync. It checks
GitHub run/job metadata and counts a run as successful only when the private
staging sync step completed. A successful import with no provider rows is healthy;
a disabled no-op schedule is not an import. While `SNAPCASE_SYNC_ENABLED` is
false, both sync and health stay inert.
The existing 30-hour freshness allowance avoids noisy failures for ordinary
GitHub schedule delays; an explicitly failed import still fails health immediately.

Health failures appear as failed GitHub Actions checks and workflow summaries.
Whether a person receives a GitHub notification depends on their repository
notification settings; this slice does not add a separate messaging channel.

For a bounded recovery after activation, manually run `SnapCase Sync`, choose
`live-ingest`, and optionally provide both `date_start` and `date_end`. The same
ACK-checked, idempotent runner is used. A partial delivery fails the run; rerunning
the same window safely upserts the same source observations with a new run key.
The result remains private and business coverage remains unverified.
A successful full routine `live-ingest` rerun clears a prior scheduled failure in
the next health check. A smaller date-scoped rerun does not, because GitHub run
metadata cannot prove that it covered the entire failed routine window.

## Historical backfill

The historical runner defaults to a fixture-only dry run from `2025-01-01`.
It queries sales account-wide in bounded monthly windows so history for retired
or currently unlisted machines is not omitted.

```powershell
node scripts/snapcase/backfill-snapcase.mjs --date-end 2025-03-31
```

An activated private-staging run would additionally require
`--live-provider --ingest`. It writes the local ignored checkpoint
`snapcase-backfill-checkpoint.local` only after every batch for a window has
returned matching acknowledgement counts. Use `--checkpoint <path>` to isolate
different targets or ranges. A resumed run reuses the checkpoint's original end
date when `--date-end` is omitted; an explicit account, target, contract, or
range mismatch fails closed.

Account-wide order/payment receipts use `sourceMachineId: null`. They preserve
the provider's actual pagination totals, including an empty response, while
remaining `businessCoverageStatus: "unverified"`. They do not prove zero sales,
machine operating state, financial meaning, or complete per-machine coverage.
Receipt bounds record the actual half-open request (`start 00:00:00` through the
next day after the inclusive window end at `00:00:00`). `requestedTimezone`
records the request header only and is not treated as proof of source clock
conversion.
