# Refund Email Assistant Operating Runbook

Last updated: 2026-08-21

Status: Refund Operations v1 pilot implementation is in review and remains default-off. The pilot uses form-only case creation, deterministic email follow-up, automatic read-only transaction matching, and separate manager confirmation and refund decisions. Production Gmail schedules, automatic customer contact, official manager actions, and live Nayax execution remain disabled until the monitored-pilot release gates pass.

Tracking epic: [#683 Refund Email Assistant and Manager Communications](https://github.com/ethtri/bloomjoy-hub/issues/683)

## Plain-English outcome

The email assistant helps Bloomjoy receive, organize, and advance refund requests. It acknowledges new conversations, identifies missing information, keeps customer follow-up moving, and reminds the right Machine Managers with a link to the exact portal case.

The assistant is not a refund approver and is not a payment operator. The target production actor for every official decision is a currently active Machine Manager mapped to the machine, acting in the authenticated Refunds portal. A link in an email may open a case; opening the link, selecting a queue row, or changing a filter performs no lookup, message, mutation, official action, or payment.

## Source-of-truth boundaries

- Gmail is the customer conversation transport.
- Bloomjoy Hub is the system of record for the refund case, status, matching evidence, manager decision, provider attempt, reporting adjustment, and audit history.
- Nayax/Lynx is the card-transaction and refund provider, subject to the account-specific production gate in `#430`.
- The legacy Google Form response must be removed from the eligible email and existing EasyText/SMS response population before activation. Both channels send customers to the Bloomjoy hosted refund form. The pilot does not add a new SMS platform, and customer contact alone never creates a Hub case.
- Agents use the owner-approved direct OAuth/delegated connection to the production customer-service mailbox, `info@bloomjoysweets.com`; they do not receive a forwarded copy in a personal inbox. That connection may let an authorized agent read, search, label, and prepare drafts within the approved refund scope, but it does not configure or enable the production Hub Gmail integration in `#634`.
- The verified Info/Support/Refunds send-as identities route through and remain identities of that designated mailbox. Treat one as Bloomjoy-mailbox-origin only when the approved mailbox configuration and provider `SENT`-label evidence agree for the message and every existing delivery gate passes; an address string alone is not proof.
- Sending from an alias requires the mailbox owner to configure and verify that Gmail send-as identity. Agents may prepare approved drafts, but they do not add or self-verify aliases or treat browser sign-in as production OAuth proof.
- `etrifari@bloomjoysweets.com` and its plus-addresses may be used only as an owner-controlled synthetic customer/test sender or recipient, or for vendor/account correspondence. They are not the production refund-assistant mailbox.

Do not forward the designated support mailbox into a personal inbox. Agents and operators should work from the label-scoped support mailbox and the Hub queue. Personal inboxes should receive only intentionally routed exception or executive-attention notices.

### Verified mailbox checkpoints through 2026-08-14

- The server OAuth profile resolves exactly to the directly connected production customer-service mailbox, `info@bloomjoysweets.com`, with Gmail read-only and send scopes; Info/Support/Refunds send-as mailbox identities are verified.
- The isolated pilot label differed from the production refund label, accepted only the owner-controlled synthetic population, and was excluded from the legacy responder for that population.
- One eligible synthetic thread received exactly one original-thread `refund_first_contact_v1` acknowledgement. Replay and a later reply produced no second acknowledgement; teardown restored disabled mode and the production label.
- The historical isolated proof completed an existing Gmail draft. The Refund Operations v1 implementation supersedes that behavior: first contact is kept in a private pre-form ledger, and only a valid hosted-form submission creates one case and links the original Gmail thread.
- After machine resolution, every case-specific customer-facing refund reply must originate through the designated support mailbox in the original Gmail thread with the complete current mapped-manager set visibly CC'd. P0 `#800` and the owner-only runner in `#810` proved that boundary once with an owner-controlled synthetic case: exactly one case message and one Gmail outbound from exact `info@`, the original thread and complete current manager route preserved, zero attachments, zero unresolved delivery, and all authorization/runtime gates restored off. The shared insert guard still blocks every unrelated customer-message creator before transport. Normal customer mail still uses the legacy responder; Hub schedules and automatic contact remain off until the staffed cutover decision in `#707`/`#409`.
- A browser sign-in or agent connector is not a substitute for the server integration, and no forwarding into a personal inbox is part of the operating model.

## Authority matrix

| Activity | Email assistant | Machine Manager | Hub service |
| --- | --- | --- | --- |
| Read a labeled refund thread | Yes, within approved mailbox access | Through the linked case when authorized | Yes, through label-scoped Gmail sync |
| Create a case | No; contact alone creates no case | No manual copy/paste required | Only a hosted-form submission creates one case, idempotently |
| Extract permitted refund facts | Yes, under strict deterministic schema and policy | May correct/confirm in the portal | Yes, deterministically; GPT is outside the pilot |
| Send the generic first-contact form link | Yes, once per eligible thread after the pre-mapping safety gates pass | Sees the linked case only after form submission identifies the machine | Yes, with one private context, no manager CC, idempotency, and kill switch |
| Send a case-specific acknowledgement/correction request | Yes, only after the current mapped-manager CC route passes | Can see the result | Yes, with send-time authorization, idempotency, and kill switch |
| Send GPT-authored or free-form text | No | May send a reviewed manual response | GPT is outside the pilot |
| Start a Nayax transaction lookup | No | Reviews the result in the portal | Starts automatically once required facts are ready; reruns only after material matching facts change |
| Confirm the matched transaction | No | Current mapped Machine Manager confirms one transaction, with a structured reason for an alternate | Enforces scope, hard safety exclusions, audit, and duplicate protection |
| Approve or deny a refund | No | Current mapped Machine Manager makes a separate decision after transaction confirmation | Enforces mapped-manager scope, coherent state, audit, and duplicate protection |
| Call Nayax refund endpoints | No | Authorizes the guarded refund action in the authenticated portal | Server-side only after manager approval and the separate `#430` and activation gates |
| Retry/reconcile an unknown provider result | No | Uses the portal recovery flow | Never retries blindly |
| Choose fallback compensation | No | Outside the Refund Operations v1 pilot | No cash fallback is a pilot requirement |

The Gmail OAuth identity, automation scheduler, GPT runner, and agent tools must not possess a privileged path that can approve, decline, or invoke a Nayax refund.

The official-action boundary uses the exact current active machine mapping as its sole grant. Admin access alone, unrelated or revoked managers, service identities, email identities, schedulers, GPT, and agents cannot perform an official decision or Nayax action. A mapped manager who also has separate Super Admin or Scoped Admin access remains authorized only through that mapping; the additional role neither grants nor revokes refund authority. A future break-glass path would require a separate owner-approved, reason-required, time-bounded, notified, immutable-audit policy; none exists today.

A valid mapped-manager login and current active machine mapping are required for manager actions. The service freezes and rechecks the case version, mapping, selected transaction, amount, duplicate state, provider setup, allowlist, and caps when it reserves the action. Concurrent or repeated confirmation can produce only one provider attempt. Refund Operations v1 uses the normal authenticated manager session; it does not require TOTP, sponsor approval, or an operator ceremony.

## Portal and provider boundary

- The exact manager case link is navigation-only. Opening it, selecting the case, changing a filter, or returning from sign-in sends no message, makes no decision, and invokes no refund.
- The initial read-only Nayax lookup starts automatically once all required matching facts are present. A material fact change permits one deterministic rerun; unchanged replays share the same fact-version claim. **Refresh** is a recovery action only after a failed or stale result.
- The manager first confirms one transaction, or chooses an alternate safe candidate with a structured reason. Confirmation does not approve or issue a refund.
- The manager separately approves or denies the refund. An eligible card approval authorizes one guarded attempt; it does not itself complete the case or send success copy.
- The server reserves and consumes the mapped-manager authorization atomically with one token-bound provider attempt. Raw attempt claims remain server-only; only a one-way digest is retained.
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
| Gmail-copy retention | GitHub and Edge `REFUND_GMAIL_RETENTION_ENABLED`; database `refund_gmail_retention_settings.cleanup_enabled` plus recorded owner approval | The database policy is armed for the approved 180-day sanitized-copy period; both runtime gates remain off, so recurring cleanup is dormant. When both runtime gates are deliberately enabled, it must still be able to purge eligible local copies after OAuth revocation |
| Attachments | Pilot code gate in hosted form and Gmail ingestion; later scanner/version policy if attachments are introduced | Disabled for the email pilot; no attachment bytes are accepted or copied |
| GPT triage | GitHub `REFUND_GPT_TRIAGE_SYNC_ENABLED`; Edge `REFUND_GPT_TRIAGE_ENABLED`; database `refund_gpt_triage_settings.enabled`; `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED` | All off; GPT never auto-sends and never receives payment authority |
| Official manager actions | Immutable database gate returned by `refund_official_actions_enabled()` | Statically false in the candidate; only a later reviewed migration may change it |
| Live Nayax execution | Statically disabled production adapter plus the documented Nayax execution safety values | No local synthetic selector and no live call until `#430` and owner gates pass |

## End-to-end operating flow

1. Gmail receives a message at the designated Info/Support/Refunds mailbox.
2. A mailbox-owned rule applies the permanent refund intake label. The production integration does not reorganize unrelated mail.
3. Label-scoped Gmail sync records the eligible conversation in a private pre-form ledger. Contact alone creates no refund case.
4. The first eligible customer message in a Gmail thread may claim one generic acknowledgement. It contains exactly one Bloomjoy hosted-form CTA, no Google Form CTA, a private one-time context, and no manager CC because the machine is not known yet. Replays and later replies do not create another acknowledgement.
5. The hosted form uses that private context to create exactly one case and link the original Gmail thread. A replay creates no second case. If the context cannot be validated, the customer is asked to reply for help; attachments are disabled.
6. The case is checked for required transaction facts and for a possible website/email duplicate.
7. If facts are missing, an approved deterministic template asks only for those facts. A transaction-conflict correction uses labeled Card type, Payment interaction, Wallet provider, and physical-card last-four provenance lines so a verified reply can update the same structured case. Each follow-up cycle permits at most one request, one reminder, and one information-received confirmation, with at most two cycles per case. If safe content or routing cannot be determined, the case routes to a person; a human-reviewed draft still cannot send until the mapped-manager CC route passes.
8. If wallet/device digits may be the problem, the existing short-lived secure wallet-correction flow is used. The customer is never asked to email a full card number or wallet screenshot.
9. When a case is ready for transaction review, or is aging, duplicate-held, blocked by setup/mapping, delivery-held, no-match, or otherwise needs a person, the currently mapped Machine Managers receive one sanitized notice with the canonical `/refunds?case=<case-id>` link and the correct next action.
10. Once required facts are ready, the service automatically runs the read-only deterministic Nayax lookup. A possible duplicate must be resolved as the same incident or different purchases before any official action. A material fact change triggers one rerun; unchanged replays do not.
11. The Machine Manager reviews the request and match evidence, then confirms one transaction. An alternate safe candidate requires a structured reason; ambiguous or unmatched cases remain open.
12. In a separate step, the Machine Manager approves or denies the refund. The authenticated mapped-manager session, case/evidence rechecks, idempotency, and duplicate protections fail closed on drift or replay; no TOTP or operator ceremony is required for the pilot.
13. After manager approval, the guarded backend may attempt Nayax execution only when the separate `#430` provider contract, reviewed gate-on migration, recovery, privacy/security, and owner-UAT gates pass. Current official-action and Nayax controls remain hard-off. The case completes only after confirmed provider success.
14. Token-bound confirmed provider success atomically completes the case and reporting before it creates one deterministic customer-facing completion-message operation in the original thread with the active mapped-manager set CC'd. It does not create a second internal manager completion email. Rejection, timeout, or unknown leaves the case open and sends no success or fallback message.

## Required refund facts

The assistant and matcher may work only with the permitted fields:

- machine location or public machine description;
- purchase date;
- approximate local purchase time;
- payment method;
- amount paid;
- last four digits only when applicable;
- last-four provenance (`physical_card` or `wallet_device_token`) when the origin is explicitly known;
- normalized Card type (Visa, Mastercard, Discover, American Express, or Other / Not sure);
- payment interaction and wallet provider when explicitly supplied;
- whether a mobile wallet was used;
- the wallet/device last four through the secure correction flow when needed.

Never request or use a full card number, CVV, expiration date, PIN, bank login, wallet password, authentication code, or wallet screenshot. Email cannot prevent a customer from voluntarily sending prohibited payment data; if received, redact it before persistence and route it under the existing Gmail safety policy. Do not ask for a generic payment-screen photo when a smaller structured correction can resolve the case.

A verified customer email reply applies only explicit, unambiguous labeled values and records one redacted audit event bound to the resulting deterministic fact version. A reply containing one corrected field cannot erase other known facts. After the fact application is accepted, including an idempotent replay of an already-applied provider message, Gmail sync coordinates the existing `customer_reply_recheck` for the current fact version. The versioned automation-action key runs the read-only lookup once, deduplicates ordinary replay, and recovers a worker interruption after the facts committed but before the lookup claim. Conflicting duplicate labels, an unknown value, or contradictory wallet/physical-card facts apply nothing and route to manager review. Emailed wallet/device-token digits are never accepted as physical-card evidence; that update remains limited to the single-use secure correction form. The manager portal shows the latest structured fact source, applied time, fact version, and digit provenance without exposing the raw source message identifier.

Reply interruption recovery checks the private same-message application receipt **before** treating an unchanged extracted reply as a no-op. Only a verified inbound customer message with a matching immutable application event and current resulting fact version may resume its original lookup. An unrelated unchanged reply has no recovery entitlement; an older applied reply cannot overwrite or rerank newer facts. The lookup coordinator rechecks the receipt's exact version before claiming the existing version-keyed action, and the existing database locks/version checks remain authoritative if facts change afterward. Payout-destination-only replies never trigger Nayax lookup. This path sends no email, selects no transaction, and performs no payment action.

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
- Bounded attempts that remain unmatched stay open for manager review; the assistant does not invent a remedy. Cash or other fallback compensation is outside the pilot.

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

`waiting_on_customer` and `more_info_needed` require durable proof of a successfully sent request with at least one deterministic customer-correctable field. The canonical lifecycle exposes the exact field list to the manager queue and case detail. A no-safe-match notice with no required fields remains Bloomjoy-owned review work; its bounded reminder cannot extend or recreate a customer wait. Unsupported historical states return to manager review without sending another message. Secure wallet correction uses its versioned, single-use correction context as the deterministic field contract and enters waiting only after the message is recorded as sent.

A skipped initial acknowledgement remains a manager-owned delivery exception even if a later customer message was sent. If no later sent message exists, use the safe acknowledgement path and reconcile uncertain Gmail delivery before sending. If later contact is already durably recorded as sent, do not resend the acknowledgement and do not contact the customer again for that exception. A currently authorized manager may record the fixed later-contact disposition against the current case version; replay returns the existing result, and the disposition creates only one redacted immutable audit event with no message, payment, decision, provider, or reporting effect.

New requests persist the conservative customer locale used by approved deterministic templates. For an existing case that shows **Not set — English fallback**, a current mapped manager may review the customer evidence and select only **English** or **Spanish + English** with one fixed reason. Do not infer language from unreviewed prose and do not ask the customer to repeat information already present in Bloomjoy records. The correction is versioned separately, affects future approved templates only, and never rewrites message history or sends a message. It creates one redacted immutable audit event and has no payment, decision, provider, reporting, or official-action effect.

### Existing-case-first Gmail linking

Spanish replies use the exact labeled lines emitted by the canonical email, with a fixed dictionary of supported payment answers. Dates remain `AAAA-MM-DD`; times accept the printed `a. m.` / `p. m.` notation. `Monto: 7,25` means 725 cents, while ambiguous grouping or mixed separators routes to manager review rather than changing the amount. A contradictory English/Spanish duplicate label is one conflicting fact, not two independent fields. Spanish and English quoted-message boundaries are excluded from the current reply. Wallet/device-token digit protection and the same-message, fact-version-keyed application/lookup remain unchanged; no translated answer authorizes a payment.

Before the generic hosted-form acknowledgement can be claimed, a verified direct-human inbound Gmail thread checks the strongest safe evidence in order: an existing provider thread, an explicit case reference bound to the same normalized sender, then recent open customer cases for that normalized sender with bounded deterministic amount, payment-method, purchase-date, and exact location/machine match flags where available. Internal/test and terminal records are never candidates. The lookup stores and projects only redacted match booleans; it does not expose the sender address or customer message in the linking task.

One recent open case is linked atomically and continues in that case/thread without another form request or case creation. More than one plausible case creates exactly one **Link an existing customer email** task. The contact enters the non-sendable `link_review` state, and the database rejects the normal first-contact claim even if a worker replays the message. A current manager with access to every candidate, or Refund Operations, selects one primary case; all remaining candidates are retained as related associations. Until resolution, official action is blocked for the candidate cases, but read-only evidence review remains available.

Resolution moves the retained conversation to the primary case, adds redacted audit events to the primary and related cases, clears a customer-wait state on the primary when applicable, and returns an explicit receipt proving that it created no case, customer message, provider call, or payment action. It does not guess which purchase-specific facts should be copied across related cases. Managers use the now-linked conversation and existing submitted form facts to continue review without asking the customer to repeat information Bloomjoy already has. An identical resolution replay returns the existing result and cannot duplicate the thread, associations, events, message, matching work, or payment work.

### Candidate template registry

| Template/version | Audience and use | Automatic-send boundary |
| --- | --- | --- |
| `refund_first_contact_v1` | Generic Bloomjoy hosted-form link for the first eligible inbound Gmail message | Once per source thread; original-thread Gmail only; one private context; no manager CC; not case-specific |
| `refund_follow_up_v1` | Historical deterministic missing-information, reminder, no-match, and receipt evidence | Retained as immutable historical evidence; no new cycle starts on this version |
| `refund_follow_up_v2` | Exact missing-information request with safely parseable labeled reply fields, one bounded reminder, safe no-match confirmation, and one received-information confirmation per correction cycle | Deterministic fields only; maximum two cycles; current mapped-manager CC and contact gates required |
| `refund_manager_aging_v1` | Internal mapped-manager reminder/escalation with the exact authenticated case link | Manager-only; one reminder at two and one escalation at five business days per attention version; independent aging gate |
| `refund_nayax_completion_v2` | Humble original-thread customer receipt with exact amount, masked card destination when available, action date, and up-to-4-business-day timing | Claimable only after token-bound confirmed provider success and atomic case/reporting completion; all current managers CC'd; no manager-only duplicate |

The registry is merged in the default-off safety foundation and is not a production enablement record. Wallet-correction templates retain their separately reviewed versions. Approval or completion language cannot be supplied as an arbitrary subject/body or ordinary status-message edit.

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
- include the public case reference after form submission has created a case; the pre-form first-contact message has no case reference;
- close warmly and invite the customer to reply in the same thread.

Preferred language is short, plain, humble, and specific. For example, use "We were not able to confidently match one transaction yet" rather than "You entered the wrong card details."

## Manager CC and participant safety

Every case-specific customer-facing refund message requires a resolved machine and one to four currently active, non-revoked Machine Managers returned by the authoritative portal mapping at send time. This applies to manual and automatic Gmail delivery and to the transactional fallback path. The generic first-contact hosted-form link is the sole exception: it is sent before mapping and contains no case-specific facts.

- The customer remains the To recipient.
- If the customer is also a current mapped manager, that identity is represented once by To; every other mapped manager remains in visible CC.
- Visible CC may expose manager work addresses to the customer and other mapped managers; production requires an approved recipient/privacy review and synthetic pilot identities.
- Before the machine is resolved, no case-specific message is delivered. The only allowed message is the once-per-thread generic form link. After mapping, a zero-manager, invalid/over-cap, or empty safe recipient set blocks all customer delivery and creates a redacted internal routing exception. Never guess a manager.
- The capped operations fallback is internal-only for routing repair. It excludes the customer and mailbox identities and can never substitute for the required customer-message CC.
- Customer-visible messages contain no internal case URL, internal note, provider identifier, or complaint analysis.
- Current mapped managers receive a separate deterministic, versioned notice containing only the public reference, public machine/location, business-day age, safe status, one recommended portal step, and canonical authenticated `/refunds?case=<case-id>` link for action-needed, aging, or exception work. It contains no card digits, complaint text, provider IDs, or provider payloads. A routing exception may instead use the capped internal operations fallback. Completion uses the single customer-facing message with manager CC and does not duplicate that confirmation.
- A manager Reply All is manager correspondence, not customer evidence. The Gmail ingestion model must classify customer, mapped manager, Bloomjoy mailbox, automated system, and unknown sender before CC is enabled.
- Any sender who is not the verified customer - including an unknown or forwarded participant, mailbox alias, revoked/former manager, or spoof-suspected sender - cannot update customer facts, clear a waiting-on-customer state, start customer GPT triage, or trigger automatic customer follow-up.
- Customer, mailbox, duplicate, revoked, malformed, and unrelated fallback addresses must not appear in the manager CC set; a customer-manager is instead counted once through To.
- Recipient addresses and CC lists must not appear in logs, health output, GitHub evidence, or unauthorized browser data.

## First-contact acknowledgement and legacy responder cutover

"First contact" means the first eligible inbound customer message in one provider Gmail thread.

- Claim one durable operation key for the thread before sending.
- Register and revalidate the private hosted-form context immediately before generic first-contact delivery. That one non-case-specific message has no manager route. Re-resolve the machine and one-to-four-manager route immediately before every later case-specific delivery.
- Do not trigger on bounces, mailing lists, bulk/automated messages, outbound messages, or later replies.
- Use standard automatic-response suppression headers.
- A known send failure becomes visible retry work. Uncertain delivery is reconciled and never retried blindly.
- While the legacy responder remains authoritative, the Hub runs in "would send" shadow mode with no Hub customer first-contact Gmail delivery. New ingestion may record a private pre-form contact but creates zero `refund_cases`; the customer is never a recipient of an internal notice. Any active-send proof uses an isolated synthetic test mailbox or label that the legacy responder cannot see.
- Cutover is a sequenced no-overlap handoff: disable and verify the legacy sender first, then enable the Hub sender for a bounded synthetic check. At no point may both responders be active for the same thread population.
- Keep a documented rapid, sequenced rollback that disables and verifies the Hub sender off before re-enabling the legacy sender, so only one responder is ever active.

## Mailbox organization

Use one permanent Gmail intake label owned by mailbox configuration, such as `Refund Operations`. The Hub reads only that explicit label.

The production and isolated pilot labels were verified on 2026-08-12. The isolated label/sender population and responder exclusion passed for the bounded synthetic first-contact test; that does not authorize the production label or broad polling. The owner-controlled case-specific original-thread proof has also passed with exactly one case message, one Gmail outbound, the complete current mapped-manager CC route, and zero unresolved delivery. Normal customer mail remains under the legacy responder until explicit production-label and legacy-responder cutover approval passes.

The Hub - not Gmail sublabels - is authoritative for operational state:

- Inbox triage;
- waiting on customer;
- ready for manager;
- blocked/exception;
- completed/closed.

Agents should work the Hub queue and labeled mailbox rather than scanning all mail. Closed conversations may be archived by an authorized human/mailbox rule; the production Gmail integration retains least privilege and does not delete, archive, mark read, or relabel unrelated messages.

## Proposed pilot cadence and service targets

No refund inbox cadence is live today. The production design is a scheduled poll, not an instant webhook: when enabled, a new email should normally be acknowledged within the ten-minute poll interval plus workflow startup time. Calling it “instantaneous” would be inaccurate. A faster event-driven responder is deferred unless the sponsor makes it a pilot requirement. The values below are proposed planning targets only and may start only after the applicable recipient, template, kill-switch, remaining synthetic-UAT, staffing, and owner go/no-go gates pass. The 30-minute business-hours target requires an Operations owner and staffing coverage decision and must not appear in customer copy. Customer waiting reminders belong to the bounded `#687` follow-up cycle; manager-only aging notices belong to `#685` and require the remaining staffed synthetic proof before enablement.

- Gmail ingestion: every 10 minutes, 24/7, when enabled.
- Automation sweep: every 15 minutes, subject to the configured customer-contact window, when enabled.
- New labeled mail target: visible in the Hub within 15 minutes.
- Business-hours triage target: within 30 minutes.
- Waiting-on-customer customer reminder: after two business days, at most once for the same `#687` correction-request cycle.
- Manager-only reminder: at two business days from the versioned manager-attention anchor, at most once for that version.
- Manager-only escalation: at five business days from the same anchor, at most once for that version.

For `#685`, a business day is Monday through Friday in `America/Los_Angeles`, preserving the anchor's local clock time. A verified customer reply cancels the old attention version; only a deterministic re-evaluation that returns the case to manager-ready may start a new version. Draft, waiting-on-customer, denied, completed, closed, delivery-held, disabled/outside-window, and stale/version-changed cases receive no manager-aging notice.

## Failure and recovery rules

- GitHub is the primary ten-minute Gmail intake scheduler. A separate Supabase five-minute watchdog may be enabled only after its reviewed production ceremony. It remains dormant while intake is healthy and dispatches the same idempotent read-only intake path only when the last success is at least 20 minutes old and no recent attempt is in flight.
- The watchdog uses a dedicated Vault-backed token accepted only for `scheduler_recovery`; it cannot approve, decline, notify a customer, select a transaction, call Nayax, or execute a refund. Managers see only `Email intake catching up` or the existing actionable intake warning, never tokens, run keys, mailbox identifiers, or retry decisions.
- A repeated cron tick, HTTP replay, or concurrent invocation cannot create a second claim for the same five-minute bucket. A missing, duplicate, or malformed Vault secret fails closed and appears in redacted health. Disable the watchdog before rotating either secret.

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

Before this candidate can be considered release-ready, the same fresh workflow run must create exactly 85 reviewed synthetic screenshots plus these five strict, sanitized JSON artifacts:

- `refund-portal-assertions.json`;
- `refund-database-counts.json`;
- `refund-gmail-mime-roles.json`;
- `refund-kill-switches.json`;
- `refund-provider-outcomes.json`.

The evidence finalizer rejects stale, missing, extra, malformed, duplicate-image, PII-bearing, identifier-bearing, URL-bearing, or free-text-bearing artifacts. Database migration/test-file totals and the release SHA must always be derived from the final integrated tree rather than copied from an older run. The provider artifact proves local synthetic success, rejection, timeout, and unknown outcomes with zero provider retry on replay; the portal artifact proves navigation-only behavior does not issue a refund or mutate a decision while the automatic read-only lookup remains fact-version idempotent. Synthetic evidence is not a live Nayax or production Gmail smoke.

## Agent procedure

1. Verify the connected mailbox identity is the designated support mailbox before reading or drafting.
2. Work only threads in the approved refund label or a case explicitly supplied by an authorized user.
3. Open the linked Hub case and read the case status before drafting.
4. Summarize the request using only permitted fields; do not copy sensitive free text into notes or GitHub.
5. Check whether the case is waiting on the customer, ready for a manager, blocked by setup/provider state, or complete.
6. Confirm the case has a resolved machine and a current one-to-four-manager route. If it does not, create or follow the routing exception and do not draft around or bypass it.
7. If an approved deterministic message is already due or already claimed/sent for the cycle, do not create a second draft or send.
8. For human-review states, prepare one concise customer-centric draft asking only for the next necessary information; sending still requires the current mapped-manager CC set.
9. For manager action, provide the separate canonical case link; never place an action-performing link in customer email. The manager reviews the automatic match, confirms one transaction, and then separately approves or denies the refund in the portal.
10. Escalate legal/safety/chargeback/high-value/uncertain content without drafting an automatic response.
11. Never approve, decline, promise, retry, reconcile, or execute a refund from email.

## Rollout sequence

1. Form-only case creation, exactly-once first contact, and legacy Google Form response replacement: `#889`.
2. Eligible Nayax machine inventory and setup/exclusion classification, including Snapcase: `#890`.
3. Deterministic original-thread follow-up, material-fact matching reruns, and reply-based appeals.
4. Exact mapped Machine Manager transaction confirmation followed by a separate approval or denial.
5. Nayax execution contract and duplicate/unknown-outcome protections: `#430`.
6. Synthetic shadow pilot, quick-disable proof, staffed monitoring, and owner go/no-go before production activation.

GPT, TOTP, operator ceremonies, QR-code flows, Kexiazhan reporting, cash fallback, and a new SMS platform are not Refund Operations v1 pilot dependencies.

## Success measures

- zero duplicate first-contact acknowledgements;
- zero case-specific customer messages delivered without a complete one-to-four current active mapped-manager recipient route, counting a customer-manager once through To;
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

- the owner-only intake-shadow acceptance in `REFUND_GMAIL_INTAKE_SHADOW_RUNBOOK.md` remains default-off and separately authorized: one shadow-label thread, exactly one fresh owner inbound plus one strictly later mailbox-origin Gmail `SENT` acknowledgement, one POST/no retry, zero Hub/customer/manager delivery, conclusive safe-close, private queue verification, and an assigned earliest/latest retention cleanup obligation;
- production-label/legacy-responder cutover and rollback approval (`#634`, `#686`, `#688`); the bounded case-specific original-thread reply with the complete current mapped-manager CC route is already proved;
- one staffed synthetic reminder/escalation plus manager-visible health and teardown under `#632`; the alert/replay/disabled-lane plumbing proof has passed, but schedules remain off;
- a Bloomjoy-project-only Edge Functions Read credential and successful protected `main` drift run under `#768`; until then, use the owner-controlled local read-only release check and never store a broad owner PAT;
- Nayax account-specific write contract, activation of the deployed default-off audited provider-outcome resolution foundation, and one owner-supervised capped live pilot (`#430`);
- assigned-scope production UAT with a clean Machine Manager-only persona and final legacy-cutover approval. The exact dual-role mapping predicate is deployed and verified; the pilot uses the normal authenticated manager session.
