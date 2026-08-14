# Refund Gmail Data Handling Approval

This document is the production-enable gate for Refund Operations Gmail intake (`#634`). It applies only to the directly connected production customer-service mailbox, `info@bloomjoysweets.com`; the hosted refund form and canonical refund cases continue independently.

Verified through 2026-08-14: the production Hub OAuth profile resolves exactly to `info@bloomjoysweets.com` with Gmail read-only/send scopes; Info/Support/Refunds send-as identities are configured and verified; and a separate isolated label/sender population passed one exactly-once original-thread first-contact acknowledgement with replay/later-reply suppression and teardown. After the native date/time correction, the private email-context form completed the existing Gmail draft exactly once and assigned its sole current mapped manager. A later bounded owner-controlled proof also passed exactly one case-specific original-thread message with the complete current mapped-manager CC set, one case message/outbound, zero unresolved delivery, and disabled teardown. This evidence does not authorize the production label, schedules, automatic contact, or legacy-responder retirement. The operating model uses direct scoped mailbox access, not forwarding into a personal inbox.

## Approved operating boundary

- Intake reads only messages in the explicitly configured Gmail refund label.
- OAuth permissions are limited to Gmail read-only and send. The integration does not modify labels, read state, archive state, or mailbox content.
- The Hub stores sanitized plain text needed for the refund case. Provider thread/message IDs remain service-only. Incoming Luhn-valid full card numbers are replaced with redacted last four before persistence.
- Unassigned drafts with no known location are visible only to Super Admins and Scoped Admins. A location-only Machine Manager cannot read them; normal machine scope resumes once a complete case is assigned to a machine.
- Logs, scheduled-workflow output, GitHub evidence, and health responses contain aggregates and safe error codes only.
- Attachments are disabled for the email pilot. The hosted form has no file control, its endpoint rejects non-empty attachment lists, and Gmail ingestion copies no attachment metadata or bytes. The quarantine/scanner design below is retained only as a future reviewed option; enabling it requires a separate operations and privacy/security decision.
- Gmail message copies are approved for automated deletion 180 days after receipt. For the email pilot there are no copied attachment bytes or metadata; cleanup redacts copied message/recipient/thread content while the canonical refund case and its audit history continue under Bloomjoy's separately governed business-record retention. The policy approval does not enable the recurring schedule.
- To support mapped-manager CC, raw To/CC recipient addresses may exist only in the service-only message/delivery record and authorized review preview for the minimum operational period. They follow the same approved 180-day Gmail-copy purge and may not be copied into durable audit payloads.
- Customer-visible recipient and CC lists are computed at send time and are not copied into logs, health output, GitHub evidence, or browser-visible service payloads beyond the authorized message review surface.
- Authorization revocation or disablement affects only Gmail intake/replies. Hosted-form intake and manual refund work remain available.
- Retention cleanup is an independent local-data lane. Its database policy is armed for the approved 180-day sanitized-copy period, while its GitHub and Edge runtime gates remain off, so recurring cleanup is dormant. When both runtime gates are deliberately enabled, Gmail sync may stay off and OAuth revocation must not prevent eligible local cleanup.

## Future crash-safe quarantine and retention contract

- Before any attachment bytes are uploaded, the database reserves one tokenized upload intent and returns the exact private `refund-gmail-quarantine` bucket plus a canonical UUID-derived path. The worker may not invent a bucket or path.
- The upload result is settled against that exact intent/token. A worker crash or ambiguous Storage response becomes `upload_unknown`; it is never treated as safely absent.
- Expired stored bytes are deleted only through a tokenized retention action bound to the recorded intent, bucket, and canonical path. Metadata is purged only after the delete result settles as confirmed.
- A missing, malformed, noncanonical, corrupt, failed, or unknown object coordinate blocks that item for manual review. It does not authorize a guessed delete and does not erase its evidence.
- One blocked object must not stop unrelated expired content that has no Storage object from being redacted/purged in the same bounded run.
- Direct browser/authenticated roles and ordinary service-role table writes cannot bypass the intent, settlement, or retention procedures.

## Outbound and participant boundary

- Gmail-linked customer communication originates through the designated support mailbox and stays in the original provider thread. The automation scheduler must use the Gmail transport for these cases rather than starting a second Resend conversation.
- The verified Info/Support/Refunds send-as identities are identities of the directly connected `info@bloomjoysweets.com` mailbox. Treat one as Bloomjoy mailbox-origin only when the approved mailbox configuration and provider `SENT`-label evidence agree and every existing delivery gate passes; an alias-looking From address alone is not trusted.
- `etrifari@bloomjoysweets.com` and its plus-addresses may be used only as an owner-controlled synthetic customer/test sender or recipient, or for vendor/account correspondence. They are not the production refund-assistant mailbox and must not substitute for the configured support mailbox.
- An approved deterministic template may send automatically only for the bounded classes and rollout gates in `Docs/REFUND_EMAIL_ASSISTANT_RUNBOOK.md`. GPT-authored or materially free-form copy remains manager-reviewed under `Docs/REFUND_GPT_TRIAGE.md`.
- One durable thread operation key protects the first-contact acknowledgement. Replays and later replies cannot create a second acknowledgement, and the legacy responder must be disabled before the Hub responder becomes authoritative.
- After machine resolution, every Gmail-linked case-specific customer-facing refund reply must originate through the designated support mailbox in the original Gmail thread. Every manual or automatic Gmail or transactional case-specific customer message requires one to three active, non-revoked Machine Managers returned by the authoritative portal mapping at send time. The generic hosted-form acknowledgement is the sole pre-mapping no-CC exception. Unresolved, zero-manager, invalid/over-cap, empty, or changed routes fail closed before every later Gmail or transactional provider delivery and create a redacted internal routing exception. The capped operations fallback is internal-only and can never replace the required customer-message CC.
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
- Participant-classification and case-specific mapped-manager recipient UAT: **Passed once through the bounded owner-controlled original-thread proof with the complete current mapped-manager CC set**
- Exactly-once first-contact and non-overlapping responder UAT: **Passed for the isolated synthetic population; production-label cutover/rollback approval remains pending**
- Production Hub OAuth/secrets and mailbox-identity smoke: **Passed for `info@bloomjoysweets.com` with Gmail read-only and send scopes**
- Refund-label filter population and legacy-responder inventory: **Legacy inventory complete; isolated label/sender/exclusion proof passed; production-label cutover remains pending**
- Info/Support/Refunds alias/send-as configuration: **Verified; the isolated first-contact outbound was confirmed from the designated support mailbox**

Both production switches remain `false` while the staffed production-label shadow/cutover and rollback gates are pending. A later owner-approved bounded window may set only the controls required by the reviewed test and must reset them immediately afterward. Scheduled/broad enablement requires that no-overlap cutover evidence plus an explicit owner go/no-go. Approval must be recorded in a reviewed PR or the linked GitHub issue without customer data, secrets, or provider identifiers.

## Deletion and incident procedure

- Pilot deletion redacts message sender/To/CC recipient/subject/body copies, delivery-recipient claims, and the copied thread subject; no attachment object or metadata should exist. The future attachment design above would additionally require settled object deletion before metadata purge. Local cleanup does not require Google mailbox access, so revoked authorization does not prevent cleanup when the independent retention schedule and Edge/database gates remain enabled. Case audit metadata remains without raw addresses.
- For a suspected credential compromise, disable the GitHub schedule, disable the Edge Function, and revoke the Google refresh token. Do not destructively delete linkage or audit tables during incident response.
- For a privacy deletion request or legal hold, the Operations and privacy/security owners must identify the exact case in the production admin system and authorize a controlled service-role procedure. Do not place customer identifiers or message content in GitHub.
