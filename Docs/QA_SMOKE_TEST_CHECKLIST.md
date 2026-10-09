<!-- #1751: Machine name replaces redundant location setup -->
- Machine Manage and detail Overview omit manual tax-rate controls. Admin source diagnostics show verified provenance or unavailable coverage; Location remains absent (#1763 supersedes #1753 tax controls).
- Machines table, Manage sheet, direct machine detail and imported setup have no Location/Reporting details display or location picker/name input.
- Unchanged company saves preserve exact internal location/timezone. Company transfer creates its own internal association, never reuses or renames a shared venue. New setup asks only Machine time zone when unknown.
- Effective Machine name agrees in customer exact-machine choices, sales/finance/refund/partner report rows and exports. Internal association labels never expose generated UUID text; genuine venue aggregates and all IDs, amounts, selection membership and history remain intact.

# QA Smoke Test Checklist

## Machine full page navigation (#1810)
- At 390px and desktop, Manage opens one full page for a bound machine (`/admin/machines/:machineId`) and an unbound Sunze/Kex source (`/admin/machines/source/:sourceKey`). Company/search/view/selected row/scroll return context stays in the URL. Reload and direct links load the same exact identity; no machine edit sheet competes with the page.
- The machine page contains one Machine name, one State and one machine Save. Settings tabs retain drafts. Declining page Back or native browser Back/Forward preserves the editor and drafts; accepting navigation discards them. Untouched imports return without a discard prompt.
- Machine Reporting starts with Partnership: current/scheduled assignments show dates; Add to partnership opens a searchable permitted partnership picker and editable Effective from date. The separate Add action writes only the canonical assignment, inherits dated terms and leaves history unchanged. Current/future primary overlaps are explained without ending them. Machine drafts block Add until saved/cancelled and survive tab changes; imported unbound sources show save-first help. Scoped/view-only, denial/retry and confirmed-write/read-failure paths must preserve scope and prevent duplicate writes. Run `node scripts/validate-machine-partnership-uat.mjs` against a local synthetic fixture server at desktop and 390px Chromium/WebKit; never assign production machines during release QA.
- Save Inactive for an unbound source with no company/name/reader/time zone. Restore Setup without creating a Hub. Stale writes keep the draft and retry safely. Successful setup followed by failed refresh must show a read-only retry, never issue another setup writer; verified retry loads the joined machine's reporting, refunds and history.
- Mobile cards show State and reader connection independently of refund availability. Exact source/reader IDs, managers and transaction provenance remain in Source & details. Company, search and Manage have 44px touch targets; no horizontal page overflow or header/save-bar overlap.
- For a synthetic active, fresh, exactly mapped excluded Nayax reader with saved managers, Refunds shows the saved exclusion reason and existing Enable customer refund requests action. That action publishes the saved reader only; card-refund processing remains off. Inactive, stale, mismatched, unknown-type and missing-manager readers cannot publish through this shortcut.
- Local synthetic regressions: `node scripts/validate-machine-navigation-uat.mjs` and `node scripts/validate-machine-mobile-ux.mjs --publish-synthetic` with Vite at `http://127.0.0.1:8097` (`MACHINE_NAVIGATION_UAT_APP_URL` / `MOBILE_UX_APP_URL` overrides). Run `deno test --no-lock src/lib/machineRefundReadiness.test.ts`. These fixtures do not modify production machines or send customer messages. Physical iPhone verification remains a manual check.

## Source catalogue lifecycle (#1811)
- For both Sunze and Kex, select State → Inactive in Manage on a bound and an unbound source without entering company, reader or timezone. It leaves Machines/Setup/Ready and their counts, appears in Inactive, and survives refresh/import. Restore the retained Setup/Live state without changing unrelated drafts. Unbound Inactive restores to Setup without setup fields; Live requires real setup. Cancel discards the State draft; failed source reads show Retry State and block writes.
- Company is visible beside search. All companies/Not assigned/exact authorized company persist in the URL and apply consistently to normal and Inactive results/counts. Archived records stay excluded.
- Nayax readers is secondary administration; per-machine mapping stays in Manage. Failed/stale state saves leave financial/refund/history/configuration unchanged and allow verified retry.

## Machines search focus regression (#1744)
- On `/admin/machines`, type a multi-character name continuously, then backspace; focus and caret stay in Search machines while results and URL update. Reload retains the query; clearing it restores all records. Verify imported Nayax and inventory searches similarly.
- Local synthetic regression: `node scripts/validate-machine-search-focus.mjs` (Vite on port 8087, or `MACHINE_SEARCH_UAT_APP_URL`). Also verifies shared-boundary render errors recover on query and pathname navigation. No assignment saves occur.

## Refund purchase review (`#1733`, synthetic cases)

- [ ] Open a selected card purchase with a reported no-product issue, approximate time, differing wallet digits, and an unknown card network. The problem, one comparison, supporting evidence and uncertainties appear together near the decision; no timing caveat is presented as positive match evidence.
- [ ] Compare other Nayax transactions without clearing the saved purchase. Opening, closing and browsing the shortlist makes no selection, approval, payment or customer-message request. The saved selection remains identifiable.
- [ ] Explicitly choose and save an eligible alternative. The selected purchase, amount and eventual synthetic approval all refer to that exact candidate; canceling a draft comparison preserves the saved purchase.
- [ ] Check incomplete and expired search fixtures. Returned count is not presented as a complete historical count or proof of uniqueness. No current candidates is distinguished from no purchases found; source, window and freshness are shown only when available.
- [ ] Verify missing card network versus customer Other/unsure, an updated purchase time with venue timezone, and a customer reply without a source link. Show factual values without inventing provenance or requiring another customer answer.
- [ ] Confirm a single Source details disclosure retains the copyable selected transaction ID, provider clock information and meaningful timestamped machine alerts. Unknown machine status without alerts is hidden. Optional absent time-source/attempt-count values and internal fact-version/ownership instructions are not ordinary review content.
- [ ] Check purchase-selected, submitted, confirmed-payment and completed fixtures. Progress language does not describe purchase selection as a completed refund. Existing cash research remains machine-source evidence, and gift-card requests keep their existing decision path.
- [ ] Verify desktop, 390 px and 320 px widths, keyboard disclosure/selection controls and long labels. Important facts, controls and focus indicators remain readable without horizontal page overflow. Use synthetic data only; never issue a live payment or contact a customer for this check.

## Company management (`#1730`)

- From Machines, open Manage companies. Rename a company, verify the updated
  name in machine choices and reports, and reject duplicate names or stale edits
  without losing the draft. Readers without machine administration cannot edit.
- Archive a company: new machine and imported-machine assignments cannot select
  it, including saves from an older tab. Existing assignments and reports remain
  available. Edit an existing machine without changing its company, then restore
  the company and verify it becomes selectable again.
- Verify the management dialog at 320px, 390px and desktop, including keyboard
  navigation, focus return, loading/errors and long names, without sideways scroll.
- After the Merlin correction, verify all formerly Merlin-owned machines and
  their locations align with Bloomjoy Enterprises; machine/location IDs, venue
  names, provider mappings, partnership agreements, financial rows and explicit
  manager assignments remain unchanged. Verify the recorded correction audit.

## Technician refund visibility (`#1729`)

- Open `/refunds` as a technician with active machine assignments and no refund
  manager/admin access. Requests show received date, machine, selected problem,
  original requested amount and refund status. Open a request to read useful
  sanitized customer comments; a resolved refund does not claim a repaired machine.
- Follow `/refunds?case=<synthetic-case-id>` after sign-in, including a request
  outside the initial seven-day list. Assigned requests open; missing/unassigned
  requests disclose no case details. Existing manager queue links still work.
- A user who manages one machine and services another sees the correct per-machine
  view. Technician-only requests never mount the manager workflow or its controls.
- Open Requests with `company=<synthetic-company-id>`, including a mixed-role
  direct-case fallback. Explain the unsupported filter before showing requests.
  Continue without it, preserving machine/date/case selections and current access;
  reset pagination. Verify recovery with keyboard at desktop, 390px and 320px.
- Exercise list/detail pagination, machine/date filters, unknown amounts, long
  comments, empty/no-assignment states, load errors/retry and assignment revocation.
  A failed permission recheck hides cached request data. Verify mobile and keyboard.
- In disposable SQL tests, check revoked, expired, future and unrelated machine
  assignments, direct IDs, same-company machines and every retained write boundary.
  Customer contact/payment credentials and raw events/attachments are absent from
  the operational read payload; sales access does not grant refund read access.
- Technician daily/weekly totals include original requested dollars; new-request
  email preserves useful sanitized symptoms and links directly to the read view.
  Technicians without sales access still see refunds, without sales data. Daily-only
  defaults and existing saved choices remain unchanged. Use synthetic mail only.

## Company assignment (`#1719`)

- As Super Admin, verify saved Company/location IDs in the full-page and sheet
  editors. New machine, Sunze and SnapCase setup include zero-machine companies.
- Explicit Add company handles duplicate capitalization/outer spaces and preserves
  the machine draft on Cancel/failure. Simultaneous creates resolve to one company;
  no invitations or memberships are created. Stale assignment saves fail clearly.
- A company change requires a compatible location or explicit new location/timezone.
  Historical facts, cases, shared old locations, managers, provider/tax settings and
  settlement assignments remain unchanged. Ordinary identity saves preserve status.
- Check loading/retry, empty choices, unavailable saved choices, long names, keyboard
  Cancel/focus, 320/390px and 200% zoom using the synthetic machine UI fixture.

## Personal machine email alerts (`#1715`)

- Open `/portal/notifications` as an assigned manager and a technician, including
  a technician without Account Settings access. Profile/Settings, Reports and
  machine-detail links reach the same personal preferences. Unassigned users
  receive assignment guidance rather than another user's machines.
- With no saved preferences, only Daily operations brief is on, at 08:00 Pacific.
  Save a daily opt-out and change assignments: the opt-out persists. Save distinct
  daily/weekly scopes and schedules, reload and confirm both. A stale-tab save or
  revoked machine keeps the draft and explains the failed save.
- Verify the machine panel changes only its current machine, last-machine removal
  turns that category off, and enabling it never revives an old selection. Reports
  setup carries selected machines into review without changing other alerts.
- In synthetic delivery tests, recheck account and machine access after claim,
  cross quiet-hour and daylight-saving boundaries, and invoke duplicate ticks.
  Confirm one delivery per period/event. Unknown provider outcomes remain held.
- Check daily/weekly totals against selected, authorized machine sales and new
  requests received in the period, including requested dollars. Actual company
  subtotals and machine rows reconcile. A resolved request received in-period
  remains included; an old open case does not enter the email. Unknown amounts
  and incomplete sales remain explicit, not zero or prepared/paid amounts.
- Check weekly comparisons on the same machines with current and prior data,
  partial comparison coverage and a zero prior baseline. Verify long company and
  machine names, zero activity, missing data, multiple timezones, and large fleets
  at 320/390 px and desktop with images blocked and dark-mode preference.
- Optional immediate request emails retain authorized comments and case links;
  technician excerpts omit customer contact/payment credentials, private tokens
  and include original requested amounts. No case narrative is repeated in digests.
- Verify condition alerts say cash sales or payment device where those are the
  proven sources. Stale status, incomplete coverage and a missing observation
  cannot become a quiet-sales or offline incident.
- Review desktop and 320/390 px screens, keyboard focus, error/loading/empty
  states, unsaved-navigation confirmation and reachable save controls. Use
  synthetic Auth/RPC fixtures and provider transport; no live customer messages
  or refund decisions are required for these checks.

## Finance reporting and dated tax treatment (`#1708`)

- In a disposable migrated environment, open `/portal/reports?view=finance` with an authorized sales/refund manager or Super-admin. Verify sales excluding tax minus requested refund impact equals net sales. Expand the breakdown: recorded money refunds, gifts and outstanding balances are separate, with no second deduction. Select a machine and export CSV; dates, scope, values and unavailable/partial coverage agree.
- Open Finance directly as a sales-only or refund-only user and with a saved out-of-scope machine. No Finance data request is made for a denied/unverified scope. A missing optional Finance service leaves existing reporting usable and provides Retry on the Finance link. An empty response is not labeled zero activity.
- In `/admin/machines` → Reporting as a Super-admin and as a scoped admin for an assigned machine, retain the existing rate/date/reason flow. Expand the optional tax-treatment settings, change card/cash amount basis and taxable portion, and save once. Reload to verify the dated values and audit reason. Rate-only edits must not reset treatments; invalid or failed combined saves must not partially change configuration. Scoped tax editing must not expose machine identity editing or expand machine scope.
- In synthetic accounting fixtures, verify tax-inclusive full/partial taxable amounts, tax-exclusive and separately recorded tax, explicit zero versus unknown, an effective-date boundary, and a refund of an earlier purchase. Explicit source metadata wins; current source defaults and issued snapshots remain unchanged.
- Verify Finance and the tax editor at desktop and 320/390 px, including keyboard disclosure, visible validation, empty/loading/error states, and no page overflow. Run `npm run reporting:validate-finance-uat -- --app-url http://127.0.0.1:8084` and `npm run reporting:validate-tax-uat -- --app-url http://127.0.0.1:8084`; these use synthetic reporting Auth/RPC fixtures rather than production changes.

## Reporting workspace

- Heavy report admission (#1824): run `node scripts/validate-reporting-admission-uat.mjs --app-url http://127.0.0.1:8099` against the local sample preview. With two-second browser fetch latency, current Sales renders first, at most one Sales/comparison/Labor/Refund/Finance/manual-PDF request is active, pending stale scope/access work is cancelled, and one timeout does not block independent reports. Verify a fresh live annual reload with real request timings after deployment; this client queue cannot coordinate other browser tabs or server jobs.

- [ ] Open `/portal/reports` with authorized sales access. Overview, Sales and
  Locations retain the selected dates, comparison, location, machine and sales
  tender in the URL. Saved views store filters for the current user only; reopening
  or sharing a URL never grants data access.
- [ ] Compare equal periods, unequal prior-month lengths, missing source rows and
  failed reads. Missing data is unavailable, never fabricated zero activity.
  Open daily chart values with the keyboard; location drilldown and browser Back
  preserve the selected period. Read coverage before interpreting a quiet machine.
- [ ] Labor is independently authorized. Three 20-minute entries show one recorded
  hour and three paid shifts. Time-only managers see no earnings or pay export.
  Monthly estimates, partial months, missing rates and account-wide statement
  readiness remain explicit; publication is not payment.
- [ ] Refunds & Recovery independently authorizes every machine. Request cohorts,
  payment/accounting activity and period-end balances stay separate; partial cash,
  gifts, unknown dates and incomplete history remain distinguishable. CSV matches
  the visible authorized scope and contains no customer/payment identifiers.
- [ ] Open a location's 360 view and inspect permitted labor/refund panels; each
  domain rechecks scope. A sales-only user receives no labor/refund aggregate calls,
  while time-only and refund-only managers can reach their own reporting view.
- [ ] Existing detailed sales PDF export and partner agreement reporting remain
  operable under Sales → Detailed report & PDFs and Partners → Export → Polished
  PDF report. Those views show only their own filters; the original sales report
  supports longer custom periods independently of the analytics date limit.
- [ ] Period offers complete-day, week, month, year and Custom range choices.
  Custom dates apply together, preserve scope and survive refresh/Back. Invalid
  dates do not fetch data. Labor/refunds show no sales tender or comparison control.
  Partners retain agreement-specific period controls. Verify saved view,
  briefing and CSV downloads, empty/error states and 320/360/390/768/1024/1440px layouts.
- [ ] When the optional labor/refund permission services are unavailable, existing
  operator and partner reports still open without a loading/retry loop. A granted
  labor or refund view remains usable when the other service fails. Unverified
  domains never fetch report data; accounts without verified access can retry.
- [ ] Run `npm run reporting:test-analytics`,
  `npm run reporting:validate-workspace-uat -- --app-url http://127.0.0.1:8081`,
  `npm run reporting:validate-portal-uat -- --app-url http://127.0.0.1:8081`,
  and `node scripts/validate-reporting-access-uat.mjs --app-url http://127.0.0.1:8081`
  against a local server with synthetic fixtures. Run disposable database replay
  for the real authorization and canonical financial-calculation assertions.

## Refund workflow

Use [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) as the expected behavior. Tests and
historical fixtures cannot add product gates that the workflow does not contain.

- [ ] With two safe fixture cases that reference the same approved Nayax purchase,
  the second case can still select the purchase and reach the normal Manager
  refund decision without an “already linked/reserved” blocker. Replaying the
  same case still creates no second attempt, and an unknown provider result stays
  held for reconciliation. Do not send a live refund during this check.
- [ ] Legacy sender regression only (before personal-sender adoption): the 08:00
  America/Los_Angeles manager refund digest lists every canonically
  open case on that manager's current machines, including unchanged cases on the
  next day and more than eight cases. Prepared approve/deny and cash-payment
  decisions appear first; all other rows name the System, Agent, or customer
  next step and say no manager action is needed.
- [ ] Legacy sender regression only: a manager with no scoped open cases gets no
  legacy refund digest; co-managers get separate
  correctly scoped messages, and an unmapped admin gets none. Reassignment or
  changed case facts before provider start cancels a stale prepared message.
  An unknown provider outcome is held for reconciliation without a blind retry.
- [ ] Form-first acceptance (#628/#1361; implementation gaps are not implied
  complete by this checklist): only a genuine new refund/product-problem inquiry
  to Info gets one original-thread intake-link reply and no case before form
  submission; replay creates no duplicate. Unrelated/vendor/marketing mail gets
  no refund response, and existing-case replies get no new intake.
- [ ] A targeted correction notification names exactly the human-readable fields
  and brief reason and includes **Update your request**. Its same-case form uses
  those labels, highlights the requested checks and shows saved prior answers.
- [ ] Invalid/stale corrections change no facts; a valid structured update saves
  once to the current case and automatically rechecks the purchase. Rough time
  stays approximate, venue timezone is derived internally, and a mapping/provider
  defect creates no customer homework, decision or payment.
- [ ] A submitted/expired link has fresh targeted same-case update access; it
  creates no new case or repeated request for settled facts. Preserved useful
  email replies/assisted exceptions are not treated as silence or dependent on
  routine free-text extraction/LLM interpretation.
- [ ] On a verified submitted/expired link, **Update your request** opens the
  current saved case without sending another question or creating a case/cycle.
  The original receipt remains saved, settled fields are optional, and a lost
  renewal response retries the same capability. Stale facts, changed recipient,
  unknown delivery, intentional revocation and newer replacement access cannot
  resurrect the old link or extend an expired child through ancestor retries.
- [ ] Card matching compares the exact machine and timezone-normalized time, uses
  comparable card details when available, treats contactless digit differences
  according to provenance, and keeps the customer's amount advisory.
- [ ] Refund comparison labels customer time in the case/venue timezone, Nayax
  authorization time in venue time, and a verified provider machine clock in
  its own timezone. Request-receipt and stored audit times are explicit too, and
  each candidate names its bounded source and resolution. A provider/venue clock
  mismatch is identified as System context. Browser location does not change
  these values; DST folds/gaps preserve the customer's original wall-clock entry,
  and multiple ambiguous or non-comparable provider times remain selectable for
  Manager review rather than becoming a hard veto or a reason to ask the customer
  to repeat known facts.
- [ ] A customer estimate of $10.00 with an otherwise identified $10.90 provider
  charge defaults to a $10.90 refund and does not trigger an amount question.
- [ ] The System prepares a clear exact candidate or a completed reviewed set
  from current purchase evidence. A currently eligible ambiguous sale is chosen
  within the assigned Manager's one final decision, without a prior Select/Save
  chore; a blocked sale stays visible but cannot be approved.
- [ ] The assigned Machine Manager or a Super-admin can **Approve refund** for
  one eligible exact Nayax purchase or **Decline** without choosing a purchase.
  Approval binds the full provider total and queues exactly one System-owned
  attempt. A paused processor holds that attempt until activation without asking
  for another Manager decision or calling the provider early.
- [ ] A legacy selected transaction becomes refundable only when its unchanged
  current candidate and original manager event reconstruct one unique,
  top-ranked recommendation under the current proof rules. An ambiguous or
  lower-ranked legacy selection stays blocked for manager review, names the
  transaction-confirmation problem, and does not remain on **Checking refund
  availability** during background refreshes.
- [ ] The System claims and executes that same attempt. A double click or replay
  creates no second refund or provider call. An unknown provider outcome holds the
  same attempt and does not stop unrelated cases. Exact authoritative proof that
  no refund occurred advances the same attempt once under the original approval;
  a rejected label alone does not. There is no blind retry or manual completion.
- [ ] Nayax portal access is read-only transaction research when API results are
  insufficient; it never issues or records a refund.
- [ ] Cash investigation uses Sunze, the exact machine, timezone-corrected time,
  amount, and other available evidence. **Confirm refund sent via Zelle** means
  the Manager already sent the money and completes the case without an
  intermediate payout state.
- [ ] Sunze cash evidence returns exactly one server-owned state:
  `checking_sales_history`, `sale_found`, `multiple_possible_sales`,
  `no_sale_found_with_complete_coverage`, or `sales_history_unavailable`.
  Unmapped, unsupported, unvalidated, stale, post-watermark, and disjoint-gap
  fixtures never claim complete no-match.
- [ ] A timezone-less workbook value remains explicitly unvalidated and cannot
  advance a refund coverage watermark. Validated IANA fixtures cover workbook
  dates, strings, explicit offsets, midnight, and both DST transitions.
- [ ] Without a validated watermark, a positive exact-machine successful-cash
  row from the latest machine-complete import for the reported sale date is review-only, explicitly marks
  its source time and coverage unvalidated, has no minute-delta claim, and never
  auto-selects. A newer export for a different week does not hide historical
  positive rows. A newer relevant empty export still invalidates the old snapshot.
  Zero rows stays unavailable and never claims no sale.
- [ ] An undecided cash case with a saved amount and destination but no current
  purchase recommendation shows Agent research consistently in its stage and
  Manager queue. It cannot claim payout readiness or ask to repair Manager access.
- [ ] Amount and confidence remain advisory evidence. A reviewed Manager can
  complete a cash refund from any match state after sending Zelle; selecting an
  exact Sunze sale cannot complete a second non-duplicate case.
- [ ] `anon` and `authenticated` cannot read the private Sunze coverage objects
  or execute the server-owned matching RPC.
- [ ] Customer clarification appears only after internal research is exhausted,
  asks one targeted question in the existing case, sends one follow-up only when
  there is no useful reply/update, saves structured updates to the same case,
  and prepares a Manager
  reject recommendation after 30 days without useful input. The unattended
  worker never closes or denies the case.
- [ ] On a disposable legacy cash case with an old empty research cycle, a
  current reviewed Sunze or SnapCase purchase exposes only the missing payout
  destination in the existing correction dialog. An unreviewed, released,
  conflicted or stale-source selection keeps the hold. Opening the dialog makes
  no delivery, decision or payment; the existing contact budget and authority
  still apply when a synthetic request is sent.
- [ ] A clarification or payout-destination request sends only to the customer
  in the existing thread; it does not CC Managers. An undecided cash case says
  the destination is needed to continue review and never calls the refund
  approved. Manager decision alerts and digests remain separate.
- [ ] A purchase-relationship clarification is available only for one current
  pending reconciliation pair. It queues one fixed customer-thread question,
  permits one reminder after proven delivery and no reply, and becomes stale if
  either fact fingerprint changes. Only an exact verified reply in the bound
  Gmail thread may support the existing operator duplicate/distinct action;
  ambiguous or source-unverified replies remain internal review and do not
  merge cases, block separate legitimate refunds, send money, or make a decision.
- [ ] A historical no-safe-match follow-up with no customer-correctable field,
  message, or send evidence remains open Agent purchase research. It does not
  imply a customer question exists or offer a resend. Stale facts and any
  saved question stay on their actual workflow paths; the cycle is not changed.
Existing assisted email compatibility checks below preserve prior implementation
and receipts; they do not prescribe the normal correction path or authorize
expanding email parsing. Form-first acceptance above governs new work.

- [ ] A verified customer email reply with corrected Card type or
  wallet/device-token last-four provenance updates the same case and restarts
  matching without creating a duplicate request.
- [ ] A verified `Time: 5:03 pm` reply corrects the same case using its saved
  purchase date and location timezone, records one source-bound fact receipt,
  and restarts System research. A conflicting time, stale claim, or DST fold/gap
  changes no facts; no Manager decision or provider payment is made by this step.
- [ ] After that source-bound reply settles, the portal shows System purchase
  recheck as next work while the new lookup is due or checking. It does not
  still say to review the settled reply or wait for a customer answer. Once the
  read-only lookup finishes, the case stage replaces the recheck copy.
- [ ] A structurally current cached System `run_lookup` row is rechecked against
  current case truth. Ineligible/not-started lookup work returns to Agent
  purchase research, a genuinely eligible lookup remains System-owned, and the
  repair never restores a `nextWork` object removed by actor-scoped redaction.
- [ ] The hourly subscription-backed reply task reads only the exact verified
  request and complete later-reply set. Ordinary prose can yield a quoted,
  version-bound fact receipt, including card network and a wallet-device token
  kept distinct from physical card digits. A customer who cannot provide the
  requested fact stays System-owned. After an earlier completed automatic card
  lookup, a verified rough-time or wallet reply can cause one fresh scheduled
  read-only Nayax generation using that directional evidence. A genuine
  cannot-provide reply can still start an initial read from the known machine,
  amount, and time without card digits. The completed result reopens the same
  reply task once. An exhausted or unsafe read keeps a
  named internal dependency, without asking the customer again. No generic
  follow-up sweep sends a Manager research notice, and no model output sends a
  message, approves, pays, or retries an unknown payment.
- [ ] System, mapping, timezone, provider, and delivery defects route to an
  internal issue without asking the customer to troubleshoot or repeat known
  facts.
- [ ] On a fresh `/refunds` load, the small authorized queue may appear before
  full case evidence. The four counts match the hydrated overview; internal/test
  records stay out of customer history. Selecting a queue row shows loading
  detail until current evidence arrives, retains that selection, and exposes no
  decision/payment action from the small projection. A failed detail read says
  temporarily unavailable instead of showing an empty queue or endless loading.
- [ ] `/refunds` shows exactly four wrapping views: Decision needed, Waiting on
  customer, All active, and All closed. At 390px there is no horizontal page or
  tab scrolling. Search remains available below the views.
- [ ] Decision needed contains only a fresh current-version server recommendation:
  a clear Nayax card or Sunze cash purchase match, or the advisory 30-day
  no-meaningful-input rejection recommendation. Zero, one, ten, or 198 raw
  candidates never create a recommendation. Stale action or fact versions fail
  closed. The Manager still makes the final Approve or Deny decision.
- [ ] Waiting on customer contains only an open case with proof that a real
  question was sent and has no reply. Draft, queued, failed, or internal research
  work remains in All active. Approved cash send/confirm work also remains in All
  active. All closed is the complement of all open work.
- [ ] The selected decision presents one recommendation, concise matched purchase
  proof, and Approve/Deny controls. Raw Customer request text remains visible.
  Customer purchase details, provider search evidence, case history, technical
  diagnostics, Gmail identifiers, and administration controls are collapsed by
  default. Nonselectable transaction inventory is absent from the default Manager
  view. A provider authorization timestamp is labeled Transaction time.
- [ ] A rough-time wallet request whose completed provider read contains no
  hard-safe exact device suffix or uniquely verified same-machine QR purchase
  remains internal purchase research with a named
  identifier blocker, even if many provider rows are individually hard-safe.
  The displayed candidates explain why selection is paused, with disabled
  keyboard and screen-reader controls. No reviewed-set approval proof or
  Manager ready notice is created; a later completed read with a safe exact
  identifier or one verified QR-correlated safe purchase can prepare the final
  decision, without making a provider payment.
- [ ] A completed, current-version preparation sends at most one immediate
  final-decision notice to each current Machine Manager. Cash copy says to send
  Zelle before confirming it was sent; an unresolved customer question or
  merely saved payout destination sends no ready notice. A revoked manager or
  changed preparation before provider start sends nothing. A legacy wallet
  notice with uncertain overlap stays in review, and an unknown provider send
  is never retried blindly. The lane remains off until the release review.
- [ ] Refund workflow health shows the scheduler and delivery obligations
  separately. A successful scheduled run with an open Manager queue and a
  disabled digest, or a missed 08:00 local digest without a settled batch,
  remains degraded. Unknown sends remain visible; unavailable per-case due
  evidence is labelled unavailable rather than counted as healthy progress.
- [ ] Customer and Manager views work at 390px and desktop widths, with readable
  evidence, keyboard access, no horizontal overflow, and no private provider or
  payment identifiers.

Run the focused checks that cover the changed slice; use the full test suite for
release closeout:

```text
npm run refunds:validate-nayax-matching
npm run refunds:validate-nayax-execution
npm run refunds:validate-cash-intake
npm run refunds:validate-official-actions
npm run refunds:validate-purchase-correction
npm run refunds:validate-customer-correction-persistence
npm run refunds:validate-deterministic-followup
npm run refunds:validate-customer-comms
npm run refunds:validate-manager-workbench
npm run refunds:validate-portal-uat-lifecycle
```

## Global
- [ ] App starts: `npm ci` then `npm run dev`
- [ ] Open the URL printed in the terminal (usually http://localhost:8080)
- [ ] Browser tab title updates by route and includes Bloomjoy branding; favicon renders as Bloomjoy icon
- [ ] Public routes set page-specific metadata (title + description + canonical + OG tags) in browser devtools
- [ ] Public routes include JSON-LD structured data (`script[type="application/ld+json"]`) with Organization/WebSite/WebPage entries
- [ ] Private/auth routes (`/login`, `/cart`, `/portal/*`, `/admin/*`) set `meta[name="robots"]` to `noindex`
- [ ] Direct-load public routes in browser address bar (for example `/machines`, `/supplies`, `/plus`) and confirm they do not return hosting-level 404 pages
- [ ] View page source on a direct-loaded public route (for example `/machines`) and confirm title/description/canonical are route-specific before client-side JS executes
- [ ] View page source on `/machines/commercial-robotic-machine` and confirm the `#root` contains rendered body HTML, the H1 text is present, and there are no `/src/assets/` image URLs
- [ ] View page source on `/machines/commercial-robotic-machine` and confirm quote-only JSON-LD includes matching `BreadcrumbList` and `FAQPage` nodes without an ineligible `Product`, `Offer`, or public price
- [ ] View page source on `/supplies` and confirm JSON-LD includes Product/Offer data only for direct-price supplies (`$10/kg` sugar and `$130/box` sticks)
- [ ] View page source on a direct-loaded private route (for example `/portal`) and confirm robots is `noindex`
- [ ] `https://www.bloomjoyusa.com/login`, `/reset-password`, `/portal*`, and `/admin*` redirect to `https://app.bloomjoyusa.com/...`
- [ ] `https://app.bloomjoyusa.com/` plus public marketing/storefront paths redirect back to `https://www.bloomjoyusa.com/...`
- [ ] Preview/production header check: representative public, `/login`, `/portal`, and `/admin` responses include `Content-Security-Policy`, `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `Strict-Transport-Security`
- [ ] CSP smoke check: Supabase auth/storage/Edge Function requests, Google sign-in, Stripe checkout/customer-portal redirects, Vimeo training embeds, Google Fonts, and analytics hooks load without browser CSP violations
- [ ] Production/preview asset check: JS files referenced by `/admin`, `/admin/access`, `/admin/reporting`, and `/admin/partnerships` return `application/javascript`, and a bogus `/assets/__missing-admin-chunk__.js` returns `404 text/plain` instead of the SPA fallback page
- [ ] Stale route chunk recovery check: simulate one route-level JS chunk load failure, confirm the app performs one automatic reload, then confirm a repeated failure shows the app-update refresh fallback instead of a blank page
- [ ] `robots.txt` is reachable and includes a sitemap reference
- [ ] `sitemap.xml` is reachable, lists core public routes plus public Business Playbook article routes, includes `lastmod`, and includes image sitemap entries for key machine/supplies/about/playbook URLs
- [ ] Sitemap `lastmod` values reflect versioned route/article updates rather than one build-wide date; adding/removing a public route requires an intentional route-count regression update
- [ ] After `npm run build`, run `node scripts/validate-public-route-discovery.mjs`; all 12 Search Console baseline exclusions have rendered H1/body content, exact canonical/indexable robots, sitemap freshness, crawlable incoming links, and no private/noncanonical sitemap leakage
- [ ] `/about` main content links to the Commercial Machine and launch guide; the Commercial page links to the venue-owner pitch; the indexed ROI/payback guide links to business-setup basics
- [ ] At `320x800` and desktop widths, the revised About decision panel and Commercial planning links remain readable, keyboard reachable, and free of horizontal overflow
- [ ] Mini and Micro Product JSON-LD Offers match their visible USD prices and canonical page URLs; Commercial remains quote-only with no Product rich-result node, Offer, or public price in structured data
- [ ] Machine Product/Offer JSON-LD does not add ratings, reviews, availability, inventory, shipping, returns, financing, or other unsupported commerce claims
- [ ] Apex host (`https://bloomjoyusa.com`) redirects to canonical host (`https://www.bloomjoyusa.com/`) with permanent redirect behavior
- [ ] Legacy paths (`/products`, `/products/mini`, `/products/micro`, `/products/commercial-robotic-machine`) return permanent redirects to `/machines*`
- [ ] No console errors on home page load
- [ ] Mobile header/nav works (basic)
- [ ] Public machine and commercial-machine copy does not imply Bloomjoy offers buyer financing, down payments, installment plans, or franchise packages; payment language clearly refers to customer payment acceptance/integrations or quote review
- [ ] `/machines` has no horizontal page overflow at `360x800`, `390x844`, or `414x896`; the buyer comparison uses readable mobile cards, and the public header switches to the mobile menu at `768x1024`

## Public site
- [ ] Home loads and key CTAs navigate correctly
- [ ] Home machine cards show correct model images (Commercial, Mini, Micro) without awkward clipping
- [ ] Machine naming is consistent as `Commercial Machine`, `Mini Machine`, and `Micro Machine` on Home, Machines, Contact, and footer links
- [ ] `/solutions/food-trucks` direct-loads with the approved audience, Mini-first evaluation path, space/total-load/service-flow constraint, a Mini product-path action, and a distinct Commercial-only quote action visible in the first viewport
- [ ] Food-truck solution model facts match current Mini, Commercial, and Micro product pages; no copy claims generator compatibility, vehicle mounting/securing, transport orientation, ventilation, outdoor/weather approval, permit approval, availability, delivery, revenue, ROI, payback, or margin
- [ ] Food-truck solution visibly includes installed, adjacent-station, and catering operating patterns plus meaningful “When this is not a fit” stop conditions
- [ ] Food-truck FAQs render visibly and match FAQ structured data; no review, rating, testimonial, customer logo, or proof placeholder appears when approved proof is unavailable
- [ ] `/resources/business-playbook/food-truck-mobile-setup-guide` direct-loads with unique metadata, visible review/source posture, official source links, model-specific caveats, and working links back to the solution, machine pages, planners, quote flow, and existing event guide
- [ ] Setup checklist covers measured space, complete electrical load, approved power, load-in, transport/securing questions, environment, supply storage, cleaning/reset, service flow, and local review; checked state is announced as reviewed rather than approved
- [ ] Setup checklist reset, copy, and print controls work by keyboard; refresh/direct load safely returns to an incomplete non-persisted state and no checklist value enters the URL or analytics
- [ ] `/resources/business-playbook/mobile-setup-fit-checker` direct-loads with unique canonical metadata, visible no-approval posture, eight labeled categorical question groups, an incomplete no-state result, and links to the solution and setup guide
- [ ] The fully reviewed Mini/adjacent fixture produces `Likely fit to explore`, links to `/machines/mini`, retains the manufacturer/professional/local decision boundary, and offers a distinct Commercial-only quote comparison
- [ ] The open Commercial/installed fixture produces `Needs confirmation`, names every unresolved category that drove the result, and never implies definitive compatibility or approval
- [ ] Known no-fit space, generator-certification dependence, Mini plus automatic-stick requirement, guaranteed-throughput dependence, improvised transport/securing, and Bloomjoy-as-permit-authority fixtures produce `Not currently supported` and expose no quote action
- [ ] A fully answered Micro fixture remains `Needs confirmation` and explicitly names unpublished dimensions, weight, power, throughput, and mobile compatibility as unresolved rather than inventing a likely fit
- [ ] Missing answers remain `Incomplete setup screen`; no result band is inferred until all eight categories are answered, and contradictory inputs fail closed with the relevant driver shown
- [ ] Checker product, setup-guide, and quote actions record bounded start/completion/result-band/next-action events with no exact setup values, PII, free text, financial assumptions, or arbitrary source data
- [ ] Checker quote URLs contain only `type=quote`, `interest=commercial`, canonical `source`, `use=mobile-food`, `mobile_fit`, `mobile_machine`, `mobile_placement`, and allowlisted `mobile_open`; malformed values and wrong-source context are discarded on Contact
- [ ] Contact visibly confirms the checker result band, machine signal, placement category, and open-question categories; it states that the context is not approval or quote interest and keeps the form fixed to Commercial
- [ ] Checker copy and print summaries contain categorical answers and decision boundaries only; reset moves focus to the first question, announces the reset, clears every answer, and does not retain state on refresh/direct navigation
- [ ] Every checker option works by keyboard and exposes selected state; live results are announced, focus styles remain visible, reduced-motion treatment is present, and 44px controls remain readable
- [ ] `/resources/business-playbook/food-truck-dessert-add-ons` direct-loads with unique canonical metadata, the exact operator-comparison H1, five dessert categories, thirteen complete criterion cards, visible methodology, and authoritative source links
- [ ] The comparison remains usable at 320px, 390px, 768px, and 1440px without a horizontal table or page overflow; posture badges, category names, summaries, source cards, and CTA labels wrap without clipping
- [ ] Cotton candy shows potential advantages, confirmation needs, and heavier obligations; weather and transport remain explicit tradeoffs, and the conclusion names likely fit, uncertain fit, and another-dessert-fit paths
- [ ] Cookies/brownies, churros/fried desserts, ice cream/frozen desserts, and fresh fruit each expose at least two different postures rather than acting as a straw-man comparison
- [ ] Visible copy and structured data contain no unsupported price, profit, food-cost, margin, payback, permit, demand, guaranteed-throughput, service-speed, generator, mounting, securing, outdoor-use, or local-acceptance claim
- [ ] Source links identify Bloomjoy product facts, the FDA Food Code, NFPA food-truck fire questions, a jurisdiction-specific California example, USDA frozen-food guidance, and FDA fresh-cut produce guidance; local adoption and final-owner boundaries remain visible
- [ ] Comparison links reach the food-truck solution, mobile setup guide, fit checker, Mini, Commercial, Micro, Machine Fit planner, Payback planner, existing event guide, and fixed Commercial quote path
- [ ] Quote URL contains only `type=quote`, `interest=commercial`, canonical `source`, and `use=mobile-food`; Contact displays the canonical source label and does not receive arbitrary query, setup, PII, or financial context
- [ ] Resources, Business Playbook, and the food-truck solution expose a descriptive comparison link without adding a keyword-variant or sitewide doorway pattern
- [ ] View and CTA events use only bounded route, slug, category, surface, CTA, and destination metadata; run `npm run dessert-comparison:check` and `npm run seo:check`
- [ ] `/resources/business-playbook/food-truck-catering-dessert-menu` direct-loads with unique canonical metadata, the exact established-operator H1, ten complete scope cards, two planning structures, three responsibility lanes, a reusable outline, and a machine-fit next step
- [ ] The guide visibly starts with an established operation and links readers seeking startup, initial booking, equipment-selection, or event-day formation advice to the existing Mini/Micro event-business guide
- [ ] Every package/template example is labeled as a planning structure or blank template—not a Bloomjoy offer, quote, contract, policy, serving promise, price recommendation, earnings claim, insurance interpretation, or legal recommendation
- [ ] Service window, planning estimate, menu, staffing, travel/load-in, power/setup ownership, payment/deposit posture, weather, cancellation/reschedule, and insurance/COI/buyer paperwork each expose a buyer question, operator decision, and explicit boundary
- [ ] Fixed-event and per-serving structures recommend no price, percentage, fee, deposit, refundability rule, serving count, throughput, booking, revenue, margin, payback, or local-acceptance outcome
- [ ] The static `Copy package outline` action copies only published placeholder text, announces success/failure with `aria-live`, and sends no outline content, clipboard value, operator input, PII, or financial data into analytics
- [ ] The guide links to the dessert comparison, food-truck solution, setup guide, fit checker, Mini, Micro, Payback planner, existing event guide, and fixed Commercial quote; Resources, Business Playbook, comparison, and solution pages link back contextually
- [ ] Quote URL contains only `type=quote`, `interest=commercial`, canonical `source`, and `use=mobile-food`; Contact displays the catering package guide source and receives no template, setup, guest, term, PII, or financial context
- [ ] At 320px, 390px, 768px, and 1440px, cards, template fields, CTA labels, disclaimers, and responsibility lanes wrap without clipping, horizontal page overflow, or sub-44px page-specific controls
- [ ] Direct prerendered HTML contains the exact H1 and route chunk; sitemap/Article/BreadcrumbList data are current; run `npm run catering-menu:check`, `npm run seo:check`, and the standard repository verification suite
- [ ] Mobile quote CTAs contain only allowlisted `type=quote`, `interest=commercial`, canonical `source`, and `use=mobile-food`; Mini and Micro remain on payment-first product paths, and no free-form setup, financial, or contact value appears in the URL
- [ ] Resources, Business Playbook, Machines overview, and Mini page expose descriptive mobile-operator links without keyword-stuffed sitewide repetition
- [ ] All five mobile-operator routes are prerendered, canonical, in `sitemap.xml` with a defensible `2026-08-10` lastmod, load their route modules before app hydration, and are served by the static Vercel rewrites
- [ ] At 320px, 390px, 768px, and 1440px, all three mobile routes have no horizontal page overflow, keep 44px controls, preserve readable cards/results, and leave the primary CTA clear
- [ ] Run `npm run mobile-content:check`, `npm run mobile-fit-checker:check`, and `npm run seo:check`; confirm route, claim, decision-rule, context, structured-data, source, no-proof, internal-link, and responsive guardrails pass
- [ ] Product pages load (Full, Micro, Mini)
- [ ] Home, `/machines`, and Mini detail consistently show Mini as `Coming Soon` and expose no quote/procurement checkout path
- [ ] Machine detail pages support image gallery selection (thumbnail click changes main image)
- [ ] Commercial page shows native specs content (not image-only text for core specs)
- [ ] Commercial page "Open full size" actions open in-page modal and can be closed to return to the same screen
- [ ] Commercial machine sales copy/quote CTA clearly shows wrap options and marks custom wrap as Commercial-only with offline design-team handoff
- [ ] Home, `/machines`, Commercial detail, comparison, and payback-planner surfaces do not show a Commercial Machine price; they direct buyers to request a quote
- [ ] Mini and Micro machine pages do not advertise custom wrap as an available option
- [ ] Mini page shows the expected `$4,000` baseline as coming-soon planning context, with a disabled `Coming Soon` CTA and no order form
- [ ] Mini page shows readable specs, `~90 seconds per candy`, `~40 candies/hour` planning guidance, staffed-throughput estimates, public proof video clips with controls/posters, compact/hospitality fit notes, serving-cost assumptions, and no ROI/payback guarantees
- [ ] Micro machine page shows the updated target/list price (`$2,200`)
- [ ] With `VITE_MICRO_CHECKOUT_ENABLED` unset/false, the Micro page keeps the `$2,200` planning price but shows a disabled `Checkout Pending` CTA, has no quote/request form, and a stale Micro cart item blocks checkout until removed
- [ ] With server-only `MICRO_CHECKOUT_ENABLED` unset/false, a direct Micro payload to `stripe-sugar-checkout` is rejected even if Stripe Micro Price and Shipping Rate IDs exist
- [ ] After `#717` is resolved and both `VITE_MICRO_CHECKOUT_ENABLED=true` and server-only `MICRO_CHECKOUT_ENABLED=true`, the Micro page primary CTA adds the `$2,200` Micro Machine to the cart and opens `/cart`
- [ ] Micro checkout uses only the server-configured Stripe Price and Shipping Rate IDs, collects phone/billing/shipping details, and fails closed when either ID is missing
- [ ] `/supplies` product images render professional white-background product shots without black background artifacts or awkward clipping on desktop and mobile
- [ ] `/supplies` defaults to Sugar ordering; `/supplies?order=sugar`, `/supplies?order=sticks`, and `/supplies?order=custom` direct-load with the matching selected flow
- [ ] Supplies order chooser switches between Sugar, Bloomjoy Branded Sticks, and Custom Sticks without showing every order flow at once
- [ ] Sugar flow supports one-click equal split across white/blue/orange/red and allows custom per-color override behind the "Customize Color Mix" control
- [ ] Sugar flow quick presets show `240 KG`, `400 KG`, and `800 KG`, with `400 KG` as the default target
- [ ] Sugar flow shows public pricing at `$10/kg` for signed-out or non-Plus users
- [ ] Sugar flow shows Bloomjoy Plus pricing at `$8/kg` only for users whose `subscriptions.status` is `active` or `trialing`
- [ ] Sugar flow handles high-volume setup (e.g., 500KG+) without repetitive click controls
- [ ] Sticks ordering on `/supplies?order=sticks` allows direct typed quantity input (not only +/- controls)
- [ ] Sticks ordering clearly supports Bloomjoy branded paper sticks and custom paper sticks at `$130/box` with `2000 pieces/box`
- [ ] Bloomjoy branded sticks flow requires machine size and delivery location type before direct checkout, for every allowed quantity from 1-1000 boxes
- [ ] Bloomjoy branded sticks checkout charges the server-enforced business/residential shipping rule for 1-4 boxes and free shipping for 5+ boxes
- [ ] Custom sticks page is visibly unavailable and has no unpaid artwork/procurement request form until plate fee, shipping, tax, payment, and proofing are integrated
- [ ] Shared cart accepts sugar and, only when the public Micro checkout flag is enabled, Micro; legacy/unknown/unavailable items cannot start checkout
- [ ] Cart has no horizontal overflow on mobile viewports (`360x800`, `390x844`, `414x896`)
- [ ] Cart line-item title, quantity controls, price, and remove action stack cleanly on mobile
- [ ] Plus page: pricing and boundaries are visible and clear
- [ ] Resources page shows Bloomjoy Plus teaser content for locked downloads, including Plus-ready worksheet/tool previews and reporting access where available
- [ ] Plus page shows the Business Playbook worksheet/tool preview library and keeps actual downloads positioned as Plus/operator assets rather than public static files
- [ ] Resources page leads with the Bloomjoy Business Playbook, shows visual article cards, and still exposes FAQ and Support Boundaries anchors
- [ ] `/resources/business-playbook` direct-loads and shows category navigation plus all public playbook guides
- [ ] `/resources/business-playbook/planner` direct-loads and shows the Machine Fit + Startup Budget Planner with no login, no data collection, and no ROI/profit claims
- [ ] Home hero and `/machines` expose a descriptive machine-fit planner action without hiding the primary Commercial or machine-detail path; Commercial, Mini, and Micro detail pages each expose a contextual fit-planner link
- [ ] Business Playbook planner completion offers a relevant machine-detail action plus a separately labeled Commercial-only quote action; Mini/Micro signals never become quote interest
- [ ] Planner-to-quote URLs contain only `type=quote`, `interest=commercial`, canonical `source`, and allowlisted `planner_machine`, `planner_path`, `planner_budget`, and `planner_open` categories—never exact budget, revenue, margin, volume, ROI, payback, PII, or free text
- [ ] Contact visibly confirms the planner machine signal, intended path, budget-completeness band, and open-question categories, states that no exact financial input transferred, and includes only the categorical summary in the structured lead message
- [ ] Unknown/malformed planner values and planner context from a non-planner source are discarded; direct load, refresh, back navigation, and no-answer planner state remain safe
- [ ] Planner analytics cover view/start, meaningful completion, result-to-product, and result-to-quote with machine/budget/open-question bands only; no exact financial values enter event payloads
- [ ] At 320px, 390px, 768px, and 1440px, Home/Machines planner discovery, planner result actions, and Contact planner summary have no horizontal overflow and preserve the primary action hierarchy
- [ ] Run `npm run planner-context:check`; confirm discovery, allowlist, Commercial-only policy, malformed context, lead-message privacy, and bounded analytics assertions pass
- [ ] `/resources/business-playbook/payback-planner` direct-loads and shows the Payback Scenario Planner with Commercial, Mini, and Micro paths, landed-cost fields for import fees/tariffs/shipping/duties/brokerage/accessories/supplies, fictional presets that are not loaded by default, and no earnings or payback promises
- [ ] Payback Scenario Planner math handles Commercial foot traffic/family-presence/capacity/rent/revenue share, Mini/Micro event attendance/competition/event costs, and zero or negative contribution scenarios without showing `NaN`, `Infinity`, or guaranteed-result language
- [ ] Payback Scenario Planner routes Commercial to quote, Mini to coming-soon status, and Micro to its availability-aware purchase/status page, and logs only scenario labels, bands, and booleans rather than exact dollar or sales inputs
- [ ] ROI/payback and revenue-share/rent article routes direct-load, show Article JSON-LD, source links, useful tables/scripts/checklists, and backlinks to the planner and related playbook content
- [ ] Business Playbook article routes direct-load, show a real Bloomjoy image, useful visual blocks (tables/checklists/scorecards/scripts), source links, related articles, and quote/machine CTAs
- [ ] Business Playbook article routes are readable on mobile widths (`360x800`, `390x844`, `414x896`) with no clipped tables or horizontal page overflow
- [ ] Commercial, Mini, Micro, Machines listing, Plus, and Contact success states link to relevant Business Playbook guides
- [ ] Business Playbook funnel clicks emit expected local `[Analytics]` events without PII: `click_resources_playbook_card`, `click_business_playbook_cta`, `click_plus_preview_resource`, `click_buyer_flow_playbook_link`, and Playbook-originated contact submissions emit `submit_contact_from_playbook`
- [ ] `/resources#faq` opens to the FAQ section, shows startup-cost guidance without exact all-in-cost/ROI/profit claims, keeps the quote/contact path clear on desktop and mobile, and `/resources` page source includes matching FAQPage JSON-LD
- [ ] `/machines`, `/resources`, `/plus`, and `/contact` show primary content without excessive dead space on desktop and mobile
- [ ] Footer legal links open `/privacy`, `/terms`, and `/billing-cancellation`
- [ ] Footer support links navigate to valid Resources anchors (`/resources#faq` and `/resources#support-boundaries`)
- [ ] Billing & cancellation page explains Stripe portal cancellation path and end-of-period effect
- [ ] Contact/Quote form submits (and confirmation is shown)
- [ ] Contact form labels are clickable, and all visible fields have associated labels
- [ ] Plain `/contact` opens the general-contact journey; `/contact?type=quote` opens the focused Commercial Machine fit/quote request with accurate no-SLA/no-price/no-availability/no-ROI expectation copy
- [ ] Commercial, malformed, and missing quote interest resolve to fixed Commercial context; safe Mini/Micro interest is not submitted as quote context and instead shows a purchase-path notice/link; no contact or qualification value appears in the URL
- [ ] `/contact?type=quote&use=mobile-food` preselects “Mobile food facility or food truck”; unknown `use` values are ignored and never become visible or submitted text
- [ ] Quote validation identifies and focuses an accessible error summary, associates field errors, preserves valid entries, and works by keyboard at 320px through desktop widths
- [ ] Quote submission stores intended setting, service region, timeline, and optional organization/readiness/details in the structured lead message; only name, email, setting, region, and timeline are required
- [ ] A server/network failure leaves the entered quote intact and Retry reuses the client submission token; rapid duplicate clicks and a retry after an uncertain response produce one lead row and at most one notification dispatch
- [ ] Quote success confirms receipt, explains the next review step without an SLA, summarizes only machine/setting/timing, and offers `info@bloomjoyusa.com` as the alternative contact path without putting PII in the URL
- [ ] General inquiry, demo, procurement, existing anti-abuse throttles, email/WeCom notification routing, and Playbook-source behavior still pass after the quote-specific UI changes
- [ ] `lead_form_start`, `lead_form_submit`, and `lead_form_error` use only controlled inquiry type, route, and normalized source context; no name, email, organization, region, message, or other form value reaches analytics
- [ ] Run `npm run quote-intake:check` and confirm quote mode, safe context, dedupe/retry, accessibility, CTA routing, and analytics payload guardrails pass
- [ ] Run a production build/preview, load a query-based quote URL directly, and confirm the prerendered general-contact HTML hydrates before query context is applied with no React hydration errors
- [ ] Quote flow preserves machine context (for example, Commercial CTA preselects "Machine of Interest" on `/contact`)
- [ ] The quote journey always submits `Commercial Machine`; Mini/Micro query context is visibly returned to its product path and cannot create an order, reserve inventory, claim availability, or bypass payment-first checkout
- [ ] Mobile icon-only cart/menu controls have accessible names
- [ ] Product-gallery thumbnail buttons are keyboard operable and announce selected image state
- [ ] Contact/Quote submission creates a `lead_submissions` row in Supabase with expected type/email
- [ ] Quote submissions send internal notification email to Ethan/Ian and any configured additional recipients with full request summary (name/email/source/type/message)
- [ ] Quote submissions send a WeCom internal alert to configured `WECOM_ALERT_TO_USERIDS` recipients
- [ ] Procurement submissions send internal notification email to Ethan/Ian and any configured additional recipients with fulfillment next steps
- [ ] Public intake anti-abuse: repeated direct POSTs with the same IP/email are throttled, repeated identical payloads dedupe server-side, and quote/procurement notifications stop after the configured quota while normal Contact and procurement requests still return success
- [ ] Run `npm run leads:validate-attribution`; the session-only schema, exact server allowlist, migration boundary, notification formatting, and adversarial fixtures pass
- [ ] In a fresh tab, a direct `/contact` journey records a direct first touch; campaign URLs retain only the five approved UTM fields; organic/referral journeys retain only the referrer hostname; no attribution is written to cookies or `localStorage`
- [ ] Internal quote CTAs and planner-to-quote journeys preserve only pathname, machine interest, categorical planner recommendation, and planner band; payback-planner attribution contains no exact price, cost, sales, revenue, margin, or payback inputs
- [ ] Malformed attribution, missing attribution, arbitrary query parameters, click IDs, email-like values, phone-like values, full referrer URLs, and oversized values are ignored without blocking a valid lead submission
- [ ] The saved `lead_submissions.attribution` JSON and internal notification show the same sanitized first touch, last touch, and conversion summary; retrying or deduplicating an older lead with empty attribution does not fail notification handling
- [ ] Direct, campaign, referral, and planner journeys pass on desktop and `320x800` without horizontal overflow; closing the tab ends the attribution session
- [ ] `/machines/mini` SEO/meta copy no longer references waitlist or upcoming launch language

## Auth / portal
- [ ] Login flow works (Email Code or configured method)
- [ ] Run `npm run portal-bootstrap:uat -- --app-url <local-or-preview-url>` and confirm the permission-neutral shell appears within 2 seconds, useful dashboard content and its data-ready mark both appear within 3 seconds under the normal deterministic fixture, and screenshots are written to `output/playwright`.
- [ ] With entitlement/access responses delayed, `/portal` and `/admin` render the branded structural shell without generic `Loading...`, baseline upsells, access-sensitive navigation, false zero states, or unauthorized content.
- [ ] Initial session hydration calls Technician resolution and each access-context RPC once; repeated `SIGNED_IN` and `TOKEN_REFRESHED` events do not restart bootstrap or replace a ready page with loading UI.
- [ ] Pending Technician first login resolves entitlements before access reads, then exposes assigned Training and Reporting access without a second login.
- [ ] Signing out or changing users while access is loading invalidates the earlier request; a stale response cannot restore the prior user or permissions.
- [ ] Login, authenticated portal, and Admin Console primary buttons, selected controls, links, and focus rings use the app-scoped interaction palette; normal text meets WCAG AA 4.5:1 contrast, focus indicators meet 3:1, and public-site colors remain unchanged
- [ ] Run `npm run portal:validate-contrast` and confirm the bright authenticated action fill, foreground, hover, active, deeper link/selection ink, and focus ring pass in light and dark token states while public primary/action tokens remain unchanged
- [ ] Reporting `Export polished PDF` and representative shared primary actions use bright Bloomjoy pink with dark readable text, a pink app hover shadow, and no burgundy/red or orange action treatment
- [ ] Canonical Bloomjoy Hub login lives at `https://app.bloomjoyusa.com/login`
- [ ] Temporary alias `https://app.bloomjoyusa.com/login/operator` resolves to `/login`
- [ ] On mobile `/login`, the sign-in form appears before the operator-feature highlights, the top app header stays compact without an extra context row pushing content below the fold, and visible auth/header/menu controls have touch-friendly hit areas
- [ ] Login errors show actionable copy (for example: invalid/expired code, send rate-limit)
- [ ] Language selector on `/login` switches between English and Simplified Chinese and the selected language persists after refresh on desktop
- [ ] `/login` renders exactly one visible language selector on desktop and `390x844`, including while the mobile navigation drawer is open; both language targets are at least `44x44` CSS px with a visible keyboard focus ring
- [ ] Email Code message is received in the configured inbox; its stable Bloomjoy button contains no token and automated prefetch causes no `/auth/v1/verify` request
- [ ] User submits the newest 6-digit Email Code and login completes; invalid, expired, consumed, and superseded codes offer a fresh-code recovery path
- [ ] Run `npm run auth:activation:uat -- --app-url http://127.0.0.1:8081` against `npm run dev:uat`; confirm invite, fail-closed reload, recovery, manual-admin-invite fallback, and temporary-session assertions all pass with synthetic data
- [ ] Password sign-in works for an existing email/password user
- [ ] Forgot-password flow sends a 6-digit recovery code and `/reset-password` verifies it before updating the password; no token appears in URL/history, and mobile controls have no horizontal overflow
- [ ] Google sign-in works when Supabase Google provider is enabled
- [ ] Google sign-in returns to the app host `/portal` route (for production: `https://app.bloomjoyusa.com/portal`, not `http://localhost:3000`)
- [ ] On Vercel preview UAT, Google or Email Code sign-in returns to the same preview host at `/portal` instead of `https://app.bloomjoyusa.com/portal`; if it falls back to production, confirm Supabase Additional Redirect URLs include `https://*-snapcase.vercel.app/**`
- [ ] Google sign-in button follows official GIS rendering when `VITE_GOOGLE_CLIENT_ID` is configured locally
- [ ] For auth launch hardening, Google consent screen shows Bloomjoy branding (name/logo/support email)
- [ ] For auth launch hardening, Google callback host uses `auth.bloomjoyusa.com` (not `<project-ref>.supabase.co`)
- [ ] DB/RPC security smoke for issue `#290`: as a non-admin authenticated session, direct calls fail with permission denied for legacy actor RPCs (`create_customer_account_invite_as_actor`, `record_customer_account_invite_delivery_as_actor`, `revoke_customer_account_access_as_actor`) and arbitrary-user helper RPCs (`get_portal_access_context_for_user`, `get_active_customer_account_id`, `get_active_customer_account_role`, `get_portal_access_tier_for_user`, `can_manage_customer_account_operators_for_user`, `can_access_plus_portal_for_user`, `has_active_customer_account_membership`, `is_partner_on_customer_account`) when passing any caller-supplied actor/user UUID; `get_my_portal_access_context` still returns only the current session context.

### Admin permission boundaries
- [ ] Run `npm run auth:validate-admin-boundaries`; when local persona JWTs are available, also run `ADMIN_BOUNDARY_RUN_LIVE=true npm run auth:validate-admin-boundaries`.
- [ ] Live admin-boundary validation has these required env vars set locally: `SUPABASE_URL` or `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`, `ADMIN_BOUNDARY_SCOPED_ADMIN_JWT`, `ADMIN_BOUNDARY_CORPORATE_PARTNER_JWT`, `ADMIN_BOUNDARY_TECHNICIAN_JWT`, `ADMIN_BOUNDARY_REPORTING_USER_JWT`, `ADMIN_BOUNDARY_BASELINE_JWT`, `ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_EMAIL`, `ADMIN_BOUNDARY_SUPER_ADMIN_TARGET_USER_ID`, `ADMIN_BOUNDARY_REPORTING_TARGET_EMAIL`, `ADMIN_BOUNDARY_TECHNICIAN_TARGET_EMAIL`, `ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID`, `ADMIN_BOUNDARY_CORPORATE_PARTNER_MANAGEABLE_TECHNICIAN_GRANT_ID`, and `ADMIN_BOUNDARY_CORPORATE_PARTNER_STALE_TECHNICIAN_GRANT_ID`.
- [ ] Super Admin can open `/admin/access`, search a person, and see Plus Customer, Corporate Partner, Technician, Scoped Admin, Super Admin, manual reporting, and Activity cards; grant/update/revoke actions require a reason and show clear success or error feedback.
- [ ] Super Admin non-machine admin workflows are readable and operable at `360x800`, `390x844`, `414x896`, `768x1024`, and `1024x768`: `/admin/orders`, `/admin/support`, `/admin/access`, `/admin/audit`, `/admin/partner-records`, `/admin/partnerships`, and `/admin/reporting` show no page-level horizontal overflow, keep touch controls at least 44px tall, and use cards or intentional contained scrolling for dense data.
- [ ] Scoped Admin opens `/admin` and lands on the first allowed admin surface; admin navigation shows only allowed scoped destinations such as Access and, when granted, Partnerships. `/admin/reporting`, global roles, and unsupported admin tools do not expose global controls.
- [ ] Scoped Admin cannot grant, revoke, or edit Super Admin access in the UI or by direct RPC (`admin_grant_super_admin_by_email`, `admin_revoke_super_admin`) and cannot grant/revoke Scoped Admin grants by direct RPC.
- [ ] Scoped Admin `/admin/access` shows the focused Technician workflow and hides unsupported Plus Customer, Corporate Partner, Super Admin, legacy tax-rate, and raw reporting-matrix controls across the page.
- [ ] Scoped Admin can open `/admin/partnerships` when the Partnerships admin surface is allowed, create/archive partnerships only for machines fully inside their current scoped grant, and direct out-of-scope or partially covered partnership RPC attempts fail with a scoped-access error.
- [ ] Scoped Admin can save manual reporting access only for assigned machines; direct `admin_set_user_machine_reporting_access` with any out-of-scope machine fails and does not revoke out-of-scope or derived Technician/Corporate Partner grants.
- [ ] Scoped Admin can add a Technician from `/admin/access` only when at least one selected machine is inside the active scoped-admin grant; the save sends the Technician invite and records scoped-admin sponsorship.
- [ ] Scoped Admin direct RPC attempts for zero-machine Technician grants, out-of-scope Technician grants, out-of-scope updates, or out-of-scope revokes fail with scoped-machine access errors.
- [ ] Permission-granting UAT commands pass locally against the mocked app: `npm run scoped-admin-technicians:validate-uat -- --app-url http://127.0.0.1:8081` and `npm run scoped-partnerships:validate-uat -- --app-url http://127.0.0.1:8081`; attach screenshots from `output/playwright`.
- [ ] Scoped Admins can open `/portal/account` for safe profile/settings access, but Account Settings links them to Admin Access for Technician work and does not loop them through `/portal/team`.
- [ ] `/portal/team` shows a clear unavailable/locked state for Scoped Admins who do not also have Plus Customer or Corporate Partner Technician-management authority.
- [ ] Corporate Partner sees only active portal-enabled partnership reporting and derived Technician management scope; direct admin RPCs fail, and Technician grant/update/revoke RPCs fail for out-of-scope or stale partner machine scope.
- [ ] Corporate Partner live RPC evidence shows `update_technician_machines` denies adding `ADMIN_BOUNDARY_OUT_OF_SCOPE_MACHINE_ID` to `ADMIN_BOUNDARY_CORPORATE_PARTNER_MANAGEABLE_TECHNICIAN_GRANT_ID`, `revoke_technician_access` denies `ADMIN_BOUNDARY_CORPORATE_PARTNER_STALE_TECHNICIAN_GRANT_ID`, and `get_my_technician_grants` returns HTTP 200 with the manageable grant present and the stale/out-of-scope grant absent; `401`, `404`, `PGRST202`, malformed UUID/body errors, missing fixture rows, or broad non-OK responses do not count as passing authorization evidence.
- [ ] Technician can open training and assigned-machine reporting only; Technician does not see account-owner tools, Technician management controls, Plus discounts, partner dashboard controls, or `/admin`.
- [ ] Reporting User can open `/portal/reports` only for explicitly assigned machines and cannot open `/admin` or manage Technician grants.
- [ ] Baseline authenticated user cannot open `/admin`, `/portal/training`, `/portal/reports`, Plus benefits, partner dashboard, or Technician management unless separately granted.

- [ ] Logged-out visit to `/portal` redirects to login
- [ ] App-shell routes (`/login`, `/reset-password`, `/portal*`, `/admin*`) do not render the public sales navbar or public footer
- [ ] Dashboard renders exactly one persona-relevant primary action, no more than two real needs-attention rows, a compact current-work summary, and no more than three useful links without rebuilding the sidebar as a card catalog.
- [ ] Baseline, Plus, training-only, assigned-reporting Technician, Corporate Partner, timekeeper, Super Admin, and orders-scoped Admin fixtures land on the expected primary destination without exposing unauthorized account, Team, reporting, or admin concepts.
- [ ] Dashboard loading does not show a fallback action or premature zero/caught-up state while profile-derived timekeeping access is unresolved; an unavailable current-work query keeps known capability-based access usable, shows plain-language Retry, and recovers after a successful retry; completed setup/training renders an explicit caught-up state.
- [ ] Device-local onboarding checklist progress is labeled as device-local; training completion is shown only when progress records exist, and fallback training content is not called a live recommendation.
- [ ] Portal navigation does not require horizontal scrolling on common mobile viewports (`360x800`, `390x844`, `414x896`)
- [ ] Technician Time (`/portal/time`) loads for every active Technician as a lightweight weekly calendar and shows actual time plus calculated one-hour shift units without approval states.
- [ ] Add Time allows only machines effective in the Technician's assignment scope, accepts actual work date/start/end, and previews the independently rounded machine shift count before save.
- [ ] One machine-specific entry rounds 1-60 minutes to one shift, 61-120 minutes to two shifts, and so on; separate machine entries round independently.
- [ ] Technician Time blocks end-before-start, future work, exact duplicates, and any overlapping time for the same Technician, including overlaps across different machines.
- [ ] Technician Time interprets start/end values in the selected machine location timezone: at the same instant, a completed `3:29 p.m.` Eastern entry is accepted while a genuinely future local end remains blocked; switching machines recalculates the preview and overlap check in the newly selected location timezone.
- [ ] Technician edit/delete controls work through 11:59 p.m. Pacific on the fourth day after month-end and fail closed at the start of day five; December time therefore locks to the Technician at the start of January 5.
- [ ] Technician Time empty state explains that assigned machines are required before time can be entered, without exposing payroll-setup jargon.
- [ ] Time Report (`/portal/time-review`) appears only for machine-manager/payout-management authority and returns time only for machines the current manager may manage.
- [ ] The Time Report defaults to the current month, supports another month, filters by Technician and machine, and shows actual time, calculated shifts, per-Technician totals, and machine breakdowns without unrelated account data.
- [ ] The manager Time Report contains no approve, reject, return, or correction-request workflow.
- [ ] A Machine Manager may edit an in-scope entry before or after the Technician lock date without supplying a written reason; the database retains before/after audit history.
- [ ] Out-of-scope users and out-of-scope time-entry IDs fail closed for manager reads and edits, and browser direct table writes cannot bypass the audited timekeeping RPCs.
- [ ] Worker and manager timekeeping pages have no horizontal page overflow at `390x844` across loading, load-error, setup/no-access, empty, mutation-failure, weekly-calendar, manager-edit, and populated-report states, and remain usable at desktop width.
- [ ] Multi-profile and machine controls have associated visible labels; repeated Edit and Delete controls announce the Technician, machine, date, and time context.

### Technician Pay Report (legacy validator: Admin Technician Pay Review)
- [ ] Admin or scoped Technician Pay manager can open `/admin/payouts`; users without Technician Pay admin access see the existing admin access-required state.
- [ ] From `/admin/payouts`, an account pay manager can open **Set up Technician**, see the compact invitation prerequisite, choose the person/start date/machines, and enter the rate and commission for each selected machine in one form.
- [ ] Initial Technician setup saves invitation email as the contact email plus optional phone and mailing address; an authorized pay manager can view and edit those details from the Technician card, while an unrelated authenticated user cannot read them and contact values never appear in admin audit payloads.
- [ ] Editing contact details for a Technician with multiple legal-payer profiles keeps every payer-scoped profile within the manager's authority consistent.
- [ ] **Apply first machine to all** copies the first selected machine's complete rate and commission terms to every selected machine; the manager can then edit only machines that differ.
- [ ] Each machine requires pay per started hour and offers quick **No commission**, **3% after 3 months**, and **Custom commission** choices. Custom commission supports immediate, three-month, or chosen-date timing and shows the exact three-month date before activation.
- [ ] Initial Technician setup requires an already accepted invitation/sign-in, rejects missing, duplicated, or out-of-scope machines and invalid rates, and atomically commits one payer-scoped profile per legal payer plus effective machine assignments and machine pay rules with an audit record; a failure creates no partial setup.
- [ ] The initial setup dialog remains keyboard accessible, touch friendly, scrollable on a short `390x667` viewport, and keeps **Activate Timekeeping** reachable without page-level horizontal overflow.
- [ ] The monthly report groups actual time, paid shifts, applicable per-shift rate, shift earnings, commissionable sales, applicable commission rate, commission, other earnings/credits, and statement total by Technician.
- [ ] The monthly report defaults to a summary-first Technician card, keeps account/machine filters behind **More filters**, exposes one **Adjust pay** menu, and reveals machine calculations only when **View machine breakdown** is selected.
- [ ] Every Technician card exposes **Assignment dates** separately from **Adjust pay**. The assignment editor shows the exact machine and effective window, saves through the audited effective-assignment path, and confirms that pay and commission rates were not changed.
- [ ] Selecting a month before a Technician's first assignment shows **No machine assignment in [month]**, reports any known machine sales as unattributed, disables Pay Stub publication, and offers **Backdate assignment** without implying that a backdated rate changes attribution.
- [ ] The current month shows **Month in progress · Sales through [date]**, keeps calculated amounts available as an estimate, and does not present a future month-end freshness requirement as an operator error. Pay Stub publication remains disabled until the Technician edit window closes.
- [ ] A current-month Technician with a positive SnapCase commission sees imported sales and calculated commission normally with the existing data-freshness details and no SnapCase-specific warning; the month remains non-publishable under the existing month-in-progress rule.
- [ ] A finished month blocks publication only when an effective positive-commission SnapCase assignment date is missing completed payment-import coverage; completed zero-sale windows release the same blocker, while 0% and non-SnapCase assignments remain unchanged.
- [ ] A finished positive-commission SnapCase month with K card observations and no Nayax card facts keeps the existing missing-sales blocker even when K cash facts exist; partial card totals do not add an amount-matching gate.
- [ ] After backdating a machine assignment into a closed month, saving the dates automatically recalculates that month's Commissionable Sales before the dialog closes. A matching refreshed snapshot clears freshness blockers even when the machine had no sale on the final calendar day; genuinely missing snapshots or changed underlying facts still block publishing.
- [ ] The report's machine breakdown shows actual time, independently rounded shifts, commissionable sales, and commission contribution without exposing out-of-scope machines or another Technician's compensation.
- [ ] Commissionable sales come from the authoritative monthly revenue snapshot and equal machine sales minus refunds minus estimated sales tax. Tax uses the effective machine tax rate on each sale date, rounds to cents per machine/day, and is frozen with the snapshot; the source sales basis, refunds, tax, applied commission percentage, and resulting commission reconcile exactly without deducting an adjustment twice.
- [ ] Started-hour and commission rules are effective-dated by Technician and machine; a machine rule overrides the Technician default, while another machine still uses its own rule or the default. Changes do not rewrite earlier work, sales attribution, or historical Pay Stubs, and all machine lines reconcile to the Technician total.
- [ ] Refunds that cross commission-rate segments cannot make the segmented commissionable-sales basis exceed the reconciled monthly machine basis or silently overpay commission; an ambiguous allocation blocks publication instead of fabricating a result.
- [ ] **Add rate change** atomically ends the prior open-ended rate on the preceding day and creates the replacement; commission setup defaults to the Technician across assigned machines unless the manager explicitly chooses a machine override.
- [ ] An authorized manager can add or correct Technician-visible Bonus, Supply Credit, and Expense Reimbursement items without creating a pay-run approval step; recurring supply credits respect their effective dates.
- [ ] Bonus and Expense Reimbursement default to the selected month as one-time earnings, while Supply Credit clearly offers an open-ended recurring window. Opening the report automatically creates any missing month and reconciles missing or stale Commissionable Sales snapshots without exposing a manual refresh action.
- [ ] Manager corrections after the Technician cutoff recalculate the affected report without requiring a per-entry approval or edit reason.
- [ ] In Time Report, **Add missed time** lists assigned Technicians even when they have no entries in the selected month, including inactive former Technicians with a historical assignment, limits machines to effective assignments on the chosen date, and lets an authorized manager add completed time before or after cutoff.
- [ ] Manager-added missed time rejects future work, invalid Technician/machine/date scope, and overlap; a successful entry shows the normal actual duration and independently rounded paid shifts and records the responsible manager and timestamp in audit history.
- [ ] Technician and manager add/edit attempts against a voided monthly pay period fail atomically with no time-entry or audit-event row; reopening or replacing the period remains an explicit pay-manager action.
- [ ] When time changes after an issued Pay Stub was generated, a machine-only manager is told to contact an account pay manager, Pay Reports persistently shows **Regenerate Pay Stub**, and the warning clears only after a newer stub is published.
- [ ] With July and August Pay Stubs issued, a late July time change marks both statements stale. Regenerating July clears July only; August remains stale until its own successful regeneration, and a failed or queued regeneration clears neither warning.
- [ ] In the committed two-session freshness test, a time-entry transaction and Pay Stub preparation for the same Technician/calendar year serialize on one source lock; regardless of transaction start order, a change absent from the calculation leaves the issued statement stale.
- [ ] Missing required compensation rates, a missing machine tax rate on any date with sales, unresolved machine scope, stale required sales data, and other calculation blockers appear as manager exception work and prevent a knowingly incomplete Pay Stub from publishing. An explicit configured `0%` tax rate is accepted.
- [ ] A missing rate is labeled **Rate missing** or **Commission rate missing**; blocked commission and statement totals display as **Unavailable**, never as a configured `$0.00` or `0%` fact.
- [ ] Reporting and pay-stub publication do not execute payment, require proof of payment, or claim direct-deposit/tax-provider behavior.
- [ ] Run `npm run operator-payouts:validate-manager-reports-uat` against `npm run dev:uat`; review the desktop Time Report, desktop Pay Report, and mobile Pay Report screenshots in `output/playwright/manager-time-pay-reports`.

### Technician Pay Stubs (legacy validator: Technician Pay Statements)
- [ ] At the start of the fifth day after month-end, the system idempotently generates and publishes one Pay Stub for each payable Technician whose locked monthly report has complete required inputs; safe retries do not duplicate a current statement or adjustment.
- [ ] Automatic publication does not require a manager approval action or proof that payment occurred.
- [ ] An authorized manager can regenerate an affected Pay Stub after correcting time, machine scope, sales, an applicable rate, or another earnings/credit item; regeneration preserves immutable prior versions and publishes the latest version as revised.
- [ ] Regenerating an earlier period refreshes affected year-to-date totals on later Pay Stubs through new versions or holds those later statements visibly stale until the cascade completes; a midyear launch can record opening year-to-date balances from the manual statements.
- [ ] Technicians see only the latest published Pay Stub for each period in their own Technician profile and retain historical self-service access.
- [ ] The polished Pay Stub follows the owner-provided July 2026 reference hierarchy and clearly shows payer/contractor identity, period, Statement Date, exact worked hours/minutes, paid shifts, applicable started-hour rates and earnings by machine when different, Commissionable Sales, commission rate and earnings, applicable Bonus/Supply Credit/Expense Reimbursement lines, machine detail, current and year-to-date totals, and revision context. Cross-payer work produces a separate Pay Stub per payer.
- [ ] A single-machine Pay Stub with one rate and no commission stays on one page. Multiple machines, rate changes, or commission add an appendix, and long appendices continue onto additional pages without omitting rows.
- [ ] Page 2 is a commission appendix that clearly shows, by machine and effective-date segment, **sales - refunds - estimated sales tax = commissionable sales**, the tax rate and amount, the contractor's commission rate, and resulting commission; its totals reconcile to page 1.
- [ ] The Pay Stub uses explicit Paid Shifts and Commissionable Sales labels instead of the manual sheet's mixed `Hours / Sales` heading; calculations, dates, currency, quantity labels, spelling, optional zero rows, and rounding are consistent.
- [ ] A payment method, if shown, is informational profile data; the MVP does not show a Payment Date or otherwise assert payment. Contractor profiles receive the independent-contractor/no-withholding notice, while notice selection remains profile-driven rather than globally hard-coded.
- [ ] During migration, the superseded implementation retains its guarded visibility contract: Managers can preview pay statements before issuance, and Technicians see only latest issued pay statements. This compatibility check does not add an approval requirement or make the legacy labels user-facing.
- [ ] Direct artifact requests for drafts, missing stubs, superseded versions without manager authority, or another Technician's stub fail with an access error.
- [ ] Database lint reports no missing payer `legal_name` field in either Pay Stub builder and no ambiguous `statement_payload` reference in legacy issuance; the synthetic payload-builder and two-Technician issuance fixture completes without changing compensation calculations.
- [ ] Run `npm run operator-payouts:validate-pay-stubs`; verify the two-page PDF fixture, the immutable `upsert: false` private-storage upload, queue retry behavior, service-only scheduler functions, and manager/Technician access boundaries before pilot deployment.
- [ ] Desktop portal top bar shows one profile/session menu instead of separate Account and Sign Out buttons
- [ ] Profile/session menu shows the signed-in email, an Account Settings link when the user can access `/portal/account`, and Sign Out
- [ ] Portal section navigation labels `/portal/account` as Settings and does not show a separate Admin link for admin users
- [ ] Mobile app navigation keeps Account Settings and Sign Out as session utilities without duplicate session or admin actions in the same sheet
- [ ] Signed-in `/portal/account` language preference switches core portal navigation, dashboard/reporting/training/support/account entry labels, then persists after refresh
- [ ] Authenticated desktop sidebar and mobile drawer render no persistent language selector; `/portal/account` renders exactly one labeled Preferences > Language preference section with full `English` and `简体中文` labels
- [ ] If account preference sync fails, changing language still persists on the current device and Account Settings reports the non-blocking sync failure instead of claiming account sync succeeded
- [ ] Training-only users retain their existing restricted route permissions; language recovery remains available by signing out and using the single selector on `/login`
- [ ] At desktop widths, normal portal, normal admin, Scoped Admin, and permission-neutral loading shells align sidebar/content header dividers within `1` CSS px, use one divider color, and keep EN/ZH scoped context inside the fixed header row
- [ ] Run `npm run portal-personas:uat -- --app-url http://127.0.0.1:8081`; confirm exact authenticated navigation sets, allowed and denied direct loads, one correct active destination, signed-out `next` preservation, legacy refund redirects, and dashboard CTA routes for Super Admin, Scoped Admin, Corporate Partner, reporting/training Technician, Technician Timekeeper, Generic Plus Member, and Baseline Customer.
- [ ] Review the deterministic persona evidence in `output/playwright/issue-553`, including Super Admin, Scoped Admin, Corporate Partner, signed-out redirect, and admin/non-admin mobile drawer screenshots; the mobile drawer must focus its first destination, scroll to utilities, close on Escape and selection, restore trigger focus, and expose no hidden persona destinations.
- [ ] `/portal/time-review` is hidden and direct-load blocked unless the session is Super Admin, has the `payouts`/global admin surface, or has time-report authority; an authorized manager sees exactly one active Time Report destination.
- [ ] On mobile (`390x844`), Chinese app-shell and portal navigation labels fit without horizontal page overflow
- [ ] User with reporting access, including Corporate Partner capability-based access, sees Reporting in portal navigation and exactly one dashboard link to `/portal/reports`; assigned machine/location scope is truthful, including the zero-machine state.
- [ ] User without reporting access does not see Reporting in portal navigation, the primary dashboard action, needs-attention rows, or useful links.
- [ ] On mobile app routes, page-intro actions stack cleanly full width instead of squeezing side-by-side on `/portal`, `/portal/orders`, `/portal/account`, `/portal/onboarding`, `/portal/support`, and `/portal/training`
- [ ] Non-Plus login can access baseline pages (`/portal`, `/portal/orders`, `/portal/account`)
- [ ] Non-Plus login is blocked from gated pages (`/portal/training`, `/portal/onboarding`, `/portal/support`, `/portal/team`) with clear access messaging
- [ ] Non-Plus dashboard renders only available actions; Plus/training upsell discovery stays outside the task-first dashboard and Reporting stays hidden unless reporting access is granted.
- [ ] Active Plus member sees Team in portal navigation and Technician Access on `/portal/team`; Settings (`/portal/account`) links to Team without duplicating the Technician workflow
- [ ] Adding training-only Technician access sends the Technician an invite email with a login link
- [ ] Technician Access shows active, pending, and legacy training-only people in one list with a clear setup message when the database rollout is missing
- [ ] Training-only access is represented as a Technician with no assigned machines
- [ ] Technician with no assigned machines can access `/portal` and `/portal/training*`
- [ ] Technician with no assigned machines cannot access `/portal/reports`, Plus/Corporate Partner supply discounts, billing, account-owner tools, partner settlement, or `/admin`
- [ ] Revoking Technician access removes `/portal/training*` access on the next session refresh/re-login when no other training source remains
- [ ] `/portal/orders` loads real `orders` data for the logged-in user (no mock rows)
- [ ] `/portal/account` shows live membership status and period from `subscriptions` (no hardcoded next billing date)
- [ ] `/portal/account` has no horizontal page overflow on mobile viewports (360x800, 390x844, 414x896)
- [ ] `/portal/orders`, `/portal/account`, `/portal/team`, `/portal/support`, `/portal/onboarding`, and `/portal/training` keep page actions, form controls, filters, order-card actions, Technician controls, and checklist toggles at touch-friendly sizes on mobile viewports (360x800, 390x844, 414x896)
- [ ] `/portal/account` profile save persists and reloads from `customer_profiles`
- [ ] `/portal/account` shipping save persists and reloads from `customer_profiles`
- [ ] Plus Account Owner sees Technician Access in Team (`/portal/team`) with seat usage, owned machines, and current Technician grants
- [ ] Plus Account Owner can add a Technician with either training-only access or selected owned machines, then edit that Technician's machine assignments
- [ ] Pending Technician invite resolves on first login so the Technician gets training plus assigned-machine reporting without admin repair
- [ ] Authenticated `/portal` and `/admin` route loads do not show `404` or `PGRST202` for `resolve_my_technician_entitlements` in the browser network log or console
- [ ] Plus Account Owner can save a Technician with no machines as training-only access
- [ ] Plus Account Owner sees a clear no-paid-seats message when the default 10 Technician grant cap is reached
- [ ] Plus Account Owner can revoke Technician access only after entering a revoke reason
- [ ] Corporate Partner can grant, update, renew, and revoke Technician access only for machines derived from active portal-enabled partnerships
- [ ] Corporate Partner can save a Technician with no machines as training-only access
- [ ] Baseline, Technician, Reporting User, and non-owner reporting users do not see Technician management controls
- [ ] Technician login can open `/portal/training*` and `/portal/reports`, and reporting filters/results include only assigned machines
- [ ] Technician login cannot access Plus discounts, billing, account-owner tools, partner settlement, or `/admin`
- [ ] Technician access expires after one year unless renewed
- [ ] Onboarding checklist progress updates when steps are toggled
- [ ] Onboarding progress persists for the same user after page refresh/re-login
- [ ] Training catalog visible to logged-in users
- [ ] Training catalog shows `Data source: Supabase` in local dev after auth/session settles
- [ ] Training hub hero makes one primary next action obvious (`Open start path` for a new path, `Resume learning` only for an in-progress item) without requiring deep scrolling
- [ ] `Explore the full library` scrolls to the searchable library section and focuses the search field instead of appearing dead when `All` is already selected
- [ ] Training hub shows an operator-first `Start Here` sequence plus task-based jump cards for `Daily Operation`, `Cleaning & Maintenance`, `Software & Payments`, `Troubleshooting & Repair`, `Build / Assembly`, and `Reference`
- [ ] Selecting a task-path card scrolls into the searchable library with that path active instead of only changing above-the-fold state
- [ ] Training hub surfaces compact job aids by flow moment near the library entry (`Safe Power Off and Cooldown`, `Timer Control Reference`, `Daily Cleaning Hotspots`, `Consumables Loading Reference`), with the main task library clearly separated below; Supabase-backed UUID rows still resolve the Safe Power Off moment through the canonical shutdown task route
- [ ] Main task-library browse cards show canonical operator tasks only; duplicate sibling video/checklist rows are collapsed for shutdown, cleaning, troubleshooting, and consumables
- [ ] When live Supabase training rows load, the hub hero shows non-zero quick-aid/manual counts and those same quick aids do not reappear as peer cards in the main task library
- [ ] Training hub keeps advanced filters hidden behind `More filters` by default and does not expose an `Unassigned` section anywhere in the library
- [ ] Training catalog supports supportive module filtering only when all visible catalog rows have module labels; otherwise module controls stay hidden and task navigation remains primary
- [ ] Training catalog suppresses duplicate Vimeo uploads in the operator-facing library; only intentional module-specific variants remain if they are truly distinct lessons
- [ ] Supabase-backed training guides stay in their intended task tracks (`Start Here`, `Daily Operation`, `Cleaning & Maintenance`, `Software & Payments`, `Troubleshooting & Repair`) instead of collapsing into `Reference`
- [ ] Training search finds relevant items by PDF-derived terms such as `burner`, `Nayax`, `timer`, and `waste water`
- [ ] Training search shows canonical tasks first and, when relevant, places matching quick aids/manuals in a separate secondary reference section below the task results
- [ ] Training catalog cards render thumbnail images for Vimeo-backed rows from first-party URLs (`training_assets.meta.thumbnail_url`) with no `vumbnail.com` dependency
- [ ] Visible training library cards do not fall back to the blank gradient/icon media state when an intentional guide/checklist/manual thumbnail exists
- [ ] No visible training library card resolves to `/placeholder.svg`
- [ ] Guide, checklist, quick-aid, and manual cards all render image covers cleanly while keeping their chips, progress badges, and durations legible
- [ ] Training hub cards show live progress state (`In progress` / `Completed`) after training progress rows exist
- [ ] Training detail page opens and loads an embed frame (Vimeo for seeded modules; placeholder for local-only fallback modules)
- [ ] Training detail page loads Vimeo player iframe for Vimeo-backed rows (not `about:srcdoc` placeholder)
- [ ] Training detail Vimeo player shows a clear loading state and begins playback without excessive startup delay
- [ ] Canonical task detail pages combine the walkthrough video and written essentials on one page when both exist, instead of splitting them into peer routes
- [ ] Training detail supports document-first guides with readable in-page guide sections when the primary asset is not a Vimeo video
- [ ] Training detail sections below video/guide ("What you will learn", "Checklist", "Resources") have clear purpose and readable structure
- [ ] Training detail separates `Use during this task` companion aids from the `Recommended next task` CTA so quick references do not appear as downstream steps
- [ ] Training resource cards expose real actions (`Open guide`, `Watch video`, `Go to support`, or `Download PDF`) instead of passive labels
- [ ] Guide/checklist actions continue to open the correct detail page even if the route uses a fallback catalog slug (for example `alarm-and-power-timer-setup` or `daily-maintenance-routine`)
- [ ] Absorbed legacy routes (`safe-power-off-and-cooldown`, `cleaning-and-hygiene-checklist`, `module-function-check-guide`, `sugar-loading-best-practices`) resolve to the canonical task page instead of rendering duplicate peer destinations
- [ ] `Alarm and Power Timer Setup` shows the approved schedule values (`9:30` / `20:30`, `9:00-23:00`, `8:00-22:00`) plus the controller reference in the guide body
- [ ] `Timer Control Reference` renders the annotated controller image and remains readable on both desktop and mobile widths
- [ ] Maintenance-derived task pages surface the key operator tasks from the PDF (`60 C` cooldown, cleaning hotspots, debug-page checks, and consumable loading rules) instead of only generic summaries
- [ ] Source-manual visuals from the PDFs appear inline where they clarify the task, including timer setup, shutdown/cooldown, cleaning hotspots, and consumables checks
- [ ] `Software Setup Quickstart`, `Pricing, Passwords, and Payment Settings`, and `Module Function Check Guide` no longer render as text-only guides when source-manual figures are available
- [ ] New job aids (`Safe Power Off and Cooldown`, `Daily Cleaning Hotspots`, `Consumables Loading Reference`) appear in the library/search and open from linked resource cards
- [ ] `Unlock Machine Door (Physical Service Access)` is titled to match the footage and is grouped under `Build / Assembly`, not `Software & Payments` or `Start Here`
- [ ] On mobile widths (360x800, 390x844, 414x896), the training hub keeps the compact Start Here sequence, task shortcuts, job-aid moment cards, and library search readable without oversized gaps between sections
- [ ] On mobile widths (360x800, 390x844, 414x896), training filters, onboarding checklist CTAs, support forms, and order-card actions stack cleanly without cramped button rows
- [ ] `Mark complete` persists to `training_progress` and the item remains completed after refresh/re-login
- [ ] Operator Essentials certificate appears as a secondary section below the main library and stays locked until all required items are complete and the final acknowledgement is checked
- [ ] After unlocking, the Operator Essentials certificate remains available for download on later visits
- [ ] In local QA, when Supabase returns no live training rows, the page surfaces the internal catalog warning and points to `node scripts/sync-vimeo-training-catalog.mjs --dry-run`
- [ ] Private training documents are not publicly reachable by direct URL when using Supabase-backed document assets
- [ ] Source-PDF download actions for document-first guides resolve through signed `training-documents` URLs rather than public bucket links
- [ ] Support request forms submit and show success state
- [ ] Direct support intake Edge Function calls are rejected unless `support.request` resolves server-side
- [ ] Submitted support request appears in `support_requests` table with correct `request_type`, `status=new`, and customer identity
- [ ] Submitted support request triggers a WeCom alert with request type, customer email, and subject
- [ ] `/portal/support` -> `View Setup Guide` includes install steps, QR verification timing, contact/group setup, and quick-use actions for translation, photo/video sharing, and group calls
- [ ] `/portal/support` includes a WeChat onboarding concierge form with phone region/number, blocked-step selection, and referral-needed selection
- [ ] WeChat onboarding concierge submit writes `support_requests.request_type=wechat_onboarding` and structured `support_requests.intake_meta` values (`phone_region`, `phone_number`, `device_type`, `blocked_step`, `referral_needed`, optional `wechat_id`)
- [ ] User with no reporting entitlement is blocked from `/portal/reports` with clear reporting-access copy
- [ ] User with one reporting machine entitlement can open `/portal/reports` and sees only that machine in filters/results
- [ ] `/portal/reports` supports date range, daily/weekly/monthly grain, machine, and All payments/Cash/Card/Other/Unknown payment filters without exposing location controls or columns; All payments is the default and the selected payment scope stays visible
- [ ] Operator report UI and PDF show Recorded sales − Reported refunds = Sales after refunds; the $505/$27 fixture shows $478, known card refunds remain on Card, and refund-only Unknown rows remain visible without being redistributed
- [ ] `/portal/reports` shows net sales, refund adjustments, gross sales, transaction count, sales by period, and sales by machine without mobile overflow
- [ ] On mobile widths (`360x800`, `390x844`, `414x896`), `/portal/reports` period controls, machine/payment filters, KPI cards, charts, machine comparison, report rows, and PDF export action stack without horizontal page scrolling or truncated labels
- [ ] Portal Reports > Partner Dashboard shows gross sales, refund impact, net sales, split base, and Partner Revenue Share as separate values when applied refund adjustments exist
- [ ] Corporate Partner can access `/portal/reports` partner dashboard for active portal-enabled partnerships only
- [ ] Corporate Partner sees machine reporting only for machines derived from current partnership assignments
- [ ] Corporate Partner cannot access `/admin`, tax/rule editing, machine metadata editing, imports, schedules, global reporting, or internal warning ledgers
- [ ] Partner reports hide admin-only review notes for every role; genuinely blocking data issues use plain report-incomplete copy and keep export disabled
- [ ] Inactive partnership status stops Corporate Partner live reporting access
- [ ] Partner Dashboard preview/export respects the partnership effective window: `effective_end_date = null` is open-ended, fully outside weeks/months show one `No report for this period` state without duplicate machine/setup errors, and partial weeks/months show a trimming warning while including only active-window dates
- [ ] Revoked Corporate Partner membership removes portal reporting access after refresh/re-login
- [ ] `/portal/reports` export creates a private signed PDF link that matches the selected date, machine, grain, and payment scope filters
- [ ] `npm run reporting:validate-provider-parser` passes with the sanitized provider `.xlsx` fixture
- [ ] `npm run refunds:validate-scheduled-reports` proves authenticated Nayax reports retain settled sales separately from refund observations, replay without duplicate facts, and reject malformed or non-settled rows
- [ ] A reviewed Nayax report replay creates idempotent `nayax_scheduled_report` facts for active published mappings. Sunze-backed card facts stay staged before their machine-local boundary; after a bounded verified cutover, one daily authority fact contains Nayax card money and paid Sunze order/item/tax metrics, zero-value Sunze operational rows remain separate, and clearing the boundary restores the retained original Sunze card values.
- [ ] Publishing an exact active Nayax inventory mapping for a Sunze machine sets its card-authority boundary to the next date in that machine's reporting-location timezone. Withdrawing the mapping restores Sunze; republishing defaults again, while manually clearing the boundary remains a stable rollback until the mapping itself changes.
- [ ] `npm run reporting:validate-refund-adjustments` passes with sanitized exact-match, fuzzy-alias, ambiguous, unmatched, duplicate/idempotent, same-content different-request, invalid-row, `Closed + Approve`, approved `Request Amount` fallback, `Open`, `Deny`, missing-decision, current customer-service export header, live sheet-shaped rows, removed live-source review reconciliation, sanitized-payload, and partner-settlement fixtures
- [ ] Before refund request-month recognition is activated, the report screen, PDF/export, scheduled report, both commission/payroll paths, and partner output retain the legacy calculation for the same date, machine, and payment filters; after activation, those consumers use the shared calculation and agree on every financially available field.
- [ ] On the shared calculation, a Nayax card customer charge with no explicit per-row basis uses the effective configured machine rate as embedded tax; an explicit basis still wins, and the same-rate full refund nets the sale to `$0` without a one-cent formula mismatch.
- [ ] Sunze cash remains tax-exclusive even when the machine has a configured reporting rate; no second tax deduction is applied.
- [ ] A proved tax-inclusive amount with no configured rate retains its numeric recorded value with `$0` provisional deduction, estimated/incomplete-tax status, and `$0` commission publication; it is not labeled as a proved 0% rate.
- [ ] A Gmail-linked email-context hosted form is treated as a customer-charge estimate only when `intake_meta.source=hosted_refund_intake`, `intake_meta.intake_path=email_context_form`, and the stored request target equals the validated payment amount; arbitrary Gmail text does not receive that basis.
- [ ] A refund request reduces the request month once; a later payment changes paid context without a second deduction; a later unpaid denial, withdrawal, or amount change posts only the signed unpaid difference in the change month.
- [ ] Financially unknown refund or tax inputs render as Unavailable through machine, period, summary, snapshot, PDF, and export totals rather than becoming $0; payment-only context remains visible without blocking an otherwise complete calculation.
- [ ] When a machine or assignment moves after the original purchase, the public/current technician pay report attributes the refund to the proved original purchase terms and does not charge the replacement technician; unresolved original attribution remains unavailable instead of using the current assignment.
- [ ] Actual changed sales or refund evidence may refresh the current report snapshot through the existing correction workflow, while an issued pay-statement version and PDF remain unchanged until an authorized corrected version is explicitly regenerated; a formula-only deployment does not mark every old period stale.
- [ ] Refund Adjustment Sync GitHub Action can be run manually with `dry_run=true`, pages through the source rows, and returns aggregate counts only, with no customer names, emails, payment IDs, card digits, or free-text incident descriptions in logs
- [ ] Sales Import Sync GitHub Action manual dispatch defaults to `dry_run=true` and rejects manual live imports unless `confirm_live=true` is explicitly set
- [ ] Sales Import Sync scheduled defaults still choose `Last Month` only for `45 14 1 * *`; the primary `30 13 * * *` and backup `30 17 * * *` scheduled replays choose `Last 7 Days`
- [ ] Sales Import Recovery GitHub Action manual dispatch defaults to `dry_run=true` and rejects manual live recovery unless `confirm_live=true` is explicitly set
- [ ] `npm run reporting:provider-sync -- --dry-run` requests the provider Orders export, confirms it, retries transient Export Task List wait/download-start timeouts inside the worker, downloads the newest completed Export Task file, parses `.xlsx` or `.zip` exports, reconciles trusted UI evidence against the workbook, treats weak/stale UI revenue and top-level machine discovery as diagnostics when workbook row/date evidence is valid, deletes raw downloads, and validates Supabase ingest/machine mappings without writing sales facts when ingest env vars are present
- [ ] `npm run reporting:provider-sync -- --date-start YYYY-MM-DD --date-end YYYY-MM-DD --dry-run` succeeds for one monthly custom-range backfill window and rejects exports with rows outside that selected window
- [ ] `npm run reporting:provider-sync -- --parse-file path/to/month.zip --date-start YYYY-MM-DD --date-end YYYY-MM-DD --dry-run` parses a manually supplied Export Task file, validates the selected monthly window, and logs only aggregate counts/metadata
- [ ] `npm run reporting:provider-sync -- --parse-file path/to/multi-month.xlsx --date-start YYYY-MM-DD --date-end YYYY-MM-DD --filter-date-window --dry-run` filters a manually supplied multi-month workbook to the requested monthly chunk and logs source window, filtered window, and out-of-window row counts without storing raw rows
- [ ] `npm run reporting:provider-health -- --event freshness_check --stale-hours 30` reports the latest completed sales import or sends a stale-data ops alert
- [ ] After a failed/cancelled/timed-out scheduled sales import, Sales Import Recovery replays `Last 7 Days`, runs the freshness check, uploads sanitized diagnostics when available, and sends a recovery-failure alert only if the retry or freshness check still fails

## Payments (test mode)
- [ ] Signed-out or non-Plus sugar checkout uses `$10/kg` in the cart summary and Stripe Checkout
- [ ] Bloomjoy Plus Customer and Corporate Partner sugar checkout use `$8/kg` in the cart summary and Stripe Checkout
- [ ] Direct sugar and sticks Edge Function calls cannot receive member pricing unless `supplies.member_discount` resolves server-side
- [ ] Sugar checkout completes with test card for high-quantity equal split (e.g., 500KG total)
- [ ] Sugar checkout completes with test card for unequal split mix (custom per-color quantities)
- [ ] Sugar checkout writes an `orders` row with customer email/name/phone, billing address, shipping address, pricing tier, unit price, shipping total, receipt URL, and sugar color mix
- [ ] Sugar checkout completed webhook sends internal order summary email to Ethan/Ian and any configured additional recipients (customer, totals, pricing tier, sugar mix, line items, fulfillment next steps)
- [ ] Sugar checkout sends customer confirmation email with branded HTML layout, clear totals, shipping address, color quantities, and receipt link
- [ ] Sugar checkout completed webhook sends a WeCom internal alert with order ID, customer, and sugar breakdown
- [ ] Bloomjoy branded sticks checkout completes with test card for both 1-box paid shipping and 5+ box free-shipping cases
- [ ] Bloomjoy branded sticks checkout writes an `orders` row with billing/shipping address, shipping total, receipt URL, and order detail metadata
- [ ] Bloomjoy branded sticks checkout completed webhook sends internal order summary email to Ethan/Ian and any configured additional recipients with box count, machine size, address type, shipping total, and fulfillment next steps
- [ ] Bloomjoy branded sticks checkout sends customer confirmation email with branded HTML layout, shipping address, and receipt link
- [ ] Bloomjoy branded sticks checkout completed webhook sends a WeCom internal alert with order ID, customer, and stick-order summary
- [ ] After `#717` is resolved and Micro checkout is explicitly enabled, Micro-only and mixed sugar+Micro checkouts complete with test card, persist the correct `micro_machine`/`mixed` order type and line-item metadata, and render correct customer/internal summaries
- [ ] Checkout return pages clear the cart or show success only after server-side Stripe session verification; canceled, unpaid, invalid, and mismatched session returns keep the cart and do not claim fulfillment started
- [ ] Checkout creation accepts card payments only; unpaid `checkout.session.completed` produces no order or notifications, and a synthetic `checkout.session.async_payment_succeeded` replay produces one order and one dispatch per channel
- [ ] Paid Checkout events without the server-set `checkout_source=bloomjoy_storefront`, an allowed order type, and an approved Stripe Price ID produce no order or notifications
- [ ] Replayed/concurrent paid webhook deliveries remain idempotent for the order, Ethan/Ian email, customer email, and WeCom alert
- [ ] Plus subscription checkout shows flat `$100/month` account pricing and completes with test card
- [ ] Logged-out users on `/plus` are redirected to login before checkout can begin
- [ ] After login, a baseline customer can start Plus checkout from `/portal/account` and Stripe returns to `/portal/account` for success or cancellation without crossing back to the logged-out public host
- [ ] Repeated, simultaneous, cross-tab, or minute-boundary Start Plus actions reuse one durable per-account checkout attempt and the same open Stripe Checkout Session; only one payable subscription session can be created
- [ ] If cleanup explicitly expires an unpaid Plus Checkout Session before its original `expires_at`, Stripe's provider state overrides the durable `ready` retry row; the next Start Plus action creates one fresh open Session and the following request reuses only that fresh Session
- [ ] Stripe resolution checks every stored-customer, stored-subscription, Bloomjoy-user-metadata, and exact-email candidate; one actionable Plus history is selected, ambiguous actionable histories fail closed, and stale positive database status does not block a restart after Stripe confirms terminal state
- [ ] Existing `active`, `trialing`, `past_due`, `unpaid`, or `paused` Plus subscriptions block a second checkout; failed-payment states open Billing, while `incomplete` resumes the matching open Checkout Session and never routes to Billing
- [ ] A canceled or expired incomplete Plus subscription can restart checkout on the existing Stripe Customer record
- [ ] Stripe subscription from Plus checkout contains `metadata.user_id` and `metadata.billing_model=flat_monthly`
- [ ] Paid Plus activation sends one idempotent internal email to Ethan/Ian and one non-blocking WeCom alert; unpaid/replayed checkout events do not duplicate alerts
- [ ] Customer Portal link opens with the explicit test-mode portal configuration; payment-method update, invoice history, end-of-period cancellation, and pre-expiry renewal are available
- [ ] After the reviewed `stripe-customer-portal` deploy, one synthetic no-payment live portal session uses the private `STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID`, returns only to `https://app.bloomjoyusa.com/portal/account`, and is cleaned up without changing a real customer or subscription
- [ ] Account page Manage Billing opens the signed-in user's exact Stripe customer portal record, with payment-method update, invoice history, and cancellation controls (test mode)
- [ ] In Stripe test customer portal, cancel Plus subscription and return to `/portal/account?billing=return`
- [ ] Return to account shows confirmation only after billing status refresh succeeds, and shows a retryable error if refresh fails
- [ ] After canceling, account membership card shows `Access through`, makes clear that monthly renewal is off, and offers Renew Plus through the billing portal before the period ends
- [ ] `past_due`, `unpaid`, and `paused` accounts show a visible billing warning and Fix Billing action; `incomplete` shows Finish Plus Checkout and resumes the existing session; neither state offers Start Plus Membership
- [ ] Persona UAT clicks Fix Billing, Renew Plus, Restart Plus Membership, and Finish Plus Checkout; it also proves duplicate-checkout fallback opens Billing once and billing-refresh failure leaves duplicate protections visible
- [ ] Stripe webhook updates subscriptions/orders tables (via Stripe CLI or Dashboard test event)

## California tax activation (production, no payment)

- [x] Live Stripe Tax shows California `Collecting tax` with an owner-approved 2026-08-08 start date and no end date
- [x] Production `stripe-sugar-checkout`, `stripe-sticks-checkout`, and `stripe-plus-checkout` are deployed from the reviewed source with a recorded marker-enforcement timestamp
- [x] Fresh post-marker no-payment Sugar and branded-sticks previews report `automatic_tax.enabled=true` and a complete result
- [x] A California Sugar preview follows `txcd_40020004`; California sticks collect positive tax; a taxable no-registration destination does not collect tax
- [ ] Deploy the authenticated `/portal/account` Plus checkout entry, then confirm a fresh no-payment Plus preview reports `automatic_tax.enabled=true` and the configured California taxable treatment
- [ ] Every unpaid tax-diagnostic Checkout Session created on 2026-08-08 is `expired`, and the commerce cutover audit finds zero unresolved unmarked sessions
- [ ] All no-payment previews are canceled and allowed to expire or are safely expired after confirming no payment is pending; sanitized evidence in `#718` contains no session ID, address, payment data, receipt, or customer PII

## Auth launch hardening (production-only)
- [ ] Branded auth emails send from approved Bloomjoy sender domain (not default Supabase sender)
- [ ] Supabase custom SMTP is enabled through the environment-backed Resend credential and the production Auth email limit is at least 30/hour
- [ ] Supabase Signup Confirmation, Invite User, Email Code, and password recovery emails use the versioned scanner-resistant branded templates; `npm run auth:templates:validate` passes
- [ ] Production auth smoke evidence is captured in `Docs/AUTH_PRODUCTION_SIGNOFF.md`

## Regression sanity
- [ ] Quote, order, and support primary flows still succeed when WeCom alert delivery fails (verify non-blocking warning logs in function output)
- [ ] `npm run build` passes
- [ ] `npm run lint` passes (if configured)
- [ ] `npm run seo:check` passes

## Admin (super-admin)
- [ ] P0 access recovery `#368`: follow `Docs/ACCESS_MANAGEMENT_RECOVERY_UAT.md` as the acceptance matrix for Super Admin, Plus Customer, Corporate Partner, Technician, Scoped Admin, Reporting User, and non-admin workflows; `#367` remains secondary/review-reminder-only until the core rescue lands.
- [ ] Access-management PR verification is recorded: `npm ci`, `npm run build`, `npm test --if-present`, `npm run lint --if-present`; DB-touching work also records `npm run db:validate-migrations`, `supabase db push --dry-run` when linked, and direct RPC checks for no `404`/`PGRST202`.
- [ ] Access-management PR includes desktop and mobile screenshots for affected flows, including desktop selected-person workspace and mobile `390x844` source-card layout with no horizontal scrolling or clipped controls.
- [ ] Admin Access invite UAT: run `npm run admin-access:validate-invite-uat -- --app-url http://127.0.0.1:8081` against `npm run dev:uat`; confirm Corporate Partner, Technician, and invitation-first Scoped Admin create/resend/revoke flows, then attach desktop/mobile screenshots from `output/playwright` to the PR.
- [ ] Scoped Admin Technician UAT: run `npm run scoped-admin-technicians:validate-uat -- --app-url http://127.0.0.1:8081` against `npm run dev:uat`; evidence must show in-scope Technician grant success, out-of-scope direct RPC denial, hidden Plus/Corporate Partner/Super Admin grant controls, and desktop screenshot output.
- [ ] Scoped Admin Partnerships UAT: run `npm run scoped-partnerships:validate-uat -- --app-url http://127.0.0.1:8081` against `npm run dev:uat`; evidence must show in-scope partnership create/archive success, out-of-scope direct RPC denial, and desktop/mobile screenshots.
- [ ] Admin Access exposes a direct Add Technician action on `/admin/access` in addition to the generic Add or invite access launcher.
- [ ] Access Launcher opens from `/admin/access` and deep links from `/admin/access?action=add-access`, with preset links for `corporate_partner`, `technician`, `scoped_admin`, `super_admin`, and `plus_customer`.
- [ ] Access Launcher Corporate Partner preset can grant email-based access for a never-authenticated email, send the invite email, and write both `access_invite_deliveries` and `admin_audit_log` evidence.
- [ ] Access Launcher Technician preset can grant training-only access or selected machines, send the invite email, and preserve the assigned-machine Technician reporting boundary.
- [ ] Access Launcher Scoped Admin preset accepts a never-authenticated valid email, requires at least one active machine plus an audit reason, sends a branded invite, and shows the result as pending with no effective admin/reporting access.
- [ ] Pending Scoped Admin invitations show email delivery state and expiry, can be resent without creating a second pending invitation or grant, and require a reason to revoke. Accepted, revoked, and expired states are visibly distinct.
- [ ] First normal sign-in with the exact verified invited email resolves one pending Scoped Admin invitation before access reads, creates only the selected machine scope, and is idempotent on refresh/re-login. A different email, unverified session, expired invite, revoked invite, or inactive staged machine activates nothing.
- [ ] Admin Access Corporate Partner source card uses one primary `Grant and send invite` action; the selected-person flow does not leave a saved active membership without an invite attempt unless the UI reports invite failure and shows resend/copy recovery.
- [ ] Admin Access Corporate Partner source card keeps partner-wide portal setup separate from the person invite transaction; partner portal setup has its own reason, preview, and save action.
- [ ] Admin Access Technician source card uses `Save and send Technician invite`; if invite delivery fails after the grant is saved, the UI reports the split state instead of only saying access saved.
- [ ] Partner Technician Access: corporate partner on `/portal/team` can create two Technicians for the same in-scope machine, and can assign one Technician to multiple in-scope machines; each new Technician save automatically sends the invite, and row-level resend/copy remains available for recovery.
- [ ] Partner Technician Access: training-only Technician invite copy says training library only, assigned-machine Technician invite copy says training plus assigned-machine reporting, and neither invite promises partner-wide reporting.
- [ ] Partner Technician Access: run `npm run partner-technicians:validate-uat -- --app-url http://127.0.0.1:8081` against `npm run dev:uat` and attach desktop/mobile screenshots from `output/playwright` to the PR.
- [ ] Access invite email copy stays source-specific without overstating access: Corporate Partner copy stays generic to available tools, Technician copy may mention training and assigned-machine reporting, and no invite promises broad partner-wide reporting unless the source grants it.
- [ ] Login invite URLs `/login?intent=corporate_partner&email=...`, `/login?intent=technician&email=...`, and `/login?intent=scoped_admin&email=...` prefill the email, show the contextual invite banner, and keep password, Google, and Email Code sign-in available.
- [ ] Invite Email Code verification uses a temporary non-persisting session; portal access remains closed until password creation succeeds, then the user is signed in with the new password.
- [ ] Super Admin and Plus Customer presets require an existing auth user. Scoped Admin routes an existing user to the selected person workspace but offers a pending, machine-scoped invitation for a new email.
- [ ] Non-admin and Scoped Admin sessions cannot call the `access-invite` Edge Function; invalid source IDs, mismatched target emails, revoked grants, and expired Technician grants are rejected.
- [ ] Access invite email QA records five separate states before rollout signoff: grant saved, `access-invite` attempted, provider accepted/delivered or failed, recipient inbox received or controlled test inbox captured, and recipient activated access with the invited email.
- [ ] Access invite failure-mode QA proves missing/failing email-provider configuration leaves visible retry/copy recovery and does not show a generic access-saved-only success state.
- [ ] Non-admin user cannot access `/admin/support`
- [ ] Super-admin user can access `/admin/support`
- [ ] Admin can search/filter support queue and update status/priority/assignment/notes
- [ ] Admin support queue can filter by request type and includes `wechat_onboarding`
- [ ] Admin support queue summary cards show open total, open new, and open WeChat onboarding counts
- [ ] Admin updates create `admin_audit_log` entries with `action=support_request.updated`
- [ ] Non-admin user cannot access `/admin/orders`
- [ ] Super-admin user can access `/admin/orders`
- [ ] Admin orders supports search by customer email/order ID and date range filtering
- [ ] Admin orders detail panel shows a fulfillment packet plus billing/shipping address snapshots, pricing tier, unit price, receipt link, and notification statuses
- [ ] Admin orders detail panel shows sugar color quantities for sugar orders and box/size/address metadata for Bloomjoy branded stick orders
- [ ] Admin fulfillment updates create `admin_audit_log` entries with `action=order.fulfillment_updated`
- [ ] Non-admin user cannot access `/admin/access`
- [ ] Super-admin user can access `/admin/access`
- [ ] `/admin/access` defaults to the person-first `Find a person` view, not grant-type tabs
- [ ] `/admin/accounts` opens a first-class Admin Console Accounts summary page and does not expose legacy machine-count editing
- [ ] `/admin/audit` opens a first-class Admin Console Audit page with log filtering only, not role-management controls
- [ ] Admin Access person search returns rows by email/user ID and shows membership/order/support summary data without forcing a grant-type tab choice
- [ ] Admin Access person search does not show "Unable to load account summaries" and the network console does not show `404`/`PGRST202` for `admin_get_account_summaries`
- [ ] Admin Access person search can find an existing Supabase Auth user by email even if they do not have orders yet
- [ ] Selecting a person shows one consolidated workspace with Who/What/Where/Why/When summary, effective presets, capabilities, warnings, and source cards
- [ ] Effective access summary shows all reporting machines and source breakdowns for Corporate Partner, Technician, Scoped Admin, and manual reporting machine scope
- [ ] Plus Customer source card shows paid subscription separately from admin-granted Plus Customer access, with grant/extend/revoke previews and required reasons
- [ ] Corporate Partner source card can grant Corporate Partner access with selected partner record, plain-English save preview, and required reason
- [ ] Corporate Partner source card can revoke an active membership with a plain-English impact preview and required reason
- [ ] Partner-level portal-access toggles remain available inside the Corporate Partner card, clearly labeled as partner-level, and require a reason
- [ ] Corporate Partner grants create `admin_audit_log` entries with `entity_type=corporate_partner_membership`
- [ ] Super-admin cannot grant Plus Customer access without a future expiry date and grant reason
- [ ] Super-admin cannot grant Plus Customer access while the account has an active paid Stripe subscription that is not scheduled to cancel
- [ ] Super-admin can grant or extend Plus Customer access and the customer can reach Plus-only portal pages without a paid Stripe subscription
- [ ] Super-admin can revoke Plus Customer access with a required reason and the customer is blocked from Plus-only portal pages after access is revoked
- [ ] Plus Customer access grant, extension, and revoke actions create `admin_audit_log` entries with `entity_type=plus_access_grant`
- [ ] Grant-only customers see waived Plus access on `/portal/account` and are not offered the Stripe billing portal unless they also have a paid subscription
- [ ] Admin Accounts links machine context to `/admin/machines`; machine records are managed as first-class `reporting_machines`, not account-level editable counts
- [ ] `/admin/machines` presents one compact machine list (not a second Nayax table), defaults to the operational portfolio view, and preserves search/view filters when returning from a machine detail
- [ ] Machine rows show identity, the highest-priority attention item, refund readiness, reporting status, latest activity, and one `Manage` action without exposing manager emails or provider IDs in the list
- [ ] `/admin/machines/:machineId` separates Overview, Refunds, Managers, Reporting, and Activity; browser Back returns to the preserved list state
- [ ] An unmapped machine's Refunds setup leaves the Nayax account blank and requires the exact provider account when a new machine ID is entered; existing mappings retain their saved account, and legacy mappings with an ID but no stored account retain the effective TGPACI account
- [ ] Machine Manager additions/removals remain pending until `Save managers`; Cancel restores saved assignments, and changing tasks or leaving with pending edits requires an explicit discard decision
- [ ] `/admin/machines/inventory` is Super Admin-only, defaults to `Needs review`, and keeps Published, Excluded, All, search, and per-row Review controls available
- [ ] `/admin/machines` has no page-level horizontal overflow at 360x800, 390x844, 414x896, 1024x768, or 1440x900; mobile and 1024px rows show only machine, attention, refunds, and one 44px `Manage` action
- [ ] Machine grant/revoke, machine setup edits, and machine tax/refund setup changes create `admin_audit_log` entries
- [ ] Manual reporting access source card uses a contextual machine-scope editor, not a raw permission matrix
- [ ] Manual reporting access source card can select multiple machines, save with a reason, and update that person's machine grants in one transactional save
- [ ] Manual reporting access save does not show missing-function errors for `admin_set_user_machine_reporting_access`
- [ ] Manual reporting access can revoke one user's machine access without removing other viewers from the same machine
- [ ] Super-admin users show all-machine reporting access as read-only in Admin Access
- [ ] Technician source card in Admin Access lets Super Admin grant or update a Technician as training-only or selected reporting machines, with plain-English impact preview and required reason
- [ ] Technician source card in Admin Access lets Super Admin use Bloomjoy admin sponsorship when the account has no active Plus Customer owner sponsor
- [ ] Technician source card can edit scope, renew current access, and revoke active Technician grants with required reasons
- [ ] Admin Technician scope changes revoke only Technician-sourced reporting entitlements; unrelated manual reporting grants remain intact
- [ ] Scoped Admin Technician source card shows only scoped machine choices, hides broad admin/customer/partner presets, requires at least one machine, and keeps out-of-scope or mixed-scope grants read-only with a Super Admin repair message
- [ ] Scoped Admin source card can grant or update `scoped_admin` for an existing user with zero or more selected machine scopes, save preview, and required reason
- [ ] Scoped Admin with zero machine scopes can open `/admin`, `/admin/accounts`, `/admin/orders`, `/admin/support`, `/admin/access`, `/admin/audit`, and `/admin/machines`, with Machines showing the empty assigned-machine state
- [ ] Scoped Admin users with active machine scopes see `/portal/reports` for those machines without requiring separate `report_manager` entitlements
- [ ] Scoped Admin users can open `/portal/training*` but do not become Plus members or get Plus billing/commerce benefits
- [ ] Scoped Admin users can open `/admin/partnerships` and the partner dashboard for partnerships fully covered by their scoped machines; partially covered partnerships remain hidden/blocked
- [ ] Scoped Admin users see Admin Console navigation for Overview, Orders, Support, Accounts, Machines, Access, and Audit, with machine rows/actions limited to granted machines
- [ ] Scoped Admin users cannot open global-only admin routes such as `/admin/reporting`, `/admin/partner-records`, or global role controls; `/admin/partnerships` is available only when scoped partnership authority is present and remains machine-scoped
- [ ] Scoped Admin reporting-access saves affect only manual reporting grants inside the scoped machine set and do not revoke Technician-derived grants
- [ ] Scoped Admin grant, update, revoke, and reporting-access changes create `admin_audit_log` entries
- [ ] `report_manager` users can open assigned `/portal/reports` views but remain blocked from `/admin`, `/admin/access`, and other admin routes
- [ ] Adam scoped-admin bootstrap or manual grant creates `scoped_admin` audit entries and does not create or require a `super_admin` grant
- [ ] Super Admin source card is visually de-emphasized as a rare global-risk action and can grant/revoke super-admin role with required reason metadata
- [ ] Admin Access secondary Activity view supports filtering and shows role + operational actions
- [ ] On desktop and mobile widths (`390x844` plus desktop), the selected-person workspace stacks source cards without horizontal scrolling or clipped controls
- [ ] Non-admin user cannot access `/admin/partnerships`
- [ ] Super-admin user can access `/admin/partnerships`
- [ ] Scoped Admin user can access `/admin/partnerships` only when the Partnerships admin surface is included in their admin context, and sees only assigned-machine partnership operations.
- [ ] Admin Console sidebar is the only primary admin navigation map; `/admin` does not render a second catalog of duplicate route cards
- [ ] Admin Console overview is an exception dashboard with Work queues, Customers and machines, and Access and audit sections, without a duplicate source-of-truth catalog
- [ ] Admin Console sidebar uses Admin Console language and does not present Portal Dashboard as a competing top-level internal destination; portal switching is a utility action
- [ ] Authenticated desktop routes show one grouped left sidebar; portal routes keep portal work/learning/settings groups while admin routes use the streamlined Admin Console groups
- [ ] Desktop admin routes place Admin Console in Home; Refunds as the single shared Work entry; Orders, Support Queue, and Technician Pay in Operations; Accounts and Machines in Customers; People & Permissions plus Audit in Administration; and Partner Records, Partnerships, and Admin Reporting in Partners & Reporting
- [ ] Admin routes show only one active sidebar item at a time; `/admin/orders`, `/admin/support`, `/admin/accounts`, `/admin/access`, `/admin/audit`, and `/admin/payouts` do not also mark Admin Console active
- [ ] Admin Home treats Refunds as a shared core workflow rather than an Admin-owned destination, shows only live exception signals, and does not expose database/policy terms such as `admin_roles` or `is_super_admin`
- [ ] Portal Dashboard useful links show only actions available to the signed-in account, exclude the primary/secondary task, cap at three, and do not render locked/upsell destinations or a duplicate navigation catalog.
- [ ] `/portal/time` is hidden and route-blocked for accounts without an active Technician pay profile or explicit timekeeping capability
- [ ] Desktop admin routes do not show the old Portal/Admin workspace pills, horizontal `Admin tools` navigation row, or horizontal admin scroller
- [ ] Mobile authenticated admin routes expose the same streamlined Admin Console groups in the drawer, keep Switch to Portal in utilities, focus the first destination when opened, and close after selecting a destination
- [ ] Non-admin users see no admin destinations in the authenticated sidebar or mobile drawer
- [ ] Non-admin user cannot access `/admin/partner-records` or `/admin/machines`
- [ ] Super-admin user can access `/admin/partner-records` and `/admin/machines`
- [ ] Scoped Admin user can access `/admin/machines`, sees no machines before grants, and sees only explicitly granted machines after grants
- [ ] Super-admin user sees all machine records in `/admin/machines` and can create/edit machine identity records
- [ ] Scoped Admin can open granted machine detail tabs but cannot open or mutate `/admin/machines/inventory`
- [ ] Admin Partner Records can search, create, edit, and archive reusable partner records with separate display name and legal name fields, without exposing "party" terminology
- [ ] Issue `#326`: super-admin can archive an unused test partner record from `/admin/partner-records` with required reason copy naming the record, and `admin_audit_log` stores actor, target ID/status, timestamp, and reason without customer/payment/source payloads or signed URLs
- [ ] Issue `#326`: archiving a partner record is blocked when active memberships, active partnership parties, active assignments, active schedules, report snapshots, schedule runs, sales facts, or applied adjustment history are tied to it
- [ ] Admin Partnerships setup loads without missing-RPC errors for `admin_get_partnership_reporting_setup`
- [ ] Admin Partnerships opens as a guided setup flow with Details, Participants, Machines, Payout Rules, and Weekly Preview steps
- [ ] Admin Partnerships is navigable on mobile with a compact partnership picker, `Step X of 5` header, horizontal step controls, and sticky Back/Next controls
- [ ] Admin Partnerships does not show a global Setup Warnings box or machine tax-rate editor
- [ ] Admin Partnerships > Participants can attach and remove multiple partner records with role only, without visible report-recipient or share-percentage fields
- [ ] Admin Partnerships > Participants includes an `Add new partner record` dropdown option that opens a modal, saves minimum viable partner fields, and selects the new record
- [ ] Admin Partnerships > Machines supports bulk searchable check/uncheck machine alignment and archives unchecked active assignments without exposing dates, status, role, or notes
- [ ] Admin Partnerships > Machines shows when selected machines are already assigned to another active partnership and requires confirmation before saving an overlap
- [ ] Admin Machines shows machine identity/source, partner report assignment, latest sale, and row actions without horizontal scrolling at desktop, narrower laptop, and mobile widths; normal setup has no editable tax input
- [ ] Admin Machines can edit machine label/alias, account, and machine type while hiding location and showing external machine ID as read-only system metadata
- [ ] Admin Machines can create a machine with its actual location and time zone or edit it into **Setup — provisional** phase, shows it in the Provisional view with a clear badge, and does not treat missing Nayax/Sunze/refund setup as a live-machine alert.
- [ ] A Setup-phase provisional machine remains active in the portal, appears with a Provisional badge in **Set up Technician**, accepts an open-ended assignment and pay rules, and allows the assigned Technician to record time before external provider IDs exist.
- [ ] Admin Machines create/edit and Admin Reporting imported-machine setup offer exactly **Cotton Candy - Commercial**, **Cotton Candy - Mini**, **Cotton Candy Micro**, and **Snapcase**. Save Snapcase, reload the machine detail, and confirm the value remains selected and displayed; the Snapcase filter returns it. Existing commercial/mini/micro records use the approved labels, while an unverified legacy record remains **Product unverified** until an admin explicitly classifies it. Repeat at desktop and `390x844` mobile widths.
- [ ] Admin Machines shows a sortable/filterable machine setup list with assignment readiness, assignment state filters, and latest sale
- [ ] Admin Machines create/edit and imported-machine setup do not ask admins to enter tax percentages or effective dates
- [ ] Card tax resolves from verified dated source evidence; cash has no tax deduction, and missing source tax information remains unresolved
- [ ] Reporting partial amounts: at 390×844 and desktop, September 30–October 6 and January 1–October 7 retain loaded transaction counts and label calculable net/refund amounts as known subtotals. Daily values, chart, company/machine/payment breakdowns, briefing and PDF agree on partial coverage. Missing amounts never become zero; no calculable rows stay unavailable. A failed comparison retains current-period results with a separate Retry. Run `node scripts/validate-reporting-partial-uat.mjs --app-url http://127.0.0.1:8098` against `node scripts/serve-reporting-preview.mjs --port 8098 --partial-samples` for synthetic UI coverage; verify annual performance separately against representative authorized data.
- [ ] Authorized admins can inspect read-only tax source diagnostics, including the observation date and unavailable refresh status, without editing source rates
- [ ] A successful source response missing or changing the verified field invalidates earlier coverage; a transport outage retains prior verified evidence and shows the refresh failure separately
- [ ] Admin Partnerships > Details exposes one agreement-level effective date window plus weekly/monthly cadence, report due days, invoice payment due days, payment method, ownership model, pricing authority, contract reference, and archive cleanup action
- [ ] Admin Partnerships flags records that remain Active after their reporting end date and directs admins to review agreement dates, Machines, and Payout Rules or archive the partnership
- [ ] Admin Partnerships > Machines keeps date-ended active assignments selected, shows their saved end date, preserves each assignment's actual start date, and updates the existing assignment when clearing only its obsolete end date instead of creating an overlapping replacement
- [ ] Admin Partnerships > Payout Rules identifies a legacy rule end date and provides an explicit Save & Sync action that preserves the calculation while clearing the outdated rule date
- [ ] Issue `#326`: super-admin can archive an unused test partnership from `/admin/partnerships` with required reason copy naming the partnership; related active assignments, payout rules, and schedules without run history are archived, and audit metadata stays limited to IDs/status/counts/reason
- [ ] Issue `#326`: archiving or hard-deleting a partnership is blocked when report snapshots, schedule runs, sales facts, applied adjustments, active memberships, active parties, active assignments, or active schedules make the record unsafe to remove
- [ ] Issue `#326`: archived partner records and archived partnerships are hidden from `/admin/partnerships` selectors, `/admin/reporting` report/partnership selectors, Portal Reports partner dashboard lists, and partner-report schedule creation options
- [ ] Issue `#326`: anonymous, non-admin, scoped-admin, `report_manager`, and Corporate Partner sessions cannot call archive RPCs or hard-delete partner/partnership records directly
- [ ] Admin Partnerships > Payout Rules shows a plain-language sales-to-payout summary, one current payout rule, stable participant-named Payout Allocation rows based on Participants marked `Receives payout`, whole-percent inputs, a 100% allocation check, click/tap help popovers, and no editable payout-rule date/status fields
- [ ] Admin Partnerships > Payout Rules can save a contract-specific deduction label and additional deduction notes for cashless processing, royalties, or other agreement-specific deductions
- [ ] Saving Admin Partnerships > Payout Rules repeatedly updates the current payout rule instead of creating duplicate visible rules
- [ ] Admin Partnerships does not show example-specific `Fever` terminology in the admin UI
- [ ] Admin Partnerships shows financial-rule warnings in Payout Rules and assignment warnings in the Machines step, not in a disconnected top-of-page warning box
- [ ] Admin Partnerships warns before leaving the Machines or Payout Rules step with unsaved changes, including on mobile Back/Next navigation
- [ ] Admin Partnerships > Weekly Preview enforces the partnership week-ending day and uses the previous completed Monday-Sunday week for Bubble Planet-style reporting
- [ ] Admin Partnerships > Weekly Preview shows actionable in-page readiness messages when the selected week has no active machine assignment coverage, no active payout rule coverage, partial-week coverage, or no imported assigned-machine sales
- [ ] Admin Partnerships > Weekly Preview and export respect the partnership effective window: inactive/archived partnerships and fully outside weeks produce no settlement amounts; partial weeks are bounded to active partnership dates and show the trimming note
- [ ] Authenticated Weekly Preview smoke path is run from `Docs/WEEKLY_PREVIEW_SMOKE_TEST.md` with a super-admin on `/admin/partnerships?partnershipId=<qualified_fixture_partnership_id>&step=preview`
- [ ] Authenticated Weekly Preview happy path for week ending `2026-04-19` shows `2026-04-13 through 2026-04-19`, `Ready`, `Orders` > 0, `Gross sales` > `$0`, and at least one `Sales by Machine` row after the provider import backfill/setup dates are corrected
- [ ] Authenticated Weekly Preview warning states are checked for `No machines are assigned for this week`, `No active payout rule covers this week`, and `No sales found for this selected week`
- [ ] Admin Partnerships > Weekly Preview labels payout metrics with legal partner names when recorded, otherwise the same participant names used in Payout Rules, plus Bloomjoy
- [ ] Admin Partnerships > Weekly Preview matches the corrected Bubble Planet product math: sales-source order amount as gross, machine tax plus configured `$0.40` stick-level cost deduction before split, no-pay orders counted as `$0`, and 60/40 split when configured
- [ ] Admin Partnerships > Weekly Preview shows refund impact separately and reduces net sales, split base, and Partner Revenue Share only for applied refund adjustments
- [ ] Admin Partnerships > Weekly Preview can generate a branded partner PDF and a CSV reconciliation export from the loaded preview; the PDF shows a partner-friendly report reference while internal snapshot metadata remains available in the archive/CSV
- [ ] Portal Reports > Partner Dashboard can switch to Weekly, choose a completed reporting week, and show the selected week in the controls, KPI summary, machine rollups, calculation detail, warning/status notes, and PDF/CSV/XLSX export metadata
- [ ] Portal Reports > Partner Dashboard can switch to Month to date, shows the current-month start through today in the partnership timezone, marks the period in progress, and labels PDF/CSV/XLSX exports as Month-to-date rather than finalized completed-month reports
- [ ] Portal Reports > Partner Dashboard can switch to Completed month, choose a completed calendar month, and show the selected month in the controls, KPI summary, machine rollups, calculation detail, warning/status notes, and PDF/CSV/XLSX export metadata
- [ ] Portal Reports > Partner Dashboard does not offer the current incomplete week/month as a finalized completed period; empty or blocked completed periods show clear notes and keep blocked exports disabled
- [ ] Portal Reports > Partner Dashboard machine selector offers All machines plus assigned machines; all-machine selection keeps Machine rollups, while single-machine selection scopes Partner performance summary, Net sales trend, and the bottom section to Machine history across prior periods
- [ ] Portal Reports > Partner Dashboard all-machine rollup rows and mobile cards show machine plus location and expose a keyboard/touch-accessible `View machine` action; duplicate machine labels remain distinguishable, zero-sales assignments remain visible, and the top machine picker becomes searchable when the list is long
- [ ] Portal Reports > Partner Dashboard single-machine view keeps a persistent `partnership > machine` scope bar with location and `Back to all machines`; KPI summary, trend, history, calculation, warnings, and PDF/CSV/XLSX exports all use that selected machine scope
- [ ] Portal Reports > Partner Dashboard machine rollups use partner-facing labels (`Tax + deductions`, `Payout basis` when needed, `Partner Revenue Share`), hide zero-dollar additional costs, and do not show a duplicate payout-basis column when it equals net sales
- [ ] Portal Reports > Partner Dashboard export menu offers `Polished PDF report`, `Detailed Excel workbook (.xlsx)`, and `CSV reconciliation (.csv)`, and each download uses the same selected partnership, period mode, warning state, and machine scope; machine-scoped exports include machine history when trend periods are available
- [ ] Portal Reports > Operator view defaults to a compact Last 7 days / All machines toolbar; all seven date presets remain in one Date range control, Custom alone reveals From/To inputs, and More filters contains keyboard-operable Daily/Weekly/Monthly grouping plus one summarized payment selector
- [ ] Portal Reports > Operator view shows exactly one expanded Sales by day/week/month summary; daily grouping includes one row/card per selected calendar date including `$0.00` dates, while Detailed breakdown is collapsed by default with a visible row count
- [ ] Portal Reports > Operator view machine, payment, date-range, and grouping filters update KPIs, period summary, trend, detailed rows, applied-filter summary, Reset state, and export scope together; loading and failed states do not present missing data as confirmed zero sales
- [ ] Portal Reports > Operator view distinguishes fresh, selected-range-beyond-import, and import-freshness-unavailable states; zero rows say `No sales in loaded data` when freshness does not confirm source-system inactivity
- [ ] Portal Reports > Operator view compact filters, expanded More filters, collapsed/expanded Detailed breakdown, and period-summary rows remain readable, focus-visible, touch-friendly, and free of page-level horizontal overflow at `360x800`, `390x844`, `414x896`, and a representative desktop width
- [ ] Portal Reports role boundaries remain intact: an operator-only reporting user sees no Partner Dashboard control, machine rollups, or Partner Revenue Share; Corporate Partner and Super Admin users can open and leave assigned-machine drilldowns; baseline users stay blocked and signed-out direct loads redirect to login
- [ ] Portal Reports > Operator view export button downloads a branded, partner-ready PDF with executive summary, reporting period, KPI totals, machine rollup, warning state, generated timestamp, report reference, and row-level appendix; stale legacy export responses without the polished generator version are blocked instead of opened
- [ ] Annual operator PDF export completes without an Edge CPU-limit error; v6 keeps every detailed row, known component subtotals inside unresolved rows, omission counts, signed refund impacts, and page numbering. A partial row or machine subtotal carries an asterisk; complete accounting totals remain unavailable until every component is known. Manual and scheduled snapshot known totals match the same-scope dashboard, including known zero. Run `deno test --no-lock supabase/functions/_shared/sales-report-pdf-large.test.ts` for 225 / 9,509 / 15,680 rows; compare weekly and annual exports to the same loaded report and inspect the first, middle, and last pages. Existing issued PDFs remain unchanged.
- [ ] Portal Reports > Partner Dashboard generated PDF trend graph labels use full rounded-dollar values like `$1,500`, not compact values like `$1.5k`
- [ ] Portal Reports > Partner Dashboard generated XLSX workbook includes Summary, Machine Rollups, Period Trend, Assumptions, Warning State, and Reconciliation sheets; every sheet has a management-level tagline in `A2`, and workbook totals reconcile to the dashboard/PDF net sales and Partner Revenue Share for the same selected period and machine scope
- [ ] Portal Reports > Partner Dashboard partner-facing UI, print view, PDF, CSV, and XLSX copy says `Partner Revenue Share` instead of `Amount owed`, and downloadable artifact explanations use revenue-share/reporting language instead of settlement or payout-rule language
- [ ] On mobile widths (`360x800`, `390x844`, `414x896`), Portal Reports > Partner Dashboard keeps partnership/period/machine controls, Partner Revenue Share, warning notes, chart values, machine rollups or single-machine history, calculation detail, and PDF/CSV/XLSX export menu actions readable without exposing the view to non-super-admin users
- [ ] Corporate partner P0: super-admin can create a corporate partner, create a partnership/agreement, assign machines, configure machine tax assumptions, and configure typed revenue-share terms without developer support
- [ ] Corporate partner P0: super-admin can preview a completed weekly report before generating a PDF and sees any missing tax, missing assignment, missing financial-rule, or stale-data warnings
- [ ] Corporate partner P0: generated partner PDF includes the Bloomjoy logo, a senior-manager dashboard page, reporting period, trend over time, gross sales, refund impact, tax impact, net sales, payout basis, unit/fee/cost assumptions, split calculation, Partner Revenue Share, timestamp, and a partner-friendly report reference
- [ ] Corporate partner P0: generated partner PDF earns confidence through readable formulas, dynamic agreement terms, and a machine-level appendix with a total row, full readable machine labels, no machine IDs, no raw snapshot IDs, no trust-us copy, and no truncated table labels
- [ ] Corporate partner P0: blocking report warnings prevent PDF/CSV/XLSX generation server-side rather than appearing as partner-facing caveats
- [ ] Corporate partner P0: generated partner PDF is backed by an auditable snapshot/run record with period, rule version, assumptions, generated-by user, status, storage path, and warning state
- [ ] Corporate partner P0: super-admin can download the reviewed partner PDF for manual sending; scheduled auto-email is not required for V1 acceptance
- [ ] Corporate partner P0: generated partner CSV/XLSX exports match the weekly preview totals and machine rollup
- [ ] Non-admin user cannot generate or download corporate partner report PDFs from admin routes
- [ ] Non-admin user cannot access `/admin/reporting`
- [ ] Super-admin user can access `/admin/reporting`
- [ ] Admin can create a weekly partner PDF schedule with recipients and sees it in active schedules
- [ ] Admin reporting shows report export archive, partner report exports, recent sales/refund import runs, and stale/failed sync status clearly
- [ ] Admin Reporting > Exports shows multi-format partner report artifacts independently, labels PDF as the primary partner-facing report, labels CSV as the finance/reconciliation export, shows generated timestamps, and each artifact has its own Open action
- [ ] Admin Reporting > Sync shows a refund adjustment review summary/list where ambiguous, unmatched, duplicate, invalid, and missing-status rows require review and do not silently affect settlement
- [ ] Admin Reporting > Sync shows the latest live refund sync run after the scheduled workflow runs, and open/denied rows remain review-only
- [ ] Admin reporting does not mark sales import freshness as failed solely because an unrelated historical backfill failed when a recent daily import is fresh
- [ ] Admin Reporting > Sync lists imported machines needing setup with source name, read-only external machine ID, queued rows/revenue, latest sale, and last-seen time
- [ ] SnapCase existing-machine setup lists non-Sunze Snapcase machines and legacy Nayax-linked machines with account, location, and type context; a legacy target saves through the normal mapping action, while Sunze-bound machines remain absent.
- [ ] Admin can set up an imported machine from `/admin/reporting` by choosing the report/partnership and confirming machine label, location, and machine type, without entering a tax rate or editing the external machine ID
- [ ] Imported machine setup creates/updates the reporting machine, assigns it to the selected partnership, promotes queued sales rows, and shows the promoted row count/revenue in the success message; reporting uses verified source tax information
- [ ] Admin can ignore an imported machine and reopen it later without changing already configured reporting machines
- [ ] Failed, stale, or setup-needed sales ingest runs appear in `/admin/reporting` without changing existing configured sales facts incorrectly
- [ ] Non-admin user cannot access `/admin/audit`
- [ ] Super-admin user can access `/admin/audit`
- [ ] Super-admin can grant and revoke super-admin role with reason metadata
- [ ] Audit log view supports filtering and shows role + operational actions (support, orders, machine inventory)
- [ ] Signed-in super-admin can reach `/admin` from visible navigation without typing the URL manually

### People & Permissions roster (`#1296`)

- [ ] `/admin/access` loads an exposed people list without requiring a search or manual refresh; search and Role, Account, Status, and Machine filters update the result and survive a page reload.
- [ ] All, Needs attention, and Invited views show truthful states. Account members, Technicians, Corporate Partners, reporting access, admins, and pending Scoped Admin invites appear once per person with combined access labels.
- [ ] Selecting Chelsea opens the right-side detail drawer with effective access, account/scope, machine count, access sources, Technician pay setup, activity, and advanced details. Closing restores focus to the selected row.
- [ ] Edit access uses the existing source-specific permission checks, required reason fields, automatic readback, and audit entries; no manual Refresh action is shown.
- [ ] Open Technician Pay Report deep-links to Chelsea's selected pay profile and retains the selected technician after reload.
- [ ] A Scoped Admin sees only people whose account or machine access intersects their assigned machines; a non-admin cannot call the directory RPC.
- [ ] Each visible person shows the best available contact email and phone in the roster; opening the person shows an immediately visible Contact section with email, phone, and mailing/shipping address, using “Not on file” for missing values.
- [ ] A Scoped Admin can see contact details for people already inside their assigned account/machine scope but cannot retrieve contact details for an out-of-scope person through the directory RPC.
- [ ] At 1440px desktop and 390px mobile, the list has no horizontal page overflow and the drawer becomes a usable full-width detail surface with 44px primary controls.

### People & Permissions detail workspace (`#1349`)

- [ ] Selecting Chelsea opens a wide detail workspace with her current machine names, account/source, and assignment dates visible before access controls; no Customer context card is shown.
- [ ] The expand control switches the same person to full screen and back without losing the selected person or URL state; mobile remains full width and the layout is usable at 200% zoom.
- [ ] Active permissions appear before inactive options. `Add access type` reveals the source editors, while inactive forms do not clutter the default view.
- [ ] Technician actions expose Manage machines, Renew access, and Revoke Technician access. Manage machines shows one assignment picker with current assignments preselected; renewal and revocation each show a focused reason form.
- [ ] Revocation clearly states that Technician training and Technician-sourced reporting are removed, preserves unrelated sources, requires a reason, and uses a destructive confirmation action. Canceling or closing performs no write.
- [ ] Activity is collapsed by default and does not load until expanded. Pay report still opens with the selected Technician preserved.

### Refund Gmail sender routing (`#1384`)

- [ ] A new direct-human message to `refunds@bloomjoysweets.com` is ingested and
  any acknowledgement is sent in the same thread from **Bloomjoy Refunds
  <refunds@bloomjoysweets.com>**.
- [ ] A controlled synthetic direct-human refund inquiry addressed only to
  `info@bloomjoysweets.com` receives exactly one same-thread reply from the
  Refunds sender with `https://app.bloomjoyusa.com/refunds/request`; the link
  loads and the email alone creates no case. Repeat through Support only when
  that alias is confirmed to reach the same mailbox.
- [ ] With `REFUND_GMAIL_INFO_INQUIRY_ENABLED` absent or false, a scheduled Gmail
  run records `infoInquiry.enabled=false` with an observation time and never
  searches Info/Support or claims its form-link response, even if the shared
  first-contact mode is active. Enable the Info lane only for the reviewed
  controlled journey; confirm the health readback before any real-mail rollout.
- [ ] Synthetic vendor, technician, marketing, and unrelated Info messages
  receive no refund reply. A synthetic existing-case/status question is not
  asked to submit another form.
- [ ] Info-inquiry run counts reconcile considered, eligible, replied,
  suppressed, review-held, and failed threads. A marked eligible inquiry with
  no recorded sent response after 30 minutes makes Gmail health actionable;
  a prior manual same-thread reply suppresses a duplicate.
- [ ] A customer reply in an existing thread with a case-specific refund message
  is still ingested even if the historical thread began through the Info alias.
- [ ] Automatic status and completion emails for portal-created requests without
  an exact Gmail source use the transactional outbox once, with the refund
  message ID as the idempotency key; they do not fail with
  `gmail_source_thread_required` or attach to unrelated Gmail history.
- [ ] Automatic messages created from a Gmail request retain the exact original
  bound customer conversation and exact outbound provider Message-ID, and never fall back to a different conversation.
- [ ] An exhausted completion with a confirmed payment and no exact provider or
  Gmail send record can prepare one exceptional recovery of its original saved
  message after original-thread review. The reviewed current copy is bound to
  that message's exact case reference and amount; stale "on its way" or
  business-day timing language is rejected. A second preparation, any uncertain
  or sent effect, a different recipient/thread, or an incomplete payment is
  rejected; preparation makes no Nayax call or customer send. Any authorized
  delivery then settles only against exact original-thread Gmail proof.
## Gift card resolution (synthetic checks)

### Refund exceptions and English / Spanish (`#1687`)

- Open `/refunds/request` at 1280 px and 320 px. Switch English / Español after entering an email, date, time and amount. All answers stay in place; labels, options, help, visible validation and buttons switch language. The page has no horizontal overflow and both language buttons work by keyboard. At 200% browser zoom, the request/status controls remain readable and usable; at scroll position zero, status/wallet/thank-you language controls clear the fixed header.
- Select “Received fewer items than I paid for.” Describe three items paid / two received in the existing optional details. The request says Manager review and has no few-hours delivery promise. In the existing Manager card panel, a selected $30 charge defaults to $30; edit to $10 and verify the approval shows $10. Empty, negative, over-charge and three-decimal amounts block approval. Selecting a different transaction resets the default to its actual charge.
- For cash, select “Expected change from a cash payment.” Enter cash inserted $100 and expected change $90 in the two editable amount fields. The reported product cost is calculated as $10 and labeled as unverified; no Zelle/Venmo details appear. Manager review applies regardless of the no-change signs. An absent $90 denomination does not block review submission or promise a $90 gift. Repeat this through an email-linked form using synthetic intercepted transport.
- For an ordinary eligible gift, $25 remains automatic; $25.01 rounds to $30 and requires Manager review. Repeat, partial, change and high-value reasons appear together in the existing gift panel. Edit the affected/courtesy amount to $11; both value preview and approval show $15. The preview does not reuse an old gift card's locations/expiry as verified terms for the edited value. Verified terms appear after the decision. A missing verified denomination returns an approval error and does not show issuance success.
- Complete only synthetic or locally intercepted submissions. Review thank-you pages retain Manager-review timing on refresh; ordinary eligible gift pages keep their usual few-hours estimate. Secure status, wallet-update and purchase-update pages use Spanish from the saved case on a fresh browser and allow changing the language without resetting answers. Gift terms include eligible locations, expiry and one-use/no-leftover-balance rules in both languages.
- Preserve the existing documented cash flow for explicitly disabled, unconfigured machine pools; errors or stockouts on enabled pools never fall back to cash payouts. Do not use live customer cases, send real email or create provider value during these checks.
- The new expected-change choice is hidden for unconfigured or explicitly disabled gift machines. Switching to that machine resets an already selected expected-change category while keeping entered cash facts; an enabled pool with no current stock still permits the review request.

- With an explicitly disabled machine pool, cash still submits through the existing process. Once enabled, stockouts, missing denominations, failed requests and missing activation fields must never fall back to cash payment.
- Open `/refunds/request` at desktop, 375 px and 320 px. Cash offers a gift card; card offers the recommended gift card and an original-payment refund. Selecting an original-payment refund reveals card/wallet details; switching back hides and excludes them from submission.
- Before entering an amount or switching resolution, both card choices explain timing: gift cards are usually emailed within a few hours; original-card refunds take longer for purchase investigation and the payment-processor request. Cash shows the same gift-card timing. The gift-card thank-you page keeps the few-hour expectation and allows for review/delivery delays; no customer-facing 1–2-minute or bank settlement promise appears.
- Choose the machine and enter the purchase amount. Check the server offer's actual face value, eligible locations, exact expiry time/timezone, redemption instruction and one-use/no-leftover-balance terms before submission. A missing offer cannot be accepted. A grouped location uses its existing exact machine selector for gift cards.
- For Sunzee provider fixtures, authenticate a child operator under the configured merchant parent. Add/list use the child identity; imported coupons belong to the parent. A five-digit code remains exact without padding, its actual expiry is shown, and failed or unknown creation never creates another batch blindly. KeMore keeps its separate nine-digit code contract.
- Submit once to accept the displayed offer. Confirm original tender is retained, the normal thank-you/status link works after refresh, and a response-loss retry retains the same submission identity.
- Check `/refunds/status` with synthetic manager-review, stock-wait, issued/pending-email, transport-accepted and delivery-recovery responses. Review and stock waits do not ask the customer to resubmit. Transport acceptance never claims inbox delivery. No code, other case reference or prior issuance appears in the public status.
- In the existing manager refund workspace, review a repeat request with its proposed value and previous issuance together. One approval assigns/sends automatically; denial requires a note. A read-only actor sees the request without decision buttons. Gift-card cases do not show the old card-refund or cash-payout workbench.
- Check the canonical gift lifecycle through the Manager reader: assigned delivery and stock waits remain System work, a repeat retains its existing Manager decision, and sent/delivered or declined gifts close their work. Gift lifecycle detail parses without a monetary-accounting requirement or data-review warning; ordinary card receipt checks remain strict.
- On an issued case, correct the synthetic recipient and resend the same card. A lost response retries the same intent; no new issuance or financial deduction occurs. Used/expired codes and an unknown provider outcome cannot be blindly resent. An unauthorized actor has no recovery control.
- In a disposable migrated database, verify $11 purchase/$15 face value/$4 goodwill separately. Full reports before issuance retain the outstanding purchase; current reports resolve it without money paid or extra commission deductions. Duplicate lineage and redemption retain one purchase deduction and one canonical receipt.
- As a Super-admin, expand the initially collapsed **Gift card supply** section below the existing workspace. Verify denomination, locations, usable stock and automatic replenishment status. Configure the minimum/target/maximum stock only for an already configured pool; saving preserves provider setup and validity. A Manager sees no section or stock controls, and server authorization denial never reveals settings. There is no routine manual refill or code display.
- Render the gift-card email at desktop, 375 px and 320 px with images blocked. Value, code, one redemption step, locations and exact expiry/one-use terms remain readable. All checks use synthetic codes and email addresses; do not send a customer email or perform a financial test.
- Focused browser verification: start a local server with synthetic Supabase URL `http://127.0.0.1:59999` and a synthetic public key, then run `node scripts/refunds/refund-gift-card-browser.mjs` (default local URL `http://127.0.0.1:8097`; override with `REFUND_GIFT_CARD_UAT_URL`). Synthetic transport cannot certify real inbox timing or provider redemption.

### Reporting review refinements (#1708, #1709)

- Open Reporting with no dates: show the last seven completed days. A direct link to unavailable Finance falls back to an authorized Overview automatically, preserving dates and machine/location scope. Failed access must not reuse cached Finance permission. A successful denial never loads Finance data.
- Compare same dates in the prior year, including February 29 and a year boundary. Machines without prior-year records show unavailable/not comparable. Explicit URL and saved dates survive preset changes and reloads.
- Sales opens the detailed report with no sub-tabs. Enter from a one-machine/one-location Overview; every sales request retains both filters. The inherited location is named, Clear location works, and Reset clears machine/location/tender. Invalid linked scope never silently widens to all machines.
- Overview includes a collapsed machine/payment breakdown. Reports contain no unrelated Labor/Refund access diagnostic or partner setup alert. A blocked partner export remains disabled and says Export unavailable; figures are marked Preliminary. Admin Reporting shows failed service checks only; denied access is not an outage. Partner report setup links to the existing Weekly Preview reasons/fixes.
- Use `npm run reporting:preview` to review Finance on this computer with labeled sample data. Verify summary, disclosure, machine drilldown and CSV at desktop and 320/390 px. The launcher ignores real client settings and blocks external requests, unknown RPCs, mutations and server exports.

### Operational report homes and mobile navigation (#1708, #1709)

- At 320/390 px, central Reporting uses the labeled Report selector and all five options have visible 44 px targets. Desktop keeps Overview, Sales, Finance, Locations and Partners tabs. Location/machine rows, daily trend details and payment rows can be read without sideways scrolling on a phone.
- Follow labor/refund headlines from Overview and Locations. The owning app opens Reports with the same dates/location/machine; legacy `/portal/reports?view=labor` and `view=refunds` links retain the original scope. The full operational panels no longer appear in Locations.
- A labor-only or refund-only actor with no workflow capabilities can open the permitted report and its sidebar link, but cannot open the time editor or refund queue. Successful denial, failed service checks and failed cached permission checks never reveal report values or grant workflow actions. Failures do not repeatedly retry as shells mount.
- Invalid linked dates/location/machine block data requests. Scope-only changes preserve malformed linked dates until a person changes Period. CSV keeps the displayed report scope. Refund-only users do not see a Business overview link that redirects them back to the same report.
- Start synthetic dev on 8084 and run `npm run reporting:validate-operational-uat -- --app-url http://127.0.0.1:8084`; also run the workspace/access/Finance suites. For interactive sample review, `npm run reporting:preview` supports `/portal/time-review?view=reports` and `/refunds?view=reports` on 8097.
- Selected machine and payment filters remain named when More filters is closed. Remove one with a keyboard or touch and verify the dates, location and other selections survive. An unmatched location search offers Clear search without suggesting an import failure.
- Operational report totals precede detailed methodology, which remains available through a keyboard-operable disclosure. Unknown counts appear only when relevant and retain their correct request/date population. Labor load failures offer Retry. Populated Finance coverage must not claim there are no loaded sales.
- In a disposable database, a visible-machine accounting fact linked to an unauthorized or internal-test refund makes the Refund report's accounting totals Unavailable in the UI and CSV. Authorized payment/gift recovery stays visible; an unaffected date retains its legacy paid deduction. The SQL Finance fixture covers direct links, null-ID backlinks and recognition events; `node scripts/validate-refund-report-home-uat.mjs --app-url http://127.0.0.1:8084` covers unavailable rendering and export.

## Company assignment and reporting (#1719)

- In Sales (including detailed Sales), overview, Locations, Finance and Refund reports, select Company; dates, comparison and tender stay intact. Company totals match included machine rows, with unknown amounts retained. Old links/saved views default to All companies.
- Change Company with a location/machine selected: keep compatible selections and announce cleared incompatible ones. Invalid company links and empty intersections offer explicit recovery and never load all machines.
- In the full and redacted Refund queue, Company scopes counts and cross-status search. An authorized exact-case link takes precedence on arrival; deliberately changing Company clears a conflicting case link without losing unsaved work. Unresolved mappings remain visible under All companies.
- Verify company/current-company basis in CSV/PDF, scope revalidation at export, formula protection, and unchanged payment/decision permissions. Company reassignment keeps historical fact/case locations and dates.
- Check 320/390px, desktop, keyboard focus, long company names and 200% zoom without sideways navigation or page overflow. Run `node scripts/serve-reporting-preview.mjs --port 8106 --company-samples`, then `node scripts/validate-company-reporting-uat.mjs --app-url http://127.0.0.1:8106` for read-only synthetic UI coverage. Database authorization requires separate disposable-database verification.
# Unified machine identity setup (#1742)

- On `/admin/machines`, confirm source platform/original name/ID, exact Nayax name/ID/account, company, managers, operating state and last recorded transaction are visible together. Provisional, source-only and Nayax-only records remain available.
- Open Manage without leaving the portfolio. Search imported Nayax records by name, ID and account; select and save one. Exact ID/account are automatic; linked records cannot be assigned to another Hub machine. Refund readiness stays separate.
- Edit the single Machine name such as “Great Mall - Cotton Candy”; save and reload. Internal reporting location/timezone and other machines remain unchanged.
- Cancel an unsaved name/match close prompt and verify the draft stays. Background refresh preserves dirty drafts; a stale saved identity fails with reload guidance.
- Review “Last recorded transaction >30 days”, “No transactions recorded”, and oldest-first sorting. Unknown/stale import status stays visible; these filters do not establish genuine inactivity.
- Open Discover source machines on Machines. Connect Sunze to an existing Hub machine, or review the existing source setup dialog for a deliberate new record. SnapCase can link an existing Hub machine. Ignore/reopen controls stay available; source setup refreshes the portfolio.
- Existing `/admin/machines/:machineId`, `/admin/machines/inventory`, and Reporting > Sync routes remain usable. Run `deno test --no-lock src/lib/machineTransactionRecency.test.ts` and disposable database test `supabase/tests/machine_unified_setup.sql`.
# Simplified machine setup — issue1746

- [ ] Machines shows one editable Machine name; existing customer wording is retained until an explicit edit. Admin, customer options and reader replacement agree after save.
- [ ] Company, Type, State and combined Nayax picker measure at least44px high with16px text on mobile; opening the picker exposes searchable exact name/ID/account results.
- [ ] Refunds contains no provider/name mapping controls or links. Saving refund settings never submits a provider identity or stale name draft.
- [ ] Sunze/Kexiaozhan identities appear as original plain text. The normal catalogue equals the full authorized imported provider/account/ID set, including unbound, historical, ignored and unnamed sources. Hub-only history and Nayax-only inventory do not add physical rows/counts. Source setup filters imported unbound records; missing Hub metadata never hides imports.
- [ ] An unbound Sunze and Kexiaozhan row each opens the same Manage workflow with name, exact searchable Nayax choice, company, managers, read-only numeric sourced tax and original source ID. One save atomically creates setup and continues that editor; invalid reader/manager assignments leave no partial Hub, source mapping, internal association or audit.
- [ ] Owner-reviewed archived records are absent from management choices/counts and cannot be edited/recreated by repeat imports. Restricted optimistic archive/restore preserves every original field and linked financial/refund/timekeeping/correction/recovery/grant/QR history. Unbound Nayax inventory remains available separately.
- [ ] Partial or legacy Sunze coverage is visibly unverified without removing historical imported records. Sunze sale dates retain the provider calendar date; Kexiaozhan staged positive observations are not labeled as recorded Hub transactions.
- [ ] Help is keyboard/touch accessible, draft close protection works, and readiness/recency/import uncertainty remain visible.
- [ ] Name/company failures roll back together; label-only changes preserve shared venue/timezone, reader/source identity, history and refund permissions. No automatic archive occurs.
# Info refund auto-response repair (#1455)

- #1789: acknowledgment is the default for a direct customer, including
  `Please help`, a photo-only message, non-English text and pricing questions.
  Confirm one neutral same-thread reply with the conditional form link, no case
  before form submission, and no duplicate. Spam/trash, notification senders,
  known business/internal mail and existing-case questions stay excluded.
- Also test a completed purchase report without the word refund or a stock
  failure phrase: `I paid cash at the cotton candy machine, then my card was
  billed for the full amount`. Expect one same-thread link and clean replay.
  General pricing/payment-method questions receive the neutral acknowledgment
  under #1789; known business requests remain excluded.
- Send an owner-controlled non-manager inquiry to Info with subject `Refund`
  or body `The machine took my money`. Confirm the normal ten-minute scheduler
  produces one reply in the original thread with `/refunds/request`, leaves
  the contact awaiting the form, and creates no refund case.
- Confirm a later scan suppresses a second reply; existing-case status questions,
  business mail, automated mail and quoted complaints receive no new intake reply.
- Verify the existing Gmail health view and coalesced health alert report repeated
  primary scheduler failures even when the watchdog or another scanner succeeds.

### Source tax and Finance reconciliation
- Open `/portal/reports?view=finance` as a Finance-authorized user. Confirm sales including tax, refund deductions including tax, remaining tax, and net sales agree with the source-backed calculation.
- Expand the breakdown and confirm cash retains its full collected value. Compare the separate completed-refund reconciliation with Nayax without changing request-based deductions.
- Check an unresolved tax split: affected totals show Unavailable rather than zero or an inferred gross amount. Confirm desktop and 390px mobile layouts remain readable.
- Open `/admin/machines/:machineId?tab=reporting`. Normal machine forms have no editable tax rates; admin source diagnostics show verified, unclassified, missing, or unavailable source coverage.

### Partnership dated split and optional dates (#1784)

- At `/admin/partnerships`, verify No end date shows Ongoing and saves NULL. Unchecking reveals an empty optional date without defaulting today; an entered end survives reload and Clear restores Ongoing. At 320/390 px the full date and controls fit.
- For an existing partnership, use Change split, set effective-from, review named partner/Bloomjoy NET percentages and affected machines, and confirm once. Existing deduction controls stay locked; prior versions appear in History. Stale state/invalid totals/overlap fail without partial changes.
- Verify a transition week covered by two adjacent versions does not report missing partial-week terms. September financial measures and issued payout snapshots remain unchanged; October uses the new partner-wide rule, including later assigned machines.
- Machine additions use explicit Assignment effective from and exact source ID. The provisional LA Hub is not a new machine option; confirmed Peppa already assigned is a no-op. Never promote historical LA source orders into an unverified company.

- Under partnership History, Correct end date reviews a selected version/date and requires a reason. Confirm changes only that date through a guarded expected-snapshot writer; stale/overlapping correction and audit failure roll back. For approved Merlin repair, preserve old 30% Merlin / 70% Bloomjoy deductions and start while correcting its end to September 30 before adding October terms.

### Partnership terms correction (#1788)
- Open Bubble Planet or Merlin → Payout rules → Correct terms. Review September 1, 2026, the explicit sales-after-tax/refunds-only model, 70% partner / 30% Bloomjoy and zero additional deductions.
- Confirm prior terms end August 31 and the October breakpoint is replaced. September/October draft previews recalculate; issued reports/payouts, assignment dates and lifecycle dates remain unchanged.
- Verify stale terms or a failed save preserve both versions, drafts and audit state.
## Machine cash reporting exclusion (#1795)

- Admin Machines → Manage (or machine detail → Reporting): “Exclude cash from
  financial reporting” shows the saved state, saves immediately and persists on
  reload. Check desktop, 390px and 320px widths; switch is keyboard accessible.
- A failed save restores the stored state. Only a super-admin or scoped machine
  admin can save; another machine is outside scoped access. “Cash excluded” is
  visible on the catalogue row when enabled.
- On a synthetic mixed card/cash machine, enable exclusion: Sales, Finance,
  technician commission and partner paid-sale quantities omit cash for both
  historical and current periods. Card amount/count/tax, real refunds and actual
  expenses stay unchanged. Disable to restore raw cash eligibility.
- A late cash import stays excluded. Source telemetry remains available. A Pay
  Stub prepared before the policy changes cannot be published; retry prepares
  current totals. Already-issued statement payloads stay identical.
- Run `node scripts/validate-machine-cash-exclusion-uat.mjs` against localhost:8098
  and `npm run db:validate-migrations` for the full disposable SQL suite.

- Existing-reader reuse (#1802): in an unbound Sunze or Kex machine's Manage screen, choose the exact occupied reader and confirm the same physical machine. Save/reopen the same Hub with its source ID, name/company/managers/site/time zone/history intact and no separate financial-activation step. Nayax card and genuine source cash count once; retained app-card evidence adds no duplicate money, units, tax or per-stick costs. Failed continuation offers reads-only Retry, never a second write.
- Reader change (#1802): review explicit current/new IDs and owner, an actual calendar date for same-machine replacement, and actual local time/UTC occurrence for a move between different machines. Reject missing/invalid/repeated DST evidence, stale snapshots and failed preview reads. New imported sources and occupied readers save atomically; late failures leave no new Hub/site or ownership change. Reopen one current reader while original sales/refunds keep their exact original reader/tax; unproved switch-day imports remain pending. No production Gilroy pairing or transfer is inferred from its name.

- Same-machine source connection (Sunze/Kex): verify exact source and reader IDs, one Save disabled until “These are the same machine” is checked, tap/keyboard Connection details, and one write followed by reopen or reads-only retry at 390px. Do not save a production pairing during smoke verification.
- Already-bound source / separate historical reader (#1815): run `node scripts/validate-same-machine-reader-join-uat.mjs` and its `--webkit` variant against localhost. Verify both source providers at desktop/390px show the canonical historical name, one same-machine confirmation and Connect action without date fields; explicitly choosing an actual move restores dated review. Failed previews, changed snapshots and stale saves require fresh confirmation; failed post-save refresh allows reads-only retry. Full `npm run db:validate-migrations` must apply every migration and prove original 67 cash / 317 card ownership, historical-company financial eligibility, original refund routing, source identity and capability bits remain unchanged. Never join production records as a smoke test.

- New source setup: with no trusted time zone, verify the required searchable city/time-zone selector is blank, shows why Save is unavailable, and supports keyboard/touch selection and clearing. Select a valid zone to verify reader ownership; managers remain optional. A failed check offers a reads-only Retry reader check.

- Completed same-machine source connection: keep the existing machine visible in the initial setup cache with no source; delay refreshed setup after connection. Continue only after exact source identity arrives, change the machine name, save/reopen, and verify the same source ID persists. No production save in smoke tests.

- Reporting #1824: open `/portal/reports?view=machines`; verify every permitted machine appears, search/sort and company/location/tender filters retain scope, no loaded records differs from recorded zero, customer payments including tax remain separate from sales before tax/net, partial known amounts and CSV agree, and cash/card/refund/tax details remain readable at 320/390/768px.

## Original Sheet refund payment evidence (#1849)

- In disposable fixtures, preserve original column K purchase Card/wallet/Cash separately from column G payout preference. Verify Q Refund Amount and the existing approved-I fallback retain their source proof and financial hash.
- Reconcile exact retained source/hash/Machine/date/amount evidence twice; the second call changes zero. Preserve every financial field and both populated and NULL legacy fingerprints. Do not run a real whole-Sheet sync during release verification.
- Replay an unchanged older parser and a new parser with missing/contradictory K. Retain older verified evidence only for unchanged identity; newly checked missing/contradictory evidence supersedes its review. Refuse a stale full-payload optimistic update, and keep INSERT/amount/date/Machine/hash duplicate protections.
- Confirm actual transaction tax, including zero, cash and tax-exclusive amounts take precedence. Date-bound historical reader proof and explicit owner corrections must preserve original purchase tax without changing refund booking. Conflicting Finance evidence remains unresolved. Run the actual-source atomic rollback and populated annual monetary fixtures within the unchanged eight-second guard.
- Provisional-rate PDF: export a scope containing confirmed and provisional components. Confirm the cover and original row appendix retain confirmed amounts and missing counts; a separate Provisional tax estimates section shows confirmed, estimated and combined subtotals exactly once. Verify estimated zero, negative refund reversals, absent estimates and continuation pages. Estimates do not authorize payouts.
# Machine tax rate policies (#1824)

- Open an authorized machine's **Reporting** tab in `/admin/machines`. Check the effective rate, evidence status and rate history; legacy configured settings must be separately identified.
- Choose **Adjust rate**. Check **Past dates**, **Current and future**, and **Past and current**; verify the selected preset is visible and the first/last purchase dates stay editable. Historical starts must come from recorded history or explicit input, with no arbitrary cutoff.
- Preview a provisional rate. Verify separate known and estimated cents, the actual purchase-date range, unchanged original transaction tax and cash treatment, and counts of changed components. Change any draft field and verify **Save rate** is disabled until another preview succeeds.
- Save only in a disposable/synthetic test scope. Check provisional estimates in machine, dated and location reports and CSV/PDF; known plus estimated amounts must be added once, clearly labeled, and remain separate from confirmed payout amounts. Verify a later verified source rate replaces a provisional estimate.
- Check explicit zero, bounded historical dates, ongoing future dates, failed/expired/stale previews, unauthorized machine access and readable layouts at desktop, 390 px and 320 px. Do not change production rates as a smoke-test action.

## Refund manager case notices (#1863)

- Generate the synthetic notice previews with `node scripts/validate-refund-manager-email.mjs` (see the script's output directory). At 320px, 375px and desktop widths, check that Machine name, original requested amount, selected issue, customer comment and one View case button are readable without horizontal scrolling.
- Verify setup/lookup problems describe system work, ready headings match the current action, and only canonical payment uncertainty adds a no-repeat-payment caution. Do not infer payment state from a lookup error.
- Check missing/historical context, long comments, dark preference, blocked images and plain text. Never substitute the matched/approved amount for the original requested amount or add a duplicate Location name.
- Run the manager notification transport tests: current managers receive the bounded case summary; operations fallback receives no complaint/request enrichment; reassignment or revocation before send prevents provider access in both ordinary and aging notices. A proven pre-send routing failure must not become an unknown email delivery.
- Use synthetic fixtures only; do not create a live refund or send a customer/manager test email for visual verification.

