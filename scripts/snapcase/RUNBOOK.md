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
