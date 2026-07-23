# Refund Gmail Data Handling Approval

This document is the production-enable gate for Refund Operations Gmail intake (`#634`). It applies to the designated support mailbox connection only; the hosted refund form and canonical refund cases continue independently.

## Approved operating boundary

- Intake reads only messages in the explicitly configured Gmail refund label.
- OAuth permissions are limited to Gmail read-only and send. The integration does not modify labels, read state, archive state, or mailbox content.
- The Hub stores sanitized plain text needed for the refund case. Provider thread/message IDs remain service-only. Incoming Luhn-valid full card numbers are replaced with redacted last four before persistence.
- Unassigned drafts with no known location are visible only to Super Admins and Scoped Admins. A location-only Machine Manager cannot read them; normal machine scope resumes once a complete case is assigned to a machine.
- Logs, scheduled-workflow output, GitHub evidence, and health responses contain aggregates and safe error codes only.
- Accepted attachments are PDF, JPEG, or PNG, no more than three per message and 5 MB each. They remain in private quarantine and are not manager-downloadable until a separate malware scanner explicitly marks them clean. With no scanner configured, they remain quarantined.
- Gmail message copies are eligible for automated deletion 180 days after receipt. Cleanup also redacts copied thread subjects and attachment filenames/provider metadata after quarantined bytes are removed. The canonical refund case and its audit history continue under Bloomjoy's separately governed business-record retention.
- Authorization revocation or disablement affects only Gmail intake/replies. Hosted-form intake and manual refund work remain available.

## Required approvals before production enablement

- Operations owner: **Pending**
- Privacy/security owner: **Pending**
- Approval date: **Pending**
- Approved retention period: **Pending (proposed: 180 days)**
- Quarantine-until-malware-cleared behavior accepted: **Pending**

Both `REFUND_GMAIL_ENABLED` and `REFUND_GMAIL_SYNC_ENABLED` must remain `false` until every field above is approved and the synthetic validation in `Docs/PRODUCTION_RUNBOOK.md` passes. Approval must be recorded in a reviewed PR or the linked GitHub issue without customer data, secrets, or provider identifiers.

`REFUND_GMAIL_RETENTION_ENABLED` is independent of mailbox access. Turn it on before the first Gmail copy is stored and keep it on until at least 180 days after the final copied message or attachment expires. When provider sync is disabled, the retention-only job deletes expired local copies without refreshing a Google token or calling Gmail.

## Deletion and incident procedure

- Normal deletion removes expired quarantined objects first, then redacts attachment metadata, message sender/recipient/subject/body copies, and the copied thread subject. This local cleanup runs before Gmail configuration and Google mailbox access. A malformed attachment record or failed object deletion reports a redacted retention failure and stops provider sync rather than copying more data; revoked authorization does not prevent cleanup when the scheduled job still runs. Case audit metadata remains.
- For a suspected credential compromise, disable the GitHub schedule, disable the Edge Function, and revoke the Google refresh token. Do not destructively delete linkage or audit tables during incident response.
- For a privacy deletion request or legal hold, the Operations and privacy/security owners must identify the exact case in the production admin system and authorize a controlled service-role procedure. Do not place customer identifiers or message content in GitHub.
