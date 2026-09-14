# Decisions

## 2026-09-13 - One simple customer-first refund workflow (`#1364`)

[REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) is the durable product source of truth.
This decision replaces every earlier refund workflow, matching-gate, rollout,
pilot, Manager-approval, cash-state, customer-question, TOTP, and release-ceremony
decision where they differ. Git history and closed issues retain the old record;
they are not operating instructions.

- The customer reports the problem once. The System searches Bloomjoy, Nayax, or
  Sunze before asking for more information and should resolve at least 95% of
  ordinary valid cases without clarification. That target diagnoses System
  quality; it is not an eligibility threshold.
- Matching uses the complete evidence. Exact machine and timezone-normalized time
  are primary occurrence signals. Comparable card details are strong evidence,
  but contactless/device digits may differ. The customer amount is approximate
  and never an exact-match requirement.
- The Manager makes one final decision and may select any reviewed candidate,
  regardless of the System confidence label. The recommendation advises; it does
  not veto.
- For a routine clear card match, the System saves the exact transaction before
  Manager review. Human transaction selection is an exception for ambiguous or
  disputed matches, not a preparation step on every case.
- Card approval refunds the exact selected Nayax transaction. The default amount
  is its full charged total, including sales tax. A lower-priority UI improvement
  may allow the Manager to edit that amount.
- After card approval, the System owns provider execution, settlement, and
  reconciliation. An unknown or rejected-looking response holds the same attempt
  while Bloomjoy verifies what happened; it does not ask the Manager to approve
  again. Exact Nayax or support proof that no refund occurred lets the System
  continue that same attempt under the original approval. A plain rejection label
  is not enough proof to retry.
- For cash, the System correlates Sunze evidence and presents the verified Zelle
  destination. The Manager sends Zelle before selecting **Confirm refund sent via
  Zelle**. That action completes the cash refund; there is no waiting-for-payment
  state.
- Customer clarification is one targeted request after internal research is
  exhausted, plus one follow-up only when there is no response. A reply updates
  the same case and restarts matching. Close after 30 days without a useful
  response.
- Do not add exact-amount or high-confidence gates, TOTP, a second approver,
  ordinary manual-Nayax work, caps, cohorts, observers, report or optional-
  research prerequisites, repeated customer loops, or intermediate cash states.
- Retain current Manager authority, exact selected-transaction binding, duplicate
  prevention/idempotency, privacy/security, and unknown-result reconciliation.
  These prevent actual harm and do not add another business decision.

## 2026-09-10 - Open Technician pay months are estimates and assignment dates remain explicit

The Technician Pay Report treats the current calendar month as work in progress. It may show calculated time, imported Commissionable Sales, commission, and an estimated total through the latest available sales-fact date, but it cannot publish a Pay Stub until the Technician edit window closes. A source date before a future month end is informational during the open month, not a blocker an operator is asked to fix. Closed months still require complete source evidence, and overlapping freshness checks collapse into one actionable finding per machine.

Machine assignment dates and compensation-rate dates are separate inputs. The report exposes every effective payout assignment to an account pay manager and uses the existing audited assignment RPC for date corrections. Backdating a rate never backdates the machine assignment. When a selected historical month has no overlapping assignment, the report is not publishable and explains that the machine's sales are not attributed to the Technician; it offers an explicit assignment-date correction without changing pay or commission rates.

## 2026-09-07 - Timekeeping uses per-machine shift units, transparent commission, and automatic contractor pay stubs

Bloomjoy will replace the Google Form, manual Google Sheets compilation, and manually exported PDF workflow with lightweight Timekeeping, a manager pay report, and contractor Pay Stub self-service. The detailed MVP requirements are in [TIMEKEEPING_PAY_STUB_REQUIREMENTS.md](TIMEKEEPING_PAY_STUB_REQUIREMENTS.md). This decision supersedes the per-entry manager-approval workflow in `#587` and the earlier default lock/review behavior in the 2026-05-20 Operator Pay decision.

**Canonical behavior**
- A **shift** is a one-hour pay unit, not an entire work session. Each machine-specific time entry rounds up independently: 1-60 worked minutes equals one shift, 61-120 minutes equals two shifts, and so on. For example, three separate 20-minute machine entries equal three shifts.
- Technicians enter actual start and end times after the work is completed, against one assigned machine per entry. Timekeeping does not add live clock-in/clock-out behavior.
- The technician experience is organized as a simple weekly calendar for adding and reviewing machine-specific entries. Exact duplicate entries and overlapping time for the same technician are not allowed.
- Every active Technician may open Timekeeping. A Technician may submit time only for machines in their effective assignment scope.
- Portal invitation and Timekeeping compensation setup remain two technical prerequisites: the Technician first accepts the invitation and signs in once, then an account pay manager completes one atomic setup form. The form asks which machines the Technician may use and what rate and commission they receive for each machine. The first machine's terms can be copied to all selected machines, then only differing machines need edits. Worker classification and identifier stay under optional details. A failed setup leaves no profiles, assignments, or rates partially created.
- Machine Managers do not approve, reject, or return individual entries. They see submitted actual time and calculated shifts for their machine scope and may correct an entry when they find an error.
- Manager corrections do not require a written reason and remain available after the technician lock date. The system still retains before/after audit history for manager edits.
- If a Technician omitted an entry before lock, an authorized Machine Manager may add the completed entry after lock, including for an inactive former Technician with a historically effective assignment. The entry rejects future or overlapping time, calculates shifts normally, and records the manager action automatically. A voided monthly pay period is closed to every time-entry write, including manager corrections; reopening or replacing the period is a separate pay-manager action.
- Pay Stub freshness uses a monotonic audited time-source revision serialized per Technician and calendar year, not wall-clock timestamps. If an earlier month's time changes after a Pay Stub was calculated, that month and every later issued statement in the same calendar year remain visibly stale until each affected statement has been regenerated successfully; the earlier versions remain immutable.
- Pay periods are calendar months. Technician editing for a completed month closes at 11:59 p.m. in Bloomjoy's operating timezone (`America/Los_Angeles`) on the fourth calendar day after month-end. For example, December time is technician-editable through January 4 at 11:59 p.m. and locked at the start of January 5. Manager correction remains available after that cutoff.
- Pay is calculated as shift count multiplied by the Technician-and-machine rate effective on the work date. A machine-specific rate takes precedence over the optional Technician default, and effective dating ensures raises do not rewrite prior-period compensation.
- Commission is calculated as **(machine sales - refunds - estimated sales tax) × the Technician's effective commission rate**. Sales tax uses the effective machine tax rate on each sale date and rounds to the nearest cent per machine per day. A missing tax rate on a date with sales blocks publication; an explicit `0%` remains a valid configured rate. Sales, refunds, tax rate and amount, commissionable sales, commission percentage, machine contribution, and resulting commission remain separately visible so the calculation is understandable.
- The manager's primary monthly report shows actual submitted time, calculated shifts, shift earnings, commissionable sales, commission, adjustments, and statement total by Technician, with a machine breakdown where applicable. Managers use this report to correct inputs and regenerate a statement; they do not need a separate pay-stub library.
- Optional Technician-visible earnings or credits support the categories shown in the current manual statements: bonus, supply credit, and expense reimbursement. These are manager-maintained compensation inputs, not Technician-entered time.
- After the technician lock cutoff, the system automatically generates and publishes one Pay Stub for each payable Technician for the completed month. A missing required rate or unresolved source-data error creates manager-visible exception work rather than publishing a misleading statement. Publication is otherwise routine and requires neither approval nor proof that payment occurred.
- The Pay Stub follows the owner-provided reference hierarchy and shows payer and contractor identity, period beginning and ending, statement date, actual worked time, paid shifts, applicable machine rates and earnings, commissionable sales, commission rate and earnings, applicable bonus/credit/reimbursement lines, current totals, year-to-date totals, and the contractor notice. A Technician spanning legal payers receives a separate Pay Stub from each payer. It uses **Statement Date**, not **Payment Date**, until Bloomjoy records actual payment evidence.
- An authorized manager may regenerate a Pay Stub after correcting time, sales, rates, or adjustments. Regeneration preserves immutable prior versions, publishes the latest version to the Technician, and refreshes affected year-to-date totals on later statements. A failed or merely queued regeneration does not clear the stale state.
- Technicians may view and download their own historical published Pay Stubs online. The user-facing artifact is **Pay Stub**; superseded versions remain manager-auditable but are not presented as the current Technician copy.
- The initial Pay Stub population is entirely independent contractors. Worker classification remains a profile attribute rather than a global hard-coded assumption, and the 1099/no-withholding notice is rendered for contractor profiles.
- Payment execution, direct deposit, withholding, payroll tax calculation, tax filing, W-2s, and 1099 generation remain separate until Bloomjoy makes an explicit provider and compliance decision.

**Working assumptions pending implementation**
- The existing assigned-machine authorization, audited time-entry, revenue-snapshot, compensation-rule, adjustment, versioned-statement, and private-storage foundations remain in place; the next iteration simplifies workflow rather than rewriting those boundaries.
- Actual worked time, calculated shift units, commissionable sales, rates, and resulting earnings remain separately visible so Technicians and managers can reproduce the calculation.
- Commissionable sales use Bloomjoy's authoritative reporting facts and effective machine scope for the pay period, not a number manually entered by the Technician. The exact sales measure must be labeled consistently in the manager report and Pay Stub.
- Pay-stub regeneration is a deliberate manager action after a correction; routine first publication is automatic.

**Why this choice**
- Per-machine shift units match Bloomjoy's compensation practice while exact start/end times preserve understandable source records.
- Removing individual approvals keeps routine timekeeping simple without preventing managers from correcting mistakes.
- A technician-only cutoff produces stable monthly statements while preserving a practical correction path for managers.
- Showing both paid shifts and machine sales preserves the trust currently created by the manual sheet because a contractor can see the inputs behind regular earnings and commission.
- Automatic, versioned Pay Stubs remove repetitive monthly administration and give Technicians durable self-service history without claiming to execute payroll, prove payment, or create tax forms.

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

## 2026-07-16 - Timekeeping V1 is shift entry and machine-manager review (`#587`)
Bloomjoy will replace the contractor Google Sheets/AppSheet workflow with a lightweight Hub timekeeping flow before expanding into payment execution.

This entry is retained as implementation history. The 2026-09-07 Timekeeping decision supersedes its per-entry approval/correction queue and lock/review behavior.

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
