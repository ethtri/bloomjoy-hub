# Refund Email Assistant Operating Runbook

Last updated: 2026-08-05

Status: approved operating direction. The safety slices described below are implemented for review in an unmerged integration candidate; production Gmail, automatic customer follow-up, manager CC, manager aging, retention cleanup, GPT, official manager actions, and live Nayax execution remain disabled until their separate release gates pass.

Tracking epic: [#683 Refund Email Assistant and Manager Communications](https://github.com/ethtri/bloomjoy-hub/issues/683)

## Plain-English outcome

The email assistant helps Bloomjoy receive, organize, and advance refund requests. It acknowledges new conversations, identifies missing information, keeps customer follow-up moving, and reminds the right Machine Managers with a link to the exact portal case.

The assistant is not a refund approver and is not a payment operator. The target production actor for every official decision is a currently active Machine Manager mapped to the machine, acting in the authenticated Refunds portal. A link in an email may open a case; opening the link, selecting a queue row, or changing a filter performs no lookup, message, mutation, official action, or payment.

## Source-of-truth boundaries

- Gmail is the customer conversation transport.
- Bloomjoy Hub is the system of record for the refund case, status, matching evidence, manager decision, provider attempt, reporting adjustment, and audit history.
- Nayax/Lynx is the card-transaction and refund provider, subject to the account-specific production gate in `#430`.
- The legacy Google Form/Sheet/AppSheet process remains available to EasyText/SMS during the email-only pilot. Email customers use only the Bloomjoy hosted form.
- Agents use an owner-approved direct OAuth/delegated connection to the designated mailbox; they do not receive a forwarded copy in a personal inbox. That connection may let an authorized agent read, search, label, and prepare drafts within the approved refund scope, but it does not configure or enable the production Hub Gmail integration in `#634`.
- Info/Support aliases may route into the same designated mailbox. Treat a configured alias as Bloomjoy-mailbox-origin only when the alias is in the approved mailbox configuration and Gmail `SENT`-label evidence confirms the outbound message; an address string alone is not proof. The proposed `support@bloomjoysweets.com` alias and send-as state are currently **Pending**, not assumed.
- Sending from an alias requires the mailbox owner to configure and verify that Gmail send-as identity. Agents may prepare approved drafts, but they do not add or self-verify aliases or treat browser sign-in as production OAuth proof.

Do not forward the designated support mailbox into a personal inbox. Agents and operators should work from the label-scoped support mailbox and the Hub queue. Personal inboxes should receive only intentionally routed exception or executive-attention notices.

### Mailbox evidence observed on 2026-08-03

- An agent connection showed the `info@bloomjoysweets.com` mailbox profile and a `Refund Operations` label.
- That observation proves neither production Hub OAuth/secrets nor that a mailbox filter is populating the label correctly.
- The legacy automatic-responder inventory and cutover state are **Pending**.
- Any `support@bloomjoysweets.com` alias, verified send-as identity, and matching Gmail `SENT` evidence are **Pending**.
- A browser sign-in or agent connector is not a substitute for the server integration, and no forwarding into a personal inbox is part of the operating model.

## Authority matrix

| Activity | Email assistant | Machine Manager | Hub service |
| --- | --- | --- | --- |
| Read a labeled refund thread | Yes, within approved mailbox access | Through the linked case when authorized | Yes, through label-scoped Gmail sync |
| Create or link an incomplete case | Yes, through the intake service | No manual copy/paste required | Yes, idempotently |
| Extract permitted refund facts | Yes, under strict schema and policy | May correct/confirm in the portal | Yes, deterministically and through reviewed GPT assistance |
| Send the generic first-contact form link | Yes, once per eligible thread after the pre-mapping safety gates pass | Sees the linked case after the form identifies the machine | Yes, with one private context, no manager CC, idempotency, and kill switch |
| Send a case-specific acknowledgement/correction request | Yes, only after the current mapped-manager CC route passes | Can see the result | Yes, with send-time authorization, idempotency, and kill switch |
| Send GPT-authored or free-form text | Draft only | Reviews, edits, and sends | Must enforce human approval |
| Start a Nayax transaction lookup | No | Explicitly chooses **Check Nayax transaction** in the portal | Performs no lookup from a link, filter, or row selection; may recommend one safe candidate after the explicit check |
| Approve or decline a refund | No | Only the current mapped Machine Manager, personally completing the fresh per-action TOTP step-up in the authenticated portal | Enforces scope, step-up, audit, and coherent state; production controls stay hard-off |
| Call Nayax refund endpoints | No | Only by personally authorizing the frozen portal action after fresh step-up | Yes, server-side only after manager authorization and the separate `#430` and activation gates |
| Retry/reconcile an unknown provider result | No | Uses the portal recovery flow | Never retries blindly |
| Choose fallback compensation | No | Uses the approved portal workflow | Only after the policy in `#666` is decided and the prior provider result is known |

The Gmail OAuth identity, automation scheduler, GPT runner, and agent tools must not possess a privileged path that can approve, decline, or invoke a Nayax refund.

The unmerged `#689` implementation candidate keeps Super Admins, Scoped Admins, unrelated managers, revoked managers, service identities, email identities, schedulers, GPT, and agents in setup/review/customer-follow-up roles only. They cannot perform an official decision or Nayax action. A mapped manager who is also a Super Admin or Scoped Admin is also excluded from official pilot actions. A future break-glass path would require a separate owner-approved, reason-required, time-bounded, notified, immutable-audit policy; none exists today.

A valid mapped-manager login is necessary but not sufficient. The unmerged `#692` implementation candidate prepares one two-minute, single-use, single-live-per-actor intent after the manager reviews the exact action. The intent freezes the actor, case, action, target function, case version, active manager mapping/version, owner-approved enrollment version, amount and exact payload hash, and the applicable transaction/evidence fingerprint. The manager must personally enter a fresh code for the exact owner-approved, purpose-bound TOTP factor in a non-shared, non-agent-controlled session. The refreshed JWT must be AAL2 and contain exactly one parseable newest TOTP authentication timestamp strictly newer than the intent's whole second and no more than 30 seconds in the future; stale, same-second, refresh-only, future-skewed, ambiguous, or malformed evidence fails closed.

The trusted server flow mints a random 256-bit one-use proof to carry the successful challenge into the database; only its domain-separated digest is stored, while the raw proof is server-to-server only, is never logged, and is consumed once. The approved factor is also purpose-bound through a one-way hash rather than a stored factor identifier. Per-actor and row locks prevent concurrent preparation or consumption from authorizing two actions. Preparing a new intent supersedes the old one, and cancellation, expiry, replay, enrollment change, case/mapping/evidence drift, or a reused TOTP authentication invalidates it. Nayax execution rechecks its locked machine/account/refund-control fingerprint when the service consumes the receipt. First-factor enrollment and recovery are owner-targeted, short-lived, one-use, manager-only, and human-supervised; approval/audit recording is durable, and partial recording failure triggers durable revocation and a best-effort Auth-factor removal. TOTP codes, factor identifiers, secrets, QR material, raw JWTs, raw one-use proofs, and customer/payment payloads never enter refund records, logs, screenshots, support evidence, issues, or PRs.

## Portal and provider boundary

- The exact manager case link is navigation-only. Opening it, selecting the case, changing a filter, or returning from sign-in must leave Nayax lookup, `nayax-card-refund`, admin update, customer message, TOTP step-up, and every mutating RPC at zero calls.
- **Check Nayax transaction** is the only visible primary control that starts the initial portal lookup. **Refresh** may appear only after a result exists.
- An eligible card approval authorizes one attempt; it does not itself complete the case or send success copy. `refund-case-admin-update` and ordinary message actions must reject card completion/success as a free-standing editable status operation.
- The server reserves and consumes the mapped-manager/TOTP authorization atomically with one token-bound provider attempt. Raw attempt claims remain server-only; only a one-way digest is retained.
- Confirmed provider success is one atomic settlement: provider outcome, case completion, and reporting completion succeed together before the deterministic completion message may be claimed. The completion is one customer-facing operation in the original Gmail thread with every current mapped manager visibly CC'd and no separate manager completion email.
- Provider rejection, timeout, or unknown leaves the case open. It sends no customer success or fallback message, creates no manager-only completion notice, and permits no blind provider retry. Timeout/unknown creates reconciliation work.
- The success, rejected, timeout, and unknown adapters are dependency-injected local/UAT fixtures. The production handler has no request, browser, or environment selector for synthetic success and remains statically disabled before any live provider call. Issue `#430` still owns the account contract, caps, allowlist, credentials, reconciliation semantics, controlled live smoke, and reviewed gate-on work.

## Independent default-off controls

Each lane is separately disabled. Enabling or disabling one does not silently enable another.

| Lane | Required controls | Default/off rule |
| --- | --- | --- |
| Gmail ingestion | GitHub `REFUND_GMAIL_SYNC_ENABLED`; Edge `REFUND_GMAIL_ENABLED` | Both off; the shared Edge gate also stops Gmail outbound before OAuth/provider access |
| Deterministic customer contact | Edge `REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED`; database `refund_customer_contact_settings.automatic_customer_contact_enabled` | Both off; Gmail may be connected without automatic customer contact |
| Manager aging | GitHub `REFUND_AUTOMATION_SWEEP_ENABLED`; Edge `REFUND_AUTOMATION_ENABLED`; Edge `REFUND_MANAGER_AGING_NOTICES_ENABLED` | All off; disabling aging must produce zero fetch, claim, reservation, or send work for that lane |
| Gmail-copy retention | GitHub and Edge `REFUND_GMAIL_RETENTION_ENABLED`; database `refund_gmail_retention_settings.cleanup_enabled` plus recorded owner approval | Independent of sync/OAuth; cleanup stays off until approved but must still be able to purge eligible local copies after OAuth revocation |
| Attachments | Pilot code gate in hosted form and Gmail ingestion; later scanner/version policy if attachments are introduced | Disabled for the email pilot; no attachment bytes are accepted or copied |
| GPT triage | GitHub `REFUND_GPT_TRIAGE_SYNC_ENABLED`; Edge `REFUND_GPT_TRIAGE_ENABLED`; database `refund_gpt_triage_settings.enabled`; `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED` | All off; GPT never auto-sends and never receives payment authority |
| Official manager actions | Immutable database gate returned by `refund_official_actions_enabled()` | Statically false in the candidate; only a later reviewed migration may change it |
| Live Nayax execution | Statically disabled production adapter plus the documented Nayax execution safety values | No local synthetic selector and no live call until `#430` and owner gates pass |

## End-to-end operating flow

1. Gmail receives a message at the designated Info/Support/Refunds mailbox.
2. A mailbox-owned rule applies the permanent refund intake label. The production integration does not reorganize unrelated mail.
3. Label-scoped Gmail sync creates one draft case or appends the message to the existing case/thread.
4. The first eligible customer message in a Gmail thread may claim one generic acknowledgement. It contains exactly one Bloomjoy hosted-form CTA, no Google Form CTA, a private one-time context, and no manager CC because the machine is not known yet. Replays and later replies do not create another acknowledgement.
5. The hosted form uses that private context to complete the existing Gmail draft as one case. If the context cannot be validated, a separate form case is allowed only with duplicate review held before official action. Attachments are disabled.
6. The case is checked for required transaction facts and for a possible website/email duplicate.
7. If facts are missing, an approved deterministic template asks only for those facts. Each follow-up cycle permits at most one request, one reminder, and one information-received confirmation, with at most two cycles per case. If safe content or routing cannot be determined, the case routes to a person; a human-reviewed draft still cannot send until the mapped-manager CC route passes.
8. If wallet/device digits may be the problem, the existing short-lived secure wallet-correction flow is used. The customer is never asked to email a full card number or wallet screenshot.
9. When a case is ready for transaction review, or is aging, duplicate-held, blocked by setup/mapping, delivery-held, no-match, or otherwise needs a person, the currently mapped Machine Managers receive one sanitized notice with the canonical `/refunds?case=<case-id>` link and the correct next action.
10. The Machine Manager opens the portal. That navigation performs no lookup or mutation. A possible duplicate must be resolved as the same incident or different purchases before any official action. The manager explicitly chooses **Check Nayax transaction**; the deterministic matcher then recommends one safe transaction or returns a clear manual/no-safe-match state.
11. The Machine Manager reviews the customer request and match evidence and chooses the official action.
12. The portal freezes the exact action context in a two-minute intent and asks the manager to personally complete a fresh challenge for the owner-approved TOTP factor. One live intent and one receipt are allowed per actor; cancellation, expiry, replay, concurrent consume, reused/same-second authentication, enrollment change, mapping/case/evidence/duplicate-state change, or a shared/agent session fails closed.
13. After the action-bound manager verification, the guarded backend may attempt Nayax execution only when the separate `#430` provider contract, reviewed gate-on migration, manager enrollment, recovery, privacy/security, and owner-UAT gates pass. Current official-action and Nayax controls remain hard-off. The case completes only after confirmed provider success.
14. Token-bound confirmed provider success atomically completes the case and reporting before it creates one deterministic customer-facing completion-message operation in the original thread with the active mapped-manager set CC'd. It does not create a second internal manager completion email. Rejection, timeout, or unknown leaves the case open and sends no success or fallback message.

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
- provider-success completion message only after token-bound confirmed provider success plus atomic case/reporting completion.

Every automatic message uses a versioned deterministic template, a durable operation key, a bounded contact policy, and a kill switch. An arbitrary GPT completion is never an automatic outbound message.

### Candidate template registry

| Template/version | Audience and use | Automatic-send boundary |
| --- | --- | --- |
| `refund_first_contact_v1` | Generic Bloomjoy hosted-form link for the first eligible inbound Gmail message | Once per source thread; original-thread Gmail only; one private context; no manager CC; not case-specific |
| `refund_follow_up_v1` | Exact missing-information request, one bounded reminder, safe no-match confirmation, and one received-information confirmation per correction cycle | Deterministic fields only; maximum two cycles; current mapped-manager CC and contact gates required |
| `refund_manager_aging_v1` | Internal mapped-manager reminder/escalation with the exact authenticated case link | Manager-only; one reminder at two and one escalation at five business days per attention version; independent aging gate |
| `refund_nayax_completion_v1` | Humble original-thread customer confirmation after card refund success | Claimable only after token-bound confirmed provider success and atomic case/reporting completion; all current managers CC'd; no manager-only duplicate |

The registry is implemented for review in the unmerged candidate and is not a production enablement record. Wallet-correction templates retain their separately reviewed versions. Approval or completion language cannot be supplied as an arbitrary subject/body or ordinary status-message edit.

### Human review required

- GPT-authored or materially free-form copy;
- approval, denial, or compensation language;
- legal, safety, threat, chargeback, abusive/escalated, high-value, unrelated, uncertain, low-confidence, or non-English content;
- provider outage, incomplete setup, rejection, timeout, or unknown result;
- any case where the customer, machine, participant, or recipient mapping is uncertain.

A customer denial response may be prepared only after a valid mapped-manager official denial is durably recorded. It remains human-reviewed unless a later decision approves an exact deterministic denial template. An approval is never customer success, and an editable completion message is never an allowed substitute for provider-success settlement.

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

Preferred language is short, plain, humble, and specific. For example, use "We were not able to confidently match one transaction yet" rather than "You entered the wrong card details."

## Manager CC and participant safety

Every case-specific customer-facing refund message requires a resolved machine and one to three currently active, non-revoked Machine Managers returned by the authoritative portal mapping at send time. This applies to manual and automatic Gmail delivery and to the transactional fallback path. The generic first-contact hosted-form link is the sole exception: it is sent before mapping, contains no case-specific facts, and has no manager CC.

- The customer remains the To recipient.
- Visible CC may expose manager work addresses to the customer and other mapped managers; production requires an approved recipient/privacy review and synthetic pilot identities.
- Before the machine is resolved, no case-specific message is delivered. The only allowed message is the once-per-thread generic form link. After mapping, a zero-manager, invalid/over-cap, or empty safe recipient set blocks all customer delivery and creates a redacted internal routing exception. Never guess a manager.
- The capped operations fallback is internal-only for routing repair. It excludes the customer and mailbox identities and can never substitute for the required customer-message CC.
- Customer-visible messages contain no internal case URL, internal note, provider identifier, or complaint analysis.
- Current mapped managers receive a separate deterministic, versioned notice containing only the public reference, public machine/location, business-day age, safe status, one recommended portal step, and canonical authenticated `/refunds?case=<case-id>` link for action-needed, aging, or exception work. It contains no card digits, complaint text, provider IDs, or provider payloads. A routing exception may instead use the capped internal operations fallback. Completion uses the single customer-facing message with manager CC and does not duplicate that confirmation.
- A manager Reply All is manager correspondence, not customer evidence. The Gmail ingestion model must classify customer, mapped manager, Bloomjoy mailbox, automated system, and unknown sender before CC is enabled.
- Any sender who is not the verified customer - including an unknown or forwarded participant, mailbox alias, revoked/former manager, or spoof-suspected sender - cannot update customer facts, clear a waiting-on-customer state, start customer GPT triage, or trigger automatic customer follow-up.
- Customer, mailbox, duplicate, revoked, malformed, and unrelated fallback addresses must not appear in the manager CC set.
- Recipient addresses and CC lists must not appear in logs, health output, GitHub evidence, or unauthorized browser data.

## First-contact acknowledgement and legacy responder cutover

"First contact" means the first eligible inbound customer message in one provider Gmail thread.

- Claim one durable operation key for the thread before sending.
- Register and revalidate the private hosted-form context immediately before generic first-contact delivery. That one non-case-specific message has no manager CC. Re-resolve the machine and one-to-three-manager route immediately before every later case-specific delivery.
- Do not trigger on bounces, mailing lists, bulk/automated messages, outbound messages, or later replies.
- Use standard automatic-response suppression headers.
- A known send failure becomes visible retry work. Uncertain delivery is reconciled and never retried blindly.
- While the legacy responder remains authoritative, the Hub runs in "would send" shadow mode with no outbound delivery. Any active-send proof uses an isolated synthetic test mailbox or label that the legacy responder cannot see.
- Cutover is atomic: disable and verify the legacy sender first, then enable the Hub sender for a bounded synthetic check. At no point may both responders be active for the same thread population.
- Keep a documented instant rollback that disables the Hub sender before re-enabling the legacy sender, so only one responder is ever active.

## Mailbox organization

Use one permanent Gmail intake label owned by mailbox configuration, such as `Refund Operations`. The Hub reads only that explicit label.

The `Refund Operations` label was visible in the connected `info@bloomjoysweets.com` mailbox on 2026-08-03, but filter population has not been proven. Until the mailbox owner verifies the rule with synthetic inbound evidence, the label is an observed organizing surface, not a production-ingestion guarantee.

The Hub - not Gmail sublabels - is authoritative for operational state:

- Inbox triage;
- waiting on customer;
- ready for manager;
- blocked/exception;
- completed/closed.

Agents should work the Hub queue and labeled mailbox rather than scanning all mail. Closed conversations may be archived by an authorized human/mailbox rule; the production Gmail integration retains least privilege and does not delete, archive, mark read, or relabel unrelated messages.

## Proposed pilot cadence and service targets

No refund inbox cadence is live today. The current candidate is a scheduled poll, not an instant webhook: when enabled, a new email should normally be acknowledged within the ten-minute poll interval plus workflow startup time. Calling it “instantaneous” would be inaccurate. A faster event-driven responder is deferred unless the sponsor makes it a pilot requirement. The values below are proposed planning targets only and may start only after the applicable OAuth, privacy, recipient, template, kill-switch, synthetic-UAT, and owner go/no-go gates pass. The 30-minute business-hours target requires an Operations owner and staffing coverage decision and must not appear in customer copy. Customer waiting reminders belong to the bounded `#687` follow-up cycle; manager-only aging notices belong to `#685` and require scheduler implementation and fixture proof before enablement.

- Gmail ingestion: every 10 minutes, 24/7, when enabled.
- GPT draft preparation: every 10 minutes, staggered after ingestion, when enabled.
- Automation sweep: every 15 minutes, subject to the configured customer-contact window, when enabled.
- New labeled mail target: visible in the Hub within 15 minutes.
- Business-hours triage target: within 30 minutes.
- Waiting-on-customer customer reminder: after two business days, at most once for the same `#687` correction-request cycle.
- Manager-only reminder: at two business days from the versioned manager-attention anchor, at most once for that version.
- Manager-only escalation: at five business days from the same anchor, at most once for that version.

For `#685`, a business day is Monday through Friday in `America/Los_Angeles`, preserving the anchor's local clock time. A verified customer reply cancels the old attention version; only a deterministic re-evaluation that returns the case to manager-ready may start a new version. Draft, waiting-on-customer, denied, completed, closed, delivery-held, disabled/outside-window, and stale/version-changed cases receive no manager-aging notice.

## Failure and recovery rules

- Hard bounce pauses automatic customer mail and creates a manager-visible exception with the exact case link.
- Automatic contact resumes after a hard bounce only when an authorized operator corrects/approves the recipient and the system records a new bounded contact operation; it never resumes from an ordinary case replay.
- Gmail authorization revocation disables only the Gmail lane. Hosted-form intake and portal work continue.
- Retention cleanup is independent of Gmail sync and OAuth. Once its separate owner approval and three-part cleanup gate are enabled, it must continue purging eligible local copies even after the Gmail refresh token is revoked.
- Gmail-linked automatic replies must use the original Gmail thread transport; they must not create a separate Resend conversation.
- Each follow-up is bound to the exact verified customer source thread that authorized it; a newer linked thread cannot silently become the reply target.
- A stopped or stale worker never blindly resends an old claim. Matching durable Gmail-sent evidence reconciles the local milestone once; absent, uncertain, or independently abandoned recheck evidence routes the case to manager review with redacted context.
- Scheduler failure produces aggregate, PII-free health alerts and does not block portal work.
- Manager-aging reminders have a separate default-off switch. Each version uses deterministic action keys for at most one two-business-day reminder and one five-business-day escalation; delivery uncertainty or failure becomes health/manual-review work and is never blindly retried.
- A mapping change or revocation is re-evaluated immediately before every customer send and manager notice. Missing, invalid, or changed customer-message routing fails before any provider call.
- Provider rejection leaves the case open and sends no success message.
- Provider timeout/unknown status creates reconciliation work. Never retry blindly or issue fallback compensation until the prior outcome is known not to have succeeded.
- All automatic lanes have a quick-disable switch that leaves intake and manual portal handling available.

## Integrated synthetic evidence contract

Before this candidate can be considered release-ready, the same fresh workflow run must create exactly 38 reviewed synthetic screenshots plus these five strict, sanitized JSON artifacts:

- `refund-portal-assertions.json`;
- `refund-database-counts.json`;
- `refund-gmail-mime-roles.json`;
- `refund-kill-switches.json`;
- `refund-provider-outcomes.json`.

The evidence finalizer must reject stale, missing, extra, malformed, duplicate-image, PII-bearing, identifier-bearing, URL-bearing, or free-text-bearing artifacts. Database migration/test-file totals and the final release SHA are derived from the final integrated tree and remain **Pending** until that run succeeds; this runbook does not invent them. The provider artifact must prove one local synthetic success, rejection, timeout, and unknown outcome with zero provider retry on replay; the portal artifact must prove navigation-only zero-call behavior before the explicit lookup click. Synthetic evidence is not a live Nayax or production Gmail smoke.

## Agent procedure

1. Verify the connected mailbox identity is the designated support mailbox before reading or drafting.
2. Work only threads in the approved refund label or a case explicitly supplied by an authorized user.
3. Open the linked Hub case and read the case status before drafting.
4. Summarize the request using only permitted fields; do not copy sensitive free text into notes or GitHub.
5. Check whether the case is waiting on the customer, ready for a manager, blocked by setup/provider state, or complete.
6. Confirm the case has a resolved machine and a current one-to-three-manager route. If it does not, create or follow the routing exception and do not draft around or bypass it.
7. If an approved deterministic message is already due or already claimed/sent for the cycle, do not create a second draft or send.
8. For human-review states, prepare one concise customer-centric draft asking only for the next necessary information; sending still requires the current mapped-manager CC set.
9. For manager action, provide the separate canonical case link; never place an action-performing link in customer email. The manager must still choose **Check Nayax transaction** and personally complete any official action in the portal.
10. Escalate legal/safety/chargeback/high-value/uncertain content without drafting an automatic response.
11. Never approve, decline, promise, retry, reconcile, or execute a refund from email.

## Rollout sequence

1. Documentation and policy: `#684`.
2. Exactly-once first contact and legacy cutover: `#688`.
3. Participant-safe thread transport and mapped-manager CC: `#686`.
4. Deterministic customer follow-up and versioned copy: `#687`.
5. Mapped-manager aging reminders and canonical links: `#685` plus scheduler foundation `#632`.
6. Designated production Gmail connection, copied-content retention, visible-CC privacy, and attachment-off approval: `#634`.
7. Human-reviewed GPT evaluation and data controls: `#635`.
8. Mapped Machine Manager-only official-action enforcement: `#689`.
9. Owner-supervised manager-only TOTP enrollment, recovery, privacy/security review, fresh per-action challenge, and owner UAT: `#692`.
10. Separately reviewed official-action gate-on plus one-manager portal approval and provider execution contract: `#674` and `#430`.
11. Terminal unmatched/cash fallback: `#666`.
12. Synthetic shadow pilot, quick-disable proof, and sponsor go/no-go before broad enablement.

## Success measures

- zero duplicate first-contact acknowledgements;
- zero case-specific customer messages delivered without one to three current active mapped managers in visible CC, with the generic pre-mapping form link as the sole zero-CC exception;
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
- mailbox-filter population, legacy responder inventory/cutover, and any verified `support@bloomjoysweets.com` alias/send-as plus matching Gmail `SENT` evidence;
- 180-day copied-content retention, visible-CC privacy, and attachment-off approval;
- visible CC recipient/privacy review and participant-classification UAT (`#686`);
- merge and integrated UAT for the mapped Machine Manager-only boundary in `#689`; no break-glass policy is approved;
- owner-supervised clean-manager TOTP enrollment and recovery ownership, privacy/security review, owner UAT, enrollment-window closure after the cohort is verified, and a separate reviewed gate-on migration for `#692`; official actions remain hard-off;
- OpenAI retention/data-control approval for GPT (`#635`);
- Nayax account-specific write contract and controlled live pilot (`#430`);
- alternative compensation decision (`#666`);
- clean Machine Manager-only production UAT and legacy cutover approval.
