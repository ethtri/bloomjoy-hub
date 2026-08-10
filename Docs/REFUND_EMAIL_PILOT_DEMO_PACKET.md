# Refund Email Pilot Demo Packet

Last updated: 2026-08-10

For the short, [plain-English sponsor review](REFUND_EMAIL_PILOT_SPONSOR_REVIEW.md), start there. This packet remains the detailed technical and operational evidence companion.

Purpose: give the sponsor one review surface for the email-only pilot candidate. This is a synthetic walkthrough packet, not authorization to connect production Gmail, contact customers, enroll managers, or execute refunds.

## Scope and current disposition

- In scope: designated Support/Info email, one Bloomjoy hosted form, Gmail-to-case linkage, triage, customer clarification drafts, manager routing, duplicate review, aging cues, exact case links, and safety/rollback evidence.
- Deferred: EasyText, SMS, the SMS Google Form importer, Twilio, attachments, production GPT processing, live Nayax calls, and production cutover.
- Current responder behavior: scheduled every ten minutes when enabled, plus workflow startup time. It is prompt but not instantaneous.
- Current decision: synthetic sponsor review may proceed after integrated evidence is regenerated. Controlled-inbox and production stages remain no-go until their gates below are explicitly approved.

## Roles

| Role | Owns | Must not do |
| --- | --- | --- |
| Email assistant | Label-scoped intake, safe extraction, deterministic acknowledgement, draft preparation, queue organization | Decide a refund, select a transaction, enter manager TOTP, call Nayax |
| Machine Manager | Review evidence, resolve duplicates, request clarification, personally authorize official actions in the portal | Delegate TOTP or official action to an agent/shared session |
| Release/operations operator | Configuration, isolated-label window, health monitoring, rollback | Enable a switch without recorded approval |
| QA observer | Execute synthetic script, capture sanitized pass/fail evidence | Use real customer data or secrets |
| Sponsor | Approve progression from synthetic review to controlled inbox and later production | Treat a component test as production approval |

## Sponsor walkthrough matrix

| # | Scenario | Expected evidence | Current state |
| --- | --- | --- | --- |
| 1 | Scope and switches | Email-only banner; Gmail/contact/aging/GPT/official-action/Nayax switches off | Code-proven; refresh screenshot |
| 2 | First eligible email | One humble message, one Bloomjoy form CTA, no Google Form, no manager CC, original thread | Code/database-proven; render screenshot |
| 3 | Replay and exclusions | Replay/later reply suppressed; bots, bounces, list/bulk, and outbound excluded | Code/database-proven |
| 4 | Email to hosted form | Private context completes the Gmail draft as exactly one case; invalid/replayed links fail closed; private token leaves the browser URL; attachments absent | Code/database/browser-proven |
| 5 | Manager queue | Website form / Support email badges; missing/duplicate/aging/provider filters; exact Open/Copy link | Desktop/mobile browser evidence passed |
| 6 | Missing information | Humble editable draft asks only for missing safe fields; mapped manager CC on case-specific send | Existing code proof; integrated screenshot pending |
| 7 | Duplicate safety | Same-incident / different-purchase review; stale decisions reopen after fact changes; official actions blocked before resolution | Code/database/browser-proven |
| 8 | Matching and authority | Clean/ambiguous/no-match/wallet/provider states; agents/admins cannot decide/refund; mapped-manager TOTP is synthetic-only evidence for the later official-action stage | Existing synthetic code/database/browser proof; controlled inbox stops before TOTP or official action |
| 9 | Aging and rollback | Exact manager link; disabling Gmail/contact/aging makes zero provider calls while form/manual portal remain available | Existing executable proof; refreshed scorecard pending |
| 10 | Closeout | Sanitized evidence index, remaining gates, explicit sponsor go/no-go | Pending final evidence regeneration |

## Escalation table

| Trigger | Action | Responsible role |
| --- | --- | --- |
| Possible or confirmed duplicate | Hold official actions; compare and record same incident or different purchases | Machine Manager |
| Machine or manager route unresolved | Send no case-specific customer message; repair portal mapping | Operations operator, then Machine Manager |
| Known delivery failure | Show retry work; do not imply delivery | Machine Manager |
| Uncertain Gmail delivery | Reconcile the deterministic Message-ID; never retry blindly | Operations operator |
| Bot, bounce, list, bulk, or outbound message | Suppress first contact and customer-evidence updates | Email assistant/service |
| Provider setup/failure/timeout/unknown | Keep case open; send no success; route provider work | Machine Manager and operations operator |
| Aging case | Deliver bounded manager-only notice with exact case link | Service after separate aging enablement |
| Legal, safety, threat, chargeback, abusive, high-value, non-English, or uncertain content | Human review; no automatic free-form response | Machine Manager/operations owner |

## Gates before a controlled inbox

- Sponsor approves the generic first-contact no-CC exception and attachment-off default recorded in `Docs/DECISIONS.md`.
- An isolated Gmail label and owner-controlled synthetic sender allowlist are selected; the legacy responder is proven unable to see that population.
- OAuth/secrets and exact mailbox/filter ownership are proven without exposing secret values.
- A synthetic-review identity is mapped to the test machine in the portal and its refund access boundary is verified. TOTP enrollment is not required because this stage stops before official action.
- Visible-CC privacy handling and copied-content retention receive owner approval.
- One staffed test window, operator, QA observer, stop conditions, and rollback owner are named privately.
- Every production-sensitive switch remains off except the minimum isolated-test switches for the bounded window.

## Gates before production

- Controlled inbox script passes with no real customer or payment data.
- Legacy responder inventory and atomic no-overlap cutover are complete.
- Primary/backup operating coverage and final triage/reminder service targets are approved.
- Production mailbox alias/send-as requirement is decided and verified if used.
- Full active-machine manager coverage, a clean manager-only identity, owner-supervised TOTP enrollment/recovery, retention/privacy, provider contract, live execution, and switch-by-switch go/no-go are recorded.

## What we need from the sponsor

- Now: nothing while engineering and QA finish the synthetic evidence packet.
- Before a controlled inbox: confirm the isolated inbox/label, mapped synthetic reviewer, staffed window and stop/rollback contact, and copied-content retention/visible-CC privacy defaults.
- Before production: confirm operating coverage and cadence, whether a Support alias/send-as is desired, clean manager-only identities and TOTP recovery ownership, provider/Nayax gates, and a switch-by-switch go/no-go.
- The sponsor approves production separately; the synthetic walkthrough or controlled inbox cannot imply that approval.

## Evidence rules

Use synthetic names, safe references, aggregate counts, and reviewed screenshots only. Never capture customer messages, real addresses, card digits, provider IDs, OAuth values, Gmail thread/message IDs, TOTP material, raw case URLs containing identifiers, or secrets in GitHub evidence.

## Immediate rollback

1. Set first-contact mode, Gmail sync, automatic contact, manager aging, GPT, official actions, and Nayax execution to their default-off state.
2. Verify no new claim, provider, send, or mutation calls occur.
3. Reconcile any uncertain outbound result; never resend blindly.
4. Keep hosted-form intake and manual portal work available.
5. Re-enable a legacy responder only after Hub sending is proven disabled for the same population.
