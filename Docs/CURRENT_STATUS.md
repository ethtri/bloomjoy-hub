# Current Status

Last compacted: 2026-09-29.

GitHub Issues and the Bloomjoy Project board own active priority, status,
blockers, acceptance criteria, and closeout evidence. This file is only a short
orientation snapshot; it is not a backlog or release ledger.

## Refund workflow (current)

- The gift-card implementation in PR #1658 uses the existing request, status,
  Manager workspace and email outbox. It rounds purchases up to $5, records
  Bloomjoy-funded goodwill separately, and keeps one original purchase deduction.
  Local desktop/mobile synthetic checks cover acceptance, repeat decisions,
  same-code email recovery, activation boundaries and Super-admin supply settings.
  The PR records disposable database and hosted journey evidence separately
  from local source checks; production activation remains pending.
  The owner confirmed touchscreen redemption via **Enter coupon/code** for
  both cotton candy and SnapCase. Pools remain disabled until provider setup,
  actual code creation and working machine redemption are verified. The one-use
  terms follow the owner-approved conservative assumption.
  Fixtures do not prove live creation, hardware redemption or inbox timing.
  Unactivated machines keep the existing cash intake. Activated cash requests stay on the gift-card path.

- PR #1652 restored existing Manager recommendations and decision controls for
  guarded recovered purchase selections. The deployed RF-26DB7861 appears in
  Decision needed with enabled Approve/Deny controls under the current
  authorized operator; case, purchase evidence, messages and payment records
  were unchanged during verification. No decision or payment was made.

- PR #1655 fixed the reporting fingerprint veto for exact first-generation
  Nayax System success. RF-423906B2's existing provider success now has one
  applied reporting row and one authoritative receipt, independently verified
  with protected approval, provider evidence, other purchase and messages
  unchanged. Receipt retry is idempotent and the case is excluded from delay
  work. No provider request or completion message was created; customer notice
  delivery remains unclaimed. Later continuation-generation reporting and the
  open workflow incident remain outside this slice; broader readiness is not
  claimed (#1429/#628).

- PR #1661 addresses RF-423906B2's missing ordinary completion handoff after
  receipt-only recovery (#1429/#1266). Its real reporting date is preserved and
  bank settlement remains unknown; a legacy no-message projection currently
  invents Manager delivery work and fails the portal lifecycle contract. The
  proposed existing-outbox continuation and read-only projection repair are
  under review and not deployed. No live mail is queued, claimed or sent by
  technical verification.

- On September 30 the owner confirmed form-first intake and field-specific
  same-case updates. `REFUND_WORKFLOW.md` is the single product requirements
  source. The email must name the exact fields, explain why and link to matching
  highlighted checks with prior answers preserved. PR #1651 was deployed on
  September 30: verified current submitted/expired links offer **Update your
  request**, preserve the submitted receipt and prior answers, and open fresh
  same-case structured access without another message or follow-up cycle.
  Validated matching changes invalidate stale purchase evidence and trigger the
  existing automatic recheck; unchanged confirmation preserves current facts.
  Production desktop/mobile form journeys passed with synthetic transport;
  live unknown/unauthorized capabilities were denied and protected case records
  were unchanged. Internally changed facts, revoked access and independent newer
  requests cannot be renewed through stale links; supported current issuance
  owns those cases. #628/#1361 retain remaining gaps. Emails/assisted exceptions
  retain supplied facts. The #1648 free-text email-time parsing work is held and
  superseded by this direction; no parser extension was deployed.

- PR #1645 was deployed on September 30. The refund portal shows an actor-scoped
  lightweight queue before full details, with correct counts and read-only
  navigation; actions still require the existing full case. Production desktop
  and mobile selection and case switching passed without error banners or
  overflow. Fresh queue loads improved to 4.2–8.2 seconds, while full details took
  8.9–12.0 seconds. Three consecutive loads within five seconds were not achieved;
  #628 retains the performance gap. The next bounded diagnostic is the queue
  RPC/network delay, preserving slow samples and avoiding a broader redesign.
- On September 30 the primary database scheduler missed two health dispatches
  and one refund sweep because pg_net reused transport request identifiers that the
  durable dispatch ledger incorrectly required to be globally unique. The
  failed transactions rolled back both their ledger rows and queued HTTP
  requests, so no unknown provider or customer effect escaped and the missed
  sweep must not be blindly replayed. The repair keeps `run_key` and
  `(mode, bucket_at)` as the stable dispatch identities while retaining the
  reusable pg_net request identifier as diagnostic evidence.
  Existing incident tables did not surface these rolled-back cron failures;
  closing that visibility gap remains separate work. After deployment, the
  natural 03:43 health run and 04:07 sweep both created durable dispatches and
  finished without failure. The 04:07 sweep was correctly suppressed outside
  the contact-policy window; no missed run was replayed.
- Two verified secure-form responses remained mislabeled as unread customer
  replies even though their exact current facts were already saved. The bounded
  continuation accepts only the current delivered request with no newer form,
  no unresolved requested field, and either a completed read-only recheck or the
  exact changed payout destination. It changes no stored case, decision, message,
  or payment. PR #1644 was deployed on September 30. Authenticated production
  readback confirmed provider-mapping repair for the card case and internal
  purchase research for the cash case. Stored case, message, provider-attempt,
  and receipt fingerprints remained unchanged; both delivered requests remain
  history. The deployment dry run showed no pending migrations. These internal
  next actions still require their existing case work.
- The cross-case Nayax card blocker is removed: another refund case's
  reference to the same purchase is audit context rather than a payment veto.
  Nayax owns the original-purchase total limit; same-case replay protection,
  exact purchase binding, unknown-result holds, and receipts remain.
- A fresh read-only provider result exposed a broad, ambiguous wallet candidate
  set with no independently corroborated purchase. The current
  reviewed-set proof would otherwise route it to a Manager before internal
  research. Issue #1359 tracks the backend readiness guard and case recovery;
  a completed lookup alone is not authority to choose a purchase or pay.
- On 2026-09-26 the deployed reply worker applied a verified customer time and
  settled its task, but the production portal still projected
  both a stale reply-review step and a contradictory customer-wait warning.
  The next safe step is the existing scheduled read-only purchase recheck;
  issue #1361 tracks the owner/state correction and live case readback.
- On September 29 the same reply worker safely deferred a payout-only reply
  because the customer said they do not use Zelle and also mentioned a different
  amount. The payout question does not authorize changing financial truth.
  Migration `20260929155500` narrowly recognizes a clean, verified,
  request-bound Zelle limitation as `customer_cannot_provide`. A reply that also
  contains an amount, method, card, network, or wallet fact stays in ordinary
  fact review; the amount, decision, completion state, and alternate payment
  policy remain unchanged until that review finishes.
- The follow-up repair keeps that mixed reply on the same protected fact path:
  every supported fact must still be applied from its exact verified source,
  while a direct no-Zelle statement from one exact bound message is retained as
  internal payout research evidence in the same settlement. It does not infer
  a limitation across messages, add another customer question, approve a refund,
  or authorize payment. Migration `20260930020251` is deployed, and the governed
  runner resolved the exact task while preserving the corrected amount and the
  bound no-Zelle evidence. The current next step is internal purchase research;
  no outbound message, decision, payment, completion, or accounting adjustment
  was created.
- On September 29 a governed confirmed-refund receipt reached the customer in
  the existing Gmail thread but also copied two mapped Managers because manual
  `completed` outbox rows still inherited the general Manager-copy policy. A
  second eligible receipt is held rather than repeat that route. The bounded
  correction sends manual customer questions and completion receipts to the
  customer thread only. The same recipient rule covers direct Gmail, bounded
  same-message retry, provider-outcome resolution, and transactional fallback;
  their settlement records the physical zero-CC result while retaining the
  current mapped-manager governance check. Manager approval/denial alerts and
  digests keep their existing routes. The earlier delivery remains immutable
  and is not resent.
- A reviewed card purchase with two valid current machine Managers exposed a
  stale generic queue instruction to restore Manager access even though the
  canonical work correctly required a Manager decision. The bounded projection
  repair keeps that queue aligned with the existing approve-or-deny action while
  retaining the normal any-current-machine-Manager or Super-admin authority.
  It does not assign one Manager, authorize a decision, send a message, or move
  money.
- Two current cases share one pending exact duplicate-reconciliation review.
  The protected transaction-check writer correctly stops before a provider read
  until the existing duplicate-or-distinct review is resolved. The deployed
  Edge correction now reports that expected precondition as HTTP 409 instead of
  HTTP 500, and the portal shows the current-case instruction without retry
  guidance before refreshing the authoritative next step. A bounded production
  call returned the stable conflict in 1.446 seconds; its before/after snapshot
  retained `not_started`, generation zero, zero candidates, the same event
  count, and the unresolved review. Duplicate resolution, provider calls,
  decisions, messages, and money were unchanged, and the scoped session was
  revoked. Current evidence cannot safely establish whether the pair is a
  corrected repeat form or two purchases, so the review remains pending; #628
  tracks one governed same-thread clarification when internal research is
  exhausted.
- The September 29 scheduled transaction check for one case durably saved a
  current generation with 10 ambiguous Nayax candidates and the normal
  completion/diagnostic events, then its scheduler action was incorrectly
  recorded as `database_failure`. The provider search must not be replayed. The
  bounded repair removes the redundant case write that ran after the
  authoritative result commit and keeps the recommendation event and action
  settlement. It also lets a currently mapped Machine Manager select an
  unexpired, exact-generation System candidate from an ambiguous
  scheduled result through the existing reviewed-selection action. Manual-portal
  candidates remain actor-bound, and the existing case version, generation,
  evidence, safety, and authority checks remain. This change does not select a
  purchase, rerun the provider lookup, make a decision, send a message, or move
  money. Hosted replay checks, the production migration/function deployment,
  and exact-main drift passed. The existing saved candidate was then selected
  once through the governed action with `provider_call_made=false`; the failed
  scheduler action remains immutable, the lookup was not replayed, and the
  case still has no decision or financial action. That readback exposed one
  remaining projection mismatch: the selection proof named the authorized
  Manager, while the System-generated candidate correctly remained unowned.
  Migration `20260929231500` now accepts that exact proof from a currently
  authorized machine Manager or Super-admin without rewriting candidate
  ownership, assigning the case, or changing the decision boundary. Production
  readback on two independently reviewed System selections returned the refund
  recommendation and Manager approve-or-deny next step with three and two active
  machine Managers respectively. Both decisions remain unset, no provider call,
  customer message, completion, or accounting change was introduced, and the
  original failed scheduler action remains immutable.
- On 2026-09-26 the authenticated refund list loaded again, but five case
  workflow details were still unavailable. Three traced to a stale Nayax lookup
  projection: two searches need internal machine/duplicate-scope repair before
  any provider read, and one case has confirmed payment that must not reopen
  transaction search. Track the other two fallbacks separately under #628;
  a loading list alone is not completion of the final-decision workflow.
- The September 28 production timeout is recovered. Migrations
  `20260928234730` and `20260929010530` reuse current case projections and the
  historical lifecycle version that the retained overview stage originally
  consumed, without widening any payment, refund, or customer-message timeout.
  After the second deployment on September 29, three authenticated production
  reads returned all 71 operational cases plus 11 internal/test cases in
  5.803-6.300 seconds, down from 9.202-9.333 seconds before either repair. The
  Refunds page rendered the then-current 56 active and 15 closed cases without a
  visible error, and the scoped test session was revoked. Exact payload parity
  and lifecycle v2 remained intact. Availability and timeout margin are
  improved, but the unchanged 3.4 MB response remains responsiveness debt.
- The September 29 cash payout-destination release exposed a new database
  planning regression in that response. The SQL eligibility predicate may run
  receipt and attempt research before rejecting a closed or unrelated case;
  fresh authenticated reads took 21-74 seconds and two of three timed out.
  Migration `20260929093000` preserves both eligibility results for all 83
  current cases and reduced the 83-case correction-field pass from 24.663
  seconds to 0.770 seconds in the rollback rehearsal. After production deploy,
  three serial authenticated overview reads returned all 72 customer cases plus
  11 internal/test cases in 6.352-7.173 seconds. A fresh portal session needed
  one retry, then rendered 57 active, 15 closed, and one waiting-on-customer case
  as up to date. The database regression is repaired; the large response and
  transient first-load failure remain reliability and responsiveness debt.
- The September 29 reviewed-selection preparation release closes one concrete
  case-worker gap without adding another queue or decision step. Migration
  `20260929113000` lets the existing selection action refresh current proof for
  one unchanged, actor-reviewed, exact Nayax transaction and exposes an advisory
  recommendation to the existing Manager decision path. In production,
  RF-423906B2 advanced from case-worker preparation to Manager approve-or-deny;
  its decision remained empty, and its counts remained zero payment attempts,
  zero receipts, zero action authorizations, and two unchanged customer messages.
  The proof records no provider call or customer message. This proves one real
  nonfinancial case advance; it does not claim that the remaining active case
  portfolio is complete.
- Production recovery on 2026-09-19 restored the System card-attempt queue for
  the TGPaci enterprise account. Approval and processing now use the same queue
  readiness contract, and deterministic completion delivery claims the database
  identity before it adds a customer status link. Customer intake visibility
  follows the reviewed refund inventory product category independently of the
  reporting-machine family used by other operations such as Timekeeping.
- Issue [#1364](https://github.com/ethtri/bloomjoy-hub/issues/1364) completed the
  refund-context reset, and PR
  [#1348](https://github.com/ethtri/bloomjoy-hub/pull/1348) merged the one-decision
  card workflow on 2026-09-14. Neither is an open rollout program.
- [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) is the durable product source of truth:
  the System investigates and saves the exact evidence for a routine clear match.
  A case worker chooses only when the result is genuinely ambiguous. The Manager
  then makes one decision; card approval uses the selected Nayax transaction, and
  cash confirmation means Zelle was already sent. The triage actor may differ
  from the assigned Machine Manager or Super-admin who approves.
- A routine clear match is saved by the System. Ambiguous results stay available
  for a case worker to choose and save before approval.
- Read-only transaction recovery and exact payment-result review are ordinary
  in-scope case work. An in-scope case worker, including a Scoped Admin, may
  record exact Nayax evidence for the existing System-owned attempt; this never
  creates another approval. The legacy `refundOperationsAccess` flag is only for
  the internal/test archive and cannot block ordinary case work.
- One assigned Machine Manager or Super-admin click atomically consumes one card
  approval and queues one System-owned attempt. The System executes and settles
  it. An unknown outcome holds that same attempt for verification. Exact later
  proof that no refund occurred lets the System continue the same attempt under
  the original approval; a rejected label alone does not. There is no blind
  retry, browser continuation, manual card completion, or second approval.
- Matching should resolve at least 95% of ordinary valid cases without customer
  clarification. Timezones, approximate amounts, and contactless number
  provenance are System responsibilities, not reasons for customer rework. A
  reported $10.00 purchase may correctly match and refund the selected $10.90
  provider total when the remaining evidence identifies that purchase.
- P0 issue [#1360](https://github.com/ethtri/bloomjoy-hub/issues/1360) adds an
  explicit customer/venue/provider timestamp contract and keeps ambiguous or
  noncomparable same-card candidates available for manager selection. The code
  and migration are not production behavior until their PR is merged and the
  normal release verification is complete.
- Nayax may be used for read-only transaction research when the API cannot find a
  match. Never issue or record a refund there. Cash remains a Manager-arranged
  manual payment outside the card attempt queue.
- The retired refund TOTP and step-up endpoints remain inert `410 Gone`
  compatibility tombstones for one release. Their historical names do not add a
  Manager step or authorize agents to restore that workflow.
- Open implementation work remains on the issue board. Documentation does not
  certify that every runtime path already follows the workflow.
- The consolidated migration still contains four guarded text-replacement blocks
  tracked by issue #1345; that technical debt does not add workflow authority.
- Issue [#1366](https://github.com/ethtri/bloomjoy-hub/issues/1366) is a P1 sweep
  of active agent context and the assistant-manager procedure. It is not a new
  payment safeguard or P0 launch gate.

## Current platform notes

- Bloomjoy Hub remains a Vite, React, TypeScript, Tailwind, shadcn/ui application
  backed by Supabase.
- Nayax scheduled transaction reports now stage exact settled card sales for
  active, published Sunze mappings. All 16 current exact mappings have a
  prospective machine-local authority date: older Sunze card history remains in
  place, while Nayax supplies card money and Sunze supplies cash on and after the
  boundary. One daily fact combines the Nayax amount with paid Sunze order/item/tax
  metrics while zero-value operational rows stay separate, and original values
  remain reversible. Publishing a future exact active mapping defaults the same
  boundary to the next local day; withdrawing the mapping restores Sunze, and an
  explicit boundary clear remains the rollback. Thirteen other active Sunze
  machines still lack an exact published Nayax mapping, including ten with recent
  Sunze card sales, so they remain on Sunze until their provider identities are
  mapped rather than guessed.
- The owner confirmed the interim reporting source split: Nayax supplies card
  money and machine apps supply cash. Finance screenshots show that SnapCase app
  `Order amount` excludes tax while app `Payment amount` includes tax. The
  importer uses API `paymentAmount`, with the current mapping supported by
  inspected UI parity rather than a claim about every API field or location.
  Finance also reported two unnamed Oklahoma locations whose relevant Nayax data
  excludes sales tax.
  Exact location/machine identities, report field, rates and effective dates are
  still needed from the finance reporting SOP before that exception can drive a
  consumer calculation. It is not a zero-tax assumption.
- The owner selected request-month refund recognition. A later payment posts no
  second sales deduction; a later unpaid denial or amount change posts only its
  difference in the change month. The calculation must retain the original
  purchase scope and existing assignment terms through a machine move, preserve
  already posted paid deductions, recognize eligible opening unpaid requests
  once at cutover, and leave issued Pay Stubs unchanged for ordinary later
  refund events.
- The reviewed request-month helper, consumer bindings, and contract
  documentation are deployed. The owner authorized the one-shot interim
  activation using the existing source split and configured tax treatment:
  Nayax customer charges are provisionally tax-inclusive, Sunze remains
  tax-exclusive, and explicit row metadata wins. A missing configured rate
  keeps the recorded amount numeric with no provisional deduction while the
  existing incomplete-tax publication behavior remains in force. Finance issue
  #1592 now targets named location/field/effective-date corrections; it is not a
  blanket blocker for the interim activation and does not supply an Oklahoma
  exception that can be guessed.
- Production activation followed merged compatibility PR #1628 at
  `2026-09-30 01:03:14.491153 UTC`. The one-time activation created 38 opening
  events with zero unresolved events; production now has one rollout row and 40
  recognition events in total. Authenticated browser checks passed for the
  fixed sales-report scope, cash/card reconciliation, PDF export, and a
  month-to-date view showing the opening request deductions. A temporary,
  owner-approved commission-only rollback restored `$123.30` across four
  previously positive scopes after six undated historical adjustment/context
  rows across five machines blocked their technician allocation. PR #1631 and
  production migration `20260930013500` replaced that rollback with the active
  rollout-aware calculation. Production verification retains all six rows and
  `$143.10` in machine reporting while excluding them from technician segments;
  allocation and cross-rate publication blockers are both zero, and the four
  positive shared-basis scopes total `$129.34`. The rollout row, 40 recognition
  events, 38 openings, and empty issued-statement/snapshot set remain unchanged.
  The difference from the temporary `$123.30` value comes from the corrected
  shared sales basis and original dated refund scope under the existing rate
  bands; no commission rate changed. This completes the technician commission
  rollout. Finance follow-up #1592 remains open.
- Machine-app cash can remain incomplete while a machine is offline. Sunze's
  daily seven-day overlap and monthly prior-month sweep, plus SnapCase's
  twice-daily 34-day overlap and bounded manual recovery, can ingest late rows
  idempotently. Complete pagination does not prove every offline sale uploaded,
  and an empty response is not proved zero cash. Existing targeted Pay Stub
  regeneration handles later corrections without replacing issued versions.
- Sunze cash-sale evidence now has a private, server-owned timestamp, freshness,
  coverage, and five-state match contract. Timezone-less `Payment time` values
  remain an explicitly unvalidated compatibility assumption and cannot prove a
  missing sale. PR #1630 and production migration `20260930004634` keep that negative rule
  while allowing successful cash rows from the latest machine-complete import
  and the exact machine/provider sale date to appear for explicit review. These
  rows remain marked with unvalidated coverage and timestamp semantics, never
  auto-select, and use no minute-delta claim. Post-deploy rollback verification
  returned one current review-only candidate with both unvalidated markers, a
  null minute delta, no selected sale, and no decision, completion, or accounting
  change; the rollback restored the exact prior attempt count. The other nine
  current watermark-missing cases remain unavailable rather than becoming
  no-sale evidence. A selected sale retains its originating time-provenance label
  even when a later import no longer returns it as a current candidate.
  Match confidence and coverage state explain the evidence; they do not decide
  whether a Manager may complete a reviewed cash refund. When an exact sale is
  selected, it cannot support a second non-duplicate completion.
- The production Nayax request and approval contract is proved with the current
  credentials. Use
  [NAYAX_REFUND_WORKING_CONTRACT.md](NAYAX_REFUND_WORKING_CONTRACT.md) for exact
  API fields and response handling.
- Timekeeping, Technician Pay Reports, Pay Stubs, partner reporting, access
  management, training, commerce, and machine administration remain active
  product areas. Their current work belongs on the board, not in this snapshot.
- Issue #1480 keeps normal open-month SnapCase sales and commission estimates
  visible without a SnapCase-specific warning. Closed positive-commission dates
  block only when their mapped machine lacks a completed payment import and
  successful cash publication. Production behavior still requires the related
  migrations to merge and deploy.
- Issue #1569 reconciled the six confirmed SnapCase source identities with their
  existing Nayax-linked Hub machines in production. The bounded repair preserved
  mapping dates, cash fact hashes and amounts, assignments, compensation, tax
  rules, and access grants. Completion receipts were revalidated through the
  established mapping trigger, and the issue and project item are complete.
- Issue #1478 now has a source-connected projection contract for Kexiaozhan cash only;
  existing Nayax scheduled facts remain the sole card authority and existing
  sales adjustments remain the sole refund deduction. Gross cash amount and
  half-open payment query bounds are supported, and the owner confirmed provider
  timestamps use each machine's IANA timezone. Complete acknowledged per-machine
  payment windows, including zero rows, bind normalized cash publication before
  they can release the matching closed payroll dates.
  Unknown item quantity uses a marked zero storage fallback without hiding gross
  cash, and later unproved source revisions preserve known gross as review work.
- Refund automation authenticates through the Info Gmail account and sends as
  `refunds@bloomjoysweets.com`. P0 #1455's deployed Info filter and classifier
  passed a controlled non-manager real-mailbox journey: the form link was sent
  once in the original thread, no case was created from email, and five later
  scheduled syncs recorded no duplicate reply or failure. A full Info To/Cc
  backlog pass, including read, archived, and spam mail, found no unanswered new
  refund inquiry; the hourly manual fallback is paused. Two older refund-status
  conversations remain separate follow-up work, not new form-link candidates.
- The merged refund workflow-health migrations are live. Two paid cases retain
  unresolved customer-status obligations because their historical completion
  copies cannot be bound to a reversible provider or Gmail identifier. The
  refunds and receipts are complete; delivery remains unknown, and another
  payment or replacement message is not authorized. The final historical
  no-safe-match message asked for zero fields and the current case also has no
  customer-correctable field, so health classifies that clarification as
  resolved obsolete while preserving its unknown-delivery audit evidence.
- The natural daily Manager digest passed on both September 27 and 28. Recent
  scheduler runs are healthy and suppress ineligible duplicate work, but a
  no-op run is not evidence that a case progressed; real action outcomes remain
  separately visible in the action ledger.
- A September 29 technical reminder was generated by a real, still-open refund
  workflow incident even though its scheduler was healthy. The remaining two
  failures were old automatic status notices on completed cases whose exact
  completion obligations were later resolved through existing customer-thread
  copies. Migration `20260929134500` recognizes only that case-bound, redacted,
  terminal resolution evidence and leaves every other failed or unknown notice
  visible. Refund workflow, completion-outbox, and Sunze sync technical incidents
  now stay on their existing durable records for the active GPT technical
  consumer instead of emailing executives; their action result is recorded as
  `routed_for_agent`, never as delivered email. Manager decision alerts, Manager
  digests, Sunze mapping alerts, and customer messages keep their existing routes.
- The first production health check after that routing release failed closed on
  an actual cash-case projection mismatch and sent no technical email. A saved
  payout-destination reply left the approved case in Agent review, while the
  broad cash stage incorrectly exposed a Manager payout action that the exact
  ready-notice contract rejected. Migration `20260929144500` keeps approved cash
  payout work with the Agent until the protected `cash_zelle_pending` state and
  an exact authorized Manager action are both present; the saved approval is
  unchanged and no payment is attempted. The production migration is live. A
  September 29 15:30 UTC health run completed successfully with no notification,
  set the existing workflow incident's stable-recovery timer, and created no new
  operations alert. Production now projects the affected case as
  `review_customer_reply` with no Manager payout action; customer-status delivery
  obligations remain zero. After the full 60-minute healthy window, the 16:30
  UTC health run resolved the durable workflow incident with
  `stable_recovery`; its one recovery action was recorded for the technical
  agent and did not create another raw executive email.
- The secure payout-destination form previously saved a valid Zelle destination
  but demoted an already-approved cash case into reply review. Migration
  `20260930031500` keeps only an exact changed, validated destination on the
  existing protected `cash_zelle_pending` path, records that the bound payout
  follow-up was satisfied by its submitted correction context, and exposes the
  existing Manager cash-confirmation action without sending or recording
  payment. A cannot-provide response and every undecided cash case stay in Agent
  review. Production readback of the observed case confirmed the approval and
  destination were preserved, the exact follow-up was satisfied, execution is
  still `not_requested`, no completion, receipt, attempt, adjustment, or manual
  reference exists, and a mapped Manager sees only the existing
  `send_cash_refund_and_confirm` action.
- A September 29 audit found 55 independent open case-work identities after
  excluding one open duplicate. The existing scheduled sweep and reply worker
  do not perform the broader purchase research, provider setup, reply review,
  delivery reconciliation, or assignment repair. The existing Codex caseworker
  heartbeat is the single broad consumer; it must work the portal and produce a
  real case transition or delivered customer question before this gap is called
  fixed. Production readback after migration `20260929033000` found its first
  repair incomplete: two unresolved duplicate-review cases still displayed
  System lookup work even though the real lookup claimant excludes them. The
  caseworker heartbeat was paused again before it ran. Migration
  `20260929043000` applied the claimant exclusions inside the current-work
  projector, but authenticated production readback still showed both rows as
  System work because a later lookup compatibility stage overlaid that result.
  Follow-up migration `20260929051000` repairs only the already-visible
  next-work object in the final actor-scoped overview when duplicate
  reconciliation remains open. Authenticated database readback then returned
  Agent purchase research for both rows, but the browser rejected those two
  lifecycle objects because the replacement omitted the required nullable
  `lastProgressAt` and `dueAt` keys. Migration `20260929060136` restores that
  exact public next-work shape. Authenticated browser readback then showed both
  rows as Agent purchase research with no unavailable-workflow fallback. The
  first hourly caseworker run examined seven cases and made no semantic advance;
  it exposed hidden transaction inventory and slow linked-case detail as real
  research blockers rather than counting inspection or a locale save as progress.
  Migration `20260929064743` separately restored the current undecided-cash path
  to the existing protected payout-destination request machinery. One controlled
  production case then sent exactly one payout-destination question: the provider
  recorded delivered, the bounded reminder row is waiting, and the portal moved
  the case to customer wait without a decision, payment, approval, or refund.
  That first live question also exposed two policy defects: the manual route
  copied two mapped Managers and the payout copy called the undecided request
  approved. Preserve that delivered message as immutable history and do not
  resend it. The follow-up source repair keeps `more_info` messages in the
  customer thread without Manager CC and describes payout-destination collection
  as review work; decision alerts and Manager digests remain separate.
  Candidate research and linked-case loading remain the next operational slice.
  These migrations add no queue, run ledger, decision, refund, or payment authority.
- The two remaining same-customer duplicate-review requests cannot be safely
  classified from internal evidence: their purchase facts match, but their
  customer-entered incident times differ and no provider transaction is bound.
  The current reconciliation panel has only final duplicate/distinct actions,
  so it cannot ask the one question needed to distinguish a corrected repeat
  submission from two purchases. The pending clarification slice reuses the
  existing customer-thread outbox and verified-reply intake for one fixed,
  pair-bound question and at most one reminder. It binds the exact review and
  both fact fingerprints, accepts ordinary customer wording for Bloomjoy review,
  and requires the exact outbound provider Message-ID in the customer reply before the
  existing operator action may record a customer-confirmed result. It adds no
  queue, payment gate, automatic duplicate decision, refund, or provider action.
- Historical no-safe-match follow-up cycles that stopped before creating any
  customer question project as internal purchase research only when current
  facts still have no correctable field and no cycle-bound message exists.
  Their historical failure evidence remains unchanged; the task no longer
  suggests recovering delivery of a nonexistent question.
- Technician wall-clock entries are interpreted in the selected machine
  location's IANA timezone. This keeps completed Eastern and Central work from
  being rejected as future merely because Bloomjoy's month-close policy and
  headquarters clock are Pacific; the month-close cutoff itself remains Pacific.
- Technician contact records now keep operational email, phone, and mailing-address
  details in a separate directory limited to the technician and pay-authorized
  managers. Machine-only managers cannot read them, and audit records store only
  redacted presence flags. Machine records have
  a separate operational phase, so a Setup-phase provisional machine remains
  assignable for Timekeeping without being represented as live or given invented
  provider identifiers.

## Durable references

- Product and design: `PRODUCT.md`, `DESIGN.md`
- Durable decisions: `Docs/DECISIONS.md`
- Refund product workflow: `Docs/REFUND_WORKFLOW.md`
- Live refund case procedure: `Docs/REFUND_AGENT_OPERATIONS.md`
- Nayax API execution contract: `Docs/NAYAX_REFUND_WORKING_CONTRACT.md`
- Local setup and agent preflight: `Docs/LOCAL_DEV.md`
- Production operations: `Docs/PRODUCTION_RUNBOOK.md`
- Reusable smoke coverage: `Docs/QA_SMOKE_TEST_CHECKLIST.md`

## Safety

Never paste secrets, raw customer data, payment identifiers, vendor exports, or
free-text complaint content into documentation, issues, pull requests, or chat.
