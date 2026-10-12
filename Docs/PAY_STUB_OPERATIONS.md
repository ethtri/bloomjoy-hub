# Automatic Pay Stub operations

Monthly Technician editing closes at midnight Pacific on day five. The dedicated
`pay-stub-generation-v1` cron runs every minute and calls `pay-stub-generator`.
The worker uses existing immutable PDF storage and publication transactions.
No portal visit, manager approval, payment action or email delivery is required.

The scheduler credentials are encrypted in Vault under `pay_stub_scheduler_url`
and `pay_stub_scheduler_secret`. The service-only authorization RPC verifies the
incoming scheduler secret; neither client code nor logs receive its value.
Only the database owner can configure or dispatch the private scheduler.

## Deploy and enable

1. Verify install/build/test/lint, the Pay Stub validator, full disposable migration
   replay and desktop/mobile manager/Technician verification. Compare live Auth
   before and after deployment using the existing production runbook checks.
2. Reconcile deployed migration versions exactly; do not reapply the older
   verified-zero/publication migrations already recorded in production.
3. Apply the explicit-payer and automatic-recovery migrations, deploy the reviewed
   `pay-stub-generator` and its full shared dependency tree with its existing
   custom-authentication setting, then complete authorized payer corrections.
4. As database owner, call
   `select private.configure_pay_stub_scheduler('<confirmed-project-ref>',true);`
   The function generates a dedicated secret if absent, retains it on replay and
   sets the one-minute clock. It checks the existing configured project host.
5. Verify cron status, HTTP response, generation request outcomes, issued PDF
   objects, correct payer identity and authorized Technician downloads. Inspect
   aggregate-only evidence; keep contractor data outside GitHub artifacts.

## Recovery and revisions

A failed PDF receives a bounded exponential retry delay, while calculation
exceptions retry every fifteen minutes. A processing lease older than ten
minutes becomes recoverable. Only the latest unresolved request is retried;
completed publication prevents duplicate first statements. Each worker claims
one request at a time and drains within its runtime budget.

Use the existing **Regenerate Pay Stub** action after correcting time, rates or
other inputs. Older PDF objects remain immutable. A late first publication or
earlier revision schedules affected later statements in calendar order so their
YTD can refresh. Failed attempts do not clear the existing stale indicators.

To pause the scheduler for a demonstrated incident, use
`select cron.alter_job((select jobid from cron.job where jobname='pay-stub-generation-v1'),active:=false);`
Preserve existing queued work, issued statements and Vault credentials. Restore
the prior reviewed worker and function definitions for rollback; review recorded
private correction before-state before reversing any payer change. Re-enable
only after the same verification succeeds.
