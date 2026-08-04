# Refund Gmail first-contact cutover

Issue `#688` replaces the repeating legacy canned response with one deterministic acknowledgement for the first eligible customer message in each Gmail thread. This document is the operational contract for shadow testing, cutover, rollback, and evidence. It does not authorize production Gmail access or customer sending by itself.

Read-only verification on 2026-08-03 confirmed that the connected support-mail profile is `info@bloomjoysweets.com` and that a `Refund Operations` Gmail label exists. This does not prove the Hub's production secrets, the exact label/filter population, the legacy-responder inventory, or any send-mode gate; those remain separate cutover checks below.

## Non-negotiable behavior

- A thread can claim at most one `refund_first_contact_v1` operation.
- Replayed ingestion, scheduler replay, duplicate messages, and later replies do not send another acknowledgement.
- Bounces, automated messages, outbound messages from the mailbox or any configured Gmail send-as alias, and messages that do not match the case customer are ineligible.
- The reply stays in the original Gmail thread and carries `Auto-Submitted: auto-generated` plus `X-Auto-Response-Suppress: All`.
- The customer is the sole To recipient, and one to three current active mapped Machine Managers are visible in CC. Verified direct-customer evidence, open-case state, case-wide delivery pauses, and the manager route are revalidated and persisted immediately before provider delivery; unresolved or invalid routing sends nothing.
- Customer copy is deterministic, humble, and safety-focused. It includes only public self-service links and the public refund reference; it never includes `/refunds?case=...` or asks for complete card or wallet credentials.
- An uncertain Gmail outcome is never retried blindly. Every portal and automated reply path for that thread remains blocked until deterministic Message-ID reconciliation confirms the original delivery. Reconciliation uses a five-minute in-flight lease and an incrementing attempt version, so a delayed older positive or negative result cannot overwrite a newer check. If repeated automatic checks find no matching message, an authorized portal user must inspect the original thread and record the audited **I checked; no message was sent** resolution before a controlled follow-up becomes available.
- The legacy responder and Hub responder must never be authoritative for the same thread population at the same time.
- The integrated `#686` participant and mapped-manager CC boundary satisfies the code dependency for active mode. Production remains off until every owner, OAuth, label, privacy/retention, legacy-shutdown, synthetic UAT, and rollback gate below is recorded.

## Runtime modes

| Mode | Customer email | Intended use |
| --- | --- | --- |
| `disabled` | No | Normal default and immediate Hub rollback |
| `shadow` | No | Record one content-free "would send" operation while the legacy responder remains authoritative |
| `isolated_test` | Yes, only in an isolated synthetic population | Prove original-thread delivery without overlapping the legacy responder |
| `active` | Yes, only after every recorded cutover gate | Bounded owner-approved production window after legacy shutdown and integrated synthetic UAT |

An invalid mode, public URL, timestamp, or gate combination blocks first-contact sending and marks the run unhealthy, while safe label-only mailbox ingestion and retention work continue. Omitting the mode is equivalent to `disabled`.

## Server-only configuration

Never use `VITE_` for any setting below.

- `GMAIL_SUPPORT_SEND_AS_ALIASES` (comma-separated Gmail send-as identities; omit only when the mailbox has none)
- `REFUND_GMAIL_FIRST_CONTACT_MODE`
- `REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT`
- `REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED`
- `REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID`
- `REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID`
- `REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS`
- `REFUND_GMAIL_LEGACY_RESPONDER_DISABLED`
- `REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED`
- `REFUND_GMAIL_FIRST_CONTACT_REFUND_URL`
- `REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL`
- `REFUND_GMAIL_FIRST_CONTACT_SUPPORT_URL`

The isolated label must differ from the production refund label, and the isolated sender allowlist must contain only owner-controlled synthetic addresses. The URLs must use approved public HTTPS hosts: Bloomjoy for current refund/support pages and Google Forms for the temporary backup. The customer template defaults to the Bloomjoy refund request page, the existing backup Google Form, and the public support resources page.

## Inventory the legacy sender

An operations owner must record the inventory on issue `#688` without customer content, addresses, raw headers, provider IDs, or secret values. Inspect all of the following in the designated `info@bloomjoysweets.com` account:

1. Gmail **General** settings for Vacation responder state, date range, subject, and whether the response is limited to contacts or the organization.
2. Gmail **Filters and Blocked Addresses** for any filter that forwards, applies a template, invokes a support label, or routes refund-related mail.
3. Gmail **Advanced** settings for Templates enablement, then the template name used by any relevant filter.
4. Google Apps Script projects, Workspace add-ons, ticketing integrations, forwarding destinations, or external automations that can reply from the mailbox.
5. The exact message population covered by each sender: mailbox, aliases, labels, sender/recipient predicates, and first-message versus every-message behavior.

Record only the mechanism, owner, enabled/disabled state, affected label/population, and safe rule fingerprint. If more than one sender can reply, every sender must be included in the no-overlap plan.

## Safe test sequence

1. Keep the legacy responder authoritative and set Hub mode to `shadow`.
2. Run `npm run refunds:validate-gmail`, the focused database suite, and the Gmail preflight. Confirm replay and later replies produce no second shadow operation.
3. Create a dedicated isolated Gmail label that differs from the production label and that every legacy sender explicitly excludes. Use synthetic names and content only.
4. Point `GMAIL_REFUND_LABEL_ID` to the isolated label for the test deployment, record both isolated and production label IDs, allowlist only the owner-controlled synthetic senders, set an exact UTC cutover timestamp, set `REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED=true`, and use `isolated_test`.
5. Send one new synthetic customer thread mapped to one to three synthetic managers. Confirm one linked case and one acknowledgement in the original thread, with the customer as sole To and only the current mapped managers in visible CC. Replay the scheduler, replay ingestion, and add a later reply; confirm no duplicate acknowledgement. Revoke the mapping between claim and preparation in a separate case and confirm provider delivery is blocked with no stale CC evidence.
6. Test a separate new thread, an automated response, a bounce, and an outbound mailbox message. Only the separate eligible customer thread may receive an acknowledgement.
7. Simulate a known send failure and an uncertain outcome. Confirm both are visible in case history, every guided and advanced reply control is disabled during uncertainty, and sync health stays degraded while rotating through all unresolved operations until deterministic Gmail reconciliation succeeds. For a synthetic genuine no-send outcome, require the latest versioned Gmail search to complete with exactly zero results, inspect the original thread, use the explicit not-delivered confirmation, confirm the actor and redacted resolution event are recorded, and only then send one controlled follow-up. Provider errors, ambiguous results, and stale or in-flight search versions must not permit that confirmation.
8. Return Hub mode to `disabled` after the isolated window unless the owner has approved the production cutover below.

## Atomic production cutover

All items require recorded evidence on `#688` and linked UAT evidence before active mode:

- Gmail OAuth, label ownership, privacy/retention approval, and synthetic core smoke in `#634` are complete.
- Participant classification and current mapped-manager CC acceptance in `#686` are complete.
- The legacy inventory above is complete and names the single authoritative sender.
- Shadow results show the intended first-contact population with no unexpected recipients.
- The isolated synthetic test passes.
- The versioned copy and all public links are reviewed.
- The operations owner approves the bounded time window and exact rollback owner.

Within that window:

1. Set Hub mode to `disabled`.
2. Disable every inventoried legacy sender for the production population.
3. Verify the legacy sender is disabled using settings state and one synthetic no-response check. Do not infer success from the save click alone.
4. Record the UTC boundary as `REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT` so older threads cannot receive a backfilled acknowledgement.
5. Set `REFUND_GMAIL_LEGACY_RESPONDER_DISABLED=true` and `REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED=true` only after steps 2-4 are proven.
6. Set mode to `active` for the bounded window.
7. Send one new synthetic thread and repeat the no-duplicate checks before allowing the normal labeled population.
8. Monitor aggregate counts and case events. Any nonzero reconciliation-outstanding count must keep Gmail health degraded; never put message content or addresses in logs or GitHub evidence.

## Rollback

Rollback order prevents overlapping senders:

1. Set `REFUND_GMAIL_FIRST_CONTACT_MODE=disabled` and verify Hub no longer claims new first-contact operations.
2. Preserve the operation ledger and case events for reconciliation; do not delete them.
3. Reconcile any `pending_send` or `delivery_unknown` operation against the original Gmail thread before responding manually. A no-match does not clear the block automatically; use the audited portal resolution only after an authorized person verifies the exact message is absent.
4. Restore the legacy responder only after Hub disablement is verified.
5. Reset both cutover acknowledgements to false when the approval window ends.

Hosted-form intake and manual portal case handling stay available throughout Gmail rollback.

## Evidence allowed in GitHub

Post only synthetic case references, template version, mode, UTC timestamps, aggregate eligible/sent/suppressed/failed counts, and pass/fail results. Do not post customer content, email addresses, raw headers, payment data, Gmail message or thread IDs, OAuth values, rule bodies containing personal data, or screenshots of a real inbox.
