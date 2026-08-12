# Refund Gmail Data Handling Approval

This document is the production-enable gate for Refund Operations Gmail intake (`#634`). It applies to the designated support mailbox connection only; the hosted refund form and canonical refund cases continue independently.

Observed on 2026-08-03: the connected agent profile showed `info@bloomjoysweets.com` and a `Refund Operations` label. This does **not** prove production Hub OAuth/secrets, correct label-filter population, legacy-responder inventory/cutover, or a configured `support@bloomjoysweets.com` alias/send-as. Each remains **Pending** until owner configuration and synthetic Gmail evidence prove it. The operating model uses direct scoped mailbox access, not forwarding into a personal inbox.

## Approved operating boundary

- Intake reads only messages in the explicitly configured Gmail refund label.
- OAuth permissions are limited to Gmail read-only and send. The integration does not modify labels, read state, archive state, or mailbox content.
- The Hub stores sanitized plain text needed for the refund case. Provider thread/message IDs remain service-only. Incoming Luhn-valid full card numbers are replaced with redacted last four before persistence.
- Unassigned drafts with no known location are visible only to Super Admins and Scoped Admins. A location-only Machine Manager cannot read them; normal machine scope resumes once a complete case is assigned to a machine.
- Logs, scheduled-workflow output, GitHub evidence, and health responses contain aggregates and safe error codes only.
- Attachments are disabled for the email pilot. The hosted form has no file control, its endpoint rejects non-empty attachment lists, and Gmail ingestion copies no attachment metadata or bytes. The quarantine/scanner design below is retained only as a future reviewed option; enabling it requires a separate operations and privacy/security decision.
- Gmail message copies are proposed for automated deletion 180 days after receipt. For the email pilot there are no copied attachment bytes or metadata; cleanup redacts copied message/recipient/thread content while the canonical refund case and its audit history continue under Bloomjoy's separately governed business-record retention.
- To support mapped-manager CC, raw To/CC recipient addresses may exist only in the service-only message/delivery record and authorized review preview for the minimum operational period. They follow the same approved 180-day Gmail-copy purge and may not be copied into durable audit payloads.
- Customer-visible recipient and CC lists are computed at send time and are not copied into logs, health output, GitHub evidence, or browser-visible service payloads beyond the authorized message review surface.
- Authorization revocation or disablement affects only Gmail intake/replies. Hosted-form intake and manual refund work remain available.
- Retention cleanup is an independent local-data lane. Its GitHub, Edge, and database owner-approval gates remain off by default; once all three are deliberately enabled, Gmail sync may stay off and OAuth revocation must not prevent eligible local cleanup.

## Future crash-safe quarantine and retention contract

- Before any attachment bytes are uploaded, the database reserves one tokenized upload intent and returns the exact private `refund-gmail-quarantine` bucket plus a canonical UUID-derived path. The worker may not invent a bucket or path.
- The upload result is settled against that exact intent/token. A worker crash or ambiguous Storage response becomes `upload_unknown`; it is never treated as safely absent.
- Expired stored bytes are deleted only through a tokenized retention action bound to the recorded intent, bucket, and canonical path. Metadata is purged only after the delete result settles as confirmed.
- A missing, malformed, noncanonical, corrupt, failed, or unknown object coordinate blocks that item for manual review. It does not authorize a guessed delete and does not erase its evidence.
- One blocked object must not stop unrelated expired content that has no Storage object from being redacted/purged in the same bounded run.
- Direct browser/authenticated roles and ordinary service-role table writes cannot bypass the intent, settlement, or retention procedures.

## Outbound and participant boundary

- Gmail-linked customer communication stays in the original provider thread. The automation scheduler must use the Gmail transport for these cases rather than starting a second Resend conversation.
- Configured Info/Support aliases are treated as Bloomjoy mailbox-origin only when the approved mailbox configuration and Gmail `SENT`-label evidence agree; an alias-looking From address alone is not trusted. No `support@bloomjoysweets.com` alias/send-as is approved by this document yet.
- An approved deterministic template may send automatically only for the bounded classes and rollout gates in `Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md`. GPT-authored or materially free-form copy remains manager-reviewed under `Docs/REFUND_GPT_TRIAGE.md`.
- One durable thread operation key protects the first-contact acknowledgement. Replays and later replies cannot create a second acknowledgement, and the legacy responder must be disabled before the Hub responder becomes authoritative.
- Every manual or automatic case-specific customer-facing refund message requires a resolved machine and one to three active, non-revoked Machine Managers returned by the authoritative portal mapping at send time. The generic hosted-form acknowledgement is the sole pre-mapping no-CC exception. Unresolved, zero-manager, invalid/over-cap, empty, or changed routes fail closed before every later Gmail or transactional provider delivery and create a redacted internal routing exception. The capped operations fallback is internal-only and can never replace the required customer-message CC.
- Gmail ingestion classifies every sender as customer, assigned manager, Bloomjoy mailbox, automated system, or unknown. A mapped manager's Reply All remains manager correspondence and cannot change customer-provided facts.
- An unknown, forwarded, alias, spoof-suspected, revoked-manager, or other non-verified-customer participant cannot update customer facts, clear waiting state, start customer GPT triage, or trigger automatic follow-up.
- Customer-visible messages never contain the internal portal URL. Managers receive a separate sanitized notice with the canonical `/refunds?case=<case-id>` link.
- An authenticated permanent hard bounce for the exact case customer pauses automatic contact case-wide, including newer linked threads. Recovery requires an authenticated manager to verify the exact customer address and clear every linked pause atomically; service, scheduler, ingest, replay, and partial-clear paths cannot resume it. Uncertain delivery exposes a safe exception and is never retried blindly.

## Required approvals before production enablement

- Operations owner: **Approved by Ethan Trifari for the controlled email pilot**
- Privacy/security owner: **Approved by Ethan Trifari for the controlled email pilot**
- Approval date: **2026-08-11 PT**
- Approved retention period: **180 days for the sanitized Gmail copy**
- Attachment-off behavior accepted for the pilot: **Approved**
- Visible-CC recipient/privacy behavior accepted: **Approved for the complete current portal-mapped Machine Manager set**
- Participant-classification and mapped-manager recipient UAT: **Pending**
- Exactly-once first-contact and non-overlapping legacy-responder cutover UAT: **Pending**
- Production Hub OAuth/secrets and mailbox-identity smoke: **Passed for `info@bloomjoysweets.com` with Gmail read-only and send scopes; outbound synthetic proof remains pending**
- Refund-label filter population and legacy-responder inventory: **Legacy inventory complete; isolated synthetic population proof pending**
- `support@bloomjoysweets.com` alias/send-as configuration plus Gmail `SENT` proof: **Alias verified; bounded outbound synthetic proof pending**

Both production switches remain `false` while the remaining local and isolated-test-mailbox UAT gates are pending. After those gates pass, the owner-approved bounded production synthetic window may set `REFUND_GMAIL_ENABLED=true` while `REFUND_GMAIL_SYNC_ENABLED=false`; the Edge switch is reset immediately after the manual test. Scheduled/broad enablement requires successful synthetic evidence plus an explicit go/no-go. Approval must be recorded in a reviewed PR or the linked GitHub issue without customer data, secrets, or provider identifiers.

## Deletion and incident procedure

- Pilot deletion redacts message sender/To/CC recipient/subject/body copies, delivery-recipient claims, and the copied thread subject; no attachment object or metadata should exist. The future attachment design above would additionally require settled object deletion before metadata purge. Local cleanup does not require Google mailbox access, so revoked authorization does not prevent cleanup when the independent retention schedule and Edge/database gates remain enabled. Case audit metadata remains without raw addresses.
- For a suspected credential compromise, disable the GitHub schedule, disable the Edge Function, and revoke the Google refresh token. Do not destructively delete linkage or audit tables during incident response.
- For a privacy deletion request or legal hold, the Operations and privacy/security owners must identify the exact case in the production admin system and authorize a controlled service-role procedure. Do not place customer identifiers or message content in GitHub.
