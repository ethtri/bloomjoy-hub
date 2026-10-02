# Bloomjoy Hub email alerts: first-round concepts

October 2, 2026 · Product exploration · [Issue #1711](https://github.com/ethtri/bloomjoy-hub/issues/1711)

Open [the mockup gallery](index.html). It includes a complete visual email for every candidate below, desktop/mobile preview, a subscription-settings concept and print-all view. All examples, people, locations, customer comments and numbers are synthetic. These files make no network requests and do not send mail or change product settings. Vite's development server may supply its usual local development connection.

## Recommendation

Start with **weekly performance + machine issues** and **optional new-refund FYIs**. Add **repeated-problem alerts** next. Explore enriching the existing daily refund digest with performance and operational evidence where timing and recipient scope match. Preserve every open case and the existing manager decision workflow.

The strongest product idea is using refund intake as an early machine-health signal: show the customer's selected reason, a short safe excerpt, the machine and incident time, and whether other customers reported the same symptom. A customer report is evidence to investigate, not a confirmed diagnosis.

Managers need priorities and decisions. Technicians need symptoms, location, ownership and a next step. Their email versions should follow their existing access, rather than exposing the same financial/customer payload to both roles.

## Candidate catalog

| # / mockup | Who | Proposed timing or trigger | Useful next action | Product position |
| --- | --- | --- | --- | --- |
| [01 Daily operations brief](index.html#daily) | Managers; reduced technician view | After each completed reporting day | Review performance, every open refund case, selected reasons and representative comments | Extend existing daily workflow; define how it combines before adding another email |
| [02 Weekly performance review](index.html#weekly) | Managers and technician leads | Chosen weekly day/time | Compare the same machines and identify recurring symptoms | First new subscription; existing sales and refund data |
| [03 New refund request](index.html#new-refund) | Subscribed technicians; optional manager FYI | A new canonical request is submitted | View reported machine symptom | First new subscription; distinct from a decision notice |
| [04 Refund decision ready](index.html#decision-ready) | Assigned machine managers | Prepared decision becomes ready or materially changes | Review and decide inside Hub | Existing workflow, shown for continuity |
| [05 Repeated problem reported](index.html#repeat-issue) | Subscribed technician and manager | Example: 3 distinct same-symptom reports within 2 hours | Review the cluster and arrange a check | Next addition; grouping and calibration needed |
| [06 Decisions waiting longest](index.html#decision-aging) | Assigned manager | Existing daily digest, sorted by decision-ready age | Clear oldest genuine decisions | Enrich the existing digest; no new reminder schedule |
| [07 Sales unexpectedly quiet](index.html#sales-quiet) | Manager and route technician | Sustained deviation during known open hours | Check recent activity and venue context | Existing sales; needs reliable completeness, baselines and hours |
| [08 Device reports offline](index.html#device-offline) | Technician; optional manager | Authoritative device status persists, e.g. 15 minutes | Check the named device connection | Future: no established device-status feed found |
| [09 Reporting data delayed](index.html#data-delayed) | Feed owner; optional subscriber FYI | Source misses its expected update window | Check reporting availability | Extend existing freshness signals; never infer machine outage |
| [10 Maintenance coming due](index.html#maintenance) | Assigned technician | Recorded maintenance-plan reminder | Open the specific task and guide | Future: schedule and completion records needed |
| [11 Supplies may run low](index.html#supplies) | Restock manager and technician | Estimated coverage is shorter than time to next visit | Verify stock and plan refill | Future: stock counts, logged usage and visit plan needed |
| [12 Service visit assigned](index.html#service-job) | Actual assignee | A saved service task is assigned or materially updated | Review the job and record findings | Future: service-task lifecycle needed |
| [13 Recovery observed](index.html#recovery) | Current recipients of the originating incident | Stable return of the observed signal | Review recovery evidence | Future: incident state and dependable recovery signals |

Each gallery item also documents its audience, cadence, trigger, noise controls, data needs, subject, preview text and intended destination. CTA buttons explain their proposed destination instead of opening live accounts.

## Subscription experience

The settings mock lets reviewers try machine choices, editable role presets, optional categories, cadence, delivery time, IANA time zone and quiet hours. Changes last only for the page session.

- Manager starting suggestion: weekly performance review. Existing manager decisions and open-case summaries remain visible as separate workflows.
- Technician starting suggestion: new customer reports and repeated-problem alerts for selected machines. Future assigned-service notices can join when tasks exist.
- Explicitly chosen machines only. Following a location's future machines should be a separate, clearly described option if added.
- Optional instant alerts wait until quiet hours end; a device-status exception requires explicit opt-in. A customer report alone does not bypass quiet hours.
- Every optional email explains why it arrived and offers category opt-out and alert management. Optional settings do not silently disable the existing manager workflow.
- Current authorization is checked before delivery and again when the user follows the link. A subscription does not grant new machine, refund or customer access.
- Preferences are a concept, not a new operational policy. Thresholds and presets are proposals, not restrictions on the current business workflow.

## Content and notification rules

1. Lead with machine, location, observed event and one next action. Quote the customer's report separately from system findings. Do not state an unverified mechanical cause.
2. Keep received requests, pending decisions, confirmed card refunds and issued gift-card value separate. A requested amount is not money returned, a provider-confirmed refund is not a bank-posting promise, and payment activity is not verified successful dispensing.
3. Use the exact existing refund categories. The current set covers no product, incorrect product, duplicate charge, wrong amount, fewer items than purchased, expected cash change and other.
4. Keep submission time separate from reported incident time. Late requests should not manufacture a live spike. Deduplicate canonical cases; flag uncertain incident windows.
5. Group repeated reports into an incident. Later matching reports update that incident rather than repeating the same interruption. A manager decision notice takes precedence over an intake FYI for the same event; it does not remove the case from the next daily digest.
6. Show reporting coverage, complete-through time, comparison window and currency. Missing data is unavailable, never zero. Use like-for-like machines/time periods and suppress unstable percentages. Do not describe requests received this week divided by this week's payments as a verified failure rate.
7. A daily digest includes every authorized open case, including unchanged cases. Empty required refund digests stay suppressed; an explicitly subscribed operations report may still have useful sales content. Long queues require tested rendering and complete per-case coverage, not silent truncation.
8. Escape and sanitize any customer content before email rendering. Use short redacted excerpts only where the recipient's operational access allows them; omit the excerpt if it cannot be safely redacted. No customer names, contact details, card digits, payout details or private links in technician emails. Link to current authenticated scope for fuller evidence. All excerpts here are invented.
9. Data-feed recovery, device reconnection, resumed sales and verified repair are different events. Only a recorded service check and successful test vend support “back in service.” Refund/customer obligations remain open until independently resolved.
10. Reuse the existing notification service, routing, deduplication and delivery ledger. Distinguish queued, provider accepted, delivered, bounced and unknown outcomes. Do not blindly resend unknown outcomes or add CC/BCC scope.

## Existing foundation and evidence

Reviewed `origin/main` at `36674447` on October 2, 2026. This was a read-only code/product review, not an independent audit of today's production configuration or delivery.

| Foundation | Source | Implication |
| --- | --- | --- |
| Machine performance and scheduled reports | `src/lib/reporting.ts`, `supabase/functions/sales-report-scheduler/index.ts` | Sales, transactions, time periods, machine scope, source freshness and scheduled-report machinery exist. |
| Structured refund symptoms and comments | `src/lib/refundOperations.ts`, `src/pages/RefundRequest.tsx` | Intake can support operational symptoms without inventing another customer form. |
| Complete scoped manager digest | `supabase/functions/_shared/refund-manager-digest.ts`, `refund-manager-email.ts`; [#1431](https://github.com/ethtri/bloomjoy-hub/issues/1431) | Preserve all open cases, decisions first, current manager scope and empty suppression. Initial schedule is 08:00 America/Los_Angeles. |
| Immediate manager decisions | `supabase/functions/_shared/refund-manager-ready-email.ts`, `refund-manager-ready-delivery.ts`; [#1425](https://github.com/ethtri/bloomjoy-hub/issues/1425) | New intake FYIs must not compete with prepared decision notices. |
| Notification noise and ownership | [#1278](https://github.com/ethtri/bloomjoy-hub/issues/1278), `Docs/REFUND_WORKFLOW.md` | Managers decide; system/assigned internal owners handle preparation and technical recovery. Current workflow supersedes historical cash/gift-card descriptions in older issues. |
| Machine-level technician access | `src/lib/technicianEntitlements.ts`, `src/lib/adminTechnicianAccess.ts` | Use existing grants; technician-safe alert payloads still need deliberate design. |
| Prior delivery evidence | `Docs/CURRENT_STATUS.md` records natural digests on September 27–28 | Historical evidence, not proof that any new concept is enabled. |

No self-service alert center, reliable hardware-status feed, consumables model or complete maintenance/service-task lifecycle was established by this review. These are explicit development dependencies. No production settings, database schema, payment actions, sender configuration or app routes change in this concept package.

## Success measures for a later implementation

Measure useful delivery and action, not opens alone: ready-to-notice latency, time to a genuine manager decision, report-to-technician acknowledgement where a task exists, repeat-incident acknowledgement, duplicate interruptions, opt-outs and incorrect-scope deliveries. Assess whether customer report clusters correspond to technician-confirmed problems before tuning thresholds. Proposed rules should be calibrated against complete historical data before claiming effectiveness.

## Review locally

1. On this PR branch, run `npm ci`, then `npm run dev -- --host 127.0.0.1 --port 8096 --strictPort`.
2. Open `http://127.0.0.1:8096/Docs/alert-concepts/index.html`. No account or credentials are needed.
3. Review all 13 candidates, switch Desktop/Mobile, use the narrow-screen selector, and try Subscription settings, role presets, save and category opt-out.
4. Use Print all mockups for a document view. The gallery also works by opening `index.html` directly beside its CSS/JS files.

These are browser-rendered design mockups, not production email templates. Cross-client Gmail/Outlook rendering, plain-text alternatives, live opt-out handling and delivery testing belong to implementation. The gallery uses a local font fallback when brand fonts are unavailable.

## Concept verification

All 13 concepts rendered at 1440, 390 and 320 pixels without horizontal overflow or JavaScript errors. Subscription settings were checked at both mobile widths. Role presets, local-only save, empty machine-scope feedback, category opt-out, desktop/mobile preview, direct concept links and destination explanations passed. Desktop and phone screenshots were captured; the daily, weekly and new-request layouts were visually inspected. Independent product review corrected recommendation sequencing, exact-case links and sample timeline continuity.

Repository checks: `npm ci`, `npm run build`, `npm test --if-present` (24 passed), and `npm run lint --if-present` passed. The install reported existing dependency advisories; the build reported an older browser-data list and bundle-size warnings. No dependency changes were made. A focused lint check also passed after the final mockup edits. This evidence verifies the concept gallery and unchanged application build, not production email delivery.
