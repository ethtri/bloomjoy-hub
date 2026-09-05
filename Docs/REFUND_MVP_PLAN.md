# Refund MVP delivery plan

Product direction confirmed September 5, 2026. [Issue #628](https://github.com/ethtri/bloomjoy-hub/issues/628) is the delivery checklist; linked issues own current progress. This document defines the experience and implementation boundaries, not another backlog.

## The experience to finish

A customer submits one short request. Bloomjoy finds likely purchases. A manager reviews one clear comparison and authorizes a full refund. Bloomjoy submits and approves it through Nayax, confirms the outcome, and sends one accurate update. The customer never needs a Bloomjoy account or another form to fix the original request.

Use the existing Vite/React UI, Supabase functions, lifecycle v2, attempt journal, report importer, authoritative receipts and message outbox. Do not build another refund engine, state machine, inbox or payment platform.

## What the review established

Reviewed source: `0b7f9ca5`, current issue evidence through September 5, and authenticated Chrome pages for Bloomjoy Refunds and Nayax Reports Distribution Log. Browser observations are limited to the signed-in elevated manager; they do not establish ordinary-manager or mobile acceptance. No refund, customer message or production setting was changed by this review.

| Area | Already present | Remaining outcome |
| --- | --- | --- |
| API | Server-side request and approval, original full amount, exact machine authorization timestamp, account scope, durable attempts | One attributable real API request → API approval → confirmed full refund, then normal automated handling of the proved responses (#990) |
| Reports | Scheduled CSV delivery, authenticated mail ingestion, replay deduplication, original/refund linkage, reuse of existing receipts | A trustworthy terminal-outcome signal; current negative refund rows have blank status. File arrival is not refund confirmation (#973) |
| Completion | Exact provider receipts, existing-notice adoption, customer completion tools | Automatic completion/notice after validated evidence; an unknown accounting date must not keep a paid refund in the payment queue (#971) |
| Matching | Automatic bounded lookup, alternatives, versioned selection, preserved customer facts | Correct use of payment-identifier provenance, useful recovery for ambiguous matches, honest search coverage, exclusion of purchases proved later than the customer request (#1161/#1162/#1165) |
| Customer | Hosted intake, secure status/correction links, same-case replies, English/Spanish templates, durable mail | Ask once for useful facts, working reply delivery, no repeated questions or provider problems assigned to customers (#1109/#1163) |
| Manager | One server-derived lifecycle, queue/search, saved selection, polling/recovery | Decision first, compact candidates, one final monetary confirmation, quiet exceptions, preserved drafts (#992) |
| Machines | Account-scoped inventory and explicit published/setup/excluded states | Repair demonstrated supported-machine location/account/access gaps (#890/#1123); preserve the existing account exclusion through #1095 |

The September 5 native log showed two Sent cycles and seven explicit Empty cycles in its Today view; one hourly slot was absent. This proves that a gap between emailed files can include empty runs, not a failed subscription. It does not prove complete coverage or explain absent slots. The observed Hub read-error banner and report advisory require targeted reproduction, not an assumption that every backend is broken.

## Six delivery lanes

1. **Identify the purchase (#1161/#1162/#1165, with #890):** inspect only the payment fields the integration actually uses. Record unknown semantics explicitly. Deliver a small evidence-based selection policy; do not wait for exhaustive network/token research or optional PAR access. Exclude a purchase proved later than the immutable server-observed customer request before ranking and again at selection; uncertain timestamp ordering remains explicit review evidence. Repair exact affected mappings internally. An unknown field is not permission to pick an arbitrary same-price purchase.
2. **Finish the API path (#990):** use the next genuinely owed, exact, manager-approved purchase. Keep request and approval results separate. Learn from the actual provider result and encode only demonstrated accepted/rejected semantics. An accepted request proceeds to approval automatically under the same authorization. Implement any missing safe continuation after interruption in the existing attempt, with a crash-after-request/before-approval test. Until that continuation exists, use the supported authorized portal continuation for that request; never revive the retired approval-only runtime. Other lanes do not gate unaffected qualified refunds.
3. **Confirm and finish (#973 → #971):** establish which available evidence distinguishes completed from pending refunds, then feed it into the existing receipt path. In parallel, fix receipt-to-completion and notice behavior using synthetic evidence and known receipts. Exact portal confirmation remains an internal fallback while a machine-readable terminal signal is unproved.
4. **Make customer contact effortless (#1109/#1163):** reuse the current request and message history. Ask only facts that could change the result, together in one secure same-case correction. Preserve answers, including “Not sure” and “I can't provide this.” Verify the actual monitored reply route and truthful delivery state. Complete the remaining existing-channel cutover in #889 without making its text-account access a gate on email/form work or qualified refunds.
5. **Simplify the manager workspace (#992):** make a decision possible without navigating settings or a long diagnostic report. Implement the bounded layout/action/draft slices under the existing UX tracker, reusing delivered search/history work. This can proceed while API evidence is collected.
6. **Verify the combined result (#628/#427):** reuse the above evidence on one compatible release and observe ordinary operations. Do not restart verification for unchanged code or require a manufactured transaction count.

Serialize edits to `src/pages/admin/Refunds.tsx`, shared lifecycle/selection SQL and the release manifest. Independent design, report semantics and API investigation may proceed separately. Rebase overlapping work before final verification.

## Goal execution and issue population

The **Goal issue population** section of #628 is the authoritative, exhaustive list for execution and closeout. Finish every listed requirement and every necessary follow-up discovered during implementation; add each follow-up to that list and the Project board with an owner, dependency, acceptance criteria and verification. A historical reference or optional enhancement does not silently enlarge the goal, and moving required work to a new issue does not remove the obligation to finish it.

Reuse delivered work and evidence. Each required issue closes only after its remaining acceptance is verified, applicable code is merged and deployed through the existing authorized release process, and concise evidence is linked on the issue and board. Superseded issues close only with a named successor that retains their residual requirements; the goal stays open until those requirements are fulfilled. Document concrete external blockers and continue independent work; a blocked requirement, partial automation or a merged-but-unverified change is not goal completion. Existing account exclusions stay explicit and are not expanded merely to meet the checklist.

## Manager interaction contract

The manager is checking a small customer refund between other machine-management tasks, often on a phone in a bright public venue. Use the existing light product UI, readable text, restrained color and generous primary touch targets.

- On opening a case, show location/machine, reported purchase, plain current state, who acts next and the primary action in the first case viewport.
- Show one customer-versus-purchase comparison. Present the recommendation once and keep eligible alternatives easy to inspect. Collapse unusable candidates behind a count and explanation; preserve access to them for investigation.
- Selection is not a second business approval. Keep the selection and exact full amount together, with **Refund $X** and one final confirmation immediately before submission. Do not require a separate approval save, copied provider IDs, a second approver, a fresh balance form or a routine reason checklist. Existing saved approvals survive unchanged continuation.
- Revalidate exact authority, case version and purchase on the server. Immediately disable duplicate submission; reload and another tab must show the same attempt. Pending/unknown states offer no new refund action.
- Use one focused inline area for denial or a useful correction request, including fields, optional preview, submit and cancel. These actions never silently issue money.
- Language is a summary with Change. Internal/test classification, old evidence repair and technical details are collapsed Operations tools. Their existence must not look like mandatory manager setup.
- One customer-contact summary links to one history entry point. Preserve safe unsent text during case/filter navigation; never restore authorization or payment-ready state from a draft.
- Keep the existing six server-owned queue buckets. A confirmed payment remains visibly confirmed even if email or accounting needs internal work. Do not invent frontend-only status logic.

## Customer interaction contract

- Keep `/refunds/request`, `/refunds/status` and `/refunds/correct`; no login or route redesign.
- Keep the initial form short: location, approximate local purchase time, charge amount and appropriate last-four context. Keep enrichment such as payment interaction, card network, digit source and time confidence optional and conditionally disclosed. Provide useful “Not sure” choices, never ask the customer to calculate a timezone, and prefill known machine context.
- Payment digits are evidence with a source, not a universal identity veto. Reuse #1161/#1162/#1163 for physical card versus wallet/device treatment. Do not add a long payment questionnaire to every request.
- A correction email primarily opens the secure form for the same request, scoped to useful unanswered/conflicting facts. Each requested fact is confirmed, corrected or marked unavailable; unrelated details stay optional. Restore saved answers after a connection error and retain email reply as a same-case help/compatibility path. Do not expose candidates for the customer to copy.
- A usable sent correction can place the case in Waiting. Delivery failure, provider setup, exhausted contact or “can't provide this” belongs to Bloomjoy. One reminder is enough; do not create a repeating reminder/escalation loop.
- A received request, a refund being processed and a confirmed refund are different messages. Bank-posting time is an expectation, never a claim of money already in the bank. Reuse the existing approved templates and monitored sender.

## Outcome rules agents must implement

| Evidence | System action | Visible result |
| --- | --- | --- |
| Qualified original purchase and manager authorization | One durable generation, one API request | Processing |
| Proved request accepted/pending | Approve that same request once; #990 closes any interrupted same-attempt continuation gap | Processing |
| Proved full-refund terminal outcome | Reuse/create one exact receipt; settle once; enqueue or adopt one completion notice | Refund confirmed |
| Timeout, unfamiliar response, negative report row with blank status | Preserve attempt; inspect/reconcile that exact transaction | Processing or internal review; no payment retry |
| Authoritative rejection/no-refund outcome | Correct demonstrated cause or use supported continuation/fallback | One concrete next action; unchanged purchase authorization persists |
| Already refunded | Reconcile existing outcome and any existing notice | Confirmed, no new payment |
| Known partial refund or conflicting purchase | Internal transaction-specific review | No automatic full-payment/completion claim |
| Email failed/uncertain after confirmed refund | Repair only the message task using existing outbox rules | Payment stays confirmed |
| Confirmed refund, accounting date unknown | Retain unknown date and a separate internal accounting task | Payment/customer completion proceeds |
| Missing/empty report | Show only an actionable internal freshness/coverage concern | No payment hold and no inference of no refund |

Nayax has separate request and approval operations. HTTP status alone is insufficient evidence of their business result. Request and approval must preserve the exact original `TransactionId`, `SiteId` and source `MachineAuTime`; the normal approval uses `IsRefundedExternally=false`. Never substitute GMT/server time for the machine authorization value. [Nayax request documentation](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/request-refunds), [approval documentation](https://devzone.nayax.com/docs/manage-data-operations/lynx-api/refunds/approve-or-decline-a-refund).

## Minimum controls, and scope limits

Retain exact machine/account/purchase identity, full provider amount and currency, current mapped-manager authority, a transaction-level uniqueness/claim check, case-version checks, one durable attempt with idempotency, server-only secrets, unknown-outcome reconciliation and accurate payment/message history. These run in the system rather than becoming recurring manager chores. Nayax enforces the original-transaction amount limit; a separate remaining-balance lookup is not a first-attempt requirement.

No partial-refund editor, automatic refund approval without a manager, new cash/Zelle integration, new reporting platform, SQS/SFTP migration, GPT decision engine, quotas, arbitrary dollar ceilings, pilot cohorts, routine OTP ceremonies, or new mandatory approval layers. Keep existing explicit machine/manager exclusions. Cash and alternative reimbursements remain owner-handled offline under [the current #990 decision](https://github.com/ethtri/bloomjoy-hub/issues/990#issuecomment-5543556110); do not rewrite them as original-card refunds or build further payout features for this MVP.

Do not remove existing safeguards or rebuild historical accounting/mail merely for cleanup. Optional PAR research, extra payment modes, QR rollout, sender-domain migration and retired-code removal are not MVP dependencies. No new vendor/customer correspondence authority is granted by a plan or issue.

## Verification and the completion boundary

For a changed slice, run the repository's required install/build/test/lint/typecheck checks plus focused behavioral tests. Sensitive SQL/provider changes need independent review and meaningful concurrency/permission tests. Use synthetic data for forced timeout, crash, replay and race scenarios. Browser checks use ordinary and elevated manager roles, desktop and 390px mobile, keyboard, status announcements and 200% zoom; review the changed flow rather than every historical screen.

The combined acceptance is small:

1. A genuine owed card refund travels from one customer request through one manager approval, API request and API approval to independently confirmed full refund, one Hub completion and one appropriate notice.
2. An ambiguous purchase receives one useful same-case correction or a clear internal review, with no repeated settled questions.
3. Double click, concurrent tabs, interruption and unknown outcome never create duplicate money movement; message failure never retries money.
4. A validated terminal report/API signal automatically finishes a new refund, not only corroborates an existing receipt. Duplicate/delayed reports are harmless. If no usable terminal signal exists, label automation **partial** and keep #973/#971's automatic-confirmation acceptance open; portal fallback is operational continuity, not proof of full automation.
5. A confirmed refund can finish the customer/manager journey while unknown accounting metadata remains separate internal work.
6. The first viewport communicates the manager's next action; target under a minute for ordinary review and under two minutes for correction without recruited cohorts or a new sign-off process.

One release may satisfy several issues. Record evidence once and link it. A merged PR proves code delivery; browser tests prove the exercised behavior; a native report proves only its observed fields; a live API outcome proves the attributable operation. Close superseded tracking as superseded, never as unproved product success. Use the normal #427 observation without adding an activation gate or restarting it for ordinary, safely handled exceptions.
