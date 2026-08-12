# Refund Email Pilot UAT Script

Last updated: 2026-08-12

Use only after the sponsor explicitly approves a controlled isolated-inbox test. This script stops at **manager-ready**. It does not authorize an official decision, TOTP consumption, Nayax call, settlement, or customer success message.

## Current evidence checkpoint

- **Passed:** isolated label/sender and legacy-responder exclusion; one original-thread first-contact acknowledgement; replay and later-reply suppression; hosted-form CTA only; no pre-mapping CC or attachment; teardown to disabled.
- **Passed after `#773`/`#774`:** the private form completed the existing Gmail draft exactly once, could not create a duplicate through replay, and applied the shared sole-current-manager assignment rule used by direct intake.
- **Still required:** step 10's case-specific original-thread reply with the complete current mapped-manager CC set, plus final active-cutover/rollback approval. Until then, Hub schedules and automatic contact remain off and the legacy responder remains authoritative for normal mail.

## Before the window

- Confirm the dedicated isolated Gmail label differs from production and is excluded from every legacy responder.
- Confirm only owner-controlled synthetic senders are allowlisted.
- Confirm the designated mailbox, label, OAuth scopes, ten-minute polling limitation, staffed window, stop conditions, and rollback owner.
- Confirm website and Gmail attachments are disabled.
- Confirm Gmail/contact switches are enabled only for isolated-test mode; manager aging, GPT, official actions, and Nayax remain off.
- Record only safe configuration fingerprints and aggregate evidence.

## Controlled journey

1. Send one new synthetic human email with no machine, amount, payment details, or internal reference.
2. Verify exactly one original-thread acknowledgement arrives within 15 minutes of receipt, record the elapsed time, and treat the ten-minute polling interval plus workflow startup as the expected mechanism rather than an instant webhook.
3. Verify the message has one Bloomjoy hosted-form CTA, no Google Form CTA, customer-only To, no CC, safe automatic-response headers, and no internal case link.
4. Replay the sync and reply in the same thread. Verify no second acknowledgement.
5. Open the private form link. Verify no photo/file control appears.
6. Submit safe synthetic machine, date/time, amount, payment method, last four, wallet flag, and issue summary.
7. Verify the Gmail draft becomes one manager-ready case, not two cases, and the private context cannot be reused.
8. Open the exact manager link. Verify navigation performs no lookup, message, update, TOTP, or provider call.
9. Verify the queue shows Support email, the correct operational signals, and the mapped manager from Admin > Machines.
10. Exercise one missing-information case, review the humble editable draft, then send that one synthetic case-specific reply in the original thread. Verify the full current portal-mapped manager set is visible in CC and no unrelated recipient is present.
11. Create two synthetic website/email duplicate pairs. Verify official controls are disabled, then record one as the same incident and the other as genuinely different purchases; neither review may call Gmail, TOTP, Nayax, or settlement.
12. Send a bot/automated message, bounce fixture, list/bulk fixture, and mailbox-origin message. Verify none receives first contact or changes customer evidence.

## Stop immediately if

- the legacy responder and Hub both reply;
- a second acknowledgement is sent;
- a Google Form link appears in email;
- a manager address is CC'd before the machine is known;
- the hosted form creates an unflagged second actionable case;
- an attachment is accepted or copied;
- an unrelated inbox message is touched;
- a navigation action causes a lookup, message, mutation, TOTP, or provider call;
- any secret, real customer data, payment data, or identifier appears in evidence.

## Teardown

1. Disable isolated first contact, Gmail sync, and automatic customer contact.
2. Verify zero new claims/sends after disablement.
3. Reconcile any uncertain delivery.
4. Remove or expire the isolated sender allowlist and record the safe teardown result.
5. Preserve the sanitized evidence packet and record a separate sponsor go/no-go. Do not advance to production automatically.
