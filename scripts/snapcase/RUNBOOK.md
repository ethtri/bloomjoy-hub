# SnapCase import runner

The production runner stages private observations, finalizes acknowledged
per-machine payment windows, and publishes normalized Kexiaozhan cash for
existing mappings. Nayax remains card authority.

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

## Private staging run

The operator must deliberately provide `--live-provider --ingest` together and
configure these server or GitHub environment values privately:

- `KEXIAOZHAN_REPORTING_USERNAME`
- `KEXIAOZHAN_REPORTING_PASSWORD`
- `SNAPCASE_ACCOUNT_KEY`
- `REPORTING_ROW_HASH_SALT`
- `SNAPCASE_INGEST_URL`
- `REPORTING_INGEST_TOKEN`
- `SNAPCASE_NONFINANCIAL_TEST_PAYMENT_SOURCE_KEYS` (optional, comma-separated
  account-scoped HMAC source keys for individually verified nonfinancial test
  payments; leave empty by default)
- `SNAPCASE_USD_INTERPRETATION_PAYMENT_SOURCE_KEYS` (optional, comma-separated
  account-scoped HMAC source keys for owner-verified cash payments whose raw
  `AUD`/`A$` marker is retained but whose amount is interpreted as USD; leave
  empty by default)

The Edge Function also needs the standard server-only `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and existing `REPORTING_INGEST_TOKEN`. Never use a
`VITE_` variable for any of them.

```powershell
node scripts/snapcase/sync-snapcase.mjs --live-provider --ingest
```

The CLI sends batches sequentially and reports success only after every batch is
acknowledged with matching counts. A retry reuses the exact batch key and digest.
Errors expose only a bounded code.

## Production schedule

`SnapCase Sync` is enabled in production at 05:17 and 17:17 UTC. The scheduled
job exits without a provider call if repository variable `SNAPCASE_SYNC_ENABLED`
is absent or not `true`.

The owner or technical operator maintains the encrypted GitHub login secrets. On
a provider-credential incident, set `SNAPCASE_SYNC_ENABLED` to `false`, replace
the provider password and matching GitHub secret, verify one routine import, and
then re-enable the schedule. Do not rotate `REPORTING_ROW_HASH_SALT` as ordinary
password maintenance, because it defines stable source identities. Do not change
the shared `REPORTING_INGEST_TOKEN` in only one consumer.

## Exact machine identity repair

Use `repair-machine-identities.mjs` only after read-only evidence proves an exact
SnapCase source and canonical Hub machine pair. Keep the manifest in an ignored
`*.local` file. Each entry records the composite source identity, current mapping,
canonical target, account, location, machine type, Nayax ID, effective window,
and the current machine ID needed for rollback. The runner accepts no more than
six unique pairs and requires a null partnership so it cannot create or extend a
reporting assignment.

Configure a short-lived super-admin session privately as
`SUPABASE_ADMIN_ACCESS_TOKEN`, together with `SUPABASE_URL` and
`SUPABASE_ANON_KEY`. Preview the complete manifest first; this performs no writes:

```powershell
node scripts/snapcase/repair-machine-identities.mjs --manifest scripts/snapcase/snapcase-machine-identity-repair.local
```

Review the printed before, after, and rollback machine IDs. After the migration
is released and the dry run still passes, apply that same manifest explicitly:

```powershell
node scripts/snapcase/repair-machine-identities.mjs --manifest scripts/snapcase/snapcase-machine-identity-repair.local --apply
```

The runner reuses `admin_map_snapcase_machine`; its existing mapping trigger
removes overlapping completion receipts and asks the finalizer to recreate only
the windows that remain complete after reprojection. Receipt UUIDs and completion
timestamps may therefore change. The source/window/timezone/count/digest/batch
evidence must remain equal, along with fact IDs, hashes, amounts, mapping identity,
and `mapped_at`. Re-run the preview afterward. For a rollback, swap the target
controls to the printed rollback machine and keep the same effective mapping
window. A native SnapCase rollback target may use a null expected Nayax ID; its
exact account, location, type, and null Sunze/Nayax identities still have to pass
the bounded preflight. Do not manually delete source observations, sales facts,
receipts, assignments, compensation, tax rows, or access grants.

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
The same completed-window finalization and mapped cash-publication path applies.
A successful full routine `live-ingest` rerun clears a prior scheduled failure in
the next health check. A smaller date-scoped rerun does not, because GitHub run
metadata cannot prove that it covered the entire failed routine window.

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

After activation, GitHub Actions can run the same history path by manually
starting `SnapCase Sync`, choosing `history-backfill`, and supplying both
`date_start` and `date_end`. The existing concurrency group keeps this run from
overlapping routine sync. The runner processes monthly windows sequentially and
marks a window delivered only after every batch is acknowledged. Historical
backfills are separate from routine recovery health and cannot clear a failed
scheduled import.
