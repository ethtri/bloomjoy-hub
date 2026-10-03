# Bloomjoy email alerts: round 2

October 2, 2026 · [Issue #1711](https://github.com/ethtri/bloomjoy-hub/issues/1711) · [Draft PR #1712](https://github.com/ethtri/bloomjoy-hub/pull/1712)

The owner selected original concepts **01, 02, 03, 04, 07 and 08**. This iteration refines those six only. Navigation, subscriptions, presets and print output share that scope. The first round remains in Git history. No alerts are activated or email sent.

Open [the updated gallery](index.html). Four fictional machines illustrate decisions, older backlog, resolved requests, zero requests and missing sales data. All figures and customer comments are synthetic.

## What changed

- Daily and weekly emails begin with fleet totals, then give **each machine its own numbers and refund requests**.
- Each machine shows sales before refunds, transactions, period refund impact, sales after period refunds, new requests and open cases. Weekly adds its own comparison.
- Each request includes ID, current status, selected reason, customer comment, receipt time, reported incident time and exact-case link. Earlier open cases stay under their machine with a distinct label.
- New-request FYI and manager decision-ready emails use the same case example at different workflow moments.
- Quiet-sales now uses a completed reporting day. Device-offline names the payment device and the source observation, without claiming the whole machine is down.

## Six selected alerts

| Original ID / mockup | Job | Timing / trigger | Action |
| --- | --- | --- | --- |
| [01 Daily operations brief](index.html#daily) | See yesterday's performance and today's customer work by machine | Daily chosen time; prior reporting day plus current case snapshot | Open dated report or exact case |
| [02 Weekly performance review](index.html#weekly) | Compare each machine and understand its customer reports | Last complete Monday–Sunday week versus prior complete week | Open period report or exact case |
| [03 New refund request](index.html#new-refund) | Early operational awareness for a followed machine | First canonical submission; immediate or digest | View exact report in an authorized role-appropriate view |
| [04 Refund decision ready](index.html#decision-ready) | Make the actual manager decision | Existing ready transition or material decision change | Review and approve/deny inside Hub |
| [07 Sales unexpectedly quiet](index.html#sales-quiet) | Investigate an unusual activity change | Verified completed period versus comparable open periods | Check activity and location context |
| [08 Device reports offline](index.html#device-offline) | Inspect an explicitly disconnected component | Recent authoritative offline observations persist | View source status and device service guide |

All six are selected for further development planning. 07 needs calibrated comparisons and verified reporting coverage. 08 needs validated device-status meanings and observation cadence. Selection does not claim those dependencies are complete.

## Digest anatomy

1. **Period and scope:** explicit dates, currency and machine-local reporting basis. Delivery timezone is separately configurable.
2. **Fleet totals:** sales before refunds, transactions, period refund impact and sales after period refunds. A partial total is a known subtotal with its covered machine count.
3. **Customer work:** requests received in the period; all open cases at generation time; genuinely ready manager decisions. Show the snapshot time.
4. **Coverage:** sales and refund intake separately. A recent import timestamp is not proof of a complete sales period.
5. **Every machine:** name/ID, its four measures, request counts, weekly comparison when meaningful, and its request details. Decision-bearing machines come first, then other customer work, then the rest. Ranking never hides machines.
6. **Received in this period:** retain requests since resolved because their operational evidence still matters. Use a safe excerpt or “No customer comment provided.”
7. **Earlier requests still open:** separate label within that machine, without duplicating cases from the period list.
8. **Recorded outcomes:** confirmed card refunds and issued gift-card value are separate per-machine context. They can resolve older requests and are not deducted again.

Verified zero requests says zero. Unknown sales remain unavailable even when refund information is current. “No open cases” describes the customer queue, not hardware health.

### Complete coverage without an overwhelming email

Use compact case rows, not a large quote card for each request. Preserve one complete daily email per manager and never silently cap machines or required open cases. Implementation must validate long-queue message size and clipping in supported email clients, with complete compact HTML and plain-text coverage. A link supplements the email rather than replacing required per-case content. This concept does not introduce multiple daily deliveries.

The existing manager daily digest includes every assigned-machine open case. Optional followed machines cannot narrow it. Combine only when scope/timing match; otherwise preserve the existing digest or include “Other assigned machines with open cases,” still grouped by machine. The mock's selected scope equals its manager scope. Missing sales must never delay an existing decision notice.

## Metric contract

Reuse canonical shared Hub calculations and their snapshot/version; do not calculate financial totals from raw vendor exports inside the email renderer.

| Label | Meaning |
| --- | --- |
| Sales before refunds | Shared grossSalesCents: recorded sales excluding sales tax, before request-period deductions. Not tax-inclusive receipts. |
| Transactions | Canonical transactionCount, not units, successful vends or unique customers. Do not call it paid transactions without defining a filtered measure. |
| Period refund impact | Canonical period request deductions/increases less reversals/decreases. Not the cash returned during the period. |
| Sales after period refunds | Shared netSalesCents, using the same machine, period and source basis. |
| New requests | Unique canonical requests received within the period, excluding duplicate/test cases and retaining since-resolved cases. |
| Open now | Unresolved customer work at generation time, including older requests. |
| Need your decision | Prepared current manager decisions only. Research/customer waiting/provider recovery are not manager homework. |
| Card refunds confirmed | Provider-confirmed outcome amounts in the period; separate context, not a promise about bank posting. |
| Gift-card value issued | Issued face value, separate from returned cash and original-purchase deduction. Not proof of delivery or redemption. |

Hub recognizes request-period impact before payment. A later payment must not create a second deduction. This corrects the first round's overly broad statement that requests are not deducted from sales. Customer estimate, reviewed payment amount, tax-exclusive impact and gift-card face value can differ legitimately.

### Daily synthetic reconciliation

Reporting day October 1; case snapshot October 2, 8:00 AM Pacific.

| Machine | Sales before refunds | Transactions | Period impact | Sales after period refunds | New / open / decisions |
| --- | ---: | ---: | ---: | ---: | --- |
| Harbor Mall · BJ-014 | $420 | 42 | $30 | $390 | 3 / 4 / 2 |
| Midtown · BJ-021 | $336 | 35 | $8 | $328 | 1 / 1 / 1 |
| Pine Square · BJ-032 | $240 | 25 | $0 | $240 | 0 / 0 / 0 |
| West Arcade · BJ-061 | Unavailable | Unavailable | $0 known | Unavailable | 0 / 0 / 0 |
| Known sales subtotal: 3 machines | **$996** | **102** | **$38, same 3 machines** | **$958** | **4 / 5 / 3, all 4 machines** |

Four new cases remain open plus one earlier case. Card-refund outcomes total $18.90 and gift-card value totals $10, shown per machine and not subtracted again.

### Weekly synthetic reconciliation

Period September 21–27; comparison September 14–20; case snapshot September 28, 8:00 AM Pacific.

| Machine | Sales before refunds | Prior week | Transactions | Period impact | Sales after period refunds | New / open / decisions |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Midtown · BJ-021 | $2,360 | $2,000 | 236 | $20 | $2,340 | 2 / 1 / 1 |
| Harbor Mall · BJ-014 | $2,800 | $3,000 | 280 | $30 | $2,770 | 3 / 2 / 0 |
| Pine Square · BJ-032 | $1,960 | $1,800 | 196 | $10 | $1,950 | 1 / 1 / 0 |
| West Arcade · BJ-061 | $1,300 | $1,000 | 130 | $0 | $1,300 | 0 / 0 / 0 |
| Total | **$8,420** | **$7,800** | **842** | **$60** | **$8,360** | **6 / 4 / 1** |

Three of six new cases remain open plus one earlier case. Before-refund sales rose 7.9%; Midtown rose 18.0%. Card-refund outcomes total $46 and gift-card value totals $30, including older-request outcomes. October cases are not reused in this earlier week.

## Alert refinements

**03 versus 04.** A new request reports a symptom while preparation continues. It never asks a technician to approve a refund or makes an ordinary automatic gift card require manager review. Separate received and incident times. For 04 reuse the existing ready event, scope checks and delivery ledger, with exact case/amount and current server authority. Revalidate stale decisions and assignments. If the same event produces both emails for a manager, the decision notice takes precedence. An immediate notice never removes an open case from the next daily digest.

**07: sales unexpectedly quiet.** The example is a completed day: 12 transactions versus the median 40 across eight comparable Thursdays, 70% below usual. It assumes verified period coverage, which is not a live capability claim. Validate local dates, opening hours, stable cohorts, source changes, closures, maintenance, promotions, ramp-up and late uploads. Hide percentages for zero/unknown/incomplete baselines. Use transactions or before-refund sales so deductions do not manufacture a decline.

Sunze cash ingestion is daily with a backup; SnapCase imports twice daily. Nayax report arrival does not by itself prove transaction coverage, and offline devices may buffer cash. Begin with completed periods whose coverage can be established. Intraday detection remains within this selected type but depends on demonstrably timely data; a faster email scheduler cannot fix source latency.

**08: device reports offline.** Existing point-in-time Nayax context has online/attention/unknown observations. The broad attention bucket cannot become “offline for 15 minutes.” Raw vendor status fields also need validation. Establish exact component, explicit offline meaning, observation/heartbeat timestamps, freshness limit, expected cadence and authorized polling/webhook method. Stale observations or failed polling mean unknown. A terminal status is not the vending controller or mechanical condition.

Debounce short changes, group provider-wide issues, respect planned maintenance and explicit quiet-hour exceptions, and avoid a second quiet-sales notice for the same known offline incident. Internal recovery state resets deduplication; a separate recovery-email category is outside this selected scope.

## Subscription experience

Only the five selected optional categories appear. Manager preset: daily, weekly, sales-quiet. Technician preset: new-request and device-offline. Existing manager-ready emails remain a separate protected workflow. These are editable suggestions, not automatic enrollment; 07/08 disclose signal-validation needs.

Users choose authorized machines, timezone, digest time, weekly day, immediate-versus-daily request delivery and quiet hours. The offline quiet-hour exception starts off. Preview changes last only for the page session. Subscriptions do not grant access, and optional choices do not disable existing manager obligations.

Production needs escaped, sanitized and permission-filtered customer text. Use short redacted excerpts only where the recipient's access permits them; otherwise omit the text and link to the authorized view. Customer identity, card details, payout information and private access tokens remain outside technician email.

## Evidence and implementation slices

Read-only review of origin/main at 36674447. No live-delivery audit this round. Sources: Docs/REFUND_WORKFLOW.md, Docs/SALES_SOURCE_FIELD_CONTRACT.md, Docs/DECISIONS.md, src/lib/reporting.ts, manager digest/ready templates, .github/workflows/sales-import-sync.yml, scripts/snapcase/RUNBOOK.md and provider machine context.

1. Shared per-machine projection for 01/02, preserving canonical metrics, reporting windows and case-snapshot clocks.
2. Subscription settings and recipient-safe 03; refine 04's existing presentation and reuse delivery controls.
3. Calibrate 07 using verified periods and unknown-data handling before adding intraday variants.
4. Validate provider evidence for 08, then build persistence and scoped notifications using existing services.

The sequence does not deselect any of the six or add business approval restrictions. Existing authorization, duplicate prevention and unknown-delivery protections remain.

## Review locally

Run npm ci, then npm run dev -- --host 127.0.0.1 --port 8096 --strictPort. Open http://127.0.0.1:8096/Docs/alert-concepts/index.html. No credentials needed. The HTML also opens directly beside its CSS and two JavaScript files.

Review 01/02 at desktop and phone widths: four machine sections, all new requests, earlier backlog, exact-case links and missing-sales treatment. Confirm original IDs 01/02/03/04/07/08 in navigation and print output. Try presets, saving, scope validation, opt-out and simulated destinations.

These are browser-rendered design mockups, not production Gmail/Outlook templates. Cross-client rendering, plain-text parity, long-queue delivery and live recipient/delivery checks belong to implementation. Revision verification is recorded in PR #1712.