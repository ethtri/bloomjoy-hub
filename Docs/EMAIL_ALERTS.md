# Machine email alerts

Personal preferences live at `/portal/notifications`, reached from the shared
profile menu and Settings, with shortcuts in Reports and machine details. This
page has its own assignment-based access check, so an eligible technician does
not need Account Settings or Admin access.

## Defaults and scope

Daily operations briefs start on for assigned managers and technicians, at
08:00 America/Los_Angeles. The initial daily scope follows authorized assignments,
including later assignments. Editing the machine selection creates an explicit
set. Saving an opt-out persists it; later assignments do not turn it back on.

All other approved subscriptions start off:

| Alert | Delivery and content |
| --- | --- |
| Daily operations brief | Previous-day performance and refund requests, with totals followed by machine sections. |
| Weekly performance review | Previous-week performance, comparison and machine-level refund requests. Independent of daily settings. |
| New refund request | A newly submitted request on a followed machine, with reported symptoms and the permitted comment excerpt. |
| Refund decision ready | A manager-only opt-in when an assigned case needs a decision. A link opens Hub; email does not approve a refund. |
| Sales unexpectedly quiet | Lower activity against comparable completed periods. Initial supported coverage is cash sales and is labeled accordingly. |
| Nayax connection disconnected | Sustained explicit loss of a previously observed Nayax MQTT connection. This does not establish a machine or payment outage. |

Delivery uses the current account email; this page does not enroll coworkers or
add arbitrary recipients. Daily and weekly have independent times and machine
sets. Quiet hours defer optional alerts and scheduled digests to the next allowed
time. Offline bypass is a separate explicit choice. Reports setup preserves
non-digest preferences, and the machine panel changes only its current machine.

## Reading a digest

Daily and weekly digests start with sales and new refund requests for the selected,
currently authorized machines. Company subtotals use each machine's actual Hub
account, followed by compact machine rows with sales, request count and requested
dollars. The daily period is the previous completed machine-local day; weekly is
the previous completed Monday–Sunday. A request received in the period remains
included even if it has since been resolved. Older open cases do not enter these
period totals or appear as a case backlog in the email.

Sales use canonical tax-exclusive sales before refund deductions. Requested
dollars describe what customers requested at intake, not accounting adjustments,
approved amounts, payments or gift value. Missing amounts stay unknown; partial
subtotals identify their incomplete coverage. Managers and technicians can see
original requested amounts for their authorized machines; sales visibility keeps
its separate permission check. A recent import alone does not prove complete sales
coverage. Weekly comparisons use the same machines with comparable data in both
periods; zero or missing baselines never produce a misleading growth percentage.

Detailed reasons, comments and follow-up work remain in Hub. Optional immediate
request emails retain their authorized operational details and link to the
request in Hub. Technicians can read the selected problem, useful sanitized
customer comment, original requested amount and refund status for assigned
machines. Approval and payment controls remain manager-only; contact/payment
credentials and raw case records are not part of technician read access.
See [the digest design](DIGEST_REDESIGN.md).

Conditional alerts are available only where the source is verified. Cash quiet
alerts require complete Sunze cash-day coverage with a proved time basis, plus
four comparable prior weekdays. A recent successful import alone is insufficient.
Nayax connection alerts require a documented boolean connection observation and
a connected baseline for the same machine mapping before a sustained disconnect.
Missing fields, failed reads and stale observations remain unknown.

## Delivery and verification

Preferences save atomically with a revision check. The sender checks current
assignment, account and preference state again immediately before provider
delivery. Scheduled periods and events have durable unique identities; a second
tick cannot create another email. An uncertain provider outcome remains held for
reconciliation. Test and preview modes must not reserve a delivery or send mail.

The `email-alert-dispatch` Edge Function uses a dedicated server-only
`EMAIL_ALERT_SCHEDULER_SECRET`, with the existing verified
`INTERNAL_NOTIFICATION_FROM_EMAIL` and `RESEND_API_KEY`. Neither the scheduler
credential nor the service-role credential belongs in a browser environment.
The default link origin is `https://app.bloomjoyusa.com`.

Run `npm run email-alerts:test` for template, event and delivery regressions,
`npm run email-alerts:uat -- --app-url <local-url>` for synthetic browser coverage,
and `npm run db:validate-migrations` in the disposable database environment for
actual permissions, scope, scheduling and ledger behavior. Browser fixtures do
not establish database authorization. See the [smoke checklist](QA_SMOKE_TEST_CHECKLIST.md)
and [email alert release runbook](EMAIL_ALERTS_RUNBOOK.md) for release checks.
