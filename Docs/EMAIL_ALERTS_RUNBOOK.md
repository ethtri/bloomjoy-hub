# Machine email alert release

This release implements the owner's daily-only launch direction: assigned
managers and technicians start with a daily brief at 08:00 America/Los_Angeles.
Weekly, new requests, decision-ready, quiet sales and connection alerts start off.
Saved choices remain authoritative. See [EMAIL_ALERTS.md](EMAIL_ALERTS.md) for scope.

## Release checks

Use a clean reviewed branch in its dedicated worktree. Sync current `main` before
the final verification. Require passing build, typecheck, lint, unit tests,
`npm run email-alerts:test`, synthetic browser UAT, independent access/delivery
review and the full disposable database replay. GitHub `Supabase Migrations` is
the replay environment when local Docker is unavailable. Do not substitute a
migration dry run for replay.

Apply the reviewed migrations to project `ygbzkgxktzqsiygjlqyg` with delivery
disabled. Review the exact pending list first:

```sh
supabase link --project-ref ygbzkgxktzqsiygjlqyg --yes
supabase db push --linked --dry-run --include-all
supabase db push --linked --include-all --yes
```

`--include-all` is needed when an independently reviewed newer migration has
already reached production. It is not permission to apply unrelated pending
files or repair migration history. Stop if the pending set differs from the
reviewed release.

## Configure while paused

Generate a dedicated random server-only `EMAIL_ALERT_SCHEDULER_SECRET` (at least
32 base64url characters). Put it in a private ignored environment file, never a
command argument, client variable, PR or log. Set that one secret and deploy only
the new function from the reviewed source:

```sh
supabase secrets set --env-file <private-single-secret-file> --project-ref ygbzkgxktzqsiygjlqyg
supabase functions deploy email-alert-dispatch --project-ref ygbzkgxktzqsiygjlqyg --no-verify-jwt --use-api
```

The function authenticates its dedicated bearer secret itself. It also needs the
existing verified `INTERNAL_NOTIFICATION_FROM_EMAIL` and `RESEND_API_KEY`.
Do not redeploy refund/payment functions or change their credentials for this
release. Remove the temporary secret file once both server copies are configured.

Through a private service-role RPC client, call
`service_configure_email_alert_scheduler` with:

- `p_url`: `https://ygbzkgxktzqsiygjlqyg.supabase.co/functions/v1/email-alert-dispatch`
- `p_secret`: the same dedicated value, read privately from the environment
- `p_enabled`: `false`

This stores the two dedicated Vault values and creates the paused five-minute
`email-alert-dispatch-v1` cron. No secret is embedded in the cron command or returned.

## Verify and activate

1. Confirm `service_email_alert_delivery_status` reports disabled. An authorized
   normal `{}` function request while disabled must return zero claims and sends.
2. Validate the upcoming daily due time through an authorized worker request
   `{"dryRun":true,"previewObservedAt":"<ISO timestamp>"}`. Each request renders
   one complete recipient. While `hasMore` is true, pass the returned `nextCursor`
   unchanged in `{"dryRun":true,"previewCursor":<cursor>}`. Keep the same snapshot,
   require every page to pass, and reconcile accumulated `projectionCount` with
   `totalCandidates`. `page_validated` confirms that page only; `complete` means
   traversal ended, not that an earlier page was validated. Do not log cursors.
   Direct service-RPC diagnostics use `p_observed_at`, `p_limit: 1` and `p_cursor`;
   those projections contain authorized private narratives, so do not print,
   persist or upload them. Record aggregate counts, render sizes and timings only.
3. Authorized dry-run requests must return zero writes/provider calls. Preview
   time/cursor arguments are rejected in normal and observe-only modes. Check
   the largest recipient comfortably fits the existing database time limit;
   do not raise the global timeout to hide repeated queries. Preview reserves no
   work and sends nothing. `{"observeOnly":true}` can collect real source
   evidence but must return zero email claims and sends. Unknown or missing source
   evidence must not become an available alert.
4. Verify missing/invalid bearer requests are rejected, and anonymous or ordinary
   authenticated clients cannot execute service RPCs. Confirm preference RPCs
   enforce the current user's own machine assignments.
5. Verify the production frontend deployment is the exact merged commit, the
   canonical alias is ready, and `/portal/notifications` loads through sign-in.
6. Call `service_set_email_alert_delivery_enabled` with `p_enabled: true` through
   the private service-role client. Verify cron is active and readiness shows
   only daily defaults, with optional subscriptions still off. The first daily
   delivery waits for each person's normal due time; do not force a backfill or
   send a test blast to real users.

After a scheduled tick, check aggregate cron request status, delivery readiness
and job states. Never confuse a dry-run or queued cron request with an email
provider receipt. The next due tick is verified separately from release setup.

## Pause and recovery

Call `service_set_email_alert_delivery_enabled` with `p_enabled: false`. This
pauses the dedicated cron and all adopted optional notification delivery. The
first activation timestamp remains set, so the old manager digest sender cannot
bypass personal preferences during rollback. Customer transactional messages and
refund execution are unaffected.

Keep preferences, jobs, provider-start evidence and legacy batch identities.
`delivery_unknown` is held for reconciliation; do not delete/recreate it or blindly
retry. If needed, restore a known compatible frontend/new-function release while
delivery stays paused. Re-run read-only projection checks before resuming.
