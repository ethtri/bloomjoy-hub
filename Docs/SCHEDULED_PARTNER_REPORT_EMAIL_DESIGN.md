# Scheduled Partner Report Email Design

Issue: [#284](https://github.com/ethtri/bloomjoy-hub/issues/284)

Status: design/spec only. This slice does not implement the scheduler, send email, add Partner Viewer access, or automate sends for reports with blocking warnings.

## Context

Bloomjoy already has two related reporting paths:

- Generic sales report schedules in `report_schedules` / `report_schedule_recipients`, processed by `sales-report-scheduler`. This path creates machine-sales PDFs from generic filters and emails a private signed PDF link.
- Partner report exports in `partner-report-export`, backed by `partner_report_snapshots`. This is the trusted partner settlement path. It generates PDF, CSV, and XLSX artifacts for the same partnership, period, warning state, payout rules, and permissions. Issue [#205](https://github.com/ethtri/bloomjoy-hub/issues/205) added the XLSX export option through PR [#306](https://github.com/ethtri/bloomjoy-hub/pull/306).

The scheduled partner delivery feature should extend the partner report export path, not the older generic machine-sales scheduler. The current generic schedule tables can inform naming and UI placement, but they do not have enough partner-specific scope, run records, idempotency, warning gates, recipient audit history, or retry state for settlement delivery.

Live implementation is gated on acceptance of the reviewed corporate partner PDF reporting milestone in [#169](https://github.com/ethtri/bloomjoy-hub/issues/169). The scheduler should not be enabled for real partner delivery until the reviewed PDF flow is trusted, because scheduled email must not become a path around manual report acceptance.

## Design Principles

- PDF-first for automated partner delivery. XLSX and CSV remain manual reconciliation exports unless a separate approval expands automated delivery.
- Explicit recipients only. Do not infer recipients from partnership participants, partner records, portal users, or payout recipients.
- Generate from the same preview/export inputs as manual partner PDFs.
- Fail closed when blocking warnings exist. A blocked run creates audit evidence but no partner email.
- Store private artifacts, not email bodies. Keep audit fields useful without persisting full report email content.
- Keep email provider credentials and sender configuration server-side only.
- Make retries deliberate and visible. Scheduler re-entry must not double-send a period by accident.

## Schedule Model

Add partner-specific schedule tables instead of overloading `report_schedules`.

### `partner_report_schedules`

Recommended fields:

| Field | Purpose |
| --- | --- |
| `id` | Schedule primary key. |
| `partnership_id` | Required FK to `reporting_partnerships`. Scope is one partnership/report. |
| `title` | Admin-visible schedule name. Default from partnership and cadence. |
| `status` | `paused`, `active`, or `archived`. New schedules should start paused until a dry run or test send succeeds. |
| `cadence` | `weekly` or `monthly`. Weekly targets the previous completed partnership reporting week; monthly targets the previous completed calendar month. |
| `period_grain` | `reporting_week` or `calendar_month`, matching `partner-report-export`. |
| `timezone` | IANA timezone used for due-time calculation and completed-period resolution. Default from partnership, then `America/Los_Angeles`. |
| `send_day_of_week` | Weekly due day, 0-6, local to `timezone`. |
| `send_day_of_month` | Monthly due day. Use 1-28 for V1 to avoid invalid dates. |
| `send_time_local` | Local time, stored as `time`, not only an hour integer. |
| `period_delay_days` | Optional guard after period close before first eligible send. Default `1` for weekly and monthly. |
| `sender_profile_key` | Server-configured profile, for example `partner_reports`. The DB stores a key, not a raw secret or arbitrary from address. |
| `reply_to_profile_key` | Optional server-configured reply-to profile. |
| `delivery_mode` | `secure_link` for V1. `pdf_attachment` is reserved and disabled unless a future decision approves it. |
| `configuration_version` | Monotonic integer incremented when scope, cadence, timing, delivery mode, sender profile, or active recipients change. |
| `configuration_hash` | Stable hash of the current send-affecting configuration, including active recipient emails. |
| `last_validated_configuration_hash` | Hash from the latest successful dry run or test send. |
| `last_validation_run_id` | FK to the run that validated the current configuration. |
| `last_validated_at` | Timestamp for the latest successful validation of the current configuration. |
| `created_by`, `created_at`, `updated_at` | Admin audit context. |
| `paused_at`, `paused_by`, `pause_reason` | Pause audit context. |
| `last_run_at`, `last_success_at`, `last_status` | Denormalized list-state fields copied from run records for fast admin views. |

Validation:

- Only super-admins can create, edit, pause, resume, archive, test, or retry schedules in V1.
- Active schedules require at least one active recipient.
- Active schedules require a successful dry run or test send whose validation hash matches the current `configuration_hash`.
- `cadence` and `period_grain` must agree: `weekly` uses `reporting_week`; `monthly` uses `calendar_month`.
- Schedules must not target draft or archived partnerships unless the schedule itself is paused.

### `partner_report_schedule_recipients`

Recommended fields:

| Field | Purpose |
| --- | --- |
| `id` | Recipient primary key. |
| `schedule_id` | FK to `partner_report_schedules`. |
| `email` | Normalized lowercase email. |
| `display_name` | Optional recipient label for admin readability. |
| `recipient_role` | Optional plain-language role, for example `venue finance` or `owner`. |
| `status` | `active` or `removed`. Avoid hard deletes so recipient changes stay auditable. |
| `added_by`, `added_at` | Audit context. |
| `removed_by`, `removed_at`, `remove_reason` | Audit context. |

Indexes and constraints:

- Unique active email per schedule.
- Email format validation in the admin RPC and client form.
- Do not sync or auto-create recipients from `reporting_partnership_parties`.

## Run Records

Add run and email-attempt records so every scheduler decision is inspectable.

### `partner_report_schedule_runs`

Recommended fields:

| Field | Purpose |
| --- | --- |
| `id` | Run primary key. |
| `schedule_id`, `partnership_id` | Scope at run time. |
| `period_grain`, `period_start_date`, `period_end_date`, `period_label` | Exact report period. |
| `trigger_type` | `scheduled`, `dry_run`, `test_send`, `manual_retry`, or `manual_send`. |
| `idempotency_key` | Stable key for the schedule, period, and real-delivery intent. |
| `configuration_version`, `configuration_hash` | Schedule configuration captured at run time. |
| `status` | `queued`, `checking_warnings`, `blocked`, `generating`, `artifact_ready`, `sending`, `sent`, `failed`, or `cancelled`. |
| `warning_gate_status` | `passed`, `blocked`, or `not_checked`. |
| `warnings_json` | Structured preview warnings with severity, type, machine label, and message. |
| `snapshot_id` | FK to `partner_report_snapshots` when an artifact is generated. |
| `artifact_storage_path` | Private storage object path, not a public URL. |
| `artifact_format` | `pdf` for V1 automated delivery. |
| `artifact_generated_at` | Timestamp when the PDF artifact was created. |
| `recipient_snapshot_json` | The explicit active recipients captured at run time. |
| `attempt_count` | Email attempt count for the run. |
| `claimed_at`, `lease_expires_at` | Worker claim fields so interrupted nonterminal runs can be recovered safely. |
| `error_code`, `error_message` | Last failure summary. |
| `created_at`, `started_at`, `finished_at` | Timing. |
| `created_by` | Admin user for manual actions, null/system for scheduled runs. |
| `parent_run_id` | Link manual retry/test runs back to the original run when relevant. |

Idempotency:

- For real automated sends, use a unique key shaped like `partner-report:schedule:{schedule_id}:period:{period_grain}:{period_start}:{period_end}:delivery`.
- Scheduler re-entry inserts or claims by this key. If an existing run is `sent`, skip it. If an existing run is `generating` or `sending` with an unexpired lease, skip until the lease expires.
- If an existing `generating` or `sending` run has an expired lease, reclaim it and resume from the last durable state.
- `artifact_ready` is not terminal and must not be skipped permanently. A re-entered scheduler should resume email delivery from the stored artifact path or mark the run `failed` if the artifact cannot be validated.
- `blocked` and non-retryable `failed` runs should not auto-send on scheduler re-entry. They require admin retry after the underlying issue is fixed.
- `dry_run` and `test_send` use separate idempotency keys so admins can test without blocking future real delivery.
- Manual duplicate-send after a `sent` run requires an explicit confirmation reason and creates a new `manual_send` run linked to the original run.

### `partner_report_email_attempts`

Recommended fields:

| Field | Purpose |
| --- | --- |
| `id` | Attempt primary key. |
| `run_id` | FK to `partner_report_schedule_runs`. |
| `attempt_number` | 1-based send attempt. |
| `status` | `pending`, `sent`, or `failed`. |
| `recipient_emails` | Array of normalized recipients used for this attempt. |
| `subject` | Subject line sent to the provider, without storing the full body. |
| `template_version` | Email template identifier/version used for the attempt. |
| `signed_url_expires_at` | Expiry timestamp for the signed link included in this attempt. |
| `provider` | `resend` for current server-side email provider. |
| `provider_message_id` | Provider response ID when available. |
| `error_code`, `error_message` | Provider or validation failure. |
| `triggered_by`, `triggered_at` | Admin/system actor context. |
| `completed_at` | Attempt completion time. |

Do not store the rendered email HTML/text body. The template version, subject, recipient list, provider ID, and artifact path are enough for audit without retaining unnecessary content.

## Warning Gates

The scheduled runner must use the same warning source as manual partner exports:

1. Resolve the target completed period from the schedule.
2. Call the partner period preview path for the partnership and period.
3. Treat any warning whose severity is not `non_blocking` as blocking.
4. If blocked, write a run with `status = blocked`, `warning_gate_status = blocked`, and `warnings_json`.
5. Do not create an artifact, do not sign a URL, and do not send email for a blocked run.

The admin UI should surface blocked runs as action-required items with the same warning copy used by the partner dashboard. Retrying a blocked run is allowed only after an admin fixes setup/data issues and clicks retry; the retry must re-run the warning gate before generating anything.

Implementation note: the current manual `partner-report-export` function depends on a user access token, and `admin_preview_partner_period_report` is guarded by `auth.uid()` super-admin checks. The scheduler must not fake a browser user token or expose a privileged token to the client. Follow-up implementation should add a scheduler-safe server-side preview/artifact helper, such as a service-role Edge Function guarded by `REPORT_SCHEDULER_SECRET` or a narrow security-definer RPC for scheduler execution, while keeping manual user-triggered preview/export paths super-admin-only.

## Artifact And Email Delivery

V1 should email a secure artifact link, not attach the PDF.

Rationale:

- The existing reporting decision already points scheduled partner reports to private signed PDF links.
- Private storage plus expiring signed URLs reduces long-lived report copies in inboxes.
- Links let Bloomjoy regenerate or expire access without changing the stored artifact.
- The existing `partner-report-export` path already uploads private PDF/CSV/XLSX artifacts to `sales-report-exports`.

Delivery behavior:

- Generate only the polished PDF for automated delivery.
- Upload to the private `sales-report-exports` bucket under a partner schedule path, for example `partner-reports/{partnership_id}/{period_grain}/{snapshot_id}/{file_name}` or `partner-report-schedules/{schedule_id}/{run_id}/{file_name}`.
- Create signed URLs server-side at send time. Default expiry should be 7 days to match current export behavior.
- Store the private path and expiry timestamp, not the signed URL itself.
- Record the email subject, template version, and signed URL expiry on the email attempt record.
- Email subject should include partnership name and period, for example `Bloomjoy partner report: {Partnership} - week ending 2026-04-26`.
- Email body should include period, report reference, recipient-safe summary, and the secure download link.
- Use server-side sender configuration. Prefer `PARTNER_REPORT_EMAIL_FROM` / `PARTNER_REPORT_REPLY_TO` or a named sender profile, with fallback only if intentionally configured. Do not expose provider keys or sender secrets in `VITE_` variables.
- `test_send` should label the subject with `[TEST]` and send only to explicit admin-entered test recipients or a server-configured internal test recipient, not the schedule recipient list.

PDF attachments are out of V1. If later required by a partner, add a decision entry and a new issue covering attachment size limits, retention, DLP risk, provider behavior, and explicit per-schedule consent.

## Retry Behavior

Automatic retries:

- Allowed for transient artifact upload or email provider failures, with a small capped policy such as 3 attempts and exponential backoff.
- Not allowed for blocking warnings, invalid recipient configuration, missing sender configuration, unauthorized function calls, or partnership/schedule validation failures.

Manual retries:

- `Retry run` re-runs the warning gate, regenerates or reuses the artifact as appropriate, and sends only if the gate passes.
- `Retry email` is allowed when the artifact exists and the prior failure was email delivery.
- `Retry blocked` is allowed after admin fixes, but it must start from warning validation.
- `Send again` after a successful send is a separate manual action requiring a duplicate-send confirmation reason.

Audit:

- Each retry writes an `admin_audit_log` entry with action, actor, schedule, run, period, recipient count, previous status, and reason.
- Provider failures should be summarized without dumping full provider payloads when they include recipient data.

## Admin UX

Place the feature in `/admin/reporting`, likely as a new `Partner delivery` section or a strengthened `Schedules` tab separate from generic sales schedules.

### List View

Show:

- Partnership/report name.
- Cadence and next eligible run.
- Status: active, paused, archived.
- Last run status and timestamp.
- Recipient count with a compact recipient preview.
- Latest artifact/run link when present.
- Blocking warning state when the last run was blocked.

Primary actions:

- Create schedule.
- Pause.
- Resume.
- Test send.
- Retry failed/blocked run.
- Open run history.
- Archive.

### Create/Edit Flow

Required inputs:

- Partnership.
- Cadence: weekly or monthly.
- Send day/time/timezone.
- Explicit recipients.
- Sender/reply-to profile display, read-only from server configuration.

Recommended controls:

- Create as paused by default.
- `Dry run` validates period resolution and warning gate without sending email.
- `Test send` sends a `[TEST]` email to an internal/admin test recipient and captures the result.
- `Resume` is enabled only after the latest schedule version has a successful dry run or test send.

### Run Detail Drawer

Show:

- Schedule, partnership, cadence, period, trigger, and actor.
- Status timeline.
- Warning gate result and warning details.
- Artifact path/reference and signed-link regeneration action for admins.
- Recipients used for the run.
- Email attempt history with status, provider message ID, and failure summary.
- Retry buttons only for states where retry is valid.

## Follow-Up Implementation Issues

Implementation issues created from this design:

1. [#309: P1: Add partner report schedule and run-record data model](https://github.com/ethtri/bloomjoy-hub/issues/309)
   - Adds partner-specific schedule, recipient, run, and email-attempt tables/RPCs.
   - Adds RLS, admin audit actions, idempotency constraints, configuration hashes, worker leases, and migration validation.
2. [#310: P1: Refactor partner report export for scheduled PDF generation](https://github.com/ethtri/bloomjoy-hub/issues/310)
   - Extracts reusable partner artifact generation so manual exports and scheduler runs share warning gates, PDF rendering, snapshot updates, and private storage behavior.
   - Adds the scheduler-safe server-side preview/artifact path needed because the existing manual export path requires user auth.
   - Keeps XLSX/CSV manual-only for automated delivery V1.
3. [#311: P1: Build admin UX for scheduled partner delivery](https://github.com/ethtri/bloomjoy-hub/issues/311)
   - Adds create/edit/list, pause/resume, dry-run/test-send, run history, warning-blocked states, and retry controls in `/admin/reporting`.
4. [#312: P1: Implement secure email delivery and retry handling for scheduled partner reports](https://github.com/ethtri/bloomjoy-hub/issues/312)
   - Sends server-side Resend emails with secure signed PDF links, sender/reply-to profiles, recipient snapshots, template/subject/link-expiry audit fields, retry attempts, and audit logs.
5. [#313: P1: Add scheduled partner report workflow, monitoring, and UAT coverage](https://github.com/ethtri/bloomjoy-hub/issues/313)
   - Adds the recurring worker trigger, recoverable nonterminal run handling, idempotency smoke coverage, warning-blocked smoke coverage, and admin UAT checklist updates.

## Verification For This Design Slice

Because this PR is documentation-only, verification should still run the standard project commands:

- `npm ci`
- `npm run build`
- `npm test --if-present`
- `npm run lint --if-present`
