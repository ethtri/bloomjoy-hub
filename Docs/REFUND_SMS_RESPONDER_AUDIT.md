# Refund SMS Responder Readiness Audit

Status: **RED — not ready for a live refund pilot**

Last audited: 2026-08-04

Tracking: GitHub issue `#704`; pilot readiness epic `#707`

## Plain-English outcome

Bloomjoy should keep the fast SMS-to-Google-Form experience during the soft cutover, but the current responder cannot yet be treated as a dependable pilot control. The read-only audit did not identify a verified, working production SMS automation. A signed-in GoDaddy Conversations workspace has no Phone & SMS number connected, while historical account mail says the known Twilio messaging account was suspended after its balance reached zero.

No live messages were sent, no customer-facing configuration was changed, and no credentials were entered or rotated during this audit.

The Google Form itself is publicly reachable without sign-in and its sanitized field contract is recorded below. The response Sheet, notification ownership, actual SMS trigger, message template, delivery alerts, loop suppression, opt-out handling, owner, backup, kill switch, and rollback procedure remain unverified. The pilot must not rely on the SMS lane until the owner-supervised verification window in this runbook passes.

## Read-only evidence

| Area | Verified fact | Pilot implication |
| --- | --- | --- |
| GoDaddy Conversations | The signed-in, separate business workspace has an active Conversations area, but its Phone & SMS channel says no phone number is connected. | This workspace is not evidence of the current refund-text responder. Do not connect a number or change the account as part of this audit. |
| Historical Twilio path | Account mail dated 2026-06-17 says the known Twilio account was suspended because its balance was empty and could not send or receive SMS. The console was signed out during this audit. | Twilio is a historical candidate, not a verified live responder. Account status, number ownership, configuration, compliance, and billing require owner-supervised access. |
| Public Google Form | The current legacy refund Form opens without Google sign-in and presents the expected two-page path. No attachment or file-upload question was observed. | The customer destination is available, but public reachability alone does not prove the SMS automation or response Sheet is healthy. |
| Hub bridge | Draft PR `#708` implements a default-off, read-only Sheet-to-Hub bridge with a strict 11-column contract, aggregate health, quarantine, and independent kill switches. | The bridge is not production-enabled and must not be used as evidence that SMS delivery works. |

The audit deliberately records no phone number, account identifier, Form or Sheet identifier, customer message, provider payload, or credential.

## Readiness scorecard

| Gate | State | Evidence still required |
| --- | --- | --- |
| Current provider and account identified | RED | Owner signs into the actual provider and confirms the Bloomjoy business workspace without copying secret identifiers into GitHub. |
| Inbound business number identified | RED | Record a private owner-held inventory entry and a sanitized GitHub label such as `primary refund SMS line`; do not post digits. |
| Primary owner and backup named | RED | Both people demonstrate access and know how to test, disable, restore, and troubleshoot. |
| Trigger and firing rule understood | RED | Prove whether the response fires per message, per conversation, or under another rule. |
| Humble current template and Form link | RED | Review the live template privately and prove it contains the current link once. |
| Loop, retry, bot, STOP, and HELP controls | RED | Provider-supported synthetic tests pass without a response burst or prohibited follow-up. |
| Delivery and dead-link alerting | RED | A PII-free visible alert reaches the named owner and backup. |
| SMS/email/Hub independence | RED | Disabling the SMS responder does not disable the email responder, hosted Form, Hub queue, or Sheet bridge. |
| Same-day rollback | RED | Disable and restore are timed and evidenced in an owner-supervised window. |
| Google Form public contract | AMBER | Public Form and questions are verified; response Sheet destination, access, notifications, and exact active location count must be privately verified. |
| One synthetic inbound-to-response test | RED | One approved test handset receives one response within 60 seconds; no customer number is used. |

Overall: **NO-GO for the SMS-dependent pilot lane.** Website intake and manual Hub work can continue independently. This finding does not authorize disabling or replacing any live responder.

## Target pilot behavior

The intended rule is one immediate first-contact response per sender/conversation window, not one response to every inbound message. The default pilot target is:

- first eligible inbound receives one response within 60 seconds;
- later messages from the same sender receive no additional automated Form response for 24 hours;
- provider redelivery, retry, bot/automated replies, STOP, and HELP never trigger the Bloomjoy Form response;
- after 24 hours, one new first-contact response may be sent only if the provider can do so without breaking opt-out or conversation state;
- any platform that cannot enforce this safely remains disabled for the pilot until a bounded replacement is approved.

The 24-hour suppression window is the desired pilot control, not a claim about the current provider configuration. Record the actual rule during supervised UAT.

## Customer-facing copy target

The responder should be humble, friendly, and clear without promising approval or payment:

> Hi — thanks for reaching out to Bloomjoy, and we’re sorry something went wrong. Please share the purchase details in this short refund request form: `{{CURRENT_GOOGLE_FORM_LINK}}`. Our team will review it and follow up. If you already submitted the form, you do not need to submit it again.

Add only the opt-out or compliance language required and generated by the approved provider. Do not use the responder to say that a refund is approved, completed, guaranteed, or being processed. Official decisions and refund actions remain with the mapped Machine Manager in the Hub portal.

## Sanitized Google Form contract

The customer experience has two pages. The response Sheet contract contains exactly the following 11 columns. `Timestamp` is response metadata rather than a customer question.

| Response column | Form requirement | Pilot treatment |
| --- | --- | --- |
| Timestamp | Generated by Google | Source submission time and bridge cutover boundary. |
| Your Name | Required | Customer name. |
| Email Address | Required | Customer follow-up address. |
| Location of Purchase | Required | Customer selects from approximately 46 visible choices; the exact active count must be rechecked before go-live. The Hub bridge accepts only one exact canonical machine mapping. |
| Date and Time of Incident | Optional | Customer-reported time; never treated as verified transaction time. |
| Incident Description | Required | Customer issue summary. |
| Request Amount | Optional | Validated amount; invalid or missing values keep the Hub case incomplete. |
| Payment Method | Optional | Card, Apple/Google Pay, or Cash. |
| Last 4 digits of the credit card used | Optional | Four digits only. Wallet/device digits remain customer-reported. |
| Refund Payment Preference | Cash page only | Venmo, Zelle, or no refund requested. |
| Venmo/Zelle Payment ID | Cash page only | Sensitive follow-up value; never copied into logs, issue evidence, or quarantine output. |

No attachment or file-upload question was observed. Adding any response column, including a file-upload link, must stop the bridge contract check until privacy, malware, access, and retention controls are approved.

The Form-to-Hub handoff belongs to `#702` and draft PR `#708`. The Sheet is temporary transport, not a manager queue or system of record.

## Owner-supervised verification window

### Preconditions

1. Name the primary operations owner and a backup on `#704`.
2. Privately identify the approved provider workspace and business number. Store credentials only in the provider/password manager, never in the repository or GitHub.
3. Confirm billing/account status and any registration or toll-free verification requirement.
4. Choose an owner-controlled test handset and a synthetic contact identity. Do not use a customer conversation.
5. Capture the known-good responder state privately: trigger name, firing rule, template version, link target, suppression window, alert destination, and disable/restore controls. GitHub evidence stays aggregate and redacted.
6. Confirm the public Form opens in a signed-out mobile browser and that the owner can locate the linked response Sheet and notification settings.
7. Agree to the stop conditions below before sending the first test.

### Test sequence

1. **Baseline:** send one synthetic inbound text. Require one response within 60 seconds, one current Form link, humble copy, and no refund promise.
2. **Repeat inbound:** send two ordinary follow-ups inside five minutes. Require zero additional automated Form responses.
3. **Provider redelivery:** use the provider's safe test/sandbox mechanism, if available, to replay the inbound event. Require no duplicate response.
4. **Automated sender:** use an approved synthetic bot/auto-reply fixture. Require no uncontrolled back-and-forth.
5. **STOP and HELP:** use the provider's documented test method or designated test line. Confirm carrier/provider handling, suppression, and help behavior before any Bloomjoy reply. Do not perform this on a customer thread.
6. **Delivery failure:** use a provider-supported failure fixture. Require a visible PII-free alert to both owner and backup, with no blind retry burst.
7. **Dead-link monitoring:** point the health check at an approved invalid synthetic URL or provider sandbox, not the live template. Require an alert without customer or provider identifiers.
8. **Independent disable:** turn off only the SMS automation. Confirm the email responder, hosted website Form, Hub queue, and default-off Sheet bridge remain available.
9. **Restore:** restore the exact known-good SMS version. Repeat the baseline test and time the complete disable/restore exercise. Target 15 minutes; acceptance remains same-day at maximum.
10. **Evidence:** post only pass/fail, timestamps, response latency, response count, alert receipt, rollback duration, and the named owner/backup roles to `#704`.

If the actual platform cannot safely simulate STOP, HELP, redelivery, or delivery failure, record that limitation and test the smallest owner-controlled alternative approved by the provider. Do not improvise with real customer traffic.

## Monitoring and incident ownership

Before go-live, the SMS lane needs all of the following:

- a link-health probe that does not submit the Form and alerts on an unreachable or redirected destination;
- provider delivery-failure visibility and a PII-free alert route owned by both primary and backup;
- a daily aggregate check of inbound eligible events, responder attempts, successes, suppressions, and failures;
- a documented escalation path if the response target is missed or the account is suspended;
- an independent kill switch whose location and required role are known to both owners;
- a private credential/number inventory and a sanitized GitHub operational record;
- a monthly owner access check plus an immediate check after provider billing, registration, or account-status notices.

Agents may read aggregate health and prepare reminders. They must not disclose customer text content, change provider configuration, send live tests, or restore a disabled lane without the owner-supervised procedure.

## Stop conditions

Disable only the affected SMS automation and pause SMS-dependent pilot entry if any of these occurs:

- more than one automated Form response is sent inside the suppression window;
- STOP, HELP, an automated reply, or provider redelivery triggers the Bloomjoy Form response;
- the Form link is dead, redirects unexpectedly, or requires sign-in;
- delivery failures are invisible or repeatedly retried;
- provider billing, registration, verification, or account state blocks reliable sending or receiving;
- customer data, message text, phone digits, provider identifiers, or credentials appear in logs or GitHub evidence;
- the SMS kill switch affects email, website intake, Hub work, or the Sheet bridge;
- the known-good version cannot be restored within the same day.

If the provider outcome is unknown, do not blindly retry. Preserve the aggregate incident evidence, keep website intake/manual Hub work available, and escalate to the primary owner and backup.

## Go-live evidence template

Post this sanitized checklist to `#704` after the supervised window:

- Primary owner role: `assigned / missing`
- Backup owner role: `assigned / missing`
- Provider/account privately verified: `pass / fail`
- Business-number inventory privately verified: `pass / fail`
- Account billing/registration state: `pass / fail`
- Public Form and two-page contract: `pass / fail`
- Response Sheet and notifications owner: `pass / fail`
- Baseline latency seconds: aggregate number only
- Baseline automated response count: aggregate number only
- Repeat/redelivery/bot response counts: aggregate numbers only
- STOP/HELP behavior: `pass / fail / provider test unavailable`
- Delivery/dead-link alert received by owner and backup: `pass / fail`
- Independent disable: `pass / fail`
- Restore duration minutes: aggregate number only
- Post-restore baseline: `pass / fail`
- Customer data in evidence: `zero required`
- Owner decision: `go / no-go`

Do not mark `#704` complete until every acceptance criterion has evidence or the pilot explicitly removes SMS from scope.
