# Refund Email Assistant Operating Runbook

Last updated: 2026-08-03

Status: approved operating direction; production Gmail, automatic customer follow-up, manager CC, official manager actions, and live Nayax execution remain disabled until their separate release gates pass.

Tracking epic: [#683 Refund Email Assistant and Manager Communications](https://github.com/ethtri/bloomjoy-hub/issues/683)

## Plain-English outcome

The email assistant helps Bloomjoy receive, organize, and advance refund requests. It acknowledges new conversations, identifies missing information, keeps customer follow-up moving, and reminds the right Machine Managers with a link to the exact portal case.

The assistant is not a refund approver and is not a payment operator. The target production actor for every official decision is a currently active Machine Manager mapped to the machine, acting in the authenticated Refunds portal. A link in an email may open a case; opening the link never changes the case or sends money.

## Source-of-truth boundaries

- Gmail is the customer conversation transport.
- Bloomjoy Hub is the system of record for the refund case, status, matching evidence, manager decision, provider attempt, reporting adjustment, and audit history.
- Nayax/Lynx is the card-transaction and refund provider, subject to the account-specific production gate in `#430`.
- The legacy Google Form/Sheet/AppSheet process remains the fallback until its separate cutover approval.
- A local Codex mailbox connection may let an authorized agent read, search, label, and prepare drafts in the designated mailbox. That convenience connection does not configure or enable the production Hub Gmail integration in `#634`.

Do not forward the designated support mailbox into a personal inbox. Agents and operators should work from the label-scoped support mailbox and the Hub queue. Personal inboxes should receive only intentionally routed exception or executive-attention notices.

## Authority matrix

| Activity | Email assistant | Machine Manager | Hub service |
| --- | --- | --- | --- |
| Read a labeled refund thread | Yes, within approved mailbox access | Through the linked case when authorized | Yes, through label-scoped Gmail sync |
| Create or link an incomplete case | Yes, through the intake service | No manual copy/paste required | Yes, idempotently |
| Extract permitted refund facts | Yes, under strict schema and policy | May correct/confirm in the portal | Yes, deterministically and through reviewed GPT assistance |
| Send an approved deterministic acknowledgement/correction request | Yes, only for the allowed classes below | Can see the result | Yes, with idempotency and kill switch |
| Send GPT-authored or free-form text | Draft only | Reviews, edits, and sends | Must enforce human approval |
| Select the final Nayax transaction | No | Confirms the recommended transaction in the portal | May recommend one safe candidate; never treats the match as proof of failed delivery |
| Approve or decline a refund | No | Yes, in the authenticated portal | Enforces scope, audit, and coherent state |
| Call Nayax refund endpoints | No | Only by confirming the portal action | Yes, server-side only after manager approval and `#430` release gates |
| Retry/reconcile an unknown provider result | No | Uses the portal recovery flow | Never retries blindly |
| Choose fallback compensation | No | Uses the approved portal workflow | Only after the policy in `#666` is decided and the prior provider result is known |

The Gmail OAuth identity, automation scheduler, GPT runner, and agent tools must not possess a privileged path that can approve, decline, or invoke a Nayax refund.

Current portal authorization also permits Super Admins and some machine-scoped Scoped Admins to manage cases. That is a known target-state gap tracked in `#689`. During the production pilot, those roles may assist with setup and review but do not perform an official decision or Nayax action unless Bloomjoy separately approves a reason-required, audited break-glass policy.

A valid mapped-manager login is necessary but not sufficient. `#689` must refuse to mint an official-action receipt without a recent TOTP authentication event, and `#692` must require the manager to complete a new TOTP challenge after reviewing the exact action. The challenge is bound to the case, action, case/evidence versions, and amount; any change requires a new challenge. TOTP codes, factor identifiers, secrets, QR material, and raw tokens are never stored in refund records or logs. Agent-controlled and shared browser sessions may review work but are prohibited from official payment actions.

## End-to-end operating flow

1. Gmail receives a message at the designated Info/Support/Refunds mailbox.
2. A mailbox-owned rule applies the permanent refund intake label. The production integration does not reorganize unrelated mail.
3. Label-scoped Gmail sync creates one draft case or appends the message to the existing case/thread.
4. The first eligible customer message in a Gmail thread receives one approved acknowledgement. Replays and later replies do not.
5. The case is checked for the required transaction facts.
6. If facts are missing, an approved deterministic template asks only for those facts. If safe routing cannot be determined, the assistant prepares a human-reviewed draft instead.
7. If wallet/device digits may be the problem, the existing short-lived secure wallet-correction flow is used. The customer is never asked to email a full card number or wallet screenshot.
8. The deterministic Nayax matcher either recommends one safe transaction or returns a clear manual/no-safe-match state.
9. When a safe candidate is ready, or an actionable case is aging, blocked by setup/mapping, delivery-held, no-match, or otherwise needs a person, the currently mapped Machine Managers receive one sanitized notice with the canonical `/refunds?case=<case-id>` link and the correct next action.
10. The Machine Manager opens the portal, reviews the customer request and match evidence, and chooses the official action.
11. The portal freezes the exact action context and asks the manager to personally complete a fresh TOTP challenge. Cancellation, stale verification, mapping/case/evidence change, or a shared/agent session fails closed.
12. After the action-bound manager verification, the guarded backend attempts Nayax execution. The case completes only after confirmed provider success.
13. Provider success creates one customer-facing completion-message operation with the active mapped-manager set CC'd. It does not create a second internal manager completion email. Rejection or unknown provider state sends no success message.

## Required refund facts

The assistant and matcher may work only with the permitted fields:

- machine location or public machine description;
- purchase date;
- approximate local purchase time;
- payment method;
- amount paid;
- last four digits only when applicable;
- whether a mobile wallet was used;
- the wallet/device last four through the secure correction flow when needed.

Never request or use a full card number, CVV, expiration date, PIN, bank login, wallet password, authentication code, or wallet screenshot. Email cannot prevent a customer from voluntarily sending prohibited payment data; if received, redact it before persistence and route it under the existing Gmail safety policy. Do not ask for a generic payment-screen photo when a smaller structured correction can resolve the case.

## Matching and next-action rules

### Strong physical-card path

One transaction may be recommended only when the versioned matching policy leaves exactly one safe candidate for the mapped machine, exact amount, resolved time window, and matching last four. The match supports the manager decision; it does not prove a vend failure.

### Mobile-wallet/contactless path

A physical-card versus wallet/device last-four mismatch is expected and must not be ignored or treated as customer error. Use the secure correction link, preserve trusted machine/QR evidence, and re-run deterministic matching once. A uniquely verified QR/time result may become execution-eligible only under the approved versioned policy.

### Incomplete or no-safe-match path

- Ask only for missing or genuinely correctable information.
- If complete information still produces no safe match, humbly confirm the safe facts already received and offer the approved correction path.
- If multiple plausible candidates remain, ask another question only when the answer can actually disambiguate them.
- Provider outage, missing setup, rejection, or unknown outcome is an internal exception. Do not imply that the customer gave bad information.
- Bounded attempts that remain unmatched move toward the owner-approved fallback in `#666`; the assistant does not invent a remedy.

## Communication policy

### Automatic messages allowed after their implementation and rollout gates pass

- exactly-once first-contact acknowledgement;
- request for exact missing structured fields;
- secure wallet/device-last-four correction link;
- complete-details/no-safe-match confirmation with a safe correction option;
- one bounded waiting-on-customer reminder;
- information-received confirmation at most once per explicit correction-request cycle, only when no acknowledgement already covers that event, and never on every customer reply;
- provider-success completion message only after an authorized portal action and confirmed provider success.

Every automatic message uses a versioned deterministic template, a durable operation key, a bounded contact policy, and a kill switch. An arbitrary GPT completion is never an automatic outbound message.

### Human review required

- GPT-authored or materially free-form copy;
- approval, denial, or compensation language;
- legal, safety, threat, chargeback, abusive/escalated, high-value, unrelated, uncertain, low-confidence, or non-English content;
- provider outage, incomplete setup, rejection, timeout, or unknown result;
- any case where the customer, machine, participant, or recipient mapping is uncertain.

### Customer voice standard

Every customer template must:

- open with empathy or thanks;
- acknowledge the inconvenience without sounding scripted or defensive;
- describe what Bloomjoy is doing rather than what the customer did wrong;
- give one clear next step;
- ask only for necessary information;
- avoid internal terms such as Nayax confidence classes, provider states, or case-routing names;
- avoid guarantees or unsupported timeline promises;
- include the public case reference;
- close warmly and invite the customer to reply in the same thread.

Preferred language is short, plain, humble, and specific. For example, use “We were not able to confidently match one transaction yet” rather than “You entered the wrong card details.”

## Manager CC and participant safety

Once a machine is resolved, customer communications CC only the currently active, non-revoked Machine Managers returned by the authoritative portal mapping at send time.

- The customer remains the To recipient.
- Visible CC may expose manager work addresses to the customer and other mapped managers; production requires an approved recipient/privacy review and synthetic pilot identities.
- Before the machine is resolved, the first acknowledgement may send without a manager CC and must create an operations-triage signal. Never guess a manager.
- A zero-manager or malformed mapping must not block respectful customer service. It creates an internal exception and uses only the approved operations fallback.
- Customer-visible messages contain no internal case URL, internal note, provider identifier, or complaint analysis.
- Managers receive a separate sanitized notice containing the public reference, public machine/location, safe status/age, one next action, and canonical `/refunds?case=<case-id>` link only when manager action is needed. Completion uses the single customer-facing message with manager CC and does not duplicate that confirmation.
- A manager Reply All is manager correspondence, not customer evidence. The Gmail ingestion model must classify customer, mapped manager, Bloomjoy mailbox, automated system, and unknown sender before CC is enabled.
- Any sender who is not the verified customer—including an unknown or forwarded participant, mailbox alias, revoked/former manager, or spoof-suspected sender—cannot update customer facts, clear a waiting-on-customer state, start customer GPT triage, or trigger automatic customer follow-up.
- Customer, mailbox, duplicate, revoked, malformed, and unrelated fallback addresses must not appear in the manager CC set.
- Recipient addresses and CC lists must not appear in logs, health output, GitHub evidence, or unauthorized browser data.

## First-contact acknowledgement and legacy responder cutover

“First contact” means the first eligible inbound customer message in one provider Gmail thread.

- Claim one durable operation key for the thread before sending.
- Do not trigger on bounces, mailing lists, bulk/automated messages, outbound messages, or later replies.
- Use standard automatic-response suppression headers.
- A known send failure becomes visible retry work. Uncertain delivery is reconciled and never retried blindly.
- While the legacy responder remains authoritative, the Hub runs in “would send” shadow mode with no outbound delivery. Any active-send proof uses an isolated synthetic test mailbox or label that the legacy responder cannot see.
- Cutover is atomic: disable and verify the legacy sender first, then enable the Hub sender for a bounded synthetic check. At no point may both responders be active for the same thread population.
- Keep a documented instant rollback that disables the Hub sender before re-enabling the legacy sender, so only one responder is ever active.

## Mailbox organization

Use one permanent Gmail intake label owned by mailbox configuration, such as `Refund Operations`. The Hub reads only that explicit label.

The Hub—not Gmail sublabels—is authoritative for operational state:

- Inbox triage;
- waiting on customer;
- ready for manager;
- blocked/exception;
- completed/closed.

Agents should work the Hub queue and labeled mailbox rather than scanning all mail. Closed conversations may be archived by an authorized human/mailbox rule; the production Gmail integration retains least privilege and does not delete, archive, mark read, or relabel unrelated messages.

## Proposed pilot cadence and service targets

These are planning targets owned by `#685`, not live customer commitments. The 30-minute business-hours target requires an Operations owner and staffing coverage decision; the business-day reminder/escalation targets require scheduler implementation and fixture proof before customer-facing wording may use them.

- Gmail ingestion: every 10 minutes, 24/7, when enabled.
- GPT draft preparation: every 10 minutes, staggered after ingestion, when enabled.
- Automation sweep: every 15 minutes, subject to the configured customer-contact window, when enabled.
- New labeled mail target: visible in the Hub within 15 minutes.
- Business-hours triage target: within 30 minutes.
- Waiting-on-customer reminder: after two business days, at most once for the same case/state.
- Manager escalation: before the five-business-day customer target.

Business-day wording and scheduler calculations must agree. Resolved, closed, denied, newly customer-updated, or delivery-held cases receive no stale reminders.

## Failure and recovery rules

- Hard bounce pauses automatic customer mail and creates a manager-visible exception with the exact case link.
- Automatic contact resumes after a hard bounce only when an authorized operator corrects/approves the recipient and the system records a new bounded contact operation; it never resumes from an ordinary case replay.
- Gmail authorization revocation disables only the Gmail lane. Hosted-form intake and portal work continue.
- Gmail-linked automatic replies must use the original Gmail thread transport; they must not create a separate Resend conversation.
- Scheduler failure produces aggregate, PII-free health alerts and does not block portal work.
- A mapping change or revocation is re-evaluated immediately before the next manager notice or customer CC.
- Provider rejection leaves the case open and sends no success message.
- Provider timeout/unknown status creates reconciliation work. Never retry blindly or issue fallback compensation until the prior outcome is known not to have succeeded.
- All automatic lanes have a quick-disable switch that leaves intake and manual portal handling available.

## Agent procedure

1. Verify the connected mailbox identity is the designated support mailbox before reading or drafting.
2. Work only threads in the approved refund label or a case explicitly supplied by an authorized user.
3. Open the linked Hub case and read the case status before drafting.
4. Summarize the request using only permitted fields; do not copy sensitive free text into notes or GitHub.
5. Check whether the case is waiting on the customer, ready for a manager, blocked by setup/provider state, or complete.
6. If an approved deterministic message is already due, do not create a second draft or send.
7. For human-review states, prepare one concise customer-centric draft asking only for the next necessary information.
8. For manager action, provide the separate canonical case link; never place an action-performing link in customer email.
9. Escalate legal/safety/chargeback/high-value/uncertain content without drafting an automatic response.
10. Never approve, decline, promise, retry, reconcile, or execute a refund from email.

## Rollout sequence

1. Documentation and policy: `#684`.
2. Exactly-once first contact and legacy cutover: `#688`.
3. Participant-safe thread transport and mapped-manager CC: `#686`.
4. Deterministic customer follow-up and versioned copy: `#687`.
5. Mapped-manager aging reminders and canonical links: `#685` plus scheduler foundation `#632`.
6. Designated production Gmail connection and retention/quarantine approval: `#634`.
7. Human-reviewed GPT evaluation and data controls: `#635`.
8. Mapped Machine Manager-only official-action enforcement: `#689`.
9. One-manager portal approval and provider execution gate: `#674` and `#430`.
10. Terminal unmatched/cash fallback: `#666`.
11. Synthetic shadow pilot, quick-disable proof, and sponsor go/no-go before broad enablement.

## Success measures

- zero duplicate first-contact acknowledgements;
- zero email-originated refund decisions or Nayax calls;
- zero unauthorized manager recipients;
- zero manager Reply All messages misclassified as customer replies;
- zero success emails before confirmed provider success;
- percentage of labeled mail linked to one case within 15 minutes;
- missing-field accuracy and deterministic message suppression rate;
- manager reminder-to-case-open rate and aging backlog;
- customer reply time and percentage resolved without unnecessary questions;
- template edit/escalation rate and customer-safety findings;
- Gmail, scheduler, and delivery health with no PII in telemetry.

## Production gates that remain open

- designated production Gmail OAuth, label ownership, and synthetic smoke (`#634`);
- 180-day copied-content retention and attachment quarantine approval;
- visible CC recipient/privacy review and participant-classification UAT (`#686`);
- mapped Machine Manager-only official-action enforcement or a separately approved break-glass policy (`#689`);
- OpenAI retention/data-control approval for GPT (`#635`);
- Nayax account-specific write contract and controlled live pilot (`#430`);
- alternative compensation decision (`#666`);
- clean Machine Manager-only production UAT and legacy cutover approval.
