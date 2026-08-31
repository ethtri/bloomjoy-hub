# Decisions

Entries are newest-first. For production refund work, the 2026-08-30 production-simplification decision below governs. Older conflicting pilot, cap, account-hold, canary, unfamiliar-`2xx`, permission, and TOTP mechanics are retained only as historical audit records.

## 2026-08-30 - Refund safety is transaction-scoped in production (`#990`)

- Bloomjoy is in production. Exact-case canaries, first-proof limits, pilot cohorts, observers, staffed windows, and repeated go/no-go ceremony are retired.
- A customer may receive refunds for multiple legitimate purchases. One exact Nayax transaction may support only one Bloomjoy refund case.
- The normal refund amount may be only the exact full remaining allocation for the selected Nayax transaction. Bloomjoy does not enforce arbitrary per-refund, machine, daily amount, or daily count launch caps, and the browser cannot supply or edit the direct execution amount.
- A confirmed rejection or authoritative proof that no refund occurred permits a fresh manager-confirmed attempt generation. Unknown or pending outcomes pause only that transaction; unrelated customers and transactions continue.
- Direct API availability and execution are immutably blocked as `provider_remaining_value_unverified`, before reservation or provider orchestration, until #990/#751 provide authoritative cumulative-refunded and remaining-refundable ingestion plus an atomic pre-request recheck. Read-only matching remains available. Refund Operations may approve the provider-free reviewed Nayax portal fallback for either legacy manual evidence or an ordinary exact matched card/wallet transaction only under that exact hard-guard reason; kill-switch, reconciliation, duplicate, and authority failures do not expose the ordinary fallback. Approval creates no provider call, report, or customer message. Completion requires evidence that Nayax refunded the full selected amount, while a smaller or partial result remains on hold.
- Any later direct production path keeps one explicit money confirmation, mapped-manager authorization, exact transaction evidence, row locking, idempotency, one live attempt, immutable provider journaling, confirmed-success-only customer/reporting completion, server-only credentials, and a systemic-incident kill switch.
- Customer amount, card type, and last four are matching clues. Bloomjoy searches Nayax itself before asking a customer for more work; manager-confirmed exact portal evidence is authoritative.

The concise operating standard is `Docs/REFUND_PRODUCTION_POLICY.md`.

**Why this choice**
- Nayax supports partial refunds, so original sale amount alone cannot prove the remaining refundable allocation. Provider rejection is a backstop, not a substitute for authoritative pre-request remaining-value evidence. Local transaction identity and idempotency still protect Bloomjoy concurrency, reporting, and messaging.
- Customer-, account-, and volume-wide pilot blocks delay unrelated legitimate refunds without adding transaction-level safety.

## 2026-08-30 - Refund automation runs every 30 minutes (`#1054`)

- The Supabase primary and GitHub fallback each dispatch the refund sweep twice per hour. Their health checks also run twice per hour, and both lanes derive the same UTC 30-minute `scheduled` or `health_check` run key so overlap remains an idempotent replay.
- Scheduler health becomes stale after 90 minutes without a successful run. The existing one-opening-alert, daily-reminder, and 60-minute stable-recovery incident rules are unchanged.
- The maximum automated reminder or lookup delay increases from roughly 15 to roughly 30 minutes. Refund intake, the manager queue, manual actions, approval/payment gates, provider idempotency, and all default-off activation controls are unchanged.

**Why this choice**
- A 30-minute cadence is sufficient for non-urgent reminder and lookup work, halves routine scheduler traffic, and leaves three missed intervals before the stale-health threshold opens an incident.

This supersedes only the 15-minute cadence and its prior stale threshold in the `#1045` decision. The Supabase-primary architecture, GitHub fallback, security controls, and incident behavior remain in force.

## 2026-08-30 - Refund status messages are deterministic, recoverable, and payment-neutral (`#891`)

- Bloomjoy stores a conservative customer-language preference with intake evidence and reuses it for acknowledgement, appeal, lifecycle, and automatic messages. Spanish-preferring customers receive bilingual Spanish/English copy; uncertain preference remains English.
- Cash messages describe the manager-arranged external refund path and never imply a card, bank, or Nayax refund. Card completion copy remains reserved for proven provider settlement.
- Only the latest unresolved provider hold may claim one provider-neutral delay update. A still-unresolved case may receive one human-owned status update at four Pacific business days. Stable action identities make each update exactly once; superseded attempts and early sends are rejected.
- Failed or uncertain external delivery is manager work and is never retried blindly. An intentionally skipped message stays visible with a safe acknowledgement action. Exhausted automatic contact cycles return the case to named manager review instead of silently ending communication.
- These messages do not approve, deny, execute, or infer a refund. Automatic customer contact remains behind the existing default-off environment and database gates.

**Why this choice**
- A truthful delay message can reduce customer uncertainty without overstating a provider or bank outcome. Binding it to immutable case facts and visible delivery evidence keeps communication recoverable without creating payment authority or duplicate-send risk.

## 2026-08-30 - Supabase Cron is the primary refund-automation clock (`#1045`)

- Supabase Cron dispatches the existing refund sweep four times per hour and its health check four times per hour through a dedicated Vault-backed scheduler credential. Both database jobs install default-off and have no authority beyond the existing Edge Function gates.
- GitHub Actions remains an independent fallback. Supabase and GitHub derive the same UTC 15-minute `scheduled` or `health_check` run key, so an on-time overlap or delayed GitHub event is an idempotent replay rather than a second sweep.
- Scheduler health alerts are durable incidents, not messages keyed to the latest successful run. One incident sends one opening alert, at most one reminder per 24 hours, and one recovery notice only after health remains stable for 60 minutes. A brief success followed by another stale check stays inside the same incident.
- Incident, scheduler-setting, and dispatch records contain operational timestamps and redacted status only. Browser roles cannot read or mutate them. Existing refund intake, manager authority, customer-contact, payment, provider, idempotency, and kill-switch controls are unchanged.
- Production activation requires the exact Edge Function URL and a dedicated 32+ character token in Supabase Vault, matching the server-only Edge secret, followed by disabled-state proof, synthetic replay proof, and a two-hour schedule soak. Rollback disables the database scheduler first, then the GitHub fallback and Edge automation only if the whole automation lane must stop.

**Why this choice**
- GitHub documents scheduled Actions as best-effort and production history showed multi-hour gaps despite successful jobs. A database-owned primary clock removes that external timing dependency.
- Treating every newer success timestamp as a new alert fingerprint caused repeated email during one unresolved reliability incident. A durable incident preserves attention without spamming the same recipients.

This supersedes the 2026-07-21 choice of GitHub Actions as the primary refund-automation schedule. Its action idempotency, independent monitoring, redaction, and fail-closed requirements remain in force.

## 2026-08-29 - Scoped Admin supports invitation-first exact-email activation (`#989`)

- A Super Admin may create a pending Scoped Admin invitation for a valid email that does not yet have a Bloomjoy Auth account. The invitation must include an audit reason and at least one active reporting machine.
- A pending invitation is not an effective grant. Scoped Admin authority and machine visibility activate atomically and exactly once only after the same normalized email is verified by Supabase Auth and completes the normal password-backed sign-in flow.
- Pending invitations expire after seven days, may be resent without creating a duplicate pending grant, and may be revoked before activation. Create/update, delivery, failure, expiry, revoke, and activation events remain auditable.
- The official email uses the existing scanner-resistant `access-invite` service and a stable `/login?intent=scoped_admin&email=...` route with no credential in the URL.
- Existing authenticated users continue to use the person workspace for immediate Scoped Admin grant/update/revoke. The earlier decision that an existing Scoped Admin may have zero machine scopes remains unchanged; only invitation-first onboarding requires a non-empty initial machine boundary.

**Why this choice**
- Requiring a person to discover and create an account before an administrator can invite them reverses the expected onboarding sequence and produces avoidable support work.
- Separating pending intent from effective authority prevents an unverified or mistyped email from receiving admin access.
- Reusing the established email-code activation path preserves scanner resistance, password completion, delivery evidence, and a consistent recipient experience.

## 2026-08-28 - Reconciled refund work waits on confirmed Nayax routes, not speculative writes (`#990`)

- Provider-free reconciliation of both later `$8` attempts is complete. Neither attempt is pending, neither may be replayed or approved, and no provider request or approval is currently in flight.
- The remaining external dependency is narrow: Nayax must supply the literal, case-sensitive accepted/rejected `Result`/`Status` pairs for request and approval, classify provider log `17117058946`, and identify any exact token-scope or payload-validation defect.
- Support case `#03594386` and routing tickets `#03624855`, `#03624856`, and `#03624867` are the confirmed escalation routes. The copy sent to `integration-support@nayax.com` bounced with a recipient-address rejection; agents must not describe that address as a delivered or working channel.
- Until authoritative evidence arrives, agents may maintain documentation, regression coverage, read-only monitoring, and issue hygiene. They must not register guessed response literals, alter request values, rotate roles or tokens, preselect a transaction, or send another refund request or approval.
- `#990` remains active until the provider answer is safely incorporated, one new eligible customer refund supplies the direct end-to-end proof, and `#427` begins its fresh 72-hour observation.

**Why this choice**
- It removes stale language that incorrectly treated the reconciled request-only attempt as still awaiting provider-free resolution.
- It separates work Bloomjoy can safely complete now from the provider facts only Nayax can supply.
- It prevents a bounced email address or a closed tracking item from being mistaken for successful escalation or completed production enablement.

## 2026-08-28 - Separate Nayax refund capability from Bloomjoy automatic proof (`#877`, `#961`, `#990`)

The historical Tulsa production evidence proves that Nayax's Lynx API path can produce a real refund. Agents must not describe the current blocker as “the API cannot refund” or use the absence of a direct end-to-end Bloomjoy success to erase that provider success.

**Canonical interpretation**
- At least one legitimate Tulsa `$7` refund began through Bloomjoy's Nayax API path and was later authoritatively confirmed by Nayax/DTM as a real provider refund. Bloomjoy reconciled the case, reporting adjustment, and customer completion exactly once without a second refund request.
- That success proves provider write capability. It does not prove that Bloomjoy correctly classified both immediate write responses, automatically established final provider state, and finalized the entire ordinary path without DTM or Support.
- Production still has zero direct request -> approval -> automatic-finalization proofs under an account-confirmed response contract. The next fresh eligible refund remains that proof.
- HTTP transport status and business outcome are separate. The later provider-owned `$8` log proves that Nayax can carry a business rejection over HTTP `200`; no unfamiliar `2xx` may authorize approval.
- The current request/approval body structurally matches Nayax's published fields. Do not call a payload, role, token scope, or amount-unit defect the root cause unless Nayax ties it to the exact provider log.
- Historical Tulsa and `$8` attempts are evidence only. They must not be replayed, approved, or used as the fresh direct proof.

The durable root cause analysis, evidence timeline, code audit, open hypotheses, and exit evidence are in `Docs/NAYAX_REFUND_PRODUCTION_RCA.md`.

**Why this choice**
- It preserves the positive production fact the owner identified: the API has refunded a real customer.
- It also preserves the safety fact: Bloomjoy cannot yet interpret every immediate provider response or automatically confirm every final result.
- Keeping those claims separate prevents both overreaction (“the API is broken”) and unsafe overconfidence (“one provider refund proved the full automatic integration”).

## 2026-08-28 - Canonical Nayax production refund identity (`#990`)

The production refund executor is identified by its Nayax user ID and login, not by email alone.

**Canonical production identity**
- Operator: `TGpaci LLC`
- Nayax user ID: `103260239`
- Nayax login: `dually-app\TGpaci266`
- Email: `ethtri@gmail.com`
- Status: `Active`
- Production Lynx tokens: the separately named Bloomjoy Refund Request and Bloomjoy Refund Approval tokens created on 2026-08-25 under this user. Token values remain server-only Supabase secrets and must never be copied into documentation or client configuration.

**Provider-confirmed capabilities**
- Read Last Sales for transaction matching.
- Submit a refund request.
- Approve a refund request.

Nayax Support confirmed on 2026-08-17 that the requested Lynx API roles were added to this active account. The request and approval tokens are deliberately separate even though both belong to the same active user.

**Do not use as production executors**
- Nayax user `570755401`, login `dually-app\Ethan50862`, email `etrifari@bloomjoysweets.com`: invited/unregistered side account with no production tokens. It resulted from correspondence that targeted the wrong email and must not be activated, promoted, or used for refund credential rotation unless the owner makes a new explicit decision.
- Nayax user `931941189`, login `dually-app\911004`, email `ethtri@gmail.com`: older expired duplicate. It is not the active production executor.

**Operational rules**
- Always verify the production executor using both user ID `103260239` and login `dually-app\TGpaci266`; email by itself is ambiguous.
- Do not ask Nayax to create or re-invite a refund service user as a routine remediation step.
- A refund failure does not prove missing roles. First classify the exact Nayax response and check DTM/support evidence before changing users, roles, or tokens.
- The open provider question is the exact accepted/rejected meaning of the current account's `Result`/`Status` response pair. It is a response-contract clarification, not evidence that the canonical account lacks the requested roles.

## 2026-08-27 - Approval requires an exact, account-confirmed JSON response contract (`#628`, `#971`, `#973`)

- The database may authorize `refund-approve` only after `refund-request` returns exact HTTP `200`, an `application/json` media type, a valid JSON object, string `Result` and `Status` fields, and an exact accepted pair from the account-confirmed contract. An unfamiliar `2xx`, alternate JSON media type, non-object body, missing/wrong-typed field, malformed/oversized body, response-read failure, or semantic mismatch never advances to approval.
- The provider adapter keeps only privacy-safe envelope evidence: HTTP acceptance, normalized media/body classes, a length bucket, JSON/object/schema markers, key presence and value types, semantic/full-contract match flags, transport/read failure class, and a keyed classification digest. Raw bodies and provider response values are not retained, logged, or exposed.
- The hardened contract is schema version `2`, requires Bearer authorization and the exact `https://lynx.nayax.com/operational/v1` production endpoint, and negotiates the neutral code identifier `nayax-production-account-contract-v2` with journal v3. QA remains parser/test-only. Readiness uses the adapter's credential shape and separate/shared-token rules so it cannot advertise a configuration that execution rejects. The older normal-path schema/journal remains readable and callable only for rollback compatibility; it is not accepted by the new runtime. A case allowlist can bound rollout but cannot waive written contract or approval-scope confirmation.
- Historical state at this decision's adoption: the then-unresolved `$8` attempt was on a no-retry Refund Operations hold with the affected account circuit open, and only provider-free DTM/support reconciliation could resolve it. That reconciliation completed on 2026-08-28 with authoritative no-refund evidence. The attempt remains immutable and non-replayable; the current hold is now the exact response contract and fresh-proof requirement recorded in the newer 2026-08-28 decision above.
- The legacy `approve_pending_request` runtime is retired fail-closed. Journal v3 cannot authorize a standalone approval from incomplete legacy request evidence, and the v3 migration revokes service-role execution of its reservation and stage/settlement entrypoints so an Edge rollback cannot reopen it through mutable secrets. Neither the current $8 attempt nor another historical mismatch can use that provider-write route. Its database records remain for audit/schema continuity; privileged manual reconciliation remains provider-free.
- Automatic SQS/SFTP readback remains a follow-up after the account identity and report-delivery contract are proved. Manual authoritative DTM/support evidence remains the accepted reconciliation path meanwhile.

This supersedes the 2026-08-22 unfamiliar-request-`2xx` advancement rule and the 2026-08-25 contract/scope calibration waiver. It does not weaken the one-generation/one-request/at-most-one-approval invariant, exact manager confirmation, caps, idempotency, circuit breaker, uncertainty hold, or the rule against synthetic purchases.

## 2026-08-27 - Real customer refunds are the production proof; software controls bound the risk (`#628`, `#990`, `#427`)

- A legitimate unresolved customer refund may be used to prove the production refund path when the payment has not already been refunded and has no prior provider attempt. Do not manufacture an employee purchase merely to create test evidence.
- For the first direct operating proof, use an existing eligible case of $10 or less with one exact manager-confirmed Nayax transaction. The amount, currency, machine/account, transaction reference, provider timestamp, and available card evidence must agree before the refund action is offered.
- Bloomjoy accepts the bounded business risk that a provider failure may waste time or that an incorrectly selected transaction may return a small amount to the wrong cardholder. The first risk moves no money; the second is constrained by the $10 operating limit, exact matching, manager confirmation, and the fact that Nayax returns funds only to the selected transaction's payment method.
- This acceptance removes the non-customer-only canary, manufactured purchase, staffed window, separate observer/rollback roles, recruited UAT, first-ten sample, staged cohort, and repeated go/no-go decisions as launch requirements. One manager's actual **Refund $X** confirmation remains the intentional human payment decision.
- One manager action creates one immutable server-owned attempt generation. That generation permits at most one Nayax refund request and at most one Nayax approval. Double-clicks, reloads, concurrent workers, client/network retries, and schedule replays must reuse or reconcile that generation and cannot create another provider send.
- There is no bulk-refund action. At that launch checkpoint, per-refund/daily caps and an account circuit breaker were still enforced; the 2026-08-30 production decision above retires them. Exact manager/machine/transaction authorization, idempotency uniqueness, one-live-attempt constraints, one-provider-stage constraints, and the kill switch remain mandatory server controls.
- A confirmed success completes the case, reporting adjustment, audit trail, and customer message once. Authoritative proof that no refund occurred may create one new generation. A timeout, unknown result, or conflicting record remains locked in Refund Operations and must be checked in Nayax before any manual refund or later attempt.
- Automatic Nayax report-feed reconciliation in `#973`/`#971` is a nonblocking improvement. The current manual Nayax/DTM exception path with a 60-minute target is an accepted operational limitation.
- `#427` starts a 72-hour post-launch observation with the first legitimate direct refund and reviews whatever genuine refunds occur. No minimum transaction count or manufactured activity is required.

This decision superseded earlier canary and ceremony requirements. The later 2026-08-30 production decision above also retires the launch caps and account-wide circuit breaker while preserving exactly-once, authorization, exact matching, journal, and transaction-scoped uncertainty controls.

## 2026-08-27 - Only authoritative no-refund evidence may release a fresh manager action (`#990`)

- A timeout, network error, pending response, unknown response, journal failure, or settlement failure never creates retry authority. The existing attempt remains locked while Bloomjoy confirms the authoritative result, and Refund Operations owns the exception with a 60-minute SLA.
- An exact contract-matched Nayax rejection over HTTP `2xx` is different: immutable request/approval journal evidence proves that the provider did not issue a refund. Bloomjoy atomically marks that attempt `released_no_refund`, keeps reporting and customer completion untouched, advances the case generation, and restores the ordinary **Refund $X** action.
- Release never calls Nayax and never retries automatically. A mapped manager must review and confirm the fresh action again. The old attempt cannot be reused, replayed, or approved; an unproven or malformed rejection remains locked.
- The manager sees only **No refund was sent** and the normal action. Provider codes, journal evidence, credentials, retry classification, and technical reconciliation stay out of the routine manager and customer experience.

This clarifies earlier “never retry an uncertain result” decisions: uncertainty still cannot be retried, while authoritative proof that no refund occurred permits a new human-confirmed attempt.

## 2026-08-26 - Customer refund tracking uses a fragment capability and the canonical lifecycle (`#993`)

- Normal card intake requires machine, email, purchase date/approximate time, amount, payment last four or wallet flag, and issue category. Name, phone, time-confidence diagnostics, card interaction/network, and narrative are optional; omitting them cannot weaken exact matching, duplicate protection, manager authority, or provider gates.
- Customer status uses a 256-bit opaque token whose database representation is only a SHA-256 digest. The token is carried in the URL fragment so it does not enter CDN/server request logs or referrer headers. Capabilities are one-case/read-only, revocable, 30 days by default, rate-limited, and independently default-off.
- The tracker consumes only `refund_lifecycle_v1`, then strips manager, lookup, operations, provider, evidence, and internal reason fields before responding. Active state refreshes within 15 seconds and terminal state stops.
- Card confirmation means Nayax approval, not bank posting. Customer copy says the bank may take up to four business days. Status-link rollback disables new issuance and revokes capabilities without touching cases or payments.

## 2026-08-25 - Historical exact-case calibration mechanism (`#961`; superseded for current rollout)

- Nayax does not publish the exact production `Result`/`Status` values or token permission needed to prove the two remaining launch facts without a provider write. The controlled canary may therefore use a reviewed provisional response contract and the two dedicated account-scoped credentials while `NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED=false` and `NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED=false`.
- This exception requires `NAYAX_REFUND_CANARY_UNPROVEN_PROVIDER_APPROVED=true`, the existing canary switch, and an exact UUID match. It removes only the manager-contract-confirmation and approval-scope-confirmation blocks for that one case. Kill switch, execution, dry-run, amount/daily caps, idempotency, executor identity, manager authority, exact transaction evidence, journal compatibility, account circuit breaker, and separate request/approval credentials remain mandatory.
- The exception is disabled whenever broad reopening is approved. Broad execution still requires independent confirmation of both provider facts. An unknown, denied, timed-out, malformed, or unfamiliar result remains a no-retry reconciliation hold and cannot be promoted to success.

This records why the exact-case mechanism existed. The 2026-08-30 production decision above fully retires that rollout switch; exact transaction binding remains the safety boundary.

## 2026-08-25 - Historical implementation of the database-authoritative execution contract (`#961`; current activation follows 2026-08-27)

- The append-only database journal, not Edge Function branching, is the sole authority for moving from `refund-request` to `refund-approve`. An exact accepted `2xx` or an unfamiliar successful `2xx` may authorize one approval; rejection, duplicate, already-refunded, pending, non-2xx, timeout, network failure, missing journal evidence, and version mismatch stop before approval.
- Edge and database must complete an exact provider/journal version handshake before reservation or transport. Migration-first and function rollback remain compatible because the new circuit breaker activates only through the versioned reservation RPC.
- Normal execution uses separate account-scoped request and approval write credentials. The reporting token and generic Nayax token are lookup-only and have no write fallback. A reviewed manager contract and an explicit approval-scope confirmation are independent required gates.
- Any unresolved normal attempt pauses new normal refunds for the same Nayax account. Only structured DTM/support reconciliation may clear that hold; retry, fallback payment, reporting completion, and customer success mail remain prohibited while the outcome is uncertain.
- Provider success, Bloomjoy settlement, and customer delivery are separate phases. A settlement failure after provider success is a P0 reconciliation hold; a customer-message failure does not reclassify the payment or permit another provider call.
- Deployment alone does not reopen card refunds. Under the later 2026-08-27 decision, the next eligible legitimate customer case may supply the first direct proof without a separate non-customer canary or broad-reopen approval. Exactly one request, at most one approval, atomic case/reporting settlement, one completion message, and the 60-minute Refund Operations exception target remain mandatory.

This supersedes the 2026-08-22 decision that the existing generic token and pilot-derived in-source contract were sufficient for routine launch. It preserves the two-step `2xx` behavior while making its transition, permissions, compatibility, and release proof explicit and fail-closed.

## 2026-08-24 - Refunds follow the payment method and keep the manager task simple (`#958`, `#959`)

- Card is the preferred refund path. A card case still requires an exact manager-confirmed Nayax transaction and the existing provider, duplicate-payment, amount, idempotency, cap, and reconciliation controls before Bloomjoy issues the refund through the Nayax API.
- Cash is an interim external-payment path. The manager sends the customer money outside Bloomjoy Hub using the mutually arranged method, currently Zelle or Venmo, and then uses one **Mark $X as refunded** action in Hub. Hub records completion; it does not initiate, verify, or choose the external payment channel.
- Any active, nonterminal cash case with a positive stored request amount may use that action. An imported cash-sale match may remain visible as context, but it is not an approval or completion prerequisite. A missing amount remains a simple missing-information case.
- Confirmation is the manager's attestation that the external refund was sent. The server derives the amount, acting manager, and completion time; completes and approves the case atomically; records one `manual_external` reporting adjustment and one redacted official event; and prepares one channel-neutral completion email after commit. Replay or concurrency cannot create a second completion, adjustment, event, email, or Nayax call.
- The manager does not enter a payout handle, Zelle/Venmo destination, reference, amount, or timestamp, and does not complete a separate approval or checkbox step. Existing legacy cash cases, including `cash_zelle_pending`, remain completable through the same action without rewriting their historical data.
- Public intake asks first whether the customer paid by card or cash and shows only the fields needed for that choice. Cash does not request card details or a payout handle. Gift-card fulfillment remains future work in `#666`; this interim decision does not build a gift-card system.

This decision supersedes older cash-correlation gates, Zelle-specific manager fields, separate cash approval/completion steps, and statements that cash fallback is outside the refund pilot. It does not weaken the Nayax card-refund safeguards or authorize an alternative payment when a card provider outcome is uncertain.

## 2026-08-24 - Machine refund setup exposes one truthful readiness state

- Admin Machines presents **Customer refunds** as **Ready to refund**, **Ready to activate**, **Setup needed**, or **Paused**. It never uses transaction-matching readiness to imply that live card refunds are enabled.
- The server contract separately reports customer intake, transaction matching, exact Nayax inventory lookup, current Machine Manager routing, the per-machine payment gate, and the machine limit. The authenticated Nayax availability boundary adds the runtime global pause without exposing secrets.
- A qualified machine uses the standard $50 launch limit. A Super Admin may activate one qualified machine or review and activate all qualified machines in one action; both paths revalidate prerequisites, lock each machine row, replay safely, and write a redacted audit record.
- A qualified payment-disabled machine must show an approved reason. Bulk activation includes machines awaiting reviewed activation and preserves owner, provider-support, maintenance, and commercial exceptions.
- Turning transaction matching off does not remove an otherwise customer-safe machine from public intake. Exact transaction binding, duplicate protection, provider reconciliation, idempotency, daily caps, and the emergency global pause remain server responsibilities.


## 2026-08-22 - Customer refund intake is not an automatic-payment readiness gate

- `/refunds/request` lists every active customer-safe Commercial/Mini reporting location, plus Snapcase machines that are explicitly classified and represented in the reporting portfolio. A missing immutable Nayax mapping or manager route is setup work; it does not prevent the customer from asking Bloomjoy for help.
- Exact Nayax inventory mapping, category, active provider state, manager routing, transaction confirmation, separate refund approval, caps, idempotency, duplicate-payment protection, and the execution kill switch still gate automatic payment. An explicitly excluded or provider-inactive mapped machine remains hidden.
- Every active provider inventory row must still be Published, Needs setup, or Explicitly excluded. Missing exact mappings and being outside an earlier pilot cohort are not valid business exclusions and return to Needs setup.
- This restores and extends the 2026-08-02 portfolio-intake decision for Snapcase. It supersedes only the 2026-08-21 statement that the public form uses the published automatic-payment inventory gate; all other inventory, matching, payment, and communication safeguards remain unchanged.

## 2026-08-22 - Launch with temporary refund-volume limits, then review them

- Normal production refunds start with a $50 maximum per refund, $500 total approved refunds per day, and 20 approved refunds per day.
- These limits are temporary monitoring guardrails, not permanent product requirements. They provide a simple pause point if early production volume or behavior is unexpected without changing manager approval, matching, or customer communication.
- The limits may be raised or removed after monitored production evidence is reviewed. Duplicate-payment protection, exact transaction binding, per-machine eligibility, idempotency, and no-retry handling of uncertain provider outcomes remain mandatory even if the temporary volume limits are removed.

## 2026-08-22 - Historical Nayax pilot decision (unfamiliar-`2xx` advancement superseded on 2026-08-27)

- The owner pilot proved that Bloomjoy's existing server-only Nayax token, production endpoint, amount units, identifiers, and request body can create a real refund that Nayax later confirmed as refunded. No additional Nayax role grant or written permission confirmation is a Refund Operations production prerequisite.
- Nayax's public contract treats a `2xx` request as successfully processed and the refund as pending until the separate approval step. The normal manager lane therefore advances from a journaled `2xx` request even when the returned `Result`/`Status` wording is unfamiliar; it does not relabel that unfamiliar wording as final success.
- Bloomjoy still sends at most one request and at most one approval for an attempt. Final case/reporting/customer completion requires the exact accepted approval result. HTTP failure, timeout, unfamiliar approval wording, duplicate, or already-refunded responses remain durable no-retry reconciliation holds.
- The reviewed pilot-derived production contract is checked into the server function so routine execution no longer depends on a temporary pilot-only contract secret. A supplied environment override remains fail-closed if invalid.
- Existing mapped-manager authority, exact transaction binding, per-machine and daily caps, idempotency reservation, duplicate-payment protection, kill switch, redacted stage journal, and reply-thread completion controls remain unchanged.

## 2026-08-21 - Refund pilot uses one branded message system and same-case reply appeals

- All pilot customer mail—first contact, missing-information collection, denial, appeal receipt, retries, and confirmed completion—uses one canonical warm Bloomjoy HTML/plain-text system with reply support.
- A denial must include a customer-safe reason. A verified direct customer reply after that sent denial reopens the same case for manager review, clears the prior decision, and creates no payment authority or provider attempt. Forwarded, automated, spoof-suspected, manager, and unrelated messages do not reopen cases.
- Appeal receipts are deterministic and independently default-off. Confirmed failures may use the controlled retry path; uncertain delivery is reconciliation-only and is never blindly retried.
- The manager still confirms the transaction separately from approving or denying the refund. Only confirmed payment success permits the canonical completion sentence. Existing duplicate-payment and reporting guards are unchanged.
- GPT, refund-specific TOTP/operator ceremony, QR codes, Kexiazhan reporting, cash fallback, and a new SMS platform are not Refund Operations v1 pilot requirements.

## 2026-08-21 - Refund eligibility comes from the complete Nayax inventory (`#890`)

Refund Operations v1 discovers every machine from each configured production Nayax account and records it by account plus immutable Nayax machine ID. Every active discovered machine is visibly **Published**, **Needs setup**, or **Explicitly excluded**; test, internal, duplicate, unmapped, and incomplete machines are never silently omitted.

- Cotton-candy and Snapcase use the same explicit refund-public eligibility path. Snapcase remains a separate payment/category source and is not reclassified as Sunze reporting data. Names and Nayax machine type alone never classify, map, publish, or exclude a machine.
- Publication requires an exact Nayax mapping, explicit `cotton_candy` or `snapcase` category, active machine/location, customer-safe label, and at least one current Machine Manager route. A machine that does not meet every condition remains visible as setup work.
- One absent successful snapshot does not remove a machine. Two complete successful snapshots are required before it becomes inactive; failed or empty syncs never remove or republish inventory. Large drops and failed/stale runs surface as operational attention.
- The public form and server-side submission validation use the same published inventory gate. Provider transaction lookup and live refund execution remain separately gated, and duplicate-payment/idempotency protections are unchanged.
- The sync and production schedule are default-off until reviewed deployment, inventory reconciliation, a controlled Snapcase lookup, and UAT are complete.

This supersedes earlier Commercial/Mini-only and Snapcase-out language only for refund intake eligibility and Nayax matching. It does not add Kexiazhan reporting, payroll reporting, QR codes, cash fallback, TOTP/operator ceremony, GPT, or a new SMS platform to the pilot.
## 2026-08-21 - Customer contact points to the Bloomjoy form; submission creates the case (`#889`)

The eligible customer-service email and existing EasyText/SMS response population use the Bloomjoy hosted `/refunds/request` form. The old Google Form response is retired during the sequenced no-overlap cutover. An email or text contact by itself is not a refund request in Bloomjoy and creates no `refund_cases` row.

- Gmail may record one private, replay-safe pre-form contact and send one warm hosted-form link in the original thread. The one-time private form context creates exactly one Email-sourced case only when the customer submits the Bloomjoy form; a direct website submission creates one Website-sourced case.
- After submission, the deterministic email assistant asks only for missing safe information in the original thread. A verified customer reply updates the same case and permits one automatic matching rerun only when material matching facts change.
- Email-linked and direct-form cases use the same manager queue, matching, duplicate reconciliation, transaction-confirmation, separate approval/denial, provider, reporting, and customer-message safeguards.
- EasyText/SMS keeps its current platform and changes only the response link. Refund Operations v1 adds no SMS provider or text-message ingestion path; an inbound text cannot create a Hub case before hosted-form submission.
- Production cutover must disable and verify the old responder before the Hub responder is enabled for the same population. Rollback disables and verifies Hub first, so both responders are never active together.

This supersedes the 2026-07-21 Gmail draft-on-contact rule and the 2026-08-11 EasyText/Google-Form-unchanged rule for Refund Operations v1 intake. Their mailbox isolation, minimal OAuth, replay, privacy, retention, routing, and transport safeguards remain in force. It does not add TOTP/operator ceremony, GPT, QR-code rollout, Kexiazhan reporting, cash fallback, or a new SMS platform as a pilot requirement.

## 2026-08-20 - Refund Operations uses one mapped-manager session, not TOTP ceremony

The normal manager experience is intentionally simple: a signed-in current Machine Manager reviews the case, confirms one action, and the server performs the exact guarded operation. Refund-specific TOTP enrollment, six-digit codes, temporary payment-support operators, and owner-controlled setup windows were controlled-pilot controls; they are retired from the manager product and are not prerequisites for approving, completing, or reconciling a refund.

- The database still rechecks the exact active machine mapping, authenticated user, current case version, frozen action payload, selected transaction, amount, caps, duplicate state, and row lock. A 90-second single-use authorization receipt protects provider execution and ordinary case decisions without adding a second manager task.
- An uncertain Nayax result is resolved through the same mapped-manager session. The resolver accepts only the four reviewed result/evidence shapes, stores only a digest of the safe reference, and can never call Nayax. Confirmed success atomically settles the held attempt, completes the case, creates one reporting adjustment, and prepares one reply in the original Gmail thread.
- Historical TOTP/operator tables and functions remain only for immutable audit history and rollback compatibility. Active legacy enrollments/operators are revoked by the retirement migration; no setup or code UI remains.
- The refund page has three queues—**Action needed**, **Waiting**, and **Done**—plus search. It shows one plain current state and one next action. Routine system-health notices, duplicate status badges, low-value warning banners, advanced status filters, and internal workflow terminology are removed from the manager surface.

This decision supersedes the TOTP/operator requirements in the 2026-08-20 support-window decision, the 2026-08-13 uncertain-outcome decision, and the 2026-08-12 authenticator decision for the normal manager product. Their audit, privacy, idempotency, provider-call, reporting, and customer-delivery safeguards remain in force.

## 2026-08-20 - Support-confirmed refund is reconciled without another provider call

- Nayax support confirmed that transaction `6841061866` appears refunded and described missing user-level approval roles only as a possible explanation for the earlier approval error. Support did not establish that as the cause or direct Bloomjoy to create a different refund executor. This is authoritative support evidence for the existing held attempt; Bloomjoy must not send another refund request or approval.
- Closeout uses the already deployed structured outcome resolver with `provider_confirmed_success`, `nayax_support_ticket`, `nayax_support_confirmed_success`, the exact public support-ticket reference, and the authoritative provider action time. The resolver preserves the original unknown provider result, creates no new provider attempt, finalizes reporting once, and binds one customer completion to the original Gmail thread.
- Activation is a reviewed, bounded database window rather than a permanent runtime switch. The opening migration seeds no operator and does not contact Nayax or Gmail. Production provisioning is limited to the exact current mapped owner-manager, a fresh refund-specific TOTP enrollment, and one two-minute resolution intent. The paired closing migration fails while an intent is pending or a completed resolution reply is not sent, then revokes the temporary enrollment/operator and restores the immutable false gate.
- The support ticket uses Nayax's public `CS` reference shape. The privacy validator accepts only the exact `SUPPORT:NAYAX-CS` plus seven digits form in addition to the previously reviewed eight-digit support and nine-digit DTM forms; durable evidence still stores only a SHA-256 digest.

## 2026-08-19 - Historical approval-only recovery design (`#877`; retired and superseded)

The first normal production attempt proved that an HTTP-successful Nayax request can create a **Refund Requested** transaction while returning a `Result`/`Status` pair outside Bloomjoy's guessed request contract. Bloomjoy must not hardcode an unverified production response pair or infer success from HTTP status alone.

- Normal manager execution requires an explicit versioned `NAYAX_REFUND_MANAGER_CONTRACT_JSON`. Missing or invalid contract configuration blocks before reservation or provider transport. The execution, dry-run, kill-switch, credential, machine, amount, daily-cap, and exact-manager gates remain independent.
- Every normal request/approval stage is bracketed by an append-only database journal. It stores only stage/event, bounded HTTP/outcome classes, contract-match state, transport-failure class, and a keyed classification digest. Raw or unmatched provider values never enter database rows, logs, issues, or customer-facing surfaces.
- A DTM-confirmed `Refund Requested` hold caused by a request-stage contract mismatch may reserve one approval-only recovery. The database requires the exact latest ambiguous attempt, current mapped-manager authority, unchanged case/version/provider evidence, no later attempt, and no prior approval-start marker. The original attempt has one unique recovery row, so replay cannot obtain another provider claim.
- The recovery implementation has no request-stage function or endpoint. It may issue one `refund-approve` call, never `refund-request`; any timeout, HTTP error, malformed response, journal failure, or unfamiliar response consumes the recovery and remains held without retry, finalization, reporting, fallback, or customer mail.
- Even an exact approval response is not customer completion. Dynamic Transactions Monitor or Nayax support must confirm the final provider outcome, after which the existing structured resolution boundary performs any case/reporting/email finalization.

This records the historical recovery design. The 2026-08-27 decision retires this provider-write route fail-closed; current and historical contract mismatches use provider-free DTM/support reconciliation and cannot call approval-only recovery.

## 2026-08-17 - Manager selection resolves ordinary wallet/card ambiguity

Bloomjoy shows the safe Nayax candidates in likely order using the existing deterministic time, location, amount, and card clues. Confidence is not a separate manager decision or refund gate. A current mapped manager may select any candidate that passed the existing hard safety exclusions; alternate selections keep the existing short reason and audit event. The card refund uses the exact selected Nayax amount even when a wallet token changes the last four digits or the customer reported a different amount. Customer-reported evidence remains unchanged and visible for comparison.

## 2026-08-16 - Normal card refunds use the authenticated mapped-manager action (`#430`)

For an ordinary high-confidence card case, the manager reviews the exact transaction and confirms **Refund $X** in Bloomjoy. That authenticated current Machine Manager action is the payment authority for the normal product path; it does not require a separate owner-only runner, sponsor packet, written Nayax approval, or TOTP ceremony.

- The server uses the already configured account-specific Nayax token and existing two-step refund adapter. Provider credentials never enter the browser.
- The database rechecks the exact manager-to-machine mapping, case version, stored amount, currency, selected Nayax transaction, recommendation eligibility, machine enablement/cap, duplicate links, idempotency key, and daily caps in one locked reservation.
- One exact action can create one provider attempt. Concurrent or repeated requests return the original reservation and never overlap or blindly retry an uncertain result.
- Confirmed provider success alone may complete the case, update reporting, and prepare one reply in the original customer thread. Rejection, timeout, unknown, or contract-mismatched responses keep the case open for review and send no success message.
- The normal action is recorded as `manager_session`; it must not be described as TOTP-authorized. Existing TOTP rules remain in place for the separate legacy administrative/cash and controlled-pilot paths until those paths are changed separately.

This decision supersedes older `#430` requirements for a sponsor-gated owner-only pilot as prerequisites to the normal manager experience. Deployment switches and machine caps remain off until the reviewed change is merged and the exact owner-authorized East Ridge transaction is safely identified.

## 2026-08-13 - Uncertain Nayax outcomes require a separate immutable support decision (`#767`)

A timeout, unknown, or rejected Nayax attempt remains frozen until authoritative evidence is reviewed. Resolving that hold is a separate payment-support action, not a provider retry and not a generic case edit.

- The feature is hard-disabled by an immutable database gate, seeds no operator, and has no browser/service setter. A future launch requires an explicit owner-approved payment-support operator who is also the current mapped Machine Manager, plus the existing durable TOTP enrollment and a fresh code bound to the exact case, attempt, evidence, and versions.
- The only outcomes are: keep the hold; confirm safe for a fresh manager review; confirm provider success; or document a manual Nayax completion. Each accepts only an approved evidence-source/reason pair and a prefixed monitor/support/manual reference. Card-, account-, contact-, and customer-like references are rejected before preparation; the database keeps only a SHA-256 reference digest, never the raw reference or pasted provider content.
- Two database sessions racing the same verified intent produce one immutable result. The original provider outcome remains preserved. Confirmed success/manual completion may atomically commit the case and reporting adjustment; safe-to-review releases the case without calling Nayax; hold changes no case outcome.
- Confirmed success/manual completion must freeze the authoritative payment-action time as UTC from the evidence. Reporting and customer copy use that UTC time, not the support-review time or the reviewing browser's timezone. Safe-to-review increments a bounded attempt generation so a later separately authorized action receives a fresh idempotency key without altering or reusing the old attempt.
- The final fresh-code dialog repeats the exact frozen outcome, evidence source/result, reference, and authoritative action time where applicable. The manager must be the exact current case manager with an active durable authenticator enrollment before the readiness control is offered.
- The resolution operation never calls Nayax or creates another provider attempt. A completed outcome atomically binds one deterministic completion message to the original Gmail thread; the Edge step-up then attempts only that reply with the complete current mapped-manager CC route. Safe failure permits one exact non-editable email-only retry, while uncertain delivery requires reconciliation. Hold and safe-to-review create no customer message. No recipient, copy, body, attachment, payment-retry, or provider control is exposed.
- Passing local/hosted synthetic checks does not activate the feature. The account-specific contract in `#430`, controlled synthetic deployment UAT, explicit operator grant, owner/sponsor approval, caps/allowlist, and supervised low-value pilot remain required.

## 2026-08-12 - Refund authenticator setup is private, self-only, and temporary (`#782`, `#692`)

The first refund-operator authenticator can be enrolled only by the exact preapproved owner-manager while signed into their own portal session. The database stores only a SHA-256 binding of the private, immutable, high-entropy Auth user UUID—not an email literal or guessable email hash—and the browser API accepts no target identity.

- The owner must also have a current active Machine Manager mapping and an active Super Admin role; neither role alone is sufficient.
- **Begin private setup** opens one five-minute window for the signed-in owner only. A concurrent or repeated click cannot create a second window or extend the expiry.
- The window closes logically on expiry and is consumed by successful durable enrollment. Cancel and failed-start paths remove any unfinished factor and close the window.
- Exact owner role, active manager mapping, confirmed Auth identity, and immutable owner binding are rechecked under the enrollment lock before Auth start and again before durable success. A change after the window opens fails closed.
- Checked-in Supabase Auth remains TOTP enrollment-off and verification-on. During the same private five-minute ceremony, the owner temporarily enables only Auth TOTP enrollment in the control plane, confirms it with a read-only probe, and restores it off after success, cancel, expiry, or failure. There is no generic application, agent, service, or workflow setter.
- Every refund production database/function deployment must pass an exact-project, GET-only live Auth check immediately before the first write and again after the final refund function. The probe uses only an owner-held short-lived token, emits only the two TOTP booleans and pass/fail, and cannot restore or change Auth. The Edge-Functions-Read drift credential is never reused or broadened for this check.
- Audit rows record only the bounded lifecycle event, actor, time, and approval version. QR material, codes, factor identifiers, email addresses, tokens, and customer/payment data are excluded.
- The owner scans the QR and enters setup codes personally in a private, non-agent browser. Agents and shared sessions may not view, capture, enter, relay, or proxy them.
- Authenticator setup does not enable official actions, call Nayax, contact a customer, start Gmail, or turn on a schedule. A later refund still needs a new action-bound code plus every independent provider and release gate.

The enrollment window is default-closed and is not opened by deploying this change.

## 2026-08-12 - Refund intake auto-assigns only an unambiguous current manager (`#774`)

Direct website intake and a private email-linked form use the same database ownership rule when a machine is bound to a refund case. The database serializes that decision with Admin > Machines and re-reads the current active, unrevoked manager mappings while holding the shared per-machine lock.

- Exactly one current mapping is assigned automatically.
- With two to four current mappings, the system never guesses a primary owner. The case stays unassigned for explicit admin review unless a still-current manager was deliberately selected.
- With no current mapping, or when a prior selection is stale or revoked, the case stays unassigned for explicit admin review.
- Clearing an assignment without changing the machine is preserved; the intake trigger does not silently reassign it.
- The release performs one idempotent repair of existing open, unassigned cases with a resolved machine and exactly one current manager. Each changed case receives a redacted, non-official audit event; zero- and multiple-manager cases are untouched.
- Customer CC resolution remains separate and continues to include the complete safe current mapped-manager set at send time, regardless of who participated in the Gmail thread.

This is an intake ownership rule only. It does not enable Gmail, automation, customer contact, or Nayax execution, and it does not grant the email assistant authority to perform an official refund action.

## 2026-08-11 - Owner approves the controlled refund-email pilot data policy (`#705`, `#707`)

The owner approved the first controlled email pilot with a 180-day retention period for the Hub's sanitized Gmail copy, attachment collection disabled, and visible CC to the complete current portal-mapped Machine Manager set on every case-specific customer message.

- The generic first acknowledgement remains the only customer message that may send before machine mapping and therefore carries no manager CC.
- Attachments are unavailable in the pilot. Because the system cannot copy attachment metadata or bytes, an unimplemented attachment scanner is not a prerequisite for copying sanitized message text. If attachment copying is ever enabled, scanner and quarantine approval becomes mandatory again.
- The legacy Gmail responder remains authoritative until the isolated synthetic test proves a non-overlapping population and teardown. This policy approval does not itself turn on Gmail or automatic customer contact.
- The owner also approved sending the reviewed Nayax contract-confirmation request. That approval does not authorize a provider call; live execution still requires the written account contract and the separately capped one-case test.

These approvals remove the policy-decision blocker. The technical isolation, exactly-once, mapped-manager routing, retention cleanup, and rollback tests remain mandatory launch gates.

## 2026-08-11 - The first refund-assistant pilot is email-only and attachment-free (`#707`, `#757`, `#758`)

The first controlled pilot is limited to the designated support mailbox and the Bloomjoy hosted form. EasyText and the SMS Google Form remain unchanged. The Hub is the system of record; Gmail is intake and reply transport only.

- One generic acknowledgement may send in the original thread before machine mapping and carries no manager CC. Every case-specific message requires the full current mapped-manager CC route.
- The private email link completes the originating draft case and cannot be replayed. Website/email duplicates are held for manager reconciliation instead of creating competing payment work.
- Attachments are off for this pilot. The public form has no file control, hosted intake rejects attachment bytes, and Gmail copies no attachment metadata or bytes. This supersedes the earlier quarantine-only attachment rule until scanning, retention, and download access receive separate approval.
- Managers receive a separate sanitized notice with the exact portal case link only when action, aging, or an exception needs their attention. Customer-facing messages never contain that private portal link.
- Choosing a possible Nayax transaction records evidence only. It does not approve, pay, close, or email the customer. Only a currently mapped Machine Manager may perform an official action after a fresh action-bound TOTP challenge.
- Only token-bound confirmed provider success may complete a card case, create the reporting adjustment, and authorize the one original-thread completion receipt. Rejection, timeout, or unknown outcome leaves a persistent hold and forbids blind retry, fallback payment, and success copy.
- The completion receipt states the exact amount, masked card destination when available, action date, and that the bank may take up to 4 business days to show the credit. Internal denial notes are never copied into customer mail.

Production Gmail, automatic customer contact, official actions, and live Nayax execution remain independently disabled until the release gates and owner-controlled pilot proof pass.

## 2026-08-11 - Refund product category comes from the selected machine (`#753`)

The hosted refund form does not ask the customer to identify a product or selection. The selected machine already determines whether the purchase is a phone case or cotton candy, so a separate customer answer would add effort without improving transaction matching.

- New hosted-form submissions omit `productDescription`.
- Existing stored customer product notes remain readable for backward compatibility.
- Machine configuration and sanitized provider transaction context remain the source of truth for product category and selection evidence.
- The general incident description stays product-neutral so the same form works for phone-case and cotton-candy machines.

This decision refines the optional customer product-context rule in `#750`; it does not change matching weights, manager approval authority, or live refund execution gates.

## 2026-08-11 - Refund evidence separates customer statements from provider observations (`#750`)

The hosted refund form will collect a small set of structured, non-sensitive facts that help managers compare a customer report with Nayax without overstating what the provider can identify.

- The customer states how they paid: phone/watch wallet, tapped physical card, inserted or swiped card, cash, or unsure. A wallet customer may state Apple Pay, Google Wallet, another wallet, or unsure.
- Bloomjoy treats those fields as customer statements. Current Nayax Last Sales data does not reliably identify Apple Pay versus Google Wallet and must not be presented as doing so.
- The customer also states how closely they remember the purchase time and chooses a structured issue category. An exact or roughly 15-minute time may support the existing deterministic recommendation. An estimate that may be off by an hour or is only rough remains manager-review evidence and cannot make a transaction execution-eligible.
- Nayax machine-product configuration, current machine status, and alerts near the sale may help investigation but do not increase the recommendation score, prove a failed vend, approve a refund, or authorize payment execution. Customer product text is no longer collected under `#753`.
- The manager workbench presents one customer-versus-Nayax comparison, plain-language reasons, collapsed alternatives/context, and one primary next action. It does not use internal terms such as "safety exception" in manager guidance.
- Sanitized provider context is snapshotted with the candidate evidence. Raw Nayax payloads and provider transaction IDs remain server-only.
- Richer fields from a separately permissioned Nayax transaction feed require Bloomjoy sample validation under `#751` before they may be persisted or shown. A generic phone/contactless field may not be used to infer a wallet brand.

The email assistant remains limited to communication, follow-up, and reminders. A machine manager performs every official refund action in the portal, and live Nayax execution remains governed by `#430`.

## 2026-08-10 - Catering dessert guide produces a scope template, not an offer (`#730`)

The canonical established-operator guide lives at `/resources/business-playbook/food-truck-catering-dessert-menu`. It begins with a food-truck or catering business that already operates and helps that reader turn one dessert experience into a proposal-ready outline. The existing `/resources/business-playbook/mini-micro-event-catering-business-guide` continues to own startup, initial booking, equipment-selection, and event-day formation intent.

- Ten visible scope decisions cover the service window, planning estimate, menu, staffing, travel/load-in, power/setup responsibility, payment/deposit posture, weather, cancellation/reschedule, and insurance/COI/buyer paperwork.
- Fixed-event and per-serving are presented only as planning structures. The guide recommends no price, percentage, fee, deposit, refundability rule, revenue, margin, payback, booking, or serving target.
- The reusable outline is blank and explicitly not a Bloomjoy package, offer, quote, contract, policy, performance promise, insurance interpretation, or legal recommendation. Every operational and commercial assumption must be replaced by the operator.
- Machine-fit questions route through the dessert comparison, food-truck solution, setup guide, categorical fit checker, product pages, and fixed Commercial quote policy. Mini and Micro remain on product purchase paths.
- The copy action copies only the static published template. Analytics use the existing consent-gated path with bounded route, slug, category, surface, CTA, and destination identifiers; no operator-entered terms, private setup details, PII, query strings, or financial assumptions are collected.

This keeps the page distinct from generic startup content and useful to proposal-stage operators without presenting Bloomjoy as the caterer, pricing authority, insurer, venue, lawyer, engineer, manufacturer approver, or local authority.

## 2026-08-10 - Dessert add-on comparison is an operating-fit analysis (`#729`)

The canonical food-truck dessert comparison lives at `/resources/business-playbook/food-truck-dessert-add-ons`. It compares robotic cotton candy, cookies/brownies, churros/fried desserts, ice cream/frozen desserts, and fresh fruit cups/skewers across thirteen operator-visible criteria. The three postures—potential advantage, confirm the plan, and heavier obligation—describe operating work, not popularity, quality, demand, price, profit, food cost, margin, payback, permit status, or guaranteed service speed.

- The page uses mobile criterion cards rather than a wide score table or a hidden combined ranking.
- Cotton candy is not forced to win: it carries explicit machine-fit, complete-load, staffing, weather, and transport tradeoffs and a clear poor-fit path.
- Bloomjoy machine facts come from current product pages and the approved `#723` claim matrix. FDA, USDA, NFPA, and a California mobile-food chapter are visible sources for questions to validate; they do not create one universal plan or replace local, venue, insurer, manufacturer, food-safety, fire, electrical, or vehicle review.
- The primary next step is the categorical mobile setup fit checker. A separate quote action remains fixed to Commercial and carries only the canonical source plus the bounded `mobile-food` use category.
- The page uses the existing consent-gated analytics path with bounded route, slug, category, destination, and CTA identifiers only. It sends no form values, exact setup inputs, PII, arbitrary query strings, or financial assumptions.

This keeps the comparison useful and original without presenting Bloomjoy as an equipment, food-safety, fire-code, vehicle, venue, insurance, or permitting authority.

## 2026-08-10 - Mobile setup fit checker uses transparent categorical rules (`#725`)

The mobile-operator fit checker lives at the dedicated canonical route `/resources/business-playbook/mobile-setup-fit-checker`. Its rules are implemented as a pure, testable decision function separate from the UI and are limited to the approved `#723` machine-fit claim matrix.

- Inputs are bounded categories for placement, current machine path, space/access review, complete-load and power-source review, staffing/service flow, service-volume posture, transport/load-in review, and local/venue review. The tool collects no free text, PII, exact dimensions, exact electrical values, customer data, revenue, margin, ROI, or payback inputs.
- Results are `incomplete`, `likely-fit`, `needs-confirmation`, or `not-supported`. Missing information remains incomplete; known physical conflicts, generator-certification dependence, a Mini/automatic-stick contradiction, guaranteed-throughput dependence, improvised transport/securing, and Bloomjoy-as-permit-authority assumptions fail closed.
- A likely-fit result means only “worth exploring.” Every result preserves the boundary among Bloomjoy quote review, manufacturer instructions, qualified electrical/vehicle professionals, venue/insurer review, and local authorities.
- Micro cannot receive a likely mobile fit from published evidence because its public product page does not publish the dimensions, weight, power, or mobile service rate required for that conclusion.
- Quote navigation remains fixed to `interest=commercial` and `use=mobile-food`. It may transfer only `mobile_fit`, `mobile_machine`, `mobile_placement`, and `mobile_open` allowlisted values under the canonical checker `source`.
- Unsupported results do not offer a quote action. Mini and Micro signals lead to their product/payment-first paths; a separate Commercial quote action may carry the signal as context rather than quote interest.
- Answers are not persisted. Refresh, direct navigation, back navigation after unmount, and reset return to the safe incomplete state. Copy and print summaries contain categorical answers and decision boundaries only.

This provides a useful operator screen without presenting engineering, regulatory, venue, insurer, generator, vehicle, throughput, or financial approval.

## 2026-08-10 - Machine-fit planner transfers categorical context only (`#623`)

The public Machine Fit + Startup Budget Planner may carry a bounded planning summary into the Commercial quote journey, but it does not transfer the planner's exact financial inputs or turn a Mini/Micro result into quote interest.

- The quote remains fixed to `interest=commercial` under the policy in `#617`.
- The only planner query keys are `planner_machine`, `planner_path`, `planner_budget`, and `planner_open`, with fixed allowlisted values and the canonical planner `source`.
- The visible and submitted summary may identify the advisory machine signal, intended operating-path category, budget-completeness band, and unresolved-question categories.
- Names, contact details, free-form notes, exact budget amounts, revenue, margin, volume, ROI, and payback inputs stay out of URLs and analytics.
- Mini and Micro results lead to their product/payment-first paths. A separate Commercial quote action may preserve the planner signal as context while stating that it is not quote interest.
- Unknown values, non-planner sources, refresh/direct-load states, and incomplete planner states fail safely.

This creates a useful handoff without weakening the payment-first storefront or collecting financial assumptions through attribution/query data.

## 2026-08-09 - Public quote intake uses focused, minimum-useful qualification (`#617`)
`/contact?type=quote` is a Commercial Machine fit and quote conversation, while plain `/contact` remains a general-contact path. The quote flow asks for name, email, intended setting/use, a city/state or service region, and purchase timeline. Business/organization, procurement readiness, and additional details remain optional; a phone number is not collected in the first release.

The route enforces the 2026-08-06 payment-first decision: Commercial is the fixed quoted machine. Safe Mini or Micro query context is acknowledged without being submitted as quote interest and links back to that model's product/purchase path. Unknown machine values are discarded. This prevents a marketing or planner link from turning an unavailable or direct-checkout product into an unpaid request path.

Bloomjoy promises only to review the submitted setting, region, timing, and machine fit and follow up using the supplied email. Public copy does not promise a response time, price, availability, financing, delivery date, ROI, earnings, or a definitive machine recommendation.

Qualification is serialized into the existing server-bounded lead message instead of adding database columns. Source and machine query context is allowlisted, visibly confirmed, and submitted through the existing protected intake path. A retry reuses its client submission ID, and the existing server dedupe remains authoritative. Form analytics use only controlled inquiry/source/route context and never include contact fields or the structured message.

This is intentionally reversible: field choices and copy can change after Sales UAT without a data migration. Attribution fields from `#616` may be added only through that issue's allowlisted, consent-compatible contract.

## 2026-08-10 - Public lead attribution is session-scoped, allowlisted, and lead-bound (`#616`)
Bloomjoy will retain enough first-touch, last-touch, and conversion context to distinguish direct, referral/organic, campaign, internal-CTA, and planner-assisted public leads without creating a cross-session tracking profile.

**Canonical behavior**
- The browser uses `sessionStorage`, not cookies or `localStorage`. First touch is fixed for the tab/session. Last touch changes only for a new allowlisted campaign, external referring host, explicit internal source, or controlled planner signal.
- Only pathnames, a referring hostname, five UTM fields, controlled touch classifications, normalized internal source, allowlisted machine interest, planner recommendation, and categorical planner band may be captured. Click IDs are excluded until separately approved.
- Arbitrary query parameters, fragments, full referrer URLs, exact planner inputs or financial assumptions, form values, and strings matching conservative likely-PII patterns are discarded.
- Capture runs only on indexable public routes; portal, admin, authentication, and refund-workflow paths are excluded from landing and internal-source attribution.
- Attribution is rebuilt from the server allowlist and stored in one additive `lead_submissions.attribution` JSON object. It inherits the lead row's existing retention and Super Admin-only read boundary; there is no secondary marketing store or new public read policy.
- Internal notifications show only a compact sanitized attribution summary. Notification failure remains non-blocking and cannot create a second lead.

The exact schema, field limits, lifecycle, rollout, and rollback are maintained in `Docs/LEAD_ATTRIBUTION.md`. Automated grading, autonomous outreach, marketing consent expansion, campaign click IDs, and a new CRM remain out of scope.
## 2026-08-02 - Public refund intake follows the active machine portfolio (`#681`)
Bloomjoy customers may submit a refund request for any active Commercial or Mini machine in the reporting-machine portfolio. Public intake eligibility is separate from whether that machine is ready for automated transaction matching or refund fulfillment.

**Canonical behavior**
- `/refunds/request` reads active Commercial/Mini machines and active locations dynamically from `reporting_machines`; the frontend does not maintain a second location list.
- The existing `refund_intake_enabled` field is a manager/Nayax automation-readiness gate. It does not hide an otherwise eligible machine or make direct intake reject it.
- A machine without an assigned manager or Nayax mapping still accepts the request. Bloomjoy operations remains the notification and review fallback, while matching reports the missing setup instead of claiming automation is available.
- Internal placeholder locations such as `Unmapped` or `Unknown` remain private unless the machine has an explicit customer-facing label.
- Active QR assets remain separately controlled by their opaque code status and rotation rules. Portfolio visibility does not generate or activate a QR code by itself.
- Snapcase remains outside this intake source until its machine, payment, manager-routing, and reporting source of truth is represented in the live portfolio. Production Nayax execution remains separately gated.

This decision supersedes the earlier rule that public intake exposes only machines explicitly enabled for the refund pilot. It does not widen automatic approval or payment-execution authority.

**Why this choice**
- Customers should not lose the refund path because internal manager or Nayax setup is incomplete.
- A single active-machine registry makes new locations appear automatically and prevents a six-machine pilot list from becoming stale.
- Keeping automation readiness separate preserves honest fallback behavior without overstating matching or refund capabilities.

## 2026-07-26 - Verified refunds use one manager approval and automatic fulfillment (`#674`)
Bloomjoy will make every bounded, safe effort to identify the correct transaction before asking a Machine Manager to decide a refund. The normal high-confidence path is one manager approval followed by automatic provider execution and confirmation, not a second manual workflow in Nayax.

**Canonical behavior**
- Bloomjoy owns transaction discovery. The system uses the machine-specific QR context, server-recorded scan time, customer-reported time and amount, payment method, and permitted card evidence to find one transaction or state clearly that it cannot.
- When a customer may have supplied the physical-card last four after paying with Apple Pay or another wallet, the system sends a short-lived, single-use correction link, accepts only the virtual/device last four plus limited claim confirmation, and automatically re-runs matching. It never asks for or accepts a full card number, CVV, expiration date, wallet credentials, or a wallet screenshot.
- A deterministic `strong_card` result or a uniquely verified `unique_qr_time` result may become execution-eligible. Wallet use alone does not force a manager into the Nayax portal, but a wallet mismatch cannot be ignored when another plausible transaction remains.
- The manager remains the business approver because a transaction match does not prove the product failed to dispense. Their normal task is one **Approve refund** or **Decline** decision against the recommended transaction.
- **Approve refund** triggers the server-side Nayax refund-request and refund-approval sequence. Only a confirmed provider success may complete the case, write the reporting adjustment, and send exactly one confirmation to the customer and one to the manager.
- A provider rejection leaves the case open and sends no success confirmation. A timeout or unknown provider result is never retried blindly and must be reconciled before retrying or issuing alternative compensation.
- Alternative compensation is offered only after bounded matching and correction attempts reach a terminal unmatched state, or for a payment method such as cash that cannot use the card-refund path. Selecting the compensation provider and its business rules remains the P0 owner decision in `#666`.
- Engineering may implement and test behind disabled flags. Production refund execution remains gated in `#430` until Bloomjoy confirms the account-specific Nayax write contract, credentials, amount units, response/status semantics, idempotency and reconciliation behavior, required provider identifiers, and a controlled test procedure.

This decision supersedes the manual-only target for high-confidence wallet/QR-time transactions in the machine-QR decision below. It does not authorize automatic refund approval or production payment execution.

**Why this choice**
- Managers should decide whether to help the customer, not repeat transaction research or operate a second payment console.
- A self-service correction loop handles the common physical-versus-virtual-last-four mistake without creating manager correspondence work.
- Confirmed-success-only completion, idempotency, and reconciliation protect against duplicate refunds and false customer notices.
- Keeping approval human while automating fulfillment is the simplest low-friction experience that still respects the missing vend-failure signal.

## 2026-07-26 - Machine QR and confidence-gated refund identification (`#661`)
Bloomjoy will use a machine-specific QR code and conservative transaction matching to improve refund identification without pretending that card digits or customer-reported time are always reliable.

The identification model remains binding. Where this entry describes high-confidence wallet/QR-time transactions as manual-only or alternative compensation as non-blocking, the later one-approval decision in `#674` supersedes it.

**Canonical behavior**
- Each participating machine has an opaque, rotatable refund QR identifier. Opening the QR route creates a short-lived server-side claim context containing the resolved machine and server-recorded open time; browser time is not trusted.
- The customer still provides approximate incident time, amount, payment method, and card last four. Apple Pay/mobile-wallet customers are told to provide the virtual last four shown in the wallet, which may differ from the physical card and may not reliably correlate to Nayax.
- A transaction is recommended only when approved, versioned rules leave one plausible safe candidate. A matching last four can support a strong-card result; unique machine, exact-amount, reported-time, and QR-time evidence may support a recommendation when wallet digits do not correlate. Two plausible candidates means no recommendation.
- Recommendation confidence is advisory. It does not prove a delivery failure, approve a refund, or enable payment execution. Managers remain the business approver, and any wallet refund stays outside live in-app execution unless the separate Nayax gate in `#430` is approved.
- The first rollout is a shadow pilot for the approved Commercial/Mini cohort. Snapcase remains out of scope until its payment and sales source of truth is modeled.
- Alternative compensation for unmatched wallet/contactless and cash claims remains TBD in `#666`. This decision does not select Nayax/Monyx, a gift-card provider, or a Bloomjoy stored-value platform.
- The deployed policy in `Docs/REFUND_NAYAX_MATCHING_RUNBOOK.md` remains unchanged until the implementation issues are merged, tested, and deployed. The target behavior and issue sequence live in `Docs/REFUND_IDENTIFICATION_STRATEGY.md`.

**Why this choice**
- Contactless and wallet card digits may not be a stable key, while customer-reported time alone is too imprecise for machines with frequent same-price transactions.
- A machine-specific server timestamp adds useful evidence without claiming more certainty than the data provides.
- Separating identification, approval, and execution prevents an ambiguous match from becoming an unsafe payment action.

## 2026-07-21 - GPT refund triage is narrow, minimized, and always human-reviewed (`#635`)
Bloomjoy may use GPT to reduce the time spent collecting missing refund details, but the assistance remains subordinate to the manager workflow and cannot make payment decisions.

**Canonical behavior**
- GPT may classify, summarize, extract only the allowed refund fields, identify missing information, and draft a reply that asks only for those fields. It may not match or select a Nayax transaction, approve or deny a request, promise or execute a refund, or create any payment action.
- Model input is limited to recent inbound text, excludes customer identity, redacts prohibited payment and credential data, and treats all message text as untrusted. Raw model input and provider output are not stored; derived content expires after 30 days.
- Strict schema validation plus deterministic missing-field and safety checks control routing. Legal, safety, threat, chargeback, abusive/escalated, prompt-injection, high-value, wallet, prohibited-payment-data, low-confidence, unrelated, uncertain, and non-English input receives no draft and requires a person.
- Every allowed draft is editable and must be explicitly approved by an authorized manager. A database constraint prevents automatic sending. Broader autonomy requires a separate reviewed migration and explicit sponsor decision.
- The provider lane remains disabled until a secure server-only credential destination, privacy controls, and sanitized live evaluation are approved in `#635`. Gmail and hosted-form workflows continue without GPT.

**Why this choice**
- Most inbox labor is missing-information triage, which can be assisted without delegating refund judgment or payment authority.
- Minimization, strict validation, bounded retention, and reviewer outcome tracking make quality and safety measurable while preserving a simple manager experience.

## 2026-07-21 - Gmail refund intake is label-scoped, draft-first, and transport-only (`#634`)
Bloomjoy will connect one designated support mailbox to Refund Operations as a narrowly scoped intake and reply transport. Gmail does not become the system of record, and the connection stays disabled until its production controls and owner approvals pass.

**Canonical behavior**
- OAuth grants only `gmail.readonly` and `gmail.send` for the exact configured support mailbox. The integration does not modify labels, archive mail, delete mail, or change read state.
- Only threads carrying the explicitly configured refund label are ingested. Both the Edge Function switch and scheduled GitHub workflow are off by default.
- A first eligible customer message creates one incomplete `draft` refund case. Re-delivery is idempotent, later replies append chronologically to the same case, and a new thread may relink by public case reference only when the sender email also matches.
- Provider message/thread IDs remain service-only. While location is unknown, only Super Admins and Scoped Admins may view or reply to an unassigned draft; location-only Machine Managers cannot see it. The manager UI receives sanitized plain text, redacts Luhn-valid full card numbers to last four, and never exposes raw attachment paths or provider payloads. Logs and workflow output remain aggregate-only.
- Attachments are limited to PDF, JPEG, or PNG, at most three per message and 5 MB each. Accepted bytes enter a private quarantine bucket and are not manager-downloadable until a separate malware scanner explicitly marks them clean. Until that scanner exists, attachments remain quarantined.
- Customer replies are manager-approved only and use one prominent action in the existing refund workbench. Gmail-linked replies stay in the original Gmail thread. An uncertain provider outcome is never retried automatically; the manager must reconcile Gmail first.
- The Gmail message copy is scheduled for deletion after 180 days while the canonical refund case continues under Bloomjoy's governed business-record retention. Production enablement requires recorded Operations and privacy/security approval of this period and the quarantine-until-scanned behavior.
- Authorization revocation or a Gmail outage is visible in manager health and fails only the Gmail path. Hosted-form refund intake, the refund queue, and manual manager work remain available.

**Why this choice**
- Most support effort is spent collecting missing details, so a draft-first queue can organize incomplete requests without inventing transaction facts or making an automatic refund decision.
- Label scoping, minimal permissions, redaction, private quarantine, and default-off rollout materially reduce mailbox and customer-data exposure.
- Keeping Gmail as transport preserves the Hub as the auditable case system and lets the team disable the integration without reverting the refund workflow.

## 2026-07-16 - Timekeeping V1 is shift entry and machine-manager review (`#587`)
Bloomjoy will replace the contractor Google Sheets/AppSheet workflow with a lightweight Hub timekeeping flow before expanding into payment execution.

**Canonical behavior**
- V1 uses after-the-fact completed-shift entry; it does not add a live clock-in/clock-out mode.
- Pay periods are monthly calendar periods. Each completed shift is rounded up to the next full hour before monthly totals are shown.
- Existing Machine Manager authority is the review boundary. Do not create a separate payroll approver role for shift review.
- Machine Managers may approve an unlocked submitted shift or return it for correction. A correction requires a worker-visible reason; all review changes retain immutable review and admin-audit history.
- Workers may edit an unlocked approved or returned shift. Any material shift edit resets it to waiting for manager review.
- Time-review state does not calculate, issue, or send payment. Payment execution, direct deposit, tax/compliance processing, and provider integration remain post-MVP.
- Issued pay statements remain available for worker self-service. Availability notification may be automated separately, but V1 does not mail physical statements or create payment-provider behavior.

**Why this choice**
- Workers need one fast mobile task after a shift, and managers need one scoped queue showing what requires attention.
- Reusing assigned-machine authority preserves least privilege without adding role-administration overhead.
- Separating timekeeping from payment behavior lets Bloomjoy retire Sheets/AppSheet sooner without presenting the Hub as a full payroll system.

## 2026-06-30 - Admin Console IA and Scoped Admin authority
Admin features live in one `/admin` workspace named **Admin Console**. Admin Console uses shared sidebar navigation for Overview, Orders, Support, Accounts, Machines, Access, Audit, and the existing specialized admin surfaces. The sidebar is the single admin navigation map; the `/admin` overview is an attention dashboard, not a duplicate route launcher.

**Canonical behavior**
- Keep route compatibility under `/admin`; do not introduce a competing `/operations` hierarchy.
- Admin routes group navigation by task domain: shared Work, Operations, Customers, Administration, and Partners & Reporting. Portal Dashboard is not a primary admin nav item; switching back to the portal is a utility action.
- `/admin` shows live work queues, customer/machine setup gaps, access risk, and audit signals. It must not render generic "Open" cards or static source-of-truth catalogs for the same destinations already present in the sidebar.
- Refunds are a core authenticated operations workflow at `/refunds`. Legacy `/portal/refunds` and `/admin/refunds` paths may redirect for compatibility, but navigation should expose only one Refunds entry.
- Use `reporting_machines` as the first-class machine registry because it already backs reporting, refunds, operator pay, partnerships, Machine Manager, and scoped-admin authority.
- `/admin/accounts` is a first-class account summary and machine-record context page. It must not edit legacy machine inventory counts inline.
- `/admin/audit` is audit history only. Role and scoped-admin grant controls belong in `/admin/access`.
- Scoped Admin identity is separate from machine scope. A Scoped Admin can have zero machine grants, open Admin Console, and see an empty Machines state until a Super Admin grants machine access.
- Scoped Admins may use non-role admin workflows such as orders, support, accounts, audit, and scoped machine setup. They cannot grant/revoke Super Admin or Scoped Admin authority.
- Machine visibility/control remains explicit: Super Admins see all machines; Scoped Admins see and manage only machines in their active scoped machine grants.

**Why this choice**
- The previous Admin, Operations, Governance, and Portal labels made the hierarchy feel like it jumped between products.
- Duplicating Machines, Accounts, Access, and Audit as both sidebar links and dashboard route cards increases cognitive load. The overview should answer "what needs attention?" while the sidebar answers "where can I go?"
- Separating Access from Audit keeps operational history review distinct from authority changes.
- Reusing `reporting_machines` avoids a parallel machine registry while still satisfying per-machine scoped-admin grants.

## 2026-06-25 - Scoped Admins can grant machine-scoped Technician status
Scoped Admins may grant, update, renew, and revoke Technician access only when every assigned machine is inside their active Scoped Admin machine scope.

**Canonical behavior**
- Scoped Admins use `/admin/access` for Technician grants; they do not use customer-facing `/portal/team` unless they also have Plus Customer or Corporate Partner Technician-management authority.
- Scoped Admin Technician grants require at least one in-scope machine. Training-only zero-machine Technician grants remain available to Super Admins and eligible customer/partner sponsors, not Scoped Admins.
- Scoped Admins cannot grant Plus Customer, Corporate Partner, Scoped Admin, Super Admin, billing, supply, support, global reporting, or unrelated account access through this authority.
- Existing Technician grants that include any out-of-scope machine must be read-only for that Scoped Admin and repaired by a Super Admin.
- Super Admins may use Bloomjoy admin sponsorship for Technician grants when an account has no active Plus Customer owner sponsor.

**Why this choice**
- Field operations need scoped admins such as Adam to provision venue technicians without waiting for a global admin.
- Requiring at least one assigned machine keeps the authority tied to an explicit operational boundary and avoids turning Scoped Admin into a general training-access issuer.
- Keeping the customer-facing Team workflow limited to Plus Customer and Corporate Partner sponsors prevents Scoped Admins from seeing billing/account-owner surfaces they should not control.

## 2026-06-24 - Technician management uses role-appropriate entry points, not duplicated customer admin
Technician management should be discoverable in one customer-facing place and one internal override place, backed by the same capability and shared UI patterns.

**Canonical behavior**
- Plus Customer owners and Corporate Partners manage Technicians from `/portal/team` when `can_manage_technicians` is true.
- Account Settings (`/portal/account`) should link to Team for eligible users, but should stay focused on profile, billing, shipping, and language preferences.
- Super Admins may grant or repair Technician access from `/admin/access` using the Technician preset/source card.
- Plus Customer and Corporate Partner users should not receive an `/admin` page just to manage Technicians.
- Scoped Admin authority for machine-scoped Technician grants is superseded by the 2026-06-25 decision above.

**Why this choice**
- Users expect team/staff management to live under a Team area, not buried inside settings or exposed through an internal admin console.
- Duplicating the same customer workflow across Settings, Admin, and partner-specific surfaces increases support cost, copy drift, and authorization risk.
- Keeping the shared machine-assignment UI underneath role-appropriate routes gives Plus owners, Corporate Partners, and Super Admins the same scope semantics without making their information architecture identical.

## 2026-06-20 - Technician assigned-machine grants can include multiple machines
Technician remains a training-first, read-only reporting persona, but a single Technician grant may now carry zero or more assigned reporting machines.

**Canonical behavior**
- Zero assigned machines means training-only Technician access.
- One or more assigned machines means training plus read-only `/portal/reports` access for exactly those machines.
- Plus Customer owners, Corporate Partners, and Super Admins may assign multiple in-scope machines to one Technician when their management boundary includes those machines.
- Technician revoke and scope edits must continue to affect only Technician-sourced reporting entitlements; unrelated manual reporting, Corporate Partner, Scoped Admin, or Super Admin access remains separate.

**Why this choice**
- Merlin-style partner staff often need the same narrow reporting view across several properties without receiving Corporate Partner or admin authority.
- Expanding the existing Technician machine assignment set avoids adding another role while preserving source-aware audit and revoke behavior.

## 2026-05-20 - Right-sized operator pay and payroll automation (`#443`, `#444`)
Bloomjoy will build Operator Pay as a vending-specific timekeeping, pay-run calculation, and pay-statement workflow inside the existing reporting/machine/account model.

**Canonical rule**
- Use **Operator Pay**, **Pay Run**, **Compensation Rule**, and **Pay Statement** as the default user-facing product language. Existing backend table, RPC, and TypeScript names may continue using `payout` until a separate low-risk migration is warranted.
- `customer_accounts` remain the entity boundary for V1; do not introduce a parallel business-entity platform while the current reporting/account model already provides tenant separation.
- Reuse `reporting_machines`, `reporting_locations`, machine-scoped admin access, Machine Manager assignments, `machine_sales_facts`, and `sales_adjustment_facts` for pay scope and revenue basis.
- Bloomjoy defaults are monthly calendar periods, time due 2 days after period end, lock on day 3, target pay date day 5, final manager review only, and shift-level `round_up_60_minutes`.
- Default worker type is `contractor_1099`, but worker type is a descriptive label only. The module does not calculate withholding, payroll taxes, overtime compliance, direct deposit, W-2s, or 1099 filing in V1.
- Provider-backed payroll, direct deposit, filing, and compliance automation require a later explicit provider decision and integration spike.

**Why this choice**
- This replaces the current AppSheet/Google Sheet/manual PDF workflow without rebuilding a full HR/payroll provider.
- The strongest near-term value is accurate assigned-machine timekeeping, audited compensation rules, manager review, and operator-visible issued statements.
- Keeping the first foundation on existing Bloomjoy account/machine/reporting primitives avoids overengineering while preserving a path for future vending-business customers.

## 2026-05-13 - Refund workflow card last-four visibility policy (`#436`)
Authorized refund workflow users may see the customer-provided card last four inside `/refunds` when they are allowed to manage that refund case.

**Approved visibility**
- Machine Managers assigned to the machine, scoped admins for that machine scope, and super admins may view the submitted card last four and sanitized Nayax candidate evidence for cases they can manage.
- Sanitized Nayax evidence may include authorization time, amount, currency, card brand, card last four, and match reason when returned by the server-side lookup.

**Privacy boundaries**
- Partner-facing reporting, exports, settlement payloads, issue notes, PR descriptions, logs, and screenshots must not include real card digits, payment IDs, raw Nayax transaction IDs, raw Nayax payloads, customer free-text complaint details, or customer PII.
- Raw provider IDs and payloads stay server-side/tokenized. The manager UI may show only the minimum evidence needed to correlate and manually process the refund.
- Live Nayax refund execution remains disabled unless separately approved through the refund execution safety gates.

**Why this choice**
- Manual card refunds in Nayax require the last four as an operational lookup clue.
- Hiding the last four from assigned managers would preserve privacy at the expense of forcing ordinary card cases back into manual Nayax searching and out-of-band communication.
- Limiting visibility to authenticated, case-authorized users keeps the pilot practical while preserving the reporting and export privacy guardrails.

## 2026-05-13 - Refund machine portfolio source separation
Refund operations must distinguish Bloomjoy Commercial/Mini machines from Snapcase machines by data source, not just by location name.

**Canonical rule**
- Sunze-backed sales/import data covers Bloomjoy cotton-candy machines only: Bloomjoy Commercial and Bloomjoy Mini.
- Snapcase machines are part of the broader Bloomjoy/Snapcase portfolio but are not currently represented by the Sunze sales facts used for refund correlation.
- Current refund shadow-pilot setup and cash correlation should treat active Sunze-backed `reporting_machines` as Commercial/Mini only unless a machine is explicitly modeled otherwise.
- Snapcase refund intake, manager routing, payment correlation, and settlement reporting need a separate source-of-truth decision before being included in this workflow.
- Manager roster rows from the broader portfolio should not cause Snapcase locations to be inferred into Sunze-backed refund readiness or partner reporting.

**Why this choice**
- The refund MVP relies on source-specific correlation: Nayax for card lookup and Sunze sales facts for cash matching.
- Mixing Snapcase locations into Sunze-backed machine readiness would create false confidence for transaction matching and reporting write-through.

## 2026-07-21 - Refund automation scheduling, idempotency, and health
Refund reminders, Nayax preparation, and stale-case escalation use a versioned GitHub Actions schedule backed by a database run/action ledger.

**Canonical rule**
- The sweep runs four times per hour and an independent hourly health check detects missed/stale or repeatedly failing runs.
- Scheduled execution is disabled by default at both the GitHub repository-variable layer and the Edge Function layer. Turning automation off must not disable intake or the manager refund queue.
- Customer-touching work runs only inside the configured local policy window (default 8:00 AM-8:00 PM `America/Los_Angeles`).
- Each scheduled window has one run key. Each reminder, lookup, escalation, or alert has one deterministic action key, so concurrency and workflow reruns cannot repeat the same action.
- After an external send is attempted, an uncertain/failed result stays failed for manager review rather than being retried automatically and risking a duplicate customer message.
- Run/health output contains aggregate counts and reason categories only. Manager health shows healthy, stale, failing, paused, or waiting without exposing customer or provider payloads.
- Stale/repeated-failure alerts go to the internal operations email recipients, with the GitHub workflow failure as a separate operational signal.

**Why this choice**
- It makes the existing automation sweep observable and safe to retry while keeping customer communication conservative.
- Two independent schedules cover both processing and freshness monitoring without putting the core case workflow behind scheduler availability.

## 2026-05-12 - Refund operations full-automation goal and gated Nayax execution
Bloomjoy will continue toward a fully automated refund operations system, but payment execution is gated separately from manager approval and transaction correlation.

**Canonical rule**
- Bloomjoy Hub remains the target operational source of truth for refund intake, manager workflow, customer communication, and settlement adjustment write-through.
- Managers remain the business approver. Automation may send status/customer emails, remind/escalate stale cases, and prepare payment execution only after manager approval.
- Nayax card refund execution must run through a backend-only Edge Function with feature flags, kill switch, dry-run default, explicit sponsor go/no-go, per-machine allowlist, amount caps, idempotency, and redacted audit attempts.
- Wallet/Apple Pay last-four mismatches stay manual-review for the first automated execution release.
- Zelle refunds remain manual until Bloomjoy approves a refund-payment provider and records a separate decision.
- Public refund intake exposes only machines explicitly enabled for refund intake, not every active reporting machine.
- Hosted refund cases and legacy Google/AppSheet refund rows share a business-fingerprint guard so likely duplicates stay review-only instead of writing duplicate settlement adjustments.

**Why this choice**
- It advances the full-automation goal without letting a UI click, duplicate submission, legacy sheet row, or ambiguous provider response create an unsafe refund or reporting adjustment.
- It keeps the executive sponsor in the go/no-go role for real payment execution while allowing agents to build and QA the fail-closed foundation.

**Implementation notes**
- `refund-case-admin-update` is the preferred manager update path because it can wrap the existing update RPC and send customer messages.
- `refund-case-automation-sweep` owns reminder/escalation automation and must log redacted evidence only.
- `nayax-card-refund` must fail closed until provider contract validation and sponsor go/no-go are complete; this release must not call live Nayax refund endpoints.

## 2026-05-09 - Refund operations source-of-truth and shadow-mode rollout
Refund inquiries will move from the Google Form/AppSheet process into Bloomjoy Hub as the operational source of truth, while the legacy process remains live during a shadow-mode pilot.

**Canonical rule**
- Customer intake uses the noindex hosted route `/refunds/request` for direct links and QR codes.
- Managers remain the final approver for every refund. MVP automation may correlate, request more information, and prepare reporting adjustments, but it must not auto-approve.
- Card correlation uses Nayax Lynx as the source of truth. Card refund execution remains manual until lookup reliability is proven.
- Cash correlation uses imported sales facts as the source of truth, with conservative matching only by same machine, cash payment, incident time within +/- 1 hour, and exact amount when provided.
- Approved/completed, fully correlated refund cases may write settlement adjustments with `source='refund_case'`; raw customer/payment/free-text intake must stay out of partner-facing reporting outputs.

**Why this choice**
- It reduces manager time spent reconciling requests while preserving human judgment for customer empathy and fraud/edge-case review.
- It keeps payment-adjacent actions conservative until the Nayax lookup path is validated with real production evidence.
- It allows QR/direct-link rollout by location without forcing a hard cutover from the existing Google/AppSheet fallback.

**Implementation notes**
- Track execution through issues `#402`-`#409` and call out overlap with existing refund/reporting PR `#399` on implementation PRs.
- Shadow-mode acceptance requires hosted-intake cases to complete end to end while the Google Form/AppSheet process remains available.
- The first pilot can include all current authenticated Machine Managers, but it remains a shadow pilot until `Docs/REFUND_OPERATIONS_SHADOW_PILOT.md` merge and cutover gates pass.
- Refund case processing belongs in the authenticated core Refunds workflow (`/refunds`), not inside Admin Console or as a duplicated Portal/Admin destination. Machine Manager assignment belongs with machine setup in Admin > Machines, with up to 4 authenticated managers per machine.

## 2026-05-06 - Supply procurement notifications join the internal alert pipeline
Supply procurement requests should use the same internal alert pattern as quote and paid order events.

**Canonical rule**
- Under-5 branded-stick requests and custom-stick requests remain `lead_submissions` because they need manual confirmation/proofing before payment or fulfillment.
- `lead-submission-intake` sends internal notifications for `quote` and `procurement` submissions.
- Internal notification email always includes Ethan (`etrifari@bloomjoysweets.com`) and Ian (`ian@bloomjoysweets.com`); `INTERNAL_NOTIFICATION_RECIPIENTS` may add more recipients.
- WeCom/WeChat Work remains a secondary, non-blocking alert channel for quote, procurement, order, and support events.

**Why this choice**
- Small stick orders and custom sticks are operational supply requests even when they do not go through Stripe checkout yet.
- Keeping procurement in the existing lead table avoids inventing a second order system while still giving fulfillment the same email/WeCom visibility.
- Email must not depend on a single mutable recipient secret being perfect before orders start increasing.

## 2026-05-04 - Vercel preview auth redirect support
Vercel preview login should return to the same preview host when Supabase Auth is used for preview UAT.

**Canonical rule**
- Keep the Supabase Site URL on the production app host: `https://app.bloomjoyusa.com`.
- Keep `https://*-snapcase.vercel.app/**` in Supabase Additional Redirect URLs so PR previews can complete login without falling back to production.
- Treat Vercel Deployment Protection as a separate preview-access setting. It can block ordinary executive preview access even when Supabase redirects are configured correctly.

**Why this choice**
- Preview UAT needs to test the PR deployment, not the production app.
- The app already asks Supabase to return to the active app surface; Supabase must allow that destination before it will honor the request.

## 2026-05-02 - Admin access boundary rule
Scoped admins and partner-facing admins may manage only their current active machine/account scope.

**Canonical rule**
- Current active scope is the only manageable scope for partner/scoped admin workflows.
- Historical, expired, inactive, removed, or otherwise out-of-scope machine/account access must not remain manageable through partner/scoped admin tools.
- Any later expansion to historical or inactive access management needs an explicit new decision and implementation guardrails.

**Why this choice**
- Access management must reflect current authority, not old operational relationships.
- This prevents partner/scoped admins from changing users or machines they no longer actively own.

## 2026-05-02 - Refund fallback settlement rule
Refund settlement may use Request Amount as a narrow fallback only after the rest of the required settlement context is present.

**Canonical rule**
- When refund status is `Closed`, the decision is approve-style, and the approved/refund amount is blank, Request Amount may be used as the settlement amount.
- This fallback applies only when required settlement fields are otherwise present.
- Rows missing date, location, status, or decision remain review-only and must not become settlement-ready through the fallback.

**Why this choice**
- Closed approved refunds often carry the business amount in Request Amount, but incomplete rows still need human review.
- The fallback improves settlement completeness without weakening data-quality gates.

## 2026-04-29 - Business Playbook Plus tools access model
Business Playbook public articles stay indexable. Plus-ready worksheets and operator templates may be previewed publicly, but downloadable files should live behind Plus/member access when download plumbing is implemented.

**Canonical choices**
- Do not add public static file downloads for Plus tools in this slice.
- Do not add email capture gates to public Business Playbook articles or tool previews.
- Public pages may show tool previews and link to related public articles, `/plus`, and operator login.
- The repo-managed source brief for these tools is `Docs/BUSINESS_PLAYBOOK_PLUS_TOOLS.md`.
- The UI source of truth for public preview metadata is `src/data/businessPlaybookPlusTools.ts`.

**Why this choice**
- Public articles remain useful and indexable without lead-form friction.
- Operator-only tools can stay aligned with Plus, training, reporting, and support boundaries.
- Avoiding public file URLs prevents static assets from becoming stale or bypassing member access later.

## 2026-04-28 - Preset-first Corporate Partner access model
Access management will use admin-facing presets backed by source-aware capabilities and scopes, not a visible raw permission matrix.

**Canonical access model**
- Near-term presets are Super Admin, Scoped Admin, Plus Customer, Corporate Partner, and Technician.
- Corporate Partner is separate from Plus Customer even when both receive similar functional benefits such as training, support, member supply pricing, reporting, and Technician management.
- Corporate Partner membership is stored as `corporate_partner_memberships` linked to a `reporting_partners` record.
- Corporate Partner live reporting is derived only from active partnerships where that partner is a participant and `reporting_partnership_parties.portal_access_enabled=true`.
- Partnership participant metadata, payout recipient status, or legal participation must not grant portal access by itself.
- Training-only access is represented as a Technician grant with no assigned machines; it is not exposed as a separate primary persona.
- Reporting User remains a future/internal capability and is not exposed as a primary preset.

**Canonical capabilities**
- Access checks should move toward explicit helpers for `training.view`, `support.request`, `supplies.member_discount`, `reports.partner.view`, `reports.machine.view`, `technicians.manage`, `admin.access.manage_reporting`, and `admin.global`.
- Frontend route guards, Edge Functions, reporting RPCs, and admin previews should consume server-side capability helpers over time.
- Supply discounts are enforced server-side; Plus Customer and Corporate Partner resolve to the same member supply tier, while Technician alone does not.
- Support intake must enforce `support.request` server-side.

**Canonical admin UX**
- `/admin/access` should be person-first: search a user/email, preview effective access, then apply presets with a save preview.
- Corporate Partner grants require partner selection and grant reason, and should preview active portal-enabled partnerships plus derived machines.
- Granular per-user overrides are deferred until the preset model and effective-access preview are stable.

**Why this choice**
- Presets keep admin work fast and understandable while capability helpers keep the backend flexible as personas grow.
- Explicit portal participation avoids accidental partner access through agreement setup or payout metadata.
- Source-aware Technician, Plus Customer, and Corporate Partner grants make revoke and renewal safer as Bloomjoy adds more access paths.

## 2026-04-29 - Admin Access person-first redesign priority
`/admin/access` is the canonical place for internal access management, but the current tab-heavy page is a functional foundation, not the final UX.

**Canonical redesign direction**
- The page should default to finding a person, not choosing an access-model tab.
- A selected person should have one workspace that combines effective access, active access sources, scopes, warnings, and actions.
- Access actions should be organized as preset choices and source cards, not as separate peer tabs for Users, Presets, Reporting Access, Scoped Admins, Global Roles, and Audit.
- Grant, renew, scope-change, and revoke flows should show a plain-English save preview and require an audit reason.
- Audit/activity should stay available but should not compete with the primary access-management workflow.

**Sequencing**
- Issue `#227` owns the immediate UX/CX redesign of `/admin/access`.
- Issue `#331` follows with review, renewal, expiry, and richer revoke-impact workflows.
- Issue `#150` remains the longer-term entitlement-scale umbrella for granular overrides and deeper capability model hardening.

**Why this choice**
- Admins think in terms of people and outcomes, not database tables or backend grant sources.
- Consolidating access sources into one person workspace reduces accidental misuse and makes permissions easier to audit as access models grow.

## 2026-04-24 - Sales reporting foundation
Bloomjoy sales reporting will use account/location/machine entitlements that are separate from Plus and training access.

**Canonical reporting model**
- Reporting visibility is scoped by `customer_accounts`, `reporting_locations`, and specific `reporting_machines`.
- Users can gain report access through account membership or explicit reporting entitlements.
- Reporting access does not imply Plus membership, training access, support access, billing access, or member sugar pricing.
- Super-admins manage reporting machines, entitlements, imports, schedules, and export history from `/admin/reporting`.

**Canonical reporting data**
- Sunze sales rows are normalized into machine/date/payment facts.
- Refunds and complaints are stored separately as adjustment facts, sourced first from Google Sheets or CSV import.
- Until Sunze definitions are validated, Sunze totals are treated as net sales and gross sales is calculated as `net_sales + refund_amount`.
- Imports must be idempotent by source and stable source identifier: Sunze uses a salted source order hash, while row hashes remain available for change detection and for import types without a durable source order id.

**Automation and delivery**
- V1 uses Supabase Edge Functions for on-demand exports, scheduled partner report delivery, and locked ingest entrypoints.
- Daily Sunze extraction runs as a GitHub Actions Playwright worker because the task needs a full browser runtime. The worker receives Sunze credentials plus an ingest token, but never receives the Supabase service-role key.
- The Sunze worker uses the Orders page `Last 7 Days` preset for daily catch-up plus a monthly `Last Month` catch-up, confirms the export request, downloads the completed file from Export Task List, validates `.xlsx` workbooks or `.zip` bundles, deletes raw downloads after parsing, and sends normalized rows to `sunze-sales-ingest`.
- Sunze imports must reconcile trusted Orders UI evidence against the downloaded export before ingesting. Trusted pagination row-count mismatches and explicitly trusted revenue mismatches fail closed; weak scraped UI totals are diagnostic only when the export task is pinned, workbook dates match the selected window, and row-count evidence matches.
- Sunze machine discovery uses the top-level Machine Center list visible to the workflow account as advisory operational evidence. `SUNZE_EXPECTED_MACHINE_COUNT` is optional and treated as an operations signal because new machines can appear before admins finish setting them up for reporting; missing Machine Center visibility must not block a valid Orders workbook whose row machine IDs can flow through the admin setup queue.
- GitHub dry-runs call `sunze-sales-ingest` in validation mode so Supabase row normalization and current machine setup state are checked without writing `machine_sales_facts`.
- Unconfigured Sunze machines are handled through an admin setup queue. Configured rows continue into `machine_sales_facts`; unconfigured rows are quarantined in normalized form using salted order hashes and no raw order numbers until an admin sets up the Sunze ID for a report or marks it ignored.
- The Sunze UI exposes date presets and a repaired custom range flow. Daily scheduled imports stay on `Last 7 Days`; historical backfills may use explicit monthly custom date ranges of 31 days or less only through the Export Task List flow, with all exported sale dates verified inside the requested window.
- Sunze order idempotency is based on a salted source order hash. The row hash remains available for change detection when a corrected export updates an already-seen order.
- Raw Sunze workbooks are not retained. Operational evidence is limited to normalized facts, salted order hashes, import-run metadata, GitHub run IDs, admin-visible freshness/error status, and short-retention sanitized GitHub diagnostic artifacts. Diagnostic artifacts may contain only allowlisted run metadata, redacted error text, and sanitized UI summary fields; they must not contain raw workbooks, customer emails, raw order numbers, provider credentials, or raw machine identifiers.
- Scheduled partner reports default to the previous Monday-Sunday week and email a private signed PDF link through the existing Resend pattern.
- The automation must not bypass CAPTCHA, MFA, or Sunze access controls, and must not open machine-level settings or `More` menus.

**Why this choice**
- Reporting needs machine-level partner visibility without granting broader customer portal or commerce permissions.
- Keeping sales facts and refund adjustments separate preserves source auditability while allowing gross/net calculations.
- This keeps browser automation separate from database authority while still allowing daily imports, idempotent writes, and clear failure auditing.

## 2026-04-25 - Admin access and reporting setup split
Admin permission work and partnership financial setup are separate concerns.

**Canonical admin surfaces**
- `/admin/access` is the single admin place for users, Plus Customer access, Corporate Partner access, super-admin roles, audit history, and explicit machine-level reporting visibility.
- `/admin/reporting` is for reporting operations: schedules, import/sync status, stale-data warnings, and export archive visibility.
- `/admin/partner-records` is for reusable external organizations and contacts that can become participants in one or more partnerships.
- `/admin/machines` is for machine identity, aliases, partner-report inclusion status, and current machine tax rates.
- `/admin/partnerships` is for guided agreement setup: partnership details, participants, assigned machines, payout rules, and weekly preview.

**Canonical partnership model**
- Reporting visibility remains machine-level only for V1. Partnerships do not grant inherited user access yet.
- Partnerships group machines for financial reporting, partner report setup, and payout calculations.
- Tax rates are configured on machines through effective-dated machine tax-rate records, not on partnerships.
- Partner report calculations resolve the active machine tax rate by machine and sale date before applying partnership financial rules.
- Admin setup should be task-based rather than forcing every reporting setup concern into Partnerships.
- Partnership participants are optional V1 metadata for multi-stakeholder agreements. The relationship is managed in the partnership flow, but reusable partner records have their own admin page.
- Partnership participant setup captures who is involved and their relationship role only. Report delivery recipients belong in Reporting Operations, and payout/share percentages are configured only in Payout Rules.
- Admins should see one partnership-level agreement timeline and one active/inactive partnership control. Payout-rule status and effective dates remain backend compatibility/audit fields, but normal V1 setup treats Payout Rules as the current terms for the partnership.
- Payout Rules should present allocation by actual participant name plus Bloomjoy, use whole-number percentages, show a live 100% allocation check, and map those values to the existing primary/partner/Bloomjoy backend fields for compatibility. V1 supports two payout participants plus Bloomjoy until the backend model expands.
- Partnership machine assignment is a current-state bulk alignment workflow. Assignment role, status, notes, and effective date windows remain backend compatibility fields but are defaulted/archived by the UI rather than exposed in normal setup.
- Scoped Admins may manage partnership setup only when the partnership's current primary-reporting machines are wholly inside their active machine grant. New draft partnership shells and unlinked partner records created by a Scoped Admin remain manageable by that creator until machines/participants attach them to a scope.
- Scoped Admin partnership authority does not grant global Partner Records, unrelated partner records, out-of-scope machines, or the `*` admin surface. Every scoped partnership mutation must require a reason, fail closed on out-of-scope machine attempts, and audit `actorAuthority`.
- Machine tax-rate history stays effective-dated in the backend, but normal admin editing happens from the Machines page and focuses on current machine rates, with explicit no-tax machines distinguishable from missing tax configuration.
- Initial documented machine tax rates default to a hidden `2026-01-01` effective start for reporting history. Future tax changes stay effective-dated but are captured through a simple "new rate + applies from" workflow.
- Setup warnings should appear where an admin can act: machine tax and assignment readiness on Machines, assignment overlap in the partnership Machines step, financial-rule gaps in Payout Rules, and preview-specific issues in Weekly Preview.
- Weekly Preview must explain setup/data blockers in-page, especially when assignment coverage, payout-rule coverage, or imported sales do not cover the selected reporting week.
- Bubble Planet reporting parity uses Sunze `Order amount` as gross sales, subtracts machine-rate tax plus configured stick-level cost deductions before the split, counts no-pay orders as orders/items with `$0` sales and `$0` deductions, and supports a participant-named 60/40 split when configured that way.
- Admin UI should avoid example-specific partner names and avoid exposing abstract backend split labels when participant names can be shown directly.
- Weekly partner previews must use the partnership's configured week-ending day. Bubble Planet-style weekly reporting is Monday-Sunday with a Sunday week-ending date.

**Why this choice**
- Admins think about permissions person-first, while partnership setup is about financial reporting and contractual grouping.
- Keeping user access machine-level avoids hidden permission inheritance while the reporting feature is still new.
- Machine-level tax rates reflect real operating differences and keep tax changes auditable over time.
- Separating Partner Records and Machines reduces partnership setup friction while keeping the common create-new-record path available from the participant dropdown.

## 2026-04-25 - Reporting migration repair and schema-cache checks
Production reporting/admin RPC fixes must move forward through new migrations, not edits to migrations Supabase already marked applied.

**Canonical migration rule**
- Do not rely on editing an already-applied migration to repair production. Supabase will not replay it.
- Do not reuse migration timestamps across feature branches; if a collision reaches `main`, add a later forward-only repair migration that makes the intended schema explicit.
- If production is missing tables, RPCs, grants, or function definitions from an already-applied migration, add a later forward-only, idempotent repair migration.
- Frontend-facing RPC migrations should end with `select pg_notify('pgrst', 'reload schema');` so PostgREST refreshes function metadata.
- Production validation for admin/reporting RPC changes must include direct REST probes that confirm key RPCs do not return `404` or `PGRST202`.

**Why this choice**
- The reporting admin outage came from schema drift: production had an older migration version marked applied before the final admin/partnership RPCs existed.
- Forward repair migrations keep repo history and production history aligned without manual rollback or destructive database operations.

## 2026-04-25 - Corporate partner reporting first deliverable
The next P0 reporting milestone is a trusted corporate partner report that Bloomjoy can review before sending.

**Canonical V1 delivery**
- Super-admins generate corporate partner reports from `/admin/partnerships` after partnership setup, machine assignments, tax assumptions, and financial terms are configured.
- Manual super-admin review comes before scheduled auto-email. Scheduled delivery remains future automation after the report content and math are trusted.
- Corporate partners do not get inherited portal access from partnership setup in V1. Partner-facing value is delivered through reviewed PDFs first.
- Operator performance dashboards are deferred until the corporate partner review/download workflow is accepted.
- Partner dashboard UX/CX can be designed in parallel, but it is not required for the first reviewed-PDF milestone.

**Canonical partner report**
- The PDF should be a polished settlement artifact, not the current simple text-style sales export.
- Required report shape: executive summary, reporting period, gross sales, tax impact, net sales, unit/fee/cost assumptions, split calculation, amount owed, machine-level appendix, warning states, generated timestamp, and snapshot ID.
- Generated partner reports must have auditable snapshot/run records with period, rule version, assumptions, generated-by user, status, recipients/download metadata, storage path, and any warnings.

**Canonical dashboard direction**
- The reporting tab should default to an operator-style view for the user's assigned machines.
- A partner dashboard view should appear only when the access context grants partner-dashboard visibility.
- V1 partner dashboard visibility defaults to super-admins only until explicit partner-viewer permissions are implemented.
- The browser dashboard should emphasize smooth period controls, summary KPIs, machine-level rollups, warning states, and calculation transparency; the PDF remains the formal settlement artifact.

**Canonical rule approach**
- Revenue-share rules should be typed and configurable: week-ending day, machine tax method, fee basis, cost basis, split base, and share percentages.
- Bubble Planet-style reporting is the first validation fixture, but the implementation must not hardcode Bubble Planet-specific names or terms into the calculation model.
- Do not introduce a new reporting platform, CMS, or headless reporting service for this milestone.

**Why this choice**
- The business risk is partner trust, so reviewed and explainable numbers matter more than early automation.
- A typed rule model supports multiple partnership patterns without building an unsafe open-ended formula engine.
- Keeping partner delivery PDF-first avoids expanding the permission model before the internal reporting process is stable.

## 2026-04-14 - Training-only operator access grants
Bloomjoy now supports a narrow operator access tier for staff who need training without becoming paid Bloomjoy Plus members.

**Canonical access model**
- `baseline`: authenticated customer basics only (`/portal`, orders, account).
- `training`: operator training access only (`/portal`, `/portal/training*`, training progress, and certificate flow).
- `plus`: full Bloomjoy Plus portal access (`training`, onboarding, support, customer account tools, and Plus commerce benefits).
- `super_admin`: internal operations access; treated as `plus` for portal gating.

**Grant model**
- Active Bloomjoy Plus members and super-admins can grant training-only operator access by email.
- Operator grants are stored separately from Stripe-backed `subscriptions` so they do not create Plus billing, sugar pricing, support, or onboarding entitlements.
- If a Plus sponsor loses active/trialing subscription status, their sponsored operator grants stop conferring training access until Plus is active again.

**Why this choice**
- Operators often need training materials but should not inherit account-owner commerce, billing, support, or onboarding workflows.
- Keeping operator training separate from unpaid Plus Customer access avoids confusing training seats with customer membership benefits.
- Email-based grants let the operator sign in later with the same address without requiring a full invitation system in this slice.

## 2026-04-06 - Emergency commerce remediation: Plus-only sugar pricing, durable order capture, and customer confirmations
For sugar ordering, Bloomjoy Plus members receive the discounted rate and all other buyers pay the public rate.

**Canonical pricing**
- Bloomjoy Plus members (`subscriptions.status in ('active', 'trialing')`) pay **`$8/kg`**
- All other customers, including anonymous buyers, pay **`$10/kg`**
- Free shipping remains in effect for sugar orders for now

**Canonical order-processing choices**
- Sugar pricing is enforced **server-side** in `stripe-sugar-checkout`; the client may display pricing but does not decide the Stripe price ID.
- `orders` must persist the operational order snapshot before any email or WeCom notification is attempted.
- Order records must retain customer contact details, billing/shipping address snapshots, pricing tier, unit price, shipping total, receipt URL, and line-item order breakdown.
- Customer order confirmations are sent by the app via Resend in addition to the Stripe receipt.
- Notification channel failures must be recorded on the `orders` row and must not block order persistence.
- Production release verification for commerce must fail if required Stripe/Resend/WeCom secrets are missing.

**Why this choice**
- The April 6 incident showed that public sugar checkout was incorrectly charging the member rate to everyone.
- The webhook runtime bug prevented paid orders from being captured in Supabase at all.
- Internal visibility cannot depend on a single notification channel succeeding.
- Ops needs order data inside Bloomjoy Hub, not only inside Stripe.

## 2026-03-22 - Split the operator app from the public marketing site
Bloomjoy now uses three host roles:

- `www.bloomjoyusa.com` for public marketing, storefront, and legal pages
- `app.bloomjoyusa.com` for operator login, password reset, portal, and admin workflows
- `auth.bloomjoyusa.com` for Supabase/Auth callback infrastructure

**Why this choice**
- Logged-in operators should not stay inside the public sales navbar/footer shell.
- The operator experience should feel like an application, not a marketing site with gated tabs.
- This keeps the change incremental in the existing Vite SPA and Vercel deployment instead of introducing a second frontend codebase.

**Implementation notes**
- Public routes stay indexable only on `www`.
- App routes stay `noindex` and are excluded from the public sitemap.
- `www` requests for `/login`, `/reset-password`, `/portal*`, and `/admin*` redirect to `app`.
- `app` requests for public marketing/storefront routes redirect back to `www`.
- `/login/operator` remains a temporary alias that canonicalizes to `/login`.

Record decisions here so agents don’t “thrash” the stack.

## 2026-01-11 — Starting point and baseline stack (Loveable POC)
We are **not starting from scratch**. The current codebase started as a Loveable-generated proof-of-concept.

**Canonical baseline (keep unless a new decision says otherwise):**
- Frontend: **Vite + React + TypeScript**
- UI: **Tailwind CSS + shadcn/ui**
- Routing: reuse what the POC already uses; if missing, default to **react-router-dom (v6+)**
- Auth + DB (recommended): **Supabase (Auth + Postgres + Storage)**  
- Payments (recommended): **Stripe**
  - Important: Stripe secret keys must be used **server-side only** (never exposed as `VITE_` env vars)

Rationale:
- We already have a working POC in this stack → fastest path is incremental hardening + extension.
- Supabase + Stripe reduce custom backend surface area for MVP.

**Note:** `Docs/BUSINESS_CONTEXT.md` contains an older “suggested technical approach” (Next.js). That section is not canonical—this file is.

## 2026-01-11 — Server-side surface for Stripe
Because this is a Vite SPA, we still need a **server-side component** for:
- Creating Stripe Checkout Sessions
- Handling Stripe webhooks (subscription/order state sync)

Approved options (pick one early; record the final choice here):
1) **Vercel Functions** in `/api/*` (simple monorepo, good DX)
2) **Netlify Functions** in `/.netlify/functions/*`
3) **Supabase Edge Functions** (keeps infra in Supabase)

Until the option is chosen, keep integrations modular (thin client wrappers + clear boundaries).

## 2026-02-02 - Stripe server-side surface choice
We will use **Supabase Edge Functions** for Stripe Checkout and webhook handling.

**Why this choice**
- Hosting-agnostic: the Vite SPA can be hosted anywhere while functions live with Supabase.
- Tight integration with Postgres for webhook-driven state sync.
- Server-only secrets live in Supabase Function Secrets (no VITE_ exposure).
- Minimal, reversible changes: add edge functions and call them from the SPA.

## Open questions (resolve early)
- Hosting target: Vercel vs Netlify vs other (impacts serverless function layout)
- Machines purchase flow in MVP:
  - Quote-only for all machines? or “Buy now” for Micro?
- Membership perks in MVP:
  - Sugar discount vs shipping perk vs both vs neither
- Lead capture destination in MVP:
  - Supabase table vs email provider (Resend/Postmark) vs both

## 2026-01-22 — Training video hosting (MVP)
We will use **Vimeo (Starter/Standard)** for the training library MVP.

**Why this choice**
- Fastest embed path with a reliable player for a Vite React SPA.
- Domain-level embed restrictions provide basic protection.
- Works with Supabase RLS for gating catalog access.

**MVP implementation notes**
- Store training metadata and assets in Supabase tables (`trainings`, `training_assets`).
- Store `provider_video_id` + `provider_hash` (for unlisted embeds).
- Embed via iframe: `https://player.vimeo.com/video/{videoId}?h={hash}&dnt=1`.
- Restrict embeds to approved domains in Vimeo settings.

## 2026-01-22 — Membership gating source of truth (MVP)
We will use a **dedicated `subscriptions` table** synced from Stripe webhooks as the source of truth for membership status.

**Why this choice**
- Avoids relying on client-managed flags for access control.
- Enables accurate access decisions using Stripe subscription state.
- Supports future upgrades (multiple plans, seats, trials).

**MVP implementation notes**
- Use RLS policies that allow training data when the subscription status is `active` or `trialing`.
- Optional: keep a denormalized `profiles.is_member` flag as a cache, but derive it from `subscriptions` only.

## 2026-04-14 — Plus flat account pricing (supersedes 2026-02-21)
We will price Bloomjoy Plus at **$100 per month per customer account**.

**Pricing model**
- Single recurring Stripe price (`STRIPE_PLUS_PRICE_ID`) set to $100/month
- Checkout quantity is always `1`
- Monthly charge is a flat `$100`

**MVP scope choice**
- Keep webhook and `subscriptions` schema unchanged for membership gating compatibility
- Machine inventory stays in the admin portal for operational context only
- Existing live subscriptions with quantity greater than `1` will be adjusted manually in Stripe by the billing owner

## 2026-02-23 - Super-admin MVP role model and operations choices (`#37`)
For MVP admin operations, we will use a single internal role and keep workflow complexity minimal.

**Approved choices**
- Internal role model: `super_admin` only for MVP (no `ops_agent` in MVP)
- Support ticket statuses: `new`, `triaged`, `waiting_on_customer`, `resolved` (optional terminal `closed`)
- Machine count source of truth: app-managed machine count in admin portal is authoritative for operations
- Ticket notifications: defer email alerts for MVP; monitor via admin queue dashboard

**Why this choice**
- Minimizes authz/RLS complexity while landing core operations capability quickly.
- Keeps support workflow reportable without over-modeling states too early.
- Allows operations to maintain real-world machine inventory independent of billing timing.
- Avoids notification plumbing in MVP and keeps scope focused on secure admin workflows.

## 2026-02-26 - Temporary admin email allowlist for auth/training QA (`#75`)
To unblock local QA while role provisioning catches up, we temporarily allow two known owner emails to behave as admin in app auth and training-access checks:
- `etrifari@bloomjoysweets.com`
- `ethtri@gmail.com`

This is a temporary release aid, not the long-term authorization model.

Follow-up requirement:
- Remove static email allowlist before production and rely on `admin_roles` + RLS as the only source of admin access.

## 2026-02-26 - Training thumbnails strategy for Vimeo Module 1 (`#75`)
Training library cards use Vimeo-based thumbnails derived from `provider_video_id`:
- `https://vumbnail.com/{video_id}.jpg`

Rationale:
- Fast, no-backend thumbnail path for current MVP scope.

Follow-up requirement:
- Move to first-party thumbnail URLs stored in `training_assets.meta.thumbnail_url` (or Supabase Storage) for production durability.

## 2026-03-01 - First-party training thumbnail strategy (`#79`)
Training library cards now prefer first-party thumbnail values from `training_assets.meta.thumbnail_url`.

**Storage convention**
- `thumbnail_url` stores either:
  - a public URL (`https://...`) when provided by operations, or
  - a Supabase Storage object key in bucket `training-thumbnails` (example: `vimeo/<video_id>.jpg`).

**Why this choice**
- Removes runtime dependency on third-party thumbnail host availability.
- Keeps thumbnail source controlled by Bloomjoy infrastructure and data.
- Supports environment-specific Supabase hosts without hardcoded thumbnail domains.

**Implementation notes**
- Frontend resolves storage keys via `supabaseClient.storage.from('training-thumbnails').getPublicUrl(...)`.
- Default visual fallback remains first-party (`/placeholder.svg`) for rows missing a thumbnail value.

## 2026-03-02 - Internal quote/order notification email provider
We will use **Resend** from Supabase Edge Functions for internal operations notifications.

**Scope**
- Quote request notifications from `lead-submission-intake`.
- Supply procurement notifications from `lead-submission-intake`.
- Sugar order notifications from `stripe-webhook` (`checkout.session.completed` payment mode).

**Why this choice**
- Keeps email API keys server-side only in function secrets.
- Minimal change surface: no client secret exposure and no new frontend provider SDK.
- Fast to implement with plain HTTPS calls from Deno edge functions.

## 2026-03-02 - Auth transactional email provider for launch hardening (`#77`)
For production auth email branding and deliverability, we will use **Resend** as the SMTP provider for Supabase Auth emails.

**Why this choice**
- Fastest path to branded sender setup for launch timelines.
- Clear domain authentication workflow (SPF/DKIM) with strong deliverability posture.
- Keeps implementation minimal by using Supabase Auth SMTP configuration (no app rewrite).

**Implementation notes**
- Configure and verify Bloomjoy sender domain in Resend.
- Use Resend SMTP credentials in Supabase Auth email settings for signup confirmation, magic link, and recovery templates.
- Record final test evidence in `Docs/AUTH_PRODUCTION_SIGNOFF.md`.

## 2026-03-09 - Machine sales-sheet baseline (commercial/mini) + micro pricing correction
To keep sales copy and quote intake consistent with current sales materials, we will align machine pricing/wrap language to the latest internal sales-sheet inputs.

**Canonical updates**
- Micro machine target/list price for current sales messaging: **`$2,200`**.
- Commercial machine wrap options must show:
  - Standard Bloomjoy wrap.
  - Custom wrap, explicitly marked as **Commercial-only** and handled offline by the Bloomjoy design team.
- Mini and Micro should not advertise a custom wrap option in MVP copy/flows.

**Source documents reviewed (internal)**
- `Commercial Sales Sheet.pdf` - Quote `20260201B3` dated `2026-02-01` (price effective `2026-05-30`).
- `Mini Sales SHeet.pdf` - Quote `20260228Mini` dated `2026-02-28` (price effective `2026-05-31`).

**Implementation notes**
- Keep custom wrap handling as a manual design handoff (no self-serve design builder in MVP).
- Ensure public product copy, quote CTA language, and smoke checklist coverage stay aligned to these rules.

## 2026-03-10 - WeCom as the internal ops-alert POC channel
For current operations-event alerting, we will use **WeCom app messaging** from Supabase Edge Functions (quote, order, and support events).

**Scope**
- Quote submission alerts (`lead-submission-intake`)
- Supply procurement alerts (`lead-submission-intake`)
- Sugar order alerts (`stripe-webhook`)
- Support request alerts (`support-request-intake`)

**Why this choice**
- Keeps WeCom credentials server-side only (`WECOM_*` function secrets).
- Aligns to actual ops communication channel without changing customer-facing auth flows.
- Adds non-blocking behavior so core quote/procurement/order/support flows continue if WeCom is unavailable.

**Implementation notes**
- Token lifecycle handled server-side with cached `access_token` fetch/refresh.
- Recipient fanout controlled by `WECOM_ALERT_TO_USERIDS` (comma-separated user IDs).
- WeCom dispatch failures are logged as warnings and do not fail core business transactions.

## 2026-03-10 - WeChat onboarding concierge intake model
To reduce WeChat onboarding friction, we will treat onboarding blockers as a first-class support request type.

**Canonical model**
- `support_requests.request_type` includes `wechat_onboarding`.
- Structured onboarding context is stored in `support_requests.intake_meta` (JSON), including:
  - `phone_region`
  - `phone_number`
  - `device_type`
  - `blocked_step`
  - `referral_needed`
  - optional `wechat_id`

**Why this choice**
- Keeps portal intake simple while giving ops consistent triage data.
- Avoids one-off DM triage by standardizing onboarding requests in existing support queue tooling.
- Preserves backward compatibility with existing support request status/priority/admin-audit flows.

## 2026-03-19 - Training tracks, progress, and lightweight completion certificate
To improve training findability without introducing a full LMS, we will expand the member training experience with curated tracks, server-backed progress, and one lightweight completion certificate.

**Canonical choices**
- Organize discovery around operator tasks first (`Start Here`, `Software & Payments`, `Daily Operation`, `Cleaning & Maintenance`, `Troubleshooting`) while keeping module tags available.
- Keep using the existing `trainings` and `training_assets` tables as the content foundation.
- Add `training_tracks`, `training_track_items`, `training_progress`, and `training_certifications` for curated paths, persisted completion, and certificate issuance.
- Keep full training documents member-only in a private Supabase Storage bucket (`training-documents`) when original PDFs are uploaded.
- Support exactly one v1 certificate: **Bloomjoy Operator Essentials**.

**Why this choice**
- Makes training easier to find by intent instead of forcing users to remember module numbers.
- Preserves the existing Vimeo + Supabase architecture and avoids an LMS rewrite.
- Gives Bloomjoy a completion signal and certificate path without adding quiz or manual-review complexity.
- Keeps protected training documents behind the same membership model as the rest of the portal.

**Implementation notes**
- Document-first guides can ship immediately from curated in-app content while original PDFs are uploaded separately through the operations helper script.
- Certificate issuance is validated server-side via Supabase RPC after all required track items are marked complete and the final acknowledgement is confirmed.
- This is intentionally a lightweight completion credential, not a quiz-based certification system.

## 2026-07-20 - Scanner-resistant partner activation and password recovery (`#609`)
Bloomjoy Hub authentication emails for partner activation, passwordless sign-in, and password recovery use manual one-time codes with stable app links. Token-bearing one-click confirmation URLs are not allowed in these templates.

**Canonical choices**
- `access-invite` remains the official access-grant and resend workflow. Its durable `/login?intent=...&email=...` URL does not contain an auth credential.
- Supabase Signup Confirmation, Invite User, Magic Link/OTP, and Recovery templates show `{{ .Token }}` and link only to a stable Bloomjoy code-entry route. They must not contain `{{ .ConfirmationURL }}`, `{{ .TokenHash }}`, or any token in an `href`.
- Email Code verification for an invitation and recovery-code verification use a non-persisting temporary Supabase client. Portal sign-in happens only after password creation succeeds.
- A manual Supabase Invite User email is supported as a safe recovery path with `verifyOtp(..., type: 'invite')`, but administrators should use Hub Access so grants, delivery evidence, and scope remain auditable.
- Hosted template publication is an explicit production configuration step using the guarded deployment helper and a matching project-reference confirmation.
- The checked-in Supabase auth base preserves the production Site URL, redirect allowlist, MFA TOTP, confirmation requirement, one-minute email frequency, and six-digit OTP length so a production `supabase config push` cannot silently apply local defaults.
- Production Auth email uses the existing Resend account through custom SMTP (`info@bloomjoyusa.com`, credential supplied only through `RESEND_API_KEY`) with a 30-email/hour project limit. Supabase's demonstration sender is not a production fallback because it permits only two messages per hour and restricts recipients.

**Why this choice**
- Corporate email-security products may prefetch links and consume one-time confirmation URLs before a recipient clicks them.
- Manual code submission proves the human recipient initiated verification and keeps credentials out of URLs, browser history, logs, and analytics.
- A temporary session makes abandoned or reloaded invitation setup fail closed instead of leaving authenticated portal access active before password creation.

## 2026-08-06 - Payment-first storefront and Commercial-only quote policy (`#715`)

Bloomjoy will collect payment on the website before beginning fulfillment or sending new-sale operations alerts. The BloomDirect Commercial Machine is the only product that uses a quote/request flow.

**Canonical purchase paths**
- Sugar: direct Stripe checkout with server-selected member or standard pricing.
- Bloomjoy branded sticks: direct Stripe checkout for 1-1000 boxes; 1-4 boxes use the existing business/residential per-box shipping rule and 5+ boxes ship free.
- Micro Machine: direct Stripe checkout at the server-configured Price ID once enabled; a server-configured Stripe Shipping Rate is required and checkout fails closed if either is missing. Shipping pricing is an open executive decision tracked in `#717`, so the browser purchase CTA defaults off unless `VITE_MICRO_CHECKOUT_ENABLED=true`; Micro does not fall back to a quote/request form.
- Bloomjoy Plus: direct Stripe subscription checkout.
- Commercial Machine: quote request; variable configuration and delivery remain offline.
- Mini Machine and custom sticks: visibly unavailable, with no quote/procurement form, until a complete payment-first checkout is ready. Custom sticks must account for artwork proofing and the first-order plate fee before reopening.

**Payment and notification safeguards**
- Client prices are display-only. Stripe Price IDs, Micro shipping, stick shipping, allowed SKUs, and quantity limits are enforced server-side.
- Stripe Checkout enables Automatic Tax. Production tax collection remains gated on the appropriate Stripe Tax registrations, product tax codes/tax behavior, and owner/tax-advisor approval; enabling the calculation path does not create a registration.
- Physical order rows and notifications are created only when Stripe reports `payment_status=paid`. Delayed-payment success uses the same idempotent path.
- Paid physical orders send idempotent internal email to Ethan and Ian (plus configured recipients), customer confirmation, and a non-blocking WeCom alert. Paid Plus activation sends idempotent Ethan/Ian email and WeCom alert.
- Checkout return pages verify the server-side Stripe session before claiming payment success or clearing the cart.

**Production rollout gates**
- Resolve `#717`, configure and verify `STRIPE_MICRO_PRICE_ID` and `STRIPE_MICRO_SHIPPING_RATE_ID` in test mode and production, then explicitly enable `VITE_MICRO_CHECKOUT_ENABLED=true`.
- Confirm Stripe Tax registrations, product tax codes, Price tax behavior, and checkout tax results with the business owner/tax advisor.
- Apply the order-type migration, deploy the reviewed Edge Functions, and capture test-mode evidence for paid, canceled, unpaid/delayed, replayed, and mixed-cart cases before go-live.

## 2026-08-12 - Exact machine-manager mapping is the sole refund-payment authority (`#777`)

Official refund authority comes from a current, active, unrevoked Machine Manager assignment for the exact machine on the case. A separate Super Admin or Scoped Admin entitlement neither grants that authority nor cancels a valid manager assignment.

**Canonical choices**
- An administrator without the exact Machine Manager assignment remains unable to approve, deny, complete, or issue a refund.
- A mapped manager who also has administrative access follows the identical private manager journey: owner-approved TOTP enrollment, a fresh action-bound verification, frozen case/evidence, one-use receipt, provider gates, amount and daily caps, and replay protection.
- Agents and shared sessions may prepare evidence and communications but cannot enter the manager's verification code or perform the official payment action.
- Broader access remains visible in aggregate readiness audits as context; it is not an eligibility failure by itself.

**Why this choice**
- Bloomjoy's small operating team legitimately combines administrative and machine-management responsibilities.
- Denying a real mapping because of unrelated access creates a dead end without improving payment safety.
- Tying authority to the exact machine assignment preserves least privilege: admin access alone can never authorize money movement.

## 2026-08-25 - Already-completed Nayax refunds use evidence-only reconciliation (`#971`)

Nayax's supported public contract does not provide a read-only API that authoritatively reports the final refund outcome. Dynamic Transactions Monitor or a Nayax support confirmation remains the authoritative operational evidence when a refund completed outside Bloomjoy or before Bloomjoy recorded an attempt.

**Canonical choices**
- A matched, never-attempted card case may open exactly one `evidence_only` reconciliation attempt from the signed-in exact Machine Manager session and current case version.
- Opening review makes no Nayax call, creates no provider claim, posts no reporting adjustment, and creates no customer message.
- Evidence-only review may record only authoritative success or preserve the hold. It cannot mark retry-safe, create a fresh payment path, or use the manual-refund result shape.
- A completed result requires a validated DTM or support reference and a timestamp no earlier than the matched sale authorization and no later than the current review window. Only a one-way reference digest is retained.
- If an ordinary held attempt exists but exact DTM success occurred after the matched sale and before that attempt was created, the server derives `nayax_dtm_preexisting_settled`. Operators cannot submit that classification directly. Historical support/manual evidence, evidence before the sale, and future evidence remain blocked.
- One successful provider-evidence digest can complete only one case, including under concurrent requests. The original unknown/rejected provider result remains in the audit record, the completion event says Nayax had already completed the refund, and customer copy does not claim Bloomjoy's later attempt issued it.
- Confirmed success reuses the existing exactly-once outcome resolver for the reporting adjustment and source-appropriate customer completion. Replay cannot duplicate either effect.
- Do not build an automatic matcher from undocumented DTM behavior. Automatic reconciliation can replace this fallback only after Nayax supplies and Bloomjoy validates a supported authoritative readback contract.

**Why this choice**
- It closes the operational dead end for real refunds already completed in Nayax without weakening the no-blind-retry rule.
- It separates recording historical provider truth from issuing money, so recovery cannot become a duplicate-refund path.

## 2026-08-30 - Refund lifecycle owns the manager queue (`#992`)

Queue placement is part of the server-owned refund lifecycle, not a browser inference from separate status, lookup, readiness, or selected-case fields.

**Canonical choices**
- `refund_lifecycle_v1` includes an explicit `waiting_on_customer` stage. It takes precedence over matching, candidate review, and transaction-confirmed projections, but never hides an initiated, uncertain, confirmed, or Refund Operations payment state.
- The manager overview nests one redacted `refund_manager_queue_v1` projection in each lifecycle. Its bucket, label, next action, and read-only retry eligibility drive the queue row, filter, count, selected detail, and URL routing.
- The six manager buckets remain Action needed, Ready to refund, In progress, Needs Refund Operations, Waiting on customer, and Done. Opening or selecting a case cannot change its bucket.
- Every loaded nonterminal lifecycle participates in automatic refresh; refresh is not limited to the selected case and remains capped at 15 seconds.
- A read-only Nayax lookup still stored as `checking` after 90 seconds projects as `lookup_timed_out`. Only `retry_read_only_lookup` may be exposed, and only when the server projection marks it safe. A client/network error cannot grant retry eligibility.
- Customer status uses the same `waiting_on_customer` vocabulary and directs the customer to reply to the existing Bloomjoy email instead of submitting another form.
- Deploy the database migration first, then `refund-case-intake` (whose secure-status parser accepts the new customer stage), and then the frontend. Both customer and manager parsers fail closed when their canonical contract is absent or unknown.

**Why this choice**
- It removes the live contradiction where detail, queue placement, and counts could disagree or change merely because a manager opened the case.
- It keeps stale lookup recovery read-only and preserves the separate no-blind-payment-retry boundary.
- It gives managers and customers one truthful state vocabulary without exposing provider or reconciliation details.
