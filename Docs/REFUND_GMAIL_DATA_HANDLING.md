# Refund Gmail Data Handling Approval

This document is the production-enable gate for Refund Operations Gmail intake (`#634`). It applies to the designated support mailbox connection only; the hosted refund form and canonical refund cases continue independently.

## Approved operating boundary

- Intake reads only messages in the explicitly configured Gmail refund label.
- OAuth permissions are limited to Gmail read-only and send. The integration does not modify labels, read state, archive state, or mailbox content.
- The Hub stores sanitized plain text needed for the refund case. Provider thread/message IDs remain service-only. Incoming Luhn-valid full card numbers are replaced with redacted last four before persistence.
- Unassigned drafts with no known location are visible only to Super Admins and Scoped Admins. A location-only Machine Manager cannot read them; normal machine scope resumes once a complete case is assigned to a machine.
- Logs, scheduled-workflow output, GitHub evidence, and health responses contain aggregates and safe error codes only.
- Accepted attachments are PDF, JPEG, or PNG, no more than three per message and 5 MB each. They remain in private quarantine and are not manager-downloadable until a separate malware scanner explicitly marks them clean. With no scanner configured, they remain quarantined.
- Gmail message copies are eligible for automated deletion 180 days after receipt. The canonical refund case and its audit history continue under Bloomjoy's separately governed business-record retention.
- Authorization revocation or disablement affects only Gmail intake/replies. Hosted-form intake and manual refund work remain available.

## Required approvals before production enablement

- Operations owner: **Pending**
- Privacy/security owner: **Pending**
- Approval date: **Pending**
- Approved retention period: **Pending (proposed: 180 days)**
- Quarantine-until-malware-cleared behavior accepted: **Pending**

Both `REFUND_GMAIL_ENABLED` and `REFUND_GMAIL_SYNC_ENABLED` must remain `false` until every field above is approved and the synthetic validation in `Docs/PRODUCTION_RUNBOOK.md` passes. Approval must be recorded in a reviewed PR or the linked GitHub issue without customer data, secrets, or provider identifiers.

## Deletion and incident procedure

- Normal deletion removes expired quarantined objects first, then purges the retained Gmail message body on the next successful sync maintenance pass. Case audit metadata remains.
- For a suspected credential compromise, disable the GitHub schedule, disable the Edge Function, and revoke the Google refresh token. Do not destructively delete linkage or audit tables during incident response.
- For a privacy deletion request or legal hold, the Operations and privacy/security owners must identify the exact case in the production admin system and authorize a controlled service-role procedure. Do not place customer identifiers or message content in GitHub.
