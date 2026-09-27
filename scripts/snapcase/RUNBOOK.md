# SnapCase staging runner

This runner is inactive by default. When explicitly activated, it stages private
observations, finalizes acknowledged per-machine payment windows, and publishes
normalized Kexiaozhan cash for existing mappings. Nayax remains card authority.

## Local synthetic check

Run without credentials or network access:

```powershell
node scripts/snapcase/sync-snapcase.mjs
node --test scripts/snapcase/*.test.mjs
deno test --no-lock supabase/functions/snapcase-data-ingest/handler.test.ts
```

The first command uses the checked-in synthetic fixture and performs no write.
Its output contains extraction counts plus completed-window and published-cash
counts. A dry run reports zero publication counts and performs no write.

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

## Historical backfill

The historical runner defaults to a fixture-only dry run from `2025-01-01`.
It queries sales account-wide in bounded monthly windows for retired/unlisted
discovery and also queries every current inventory machine separately so its
machine-local historical payment windows can publish and prove zero rows.

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
The separate per-machine payment receipts are the only historical completion
input. Unknown historical machines without persisted timezone/mapping context
remain staged exceptions until ordinary machine mapping data becomes available.
Receipt bounds record the actual half-open request (`start 00:00:00` through the
next day after the inclusive window end at `00:00:00`). `requestedTimezone`
records the request header only and is not treated as proof of source clock
conversion.
