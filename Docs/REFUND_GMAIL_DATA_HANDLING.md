# Refund Gmail Data Handling Approval

This document is the production-enable gate for Refund Operations Gmail intake (`#634`). It applies to the designated support mailbox connection only; the hosted refund form and canonical refund cases continue independently.

## Approved operating boundary

- Intake reads only messages in the explicitly configured Gmail refund label.
- OAuth permissions are limited to Gmail read-only and send. The integration does not modify labels, read state, archive state, or mailbox content.
- The Hub stores sanitized plain text needed for the refund case. Provider thread/message IDs remain service-only. Incoming Luhn-valid full card numbers are replaced with redacted last four before persistence.
- Unassigned drafts with no known location are visible only to Super Admins and Scoped Admins. A location-only Machine Manager cannot read them; normal machine scope resumes once a complete case is assigned to a machine.
- Logs, scheduled-workflow output, GitHub evidence, and health responses contain aggregates and safe error codes only.
- Accepted attachments are PDF, JPEG, or PNG, no more than three per message and 5 MB each. Before any Storage upload begins, the database creates a tokenized intent containing the exact UUID-derived path in the private `refund-gmail-quarantine` bucket. A success, explicit failure, or unknown result settles against that token; failures, unknown results, and a worker crash keep the coordinates so retention can delete the possible byte without Gmail. Only evidence recorded before transport may remain storage-free. Attachments are not manager-downloadable until a separate malware scanner explicitly marks them clean. Missing, disabled, unapproved, or version-mismatched quarantine/scanner configuration blocks new Gmail copies before provider access.
- The proposed policy makes Gmail message copies eligible for cleanup 180 days after the database records the local copy, not from a caller-controlled Gmail date. Cleanup redacts copied thread/message content and attachment filenames/provider metadata only after quarantined bytes are confirmed removed. The canonical refund case and its audit history continue under Bloomjoy's separately governed business-record retention.
- Authorization revocation or disablement affects only Gmail intake/replies. Hosted-form intake and manual refund work remain available.

## Required approvals before production enablement

- Operations owner: **Pending**
- Privacy/security owner: **Pending**
- Approval date: **Pending**
- Approved retention period: **Pending (proposed: 180 days)**
- Quarantine-until-malware-cleared behavior accepted: **Pending**

`REFUND_GMAIL_ENABLED`, `REFUND_GMAIL_SYNC_ENABLED`, both retention enable switches, and the attachment scanner switch must remain `false` until every field above is approved. After approval, retention is bootstrapped and proven healthy before Gmail OAuth is configured; Gmail sync stays off until the remaining synthetic validation in `Docs/PRODUCTION_RUNBOOK.md` passes. Approval must be recorded in a reviewed PR or linked issue without customer data, secrets, or provider identifiers.

## Deletion and incident procedure

- Normal cleanup claims one due, canonical quarantine intent at a time. The bucket and path are re-derived and checked against the attachment linkage before deletion and again before settlement, so corrupt coordinates cannot target another object. A confirmed byte deletion settles that claim before attachment metadata or message content is redacted. A confirmed failure keeps metadata and can retry under a new run; an upload or deletion with an unknown result keeps its own attachment/message metadata, never retries blindly, marks aggregate cleanup health for manual review, and blocks every new Gmail copy. Unrelated due attachments that are proven storage-free and their messages may still purge in the same run. A privacy owner and technical owner must reconcile private storage evidence through a reviewed forward remediation. Case audit metadata remains.
- Retention-only cleanup uses the local database and private storage without reading Gmail configuration, refreshing Google OAuth, or calling Gmail. Keep it scheduled when Gmail intake is disabled or authorization is revoked. It never deletes, archives, marks read, relabels, or otherwise reorganizes the source mailbox.
- For a suspected credential compromise, disable the Gmail sync schedule and `REFUND_GMAIL_ENABLED`, then revoke the Google refresh token. Keep the approved retention-only schedule and worker running until every local Gmail copy is cleared; they do not require Gmail authorization or provider access. Do not destructively delete linkage or audit tables during incident response.
- For a privacy deletion request or legal hold, the Operations and privacy/security owners must identify the exact case in the production admin system and authorize a controlled service-role procedure. Do not place customer identifiers or message content in GitHub.
