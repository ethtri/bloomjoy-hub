# Mobile-operator SEO evidence and release brief

Last reviewed: 2026-08-09

## Decision

Bloomjoy will treat food trucks, concession trailers, mobile-food operators, and established caterers as a focused content-and-conversion experiment. The first release is:

1. `/solutions/food-trucks` — the commercial fit and machine-selection page.
2. `/resources/business-playbook/food-truck-mobile-setup-guide` — the setup-readiness guide.

The follow-on release is:

1. `/resources/business-playbook/food-truck-dessert-add-ons` — the operator-first dessert comparison.
2. `/resources/business-playbook/food-truck-catering-dessert-menu` — the catering package guide.
3. `/resources/business-playbook/mobile-setup-fit-checker` — a conservative categorical fit checker.

The primary CTA is **Request a machine-fit quote**. It routes to `/contact?type=quote`, preserves an allowlisted machine interest and the canonical source path, and identifies the use case as mobile without storing free-form setup details in the URL or analytics. A **Check your setup** CTA may become primary after the fit checker is released and measured.

This release decision and CTA wording are approved through the owner's 2026-08-09 instruction to execute epic #722 and its issues. Ethan Trifari is the named Search Console and 30/60/90-day review owner. Credentials, account identifiers, exports, and customer data are not recorded here.

## Evidence classification

Recommendations use four evidence classes:

- **Verified domain demand:** Search Console query/page data for `bloomjoyusa.com`.
- **Owner field signal:** the owner's observation that current buyers include food-truck and mobile-food operators seeking an add-on.
- **Competitor observation:** current search results contain generic food-truck dessert lists and supplier/product pages, but little decision-grade robotic-machine fit guidance.
- **Inference to test:** a distinct, operator-first solution page plus practical setup content can earn non-branded discovery and improve quote quality.

The owner's mobile-operator signal is not yet verified domain demand. Search Console returned zero impressions and zero clicks for the target mobile query regex during the baseline period. This is a deliberate experiment, not a claim that Bloomjoy already ranks for or receives measurable search demand from these queries.

## Search Console baseline

Property: `sc-domain:bloomjoyusa.com`

Review scope:

- Search type: Web
- Period: 2026-05-09 through 2026-08-08 (three months)
- Last report update at review: approximately five hours prior
- Mobile-operator regex: `(?i)(food truck|mobile food|mobile food facility|concession trailer|catering|dessert add[- ]?on)`
- Limitation: filtered Search Console totals can be partial; low-volume queries may be withheld. The unfiltered table exposed 23 queries.

Unfiltered performance:

| Metric | Baseline |
| --- | ---: |
| Clicks | 32 |
| Impressions | 1,380 |
| CTR | 2.3% |
| Average position | 6.8 |

Target-cluster result:

| Cluster | Clicks | Impressions | Evidence status | Decision |
| --- | ---: | ---: | --- | --- |
| Food truck | 0 | 0 | Owner field signal only | Publish one solution page and measure |
| Mobile food | 0 | 0 | Owner field signal only | Use as supporting language, not a separate page |
| Mobile food facility | 0 | 0 | Jurisdiction-specific terminology; no domain demand | Cover cautiously in the setup guide |
| Concession trailer | 0 | 0 | Owner field signal plus competitor observation | Share the food-truck solution page |
| Catering | 0 | 0 | Existing event content plus owner field signal | Preserve existing startup intent; add established-operator guide |
| Dessert add-on | 0 | 0 | Competitor observation and inference | Publish the bounded comparison after P1 pages |

Representative current queries:

| Query | Clicks | Impressions | CTR | Position |
| --- | ---: | ---: | ---: | ---: |
| `bloomjoy sweets` | 6 | 203 | 3.0% | 3.2 |
| `bloomjoy` | 3 | 129 | 2.3% | 5.1 |
| `bloomjoy inc` | 1 | 114 | 0.9% | 5.2 |
| `cotton candy sticks` | 1 | 1 | 100% | 1.0 |
| `how to work cotton candy machine` | 0 | 2 | 0% | 87.0 |
| `sweet robo cotton candy machine` | 0 | 1 | 0% | 86.0 |

Representative current pages:

| Page | Clicks | Impressions | CTR | Position |
| --- | ---: | ---: | ---: | ---: |
| `/` | 25 | 1,133 | 2.2% | 5.7 |
| `/billing-cancellation` | 3 | 36 | 8.3% | 17.4 |
| `/machines/mini` | 2 | 34 | 5.9% | 9.2 |
| `/supplies` | 1 | 235 | 0.4% | 6.5 |
| `/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning` | 1 | 25 | 4.0% | 7.2 |
| `/machines` | 0 | 89 | 0% | 7.2 |
| `/machines/micro` | 0 | 81 | 0% | 10.0 |
| `/resources` | 0 | 50 | 0% | 6.8 |
| `/resources/business-playbook/mini-micro-event-catering-business-guide` | 0 | 5 | 0% | 8.2 |
| `/resources/business-playbook` | 0 | 4 | 0% | 6.3 |

## Sitemap, indexing, and enhancements

The canonical sitemap `https://www.bloomjoyusa.com/sitemap.xml` was submitted on 2026-03-09, last read on 2026-08-06, and reported **Success** with 25 discovered pages and no discovered videos.

Page indexing was last updated on 2026-08-06:

- 13 indexed pages.
- 7 discovered, currently not indexed.
- 5 crawled, currently not indexed.
- 4 expected redirect URLs.
- 2 intentionally blocked URLs (`app.bloomjoyusa.com/portal` and `/cart`).
- No duplicate/canonicalized exclusion was reported.

Enhancements at review time:

- Product snippets: 2 valid and 2 invalid. Remediation is owned by #618.
- Merchant listings: 2 valid and 0 invalid.
- Breadcrumbs: 2 valid and 0 invalid.
- HTTPS: 9 HTTPS and 0 non-HTTPS pages in the overview report.

### Route-level baseline

| Canonical public route | Search Console status |
| --- | --- |
| `/` | Indexed |
| `/machines` | Indexed |
| `/machines/commercial-robotic-machine` | Discovered — currently not indexed |
| `/machines/mini` | Indexed |
| `/machines/micro` | Indexed |
| `/supplies` | Indexed |
| `/plus` | Indexed |
| `/resources` | Indexed |
| `/resources/business-playbook` | Indexed |
| `/resources/business-playbook/planner` | Indexed |
| `/resources/business-playbook/payback-planner` | Indexed |
| `/resources/business-playbook/how-to-start-cotton-candy-vending-business` | Discovered — currently not indexed |
| `/resources/business-playbook/best-locations-for-cotton-candy-vending-machines` | Crawled — currently not indexed |
| `/resources/business-playbook/mini-micro-event-catering-business-guide` | Crawled — currently not indexed |
| `/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business` | Crawled — currently not indexed |
| `/resources/business-playbook/cotton-candy-machine-roi-sales-payback-planning` | Indexed |
| `/resources/business-playbook/how-to-pitch-location-owners` | Discovered — currently not indexed |
| `/resources/business-playbook/revenue-share-vs-rent-cotton-candy-machine-placement` | Discovered — currently not indexed |
| `/resources/business-playbook/commercial-vending-vs-event-catering` | Crawled — currently not indexed |
| `/resources/business-playbook/business-setup-basics-llc-ein-insurance-permits` | Crawled — currently not indexed |
| `/contact` | Discovered — currently not indexed |
| `/about` | Discovered — currently not indexed |
| `/privacy` | Discovered — currently not indexed |
| `/terms` | Indexed |
| `/billing-cancellation` | Indexed |

The four redirect exclusions are expected canonical-host redirects: the HTTP `www` URL, HTTP apex URL, HTTPS apex URL, and `app.bloomjoyusa.com/`. Manual indexing requests must be limited to a corrected, high-value canonical route after technical and content checks; they are not a bulk indexing strategy.

## Audience, job, and disqualifying fit

Primary audience: an established food-truck, concession-trailer, mobile-vending, or catering operator evaluating a visual dessert add-on.

Primary job: determine whether a Bloomjoy machine is plausible for the available space, power planning, staffing, service flow, cleaning, storage, and transport workflow, then start a qualified quote conversation.

Disqualifying or stop-and-confirm conditions:

- No verified space for the selected machine dimensions, service clearance, and guest/line flow.
- No approved electrical plan for the machine's rated/max power within the setup's total load.
- A requirement for Bloomjoy to certify generator compatibility, vehicle mounting, securing, transport orientation, ventilation, outdoor/weather use, or permit approval.
- No trained person available for a Mini/manual-stick service model.
- A required serving rate, revenue, margin, ROI, or payback guarantee.
- No workable cleaning/reset, sugar/stick storage, humidity/weather, or safe load-in plan.
- Local authority, licensed electrical, vehicle-engineering, manufacturer, venue, or insurer questions remain unresolved where their approval is required.

## Machine-fit claim matrix

`Approved` means the claim is already visible in the current public product/SEO source. It does not turn Bloomjoy into an electrical, engineering, vehicle, or regulatory authority.

| Claim | Source | Status for mobile pages | Required caveat |
| --- | --- | --- | --- |
| Mini dimensions: 430 x 555 x 1582 mm | `src/pages/products/Mini.tsx`, `src/lib/seoRoutes.ts` | Approved | Confirm measured space, access, and service clearance during quote review |
| Mini weight: 83.9 kg | `src/pages/products/Mini.tsx` | Approved | Weight alone does not establish safe vehicle mounting, handling, or transport |
| Mini: AC 110V/220V, 2400W maximum, 100W standby | `src/pages/products/Mini.tsx`, `src/lib/seoRoutes.ts` | Approved | Rated/max power does not establish generator compatibility or total-load safety |
| Mini cycle guidance: about 90 seconds; about 40/hour machine-cycle ceiling | `src/pages/products/Mini.tsx` | Approved as planning guidance | Not served throughput; pattern, manual stick feeding, guest/payment flow, staffing, and resets change results |
| Mini staffed planning range: about 25–35/hour | `src/pages/products/Mini.tsx`, `src/lib/seoRoutes.ts` | Approved as an estimate | Not guaranteed throughput; confirm the target service window |
| Mini uses manual stick feeding | Current Mini product copy and planning guidance | Approved | Requires staffed rhythm; do not imply unattended mobile operation |
| Commercial dimensions: 2001 x 643 x 1315 mm or 2001 x 671 x 1332 mm | `src/pages/products/CommercialRobotic.tsx` | Approved | Configuration must be confirmed during quote review |
| Commercial: AC 110V/220V, 2700W | `src/pages/products/CommercialRobotic.tsx` | Approved | Does not establish generator compatibility or total-load safety |
| Commercial cycle: 70–130 seconds | `src/pages/products/CommercialRobotic.tsx`, `src/lib/seoRoutes.ts` | Approved | Pattern and operating conditions affect cycle time; not a service guarantee |
| Commercial automatic stick dispensing and deeper pattern set | `src/pages/products/CommercialRobotic.tsx`, `src/lib/products.ts` | Approved | Commercial remains quote-only; final configuration is reviewed offline |
| Micro is a compact, basic-shape, lower-volume path | `src/pages/products/Micro.tsx`, `src/lib/seoRoutes.ts` | Approved as qualitative fit | Do not invent dimensions, weight, power, throughput, or mobile compatibility not published on the product page |
| Up to 1.5-year machine warranty and manufacturer remote support posture | Current Mini/Commercial product and support copy | Approved with existing posture | Final terms and channels are confirmed during quote and handoff; do not promise a Bloomjoy SLA |
| Vehicle securing, transport orientation, generator compatibility, ventilation, outdoor/weather approval | No approved model-specific evidence in the repository | Unavailable; exclude as a claim | Present only as buyer questions requiring manufacturer/professional/local confirmation |
| Permit or “mobile food facility” approval | Jurisdiction-controlled | Unavailable; never promise | Terminology and requirements vary. For example, California separately regulates mobile food facilities and requires enforcement-agency approval of equipment installation in applicable cases |

## Query-to-page and cannibalization map

| Canonical page | Unique primary intent | Owns | Must not own |
| --- | --- | --- | --- |
| `/solutions/food-trucks` | Is a robotic cotton candy machine a plausible dessert add-on for my existing mobile operation? | Audience fit, operating models, machine path, constraints, disqualifiers, quote next step | Detailed setup checklist, broad dessert rankings, startup instructions, package template |
| `/resources/business-playbook/food-truck-mobile-setup-guide` | What must I check before fitting a machine into or alongside a mobile setup? | Space/power/load-in/cleaning/storage/workflow checklist and stop conditions | Product-category sales pitch, definitive electrical/vehicle/legal advice |
| `/resources/business-playbook/food-truck-dessert-add-ons` | Which bounded dessert add-on best fits my truck's operating constraints? | Original comparison across prep, storage, cooking, power, staffing, waste, weather, visual draw, and complexity | Cotton-candy-only setup depth or unsupported profit ranking |
| `/resources/business-playbook/food-truck-catering-dessert-menu` | How can an established mobile operator outline a dessert add-on for catering proposals? | Service-window/package template, responsibilities, terms to confirm | Generic business startup or machine engineering guidance |
| `/resources/business-playbook/mobile-setup-fit-checker` | Which fit band and unresolved checks apply to my categorical setup inputs? | Transparent, testable fit rules and safe quote handoff | Definitive compatibility, engineering, permit, throughput, or financial recommendation |
| `/resources/business-playbook/mini-micro-event-catering-business-guide` | How do I start a portable cotton-candy event/catering business? | New-operator launch, bookings, equipment, staffing, and event-day rhythm | Established food-truck add-on strategy |
| `/machines/*` | What does this Bloomjoy model offer? | Model-level visible specs, proof, support posture, and quote path | Mobile-industry operating guide |

## Publish-ready briefs

### Food-truck and concession-trailer solution page

- Audience/H1: Food-truck and concession-trailer operators evaluating robotic cotton candy.
- First viewport: name the audience, say Mini is the first model to evaluate for staffed compact service while Commercial requires a larger reviewed setup, identify space/power/workflow as the first constraint, and offer **Request a machine-fit quote**.
- Core sections: three operating patterns; fast fit screen; machine comparison; space/power/service/cleaning/storage/transport questions; when it is not a fit; setup-guide handoff; FAQs; quote CTA.
- Required FAQ topics: machine path, staffed versus automated stick flow, what power numbers do and do not prove, installed versus adjacent placement, and what Bloomjoy cannot approve.
- Boundaries: no generator, securing, transport, ventilation, weather, permit, revenue, ROI, margin, delivery, or availability guarantee.

### Mobile-food setup guide

- Audience/H1: mobile-food operators qualifying a truck, trailer, cart, or adjacent event station.
- Core sections: choose installed versus adjacent placement; model facts; available-space worksheet; total electrical-load questions; load-in and transport questions; heat/ventilation/weather/humidity questions; supplies/cleaning/reset; guest/payment/line flow; local and professional approvals; stop/confirm list; printable checklist; quote handoff.
- Regulatory posture: use “mobile food facility” as an example of jurisdiction-specific language. Link maintained official sources only and tell readers to confirm with their enforcement agency.
- Boundaries: do not derive generator compatibility from watts/volts, safe mounting from weight, or regulatory approval from product classification.

### Food-truck dessert add-on comparison

- Audience/H1: established mobile operators comparing cotton candy, cookies/brownies, churros/fried desserts, ice cream/frozen desserts, and one owner-approved fifth option.
- Criteria: prep, storage, cooking/frying, electrical demand, footprint, service rhythm, staffing, spoilage/waste, weather sensitivity, portability, visual draw, catering fit, and operational complexity.
- Format: mobile-friendly criterion cards followed by a compact summary; avoid a wide, horizontally dependent table.
- Conclusion paths: likely cotton-candy fit, needs setup confirmation, or another dessert category is a better fit.
- Boundaries: cotton candy must not “win” every criterion; no profit, price, margin, demand, permit, or service-speed promises.

### Food-truck catering dessert-menu guide

- Audience/H1: an established food-truck or catering operator adding a dessert experience to proposals.
- Core sections: select a service window and menu; servings as an estimate rather than a promise; staffing; travel/setup responsibility; power responsibility; weather/cancellation; COI/venue paperwork; per-serving versus fixed-event planning structures; reusable package-outline template; machine-fit next step.
- Boundary from existing event guide: this page starts with an operating business and produces a proposal-ready outline; the existing guide owns startup, booking, and initial event-business formation.
- Boundaries: no Bloomjoy package offer, recommended price, booking forecast, serving guarantee, margin, or local-acceptance promise.

## CTA and internal-link map

- `/solutions/food-trucks` links to the setup guide, Mini, Commercial, Micro, machine comparison, planner, payback planner, existing event guide, supplies, and quote intake.
- The setup guide links back to the solution page, each model, the existing event guide, planner, and quote intake.
- The comparison and catering guides link to the solution page, setup guide, relevant model pages, planners, and quote intake.
- `/resources` and the Business Playbook index add a visible **Food Trucks & Mobile Operators** entry point.
- Contextual links from `/machines`, Mini, Commercial, Micro, and the existing event guide use descriptive anchor text and avoid sitewide keyword repetition.
- Quote URLs allow only `type=quote`, an approved `interest`, canonical `source`, and a bounded mobile-use category. No arbitrary referrer URL, free-form setup note, or exact financial input is carried.

## Asset shot list

Do not delay the no-proof content release for assets, and do not use staged imagery as customer proof.

- Tape-measure photos for Mini width, depth, height, and service access.
- Real load-in sequence showing people/equipment used, without implying a universally safe method.
- Installed and adjacent pop-up layouts, each captioned as one example rather than an approved configuration.
- Power/data-plate close-up paired with “confirm total load and approved source” copy.
- Staffed Mini stick-feed and guest/payment flow clip.
- Commercial automatic-stick and line-flow clip in a suitable venue context.
- Cleaning/reset and sugar/stick storage sequence.
- Humidity/weather shutdown example if an approved operating procedure exists.
- Vertical 9:16 clips: fit screen, three stop conditions, installed-vs-adjacent distinction, and setup-checklist teaser.
- One diagram showing the decision boundary among Bloomjoy quote review, manufacturer instructions, licensed electrical/vehicle professionals, venue/insurer review, and local enforcement.

## Measurement and review

The content experiment succeeds only if measurement separates discovery from conversion quality.

- Day 0: publish only after analytics, attribution, quote intake, SEO metadata/prerendering, and privacy checks pass.
- Day 30: review indexing, impressions, queries, CTA engagement, quote starts, quote completions, and qualified mobile-use leads. Avoid conclusions from very small samples.
- Day 60: compare solution/setup/comparison/catering intent, internal-link assists, and lead quality; improve titles, snippets, and decision content where evidence supports it.
- Day 90: keep, consolidate, rewrite, or retire pages based on indexed visibility, non-branded demand, engagement, qualified-lead contribution, and sales usefulness.

Baseline limitations and first-review date must stay attached to #726. Search Console data should be recorded as redacted totals or tables, never as an account export containing sensitive information.

## Follow-up ownership

- #618: sitemap freshness and the two invalid product-snippet items.
- #615: production analytics provider and privacy-safe event coverage.
- #616: durable first/last-touch lead attribution.
- #617: quote-specific intake and visible context confirmation.
- #622: reusable proof rendering; no proof is published until permission exists.
- #623: earlier planner discovery and safe quote context.
- #626, #724, #729, #730, and #725: the approved content/tool releases described above.
- #731 tracks the 12 public routes excluded on 2026-08-06; expected redirects and private/cart exclusions are not defects.

## Sources

- Search Console property reports reviewed 2026-08-09; redacted totals and route statuses are reproduced above.
- Current repository product pages and `src/lib/seoRoutes.ts` for already-published product claims.
- [California Retail Food Code, Chapter 10](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=&chapter=10.&division=104.&lawCode=HSC&part=7.&title=), as one example showing that “mobile food facility” is jurisdiction-specific and subject to enforcement-agency/equipment review. This example is not nationwide legal advice.
- [2022 FDA Food Code](https://www.fda.gov/media/164194/download) as a general model-code reference; state and local adoption/requirements must be checked separately.
- Current search-result review for the four seed searches `cotton candy machine for food truck`, `food truck dessert add ons ideas`, `mobile food facility cotton candy machine`, and `concession trailer dessert ideas`; this is competitor observation, not demand-volume evidence.
