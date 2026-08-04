# Refund Google Form Bridge

## Purpose

During the refund pilot, email and SMS may use different customer entry points without creating two manager workflows:

- Email directs customers to the Bloomjoy Hub refund form.
- SMS may continue directing customers to the legacy Google Form.
- Both paths create cases in the Hub Refund Operations queue.
- Machine Managers perform official decisions and refund actions only in the Hub portal.

The Google Sheet is transport, not the system of record. This bridge does not send customer messages, select a Nayax transaction, approve a request, or execute a refund.

## Locked Google Form contract

The configured response sheet must contain exactly the 11 headers below. Header order may change, but missing, renamed, duplicated, or additional headers fail the sync closed. The bridge reads the complete header row separately from the configured A:K data range, so a newly added file-upload or other question cannot be silently ignored.

| Google response column | Required by Google Form | Hub treatment |
| --- | --- | --- |
| Timestamp | Yes | Source submission time and cutover boundary |
| Your Name | Yes | Customer name |
| Email Address | Yes | Customer email |
| Location of Purchase | Yes | Exact canonical mapping only |
| Date and Time of Incident | No | Customer-reported local time; never treated as verified time |
| Incident Description | Yes | Issue description |
| Request Amount | No | Requested amount in cents after validation |
| Payment Method | No | Card, Apple/Google Pay, or Cash |
| Last 4 digits of the credit card used | No | Four digits only; wallet values remain customer-reported |
| Refund Payment Preference | Cash branch only | Venmo, Zelle, or no refund requested |
| Venmo/Zelle Payment ID | Cash branch only | Governed case metadata; never logged or copied into quarantine output |

Apple Pay and Google Pay normalize to the existing card workflow with `cardWalletUsed=true`. Missing or invalid optional facts produce an incomplete, official-action-disabled draft for manager/customer follow-up. An invalid source timestamp, customer email, issue summary, or machine mapping is quarantined or rejected without creating a case.

The current Google Form contract has no attachment or file-upload field. The bridge does not read or copy attachments. Adding any new response column, including an upload link, stops the contract check until its privacy, malware, access, and retention behavior is separately approved.

## Machine mapping

The bridge maps a location only when there is one exact, active Commercial or Mini match through an approved reporting alias, an active location name, or a public refund display label. It never guesses between candidates.

- One match: create or update a draft case and assign the machine's current managers through the existing portal mapping.
- No match: quarantine as `location_unmapped`.
- More than one match: quarantine as `location_ambiguous`.

Quarantine views contain opaque source hashes, reason codes, and timestamps only. They intentionally omit customer names, email addresses, complaint text, payment identifiers, and raw Sheet rows.

## Idempotency and edits

Each Sheet row has an HMAC source key, and each normalized response has an HMAC payload fingerprint. The HMAC secret is server-only.

The opaque per-response ledger is the checkpoint: successful, rejected, and quarantined responses retain their last source/payload fingerprints and last-seen run without retaining a raw Sheet row. Each scheduled run remains replayable from the declared boundary so edits and out-of-order rows are re-evaluated safely; already checkpointed content is duplicate-suppressed.

- Retrying the same row and payload returns the existing case.
- Moving or reordering a row with the same payload does not create a second case.
- Editing a draft response updates the same draft case.
- Editing a case after a manager has progressed it fails closed as `case_locked_after_progress`.
- Multiple workers are serialized with advisory locks.

This protects the intake bridge itself. The cross-channel person/incident duplicate policy remains a separate pilot-readiness gate because Gmail and hosted-form submissions do not share a Google Sheet source key.

## Default-off configuration

All values below are server-side secrets or operational configuration. Never prefix them with `VITE_` and never put credentials in docs, issues, workflow output, or screenshots.

| Name | Purpose |
| --- | --- |
| `REFUND_GOOGLE_FORM_SYNC_ENABLED` | Edge-function kill switch; defaults to `false` |
| `REFUND_GOOGLE_FORM_SYNC_SECRET` | Dedicated bearer secret for the sync endpoint |
| `REFUND_GOOGLE_FORM_SHEET_ID` | Approved response Sheet ID |
| `REFUND_GOOGLE_FORM_SHEET_RANGE` | Response tab/range, normally `'Form Responses 1'!A:K` |
| `REFUND_GOOGLE_FORM_SOURCE_SALT` | At least 32 characters; HMAC source/payload keys |
| `REFUND_GOOGLE_FORM_START_AT` | Required ISO timestamp for live runs; older rows are skipped |
| `REFUND_GOOGLE_FORM_SYNC_ROW_LIMIT` | Page size, 50 by default and 100 maximum |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account with read-only access to this Sheet |

The scheduled workflow also requires repository variable `REFUND_GOOGLE_FORM_SYNC_ENABLED=true`. Both the Edge switch and workflow switch must be on for a scheduled live run. Manual dispatch defaults to dry-run.

## Pilot activation procedure

1. Keep both enable switches off while the migration and function are reviewed.
2. Share only the approved response Sheet with the dedicated service account as Viewer.
3. Set `REFUND_GOOGLE_FORM_START_AT` to the agreed pilot boundary. Do not use a date that imports historical customer rows.
4. Run `npm run refunds:validate-google-form-bridge` and `npm run db:validate-migrations`.
5. Deploy the reviewed migration and Edge Function through the refund release process.
6. Manually dispatch a dry run. Confirm the contract is valid and review aggregate counts only.
7. Submit synthetic, non-customer fixtures for mapped, incomplete, unmapped, ambiguous, edit, reorder, and replay cases.
8. Confirm the Hub cases/quarantine outcomes and prove no message or official action was created.
9. Record UAT evidence on GitHub issue `#702` and obtain the readiness go/no-go before enabling scheduled live runs.

Target pickup is within 15 minutes: the schedule runs every 10 minutes with a small allowance for execution time. Health output is aggregate and contains no customer content.

## Kill switch and rollback

For immediate containment, set the repository variable and Edge secret `REFUND_GOOGLE_FORM_SYNC_ENABLED=false`. Existing Hub cases remain available for manual work, while email/hosted-form intake and the Google Form itself are unaffected.

Do not delete imported cases as rollback. Preserve the audit trail, investigate quarantine/run health, and use a reviewed forward-only migration for schema correction. If credentials may be exposed, disable the workflow, revoke the service account's Sheet access, and rotate the sync secret and HMAC salt before any restart.
