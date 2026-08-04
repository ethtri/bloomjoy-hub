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
- To support mapped-manager CC, raw To/CC recipient addresses may exist only in the service-only message/delivery record and authorized review preview for the minimum operational period. They follow the same approved 180-day Gmail-copy purge and may not be copied into durable audit payloads.
- Customer-visible recipient and CC lists are computed at send time and are not copied into logs, health output, GitHub evidence, or browser-visible service payloads beyond the authorized message review surface.
- Authorization revocation or disablement affects only Gmail intake/replies. Hosted-form intake and manual refund work remain available.

## Outbound and participant boundary

- Gmail-linked customer communication stays in the original provider thread. The automation scheduler must use the Gmail transport for these cases rather than starting a second Resend conversation.
- Configured Info/Support aliases are treated as Bloomjoy mailbox-origin only when the approved mailbox configuration and Gmail `SENT`-label evidence agree; an alias-looking From address alone is not trusted.
- An approved deterministic template may send automatically only for the bounded classes and rollout gates in `Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md`. GPT-authored or materially free-form copy remains manager-reviewed under `Docs/REFUND_GPT_TRIAGE.md`.
- One durable thread operation key protects the first-contact acknowledgement. Replays and later replies cannot create a second acknowledgement, and the legacy responder must be disabled before the Hub responder becomes authoritative.
- Every manual or automatic customer-facing refund message requires a resolved machine and one to three active, non-revoked Machine Managers returned by the authoritative portal mapping at send time. Unresolved, zero-manager, invalid/over-cap, empty, or changed routes fail closed before Gmail or transactional provider delivery and create a redacted internal routing exception. The capped operations fallback is internal-only and can never replace the required customer-message CC.
- Gmail ingestion classifies every sender as customer, assigned manager, Bloomjoy mailbox, automated system, or unknown. A mapped manager's Reply All remains manager correspondence and cannot change customer-provided facts.
- An unknown, forwarded, alias, spoof-suspected, revoked-manager, or other non-verified-customer participant cannot update customer facts, clear waiting state, start customer GPT triage, or trigger automatic follow-up.
- Customer-visible messages never contain the internal portal URL. Managers receive a separate sanitized notice with the canonical `/refunds?case=<case-id>` link.
- An authenticated permanent hard bounce for the exact case customer pauses automatic contact case-wide, including newer linked threads. Recovery requires an authenticated manager to verify the exact customer address and clear every linked pause atomically; service, scheduler, ingest, replay, and partial-clear paths cannot resume it. Uncertain delivery exposes a safe exception and is never retried blindly.

## Required approvals before production enablement

- Operations owner: **Pending**
- Privacy/security owner: **Pending**
- Approval date: **Pending**
- Approved retention period: **Pending (proposed: 180 days)**
- Quarantine-until-malware-cleared behavior accepted: **Pending**
- Visible-CC recipient/privacy behavior accepted: **Pending**
- Participant-classification and mapped-manager recipient UAT: **Pending**
- Exactly-once first-contact and non-overlapping legacy-responder cutover UAT: **Pending**

Both production switches remain `false` while policy approval and local/staging or isolated-test-mailbox UAT are pending. After those gates pass, an owner-approved bounded production synthetic window may set `REFUND_GMAIL_ENABLED=true` while `REFUND_GMAIL_SYNC_ENABLED=false`; the Edge switch is reset immediately after the manual test. Scheduled/broad enablement requires successful synthetic evidence plus an explicit go/no-go. Approval must be recorded in a reviewed PR or the linked GitHub issue without customer data, secrets, or provider identifiers.

## Deletion and incident procedure

- Normal deletion removes expired quarantined objects first, then redacts attachment metadata, message sender/To/CC recipient/subject/body copies, delivery-recipient claims, and the copied thread subject. This local cleanup runs before Google mailbox access, so revoked authorization does not prevent cleanup when the scheduled job still runs. Case audit metadata remains without raw addresses.
- For a suspected credential compromise, disable the GitHub schedule, disable the Edge Function, and revoke the Google refresh token. Do not destructively delete linkage or audit tables during incident response.
- For a privacy deletion request or legal hold, the Operations and privacy/security owners must identify the exact case in the production admin system and authorize a controlled service-role procedure. Do not place customer identifiers or message content in GitHub.
