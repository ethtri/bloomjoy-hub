# Refund Email Assistant Pilot — 3-Minute Sponsor Review

Last updated: 2026-08-10

## What this review is for

You are deciding whether the proposed customer and Machine Manager experience feels right—and whether the team may run one isolated test using fake customer information.

Approving this packet does **not** approve live customer traffic, production automation, or live refunds. Those decisions come later.

## The proposed journey

### 1. The customer emails Info/Support

The customer receives one friendly acknowledgement with one clear next step: complete the Bloomjoy refund form on our website. It is sent only for the first eligible email, so replies do not trigger the same message again.

The pilot checks for new email every 10 minutes and targets a response within 15 minutes. The first message does not CC a manager because the customer has not identified the machine yet.

### 2. The customer completes the Bloomjoy form

The form adds the missing details to the same request rather than creating a second independent case. It asks only for useful information such as the machine, date, approximate time, amount, payment method, and safe last-four information when applicable. Attachments are disabled.

### 3. The assistant organizes the request

The assistant identifies missing information, possible duplicate requests, likely transaction matches, and cases that are waiting too long. It can organize the case and prepare approved customer messages. It cannot decide whether a refund should be granted.

### 4. The assistant asks useful follow-up questions

If information is missing, the customer receives a humble, specific message asking only for what is needed. Once the machine is known, the currently assigned Machine Manager is visibly CC'd on case-specific customer emails.

If Apple Pay, a mobile wallet, or tap-to-pay digits do not match, the customer is not blamed. The message explains that wallets may use different last-four digits and offers a safe correction step.

### 5. The manager receives an action-ready case

The manager sees the request, relevant evidence, any duplicate or uncertainty warning, how long it has been waiting, and a direct link to the exact case. The manager reviews the evidence and makes the official decision in the Bloomjoy portal.

### 6. The customer is updated after a confirmed outcome

The assistant cannot approve, decline, select a Nayax transaction, execute a refund, or claim success. A success message is allowed only after the manager's official action and provider success are confirmed. Live Nayax refunds are a later, separately approved stage.

## Common situations

| Situation | What happens |
| --- | --- |
| The request is complete with one likely transaction | The manager receives the organized evidence and exact case link, then decides what to do. |
| Date, time, amount, or machine is missing | The assistant asks only for the missing information in the original email thread. |
| Mobile-wallet digits do not match | The assistant explains the likely reason and offers a safe correction step. |
| Email and website requests may be duplicates | Official action is held until a manager marks them as the same incident or different purchases. |
| No clean transaction match exists | The case remains open and goes to a manager; the customer is not promised a refund. |
| A case is waiting too long | The assigned manager receives a reminder with the exact case link. |

## What stays unchanged during the pilot

- EasyText and the SMS-to-Google-Form experience are not changed.
- The existing email auto-responder remains until a separate no-overlap cutover is approved.
- Website intake and manual portal work remain available if email automation is stopped.
- Support mail is not forwarded into a personal inbox.
- Official decisions remain with the Machine Manager assigned in Admin > Machines.

## Recommended safety and privacy defaults

- Use synthetic customer and payment information for the controlled test.
- Disable attachments.
- Allow only the first generic form-link message to send without a manager CC.
- Require the current assigned manager(s) to be visibly CC'd on every later case-specific customer email.
- Remove copied Gmail message and recipient content from the Hub after 180 days; retain the separately governed case and audit record.
- Turn on only the minimum isolated-test settings during the approved window, then turn them off immediately afterward.

## The five decisions we need from you

1. **Journey:** Does the six-step journey match how you want refunds handled?
2. **First message:** Are you comfortable with the first generic form-link message having no manager CC because the machine is not yet known?
3. **Manager visibility:** Are you comfortable visibly CCing the assigned manager(s) on later case-specific customer emails?
4. **Privacy:** Do you approve attachments being disabled and the proposed 180-day limit for copied Gmail content in the Hub?
5. **Controlled test:** If the above looks right, may the team prepare one isolated test using synthetic information and return with the results?

You can respond with **Approved for a controlled synthetic test**, **Approved with changes**, or **Not ready**. Production approval will be requested separately.

## What happens after approval

1. We verify the mailbox connection, refund label, alias/send-as status, and existing auto-responder without contacting customers.
2. We privately name the synthetic sender, reviewer, test window, stop contact, and rollback owner.
3. We run one email journey through the manager-visible case, with no official refund or live Nayax action.
4. We turn the test settings off and give you a short pass/fail summary before any production decision.
