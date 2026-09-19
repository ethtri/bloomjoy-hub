# Mobile-operator social launch package

Issue: `#728`  
Related epic: `#722`  
Prepared: 2026-08-10  
Campaign owner: Marketing/CMO  
Claim review: Operations  
Lead-quality review: Sales

## Status and release gate

This is the approved-review package, not authorization to publish. It contains the message architecture, channel-ready copy, production shot plans, destination URLs, attribution convention, and a five-week relative calendar. Posting credentials, drafts, raw footage, releases, and account identifiers stay outside the repository.

Set `T` (launch day) only after all of the following are true:

- The five canonical destination pages return HTTP 200 with the intended canonical URL.
- `#615` has production consent and analytics coverage verified for destination views and agreed CTA events.
- `#616` has been released in migration -> Edge Function -> SPA order and a production-safe test confirms the social UTM values reach a redacted lead record.
- The owner approves the final accounts, channel list, copy, publish window, and real Bloomjoy footage.
- Operations approves every visible product fact and operating sequence in the final cuts.
- Anyone recognizable in footage, and any customer/venue/machine location shown, has the required written usage permission. Staged Bloomjoy footage must be labeled as an example and must not be presented as customer proof.
- Captions, alternative text, covers, links, crops, music rights, and mobile safe zones pass the pre-publish checklist in this document.

Until then, keep `#728` open and blocked. Do not substitute generic stock footage, an invented operator story, or an unverified setup to satisfy the schedule.

## Message architecture

### Audience and question

The primary reader already operates a food truck, concession trailer, mobile-vending business, or catering service and is asking:

> Could robotic cotton candy work as a dessert add-on inside the operation I already run?

This is not a startup-income campaign. It is an operating-fit campaign for a buyer with an existing service model.

### Anchor message

> A robotic cotton-candy machine can be a distinctive dessert add-on, but fit starts with space, approved power planning, staffing, service flow, cleaning, storage, and transport questions—not with a revenue or compatibility promise.

### What Bloomjoy can credibly offer

- Published machine facts and a clear path for comparing Mini, Micro, and Commercial.
- Practical questions for space, total load, workflow, cleaning, storage, service, and local review.
- A conservative categorical fit checker and a Commercial machine-fit quote conversation.
- Honest stop conditions and a clear boundary between Bloomjoy, the manufacturer, qualified professionals, venues/insurers, and local authorities.

### What the campaign must never imply

- That a machine will fit a particular truck, trailer, generator, circuit, mount, doorway, venue, climate, or jurisdiction.
- That watts alone prove generator compatibility or that machine weight proves safe mounting/transport.
- Guaranteed throughput, line speed, demand, bookings, income, margin, ROI, payback, permit approval, delivery timing, availability, or service response.
- A customer endorsement, typical result, operating record, or approved installation unless documented permission and context exist.
- That Mini or Micro can enter Bloomjoy's Commercial quote path. Commercial remains the only quoted machine; Mini and Micro retain their product paths.

### Voice and creative rule

Use an operator-to-operator voice: specific, visual, calm, and willing to say "confirm this" or "this may not fit." Open with the buyer's decision, show the physical or workflow evidence, name the boundary, and end with one useful destination. Avoid trend-chasing language, passive-income framing, and generic lifestyle footage.

## CTA and destination architecture

Each asset has one canonical destination and one primary CTA. The social post does not send people directly to several competing pages.

| Asset ID | Primary audience question | Primary CTA | Canonical destination |
| --- | --- | --- | --- |
| `fit-video-v1` | Will it fit in my food truck or trailer? | Review the food-truck machine path | `https://www.bloomjoyusa.com/solutions/food-trucks` |
| `setup-carousel-v1` | What should I check before I plan the setup? | Use the seven-point setup guide | `https://www.bloomjoyusa.com/resources/business-playbook/food-truck-mobile-setup-guide` |
| `dessert-carousel-v1` | Which dessert add-on fits my operating constraints? | Compare the operating tradeoffs | `https://www.bloomjoyusa.com/resources/business-playbook/food-truck-dessert-add-ons` |
| `catering-short-v1` | What belongs in a catering dessert package outline? | Build the package outline | `https://www.bloomjoyusa.com/resources/business-playbook/food-truck-catering-dessert-menu` |
| `workflow-clip-v1` | Which setup questions are still unresolved? | Check the setup | `https://www.bloomjoyusa.com/resources/business-playbook/mobile-setup-fit-checker` |

The destination page owns the next machine, checker, guide, or Commercial quote action. Do not add a second URL to the social caption.

## Attribution convention

Use this exact pattern for owned social links:

```text
{canonical_destination}?utm_source={channel}&utm_medium=organic-social&utm_campaign=mobile-operator-launch-2026&utm_content={asset_id}
```

Allowed values:

| Field | Values |
| --- | --- |
| `utm_source` | `linkedin`, `instagram`, `facebook`, `youtube` |
| `utm_medium` | `organic-social` |
| `utm_campaign` | `mobile-operator-launch-2026` |
| `utm_content` | One Asset ID from the destination table; use `-recut` before `-v1` for the approved second cut |
| `utm_term` | Omit for this launch |

Example LinkedIn URL:

```text
https://www.bloomjoyusa.com/solutions/food-trucks?utm_source=linkedin&utm_medium=organic-social&utm_campaign=mobile-operator-launch-2026&utm_content=fit-video-v1
```

Copy-ready URLs for all five assets across the four planned channels are in `Docs/MOBILE_OPERATOR_SOCIAL_LINKS.csv`. Every row is deliberately marked `draft-not-approved`; the publisher changes that status only in their private operating system after native-composer approval, not in this repository.

Rules:

- Use lowercase ASCII tokens and the exact canonical path. Never place a name, email, phone number, account ID, lead note, vehicle identifier, location detail, or free-form setup description in a UTM.
- Do not add `gclid`, `fbclid`, or another click ID to repository-tracked URLs. Platforms may append their own parameters; `#616` deliberately does not persist them.
- Do not add the internal contact-flow `source` parameter to a social destination. The canonical content page supplies its own allowlisted source if the visitor later enters the quote flow.
- Record only published channel, asset ID, date, and public link in the issue. Do not commit raw platform exports or audience/account data.

## Production standards

Create one reusable master per format:

- Short video master: 9:16 at 1080 x 1920, 30 fps, 30-45 seconds unless the brief says otherwise. Keep essential text, logos, measurements, and faces away from all outer edges so platform controls cannot cover them.
- Feed fallback: derive a 4:5 at 1080 x 1350 cut only after checking every crop; do not auto-crop measurement labels or disclaimer text.
- Carousel master: 4:5 at 1080 x 1350 per panel. Use one idea per panel, large type, high contrast, and a text-safe center area. Export an accessible PDF version for LinkedIn document posting only after a manual preview.
- Cover/thumbnail: short question, real machine detail, no tiny specification block, and no unsupported "fits any truck" language.
- Video accessibility: human-review all burned-in captions and upload a native caption file where the channel supports it. Include meaningful non-speech cues. Do not rely on audio to communicate measurements or cautions.
- Static accessibility: write channel-native alternative text that describes the machine, measurement/action, and purpose rather than repeating the caption. Keep the same reading order in the visual and alt text.
- Audio: use original voice/ambient sound or music with documented publishing rights. The message must remain complete when muted.

Current platform references to recheck at final export:

- [Instagram Reel size and aspect-ratio guidance](https://www.facebook.com/help/1038071743007909)
- [Instagram alternative-text editing](https://www.facebook.com/help/instagram/503708446705527)
- [LinkedIn video sharing, captions, safe zones, and specifications](https://www.linkedin.com/help/linkedin/answer/a7174587)
- [YouTube Shorts upload guidance](https://support.google.com/youtube/answer/12921536)
- [YouTube supported caption files](https://support.google.com/youtube/answer/2734698)

Platform behavior changes. The publishing owner must preview every final draft in the native composer rather than treating this repository note as a permanent platform specification.

## Asset 1: "Will it fit in my food truck?" measurement/spec video

Asset ID: `fit-video-v1`  
Primary channels: Instagram Reel, Facebook Reel, LinkedIn native video; optional YouTube Short after channel-owner confirmation  
Length/master: 35-45 seconds, 9:16  
Destination: food-truck solution page

### Required footage and sequence

| Time | Real visual | Voice/on-screen point |
| --- | --- | --- |
| 0-3s | Mini beside a tape measure; no generic truck stock | `Will it fit? Start with the setup—not the sales pitch.` |
| 3-10s | Measure published Mini width/depth/height with labels | `Mini publishes 430 x 555 x 1582 mm. Measure the real path, working clearance, and guest flow.` |
| 10-16s | Weight label or safe static product detail | `83.9 kg is a planning fact, not proof of safe mounting or transport.` |
| 16-23s | Data plate/power label and the setup's total-load worksheet | `AC 110V/220V and 2400W maximum do not certify a generator or circuit plan.` |
| 23-31s | Staffed stick feed, guest handoff, cleaning/reset detail | `Staffing, service rhythm, cleaning, and storage matter as much as footprint.` |
| 31-38s | Installed and adjacent layouts labeled `examples only`, if approved footage exists | `Installed and adjacent setups create different questions. Neither is universally approved.` |
| 38-45s | Solution-page screen and real machine detail | `Review the food-truck machine path before you quote.` |

If the exact measurement cannot be shown truthfully with the visible model, remove the number from the cut and link to the page. Never composite a tape measure onto unrelated footage.

Cover: `Will it fit in your food truck?`  
Alternative text: `A real Bloomjoy Mini machine being measured for width and height, followed by power-label, staffed-service, and cleaning details used in a mobile setup review.`

Channel-ready copy:

- LinkedIn: `The useful food-truck question is not just “Will the machine fit?” It is whether the full setup has verified access, working clearance, an approved total-load plan, a staffed service rhythm, cleaning/storage space, and a safe transport review. This walkthrough treats the published Mini facts as planning inputs—not a universal compatibility claim. Review the food-truck machine path: {tracked_url}`
- Instagram/Facebook: `Will it fit? Start with the full setup: access, working clearance, total load, staffing, service flow, cleaning, storage, and transport review. Published machine facts help you ask better questions; they do not certify a truck or generator. Review the food-truck machine path: {tracked_url}`
- YouTube title/description: `Will a robotic cotton-candy machine fit a food truck? | Start with these checks` / `Published Mini measurements and power facts are planning inputs, not a compatibility approval. Review space, total load, staffing, workflow, cleaning, storage, and transport questions here: {tracked_url}`

## Asset 2: seven-point mobile setup checklist carousel

Asset ID: `setup-carousel-v1`  
Primary channels: Instagram carousel, Facebook carousel, LinkedIn document  
Format: nine 4:5 panels (cover + seven checks + CTA)  
Destination: mobile setup guide

Panel copy:

1. `Seven checks before adding robotic cotton candy to a mobile setup`
2. `1. Space + access` / `Measure the machine path, working clearance, door/ramp route, guest line, and service access.`
3. `2. Total electrical load` / `Use the published machine rating as one input. Confirm the complete approved source, circuit, and concurrent load.`
4. `3. Staffing + stick flow` / `Mini uses manual stick feeding. Plan who operates, takes payment, hands off orders, and resets the station.`
5. `4. Load-in + transport` / `Weight and dimensions do not establish a safe mount, orientation, restraint, ramp, or handling method.`
6. `5. Cleaning + storage` / `Plan reset access, waste, sugar/stick storage, humidity control, and the end-of-service clean.`
7. `6. Guest + payment flow` / `Keep the queue, handoff, staff movement, and payment step from competing for the same space.`
8. `7. Local + venue review` / `Confirm the questions owned by local authorities, the venue, insurer, manufacturer, and qualified professionals.`
9. `A checklist narrows the unknowns. It does not approve the setup.` / `Use the full mobile setup guide.`

Cover: `Seven mobile setup checks`  
Alternative text: `Nine-panel checklist covering access, total electrical load, staffing, transport, cleaning, guest flow, and local or venue review for a mobile robotic cotton-candy setup.`

Channel-ready copy:

- LinkedIn: `A machine footprint is only one line in a mobile setup plan. These seven checks organize the physical, electrical, staffing, transport, cleaning, guest-flow, and local-review questions that should be resolved before a quote. Save the checklist, then use the full guide: {tracked_url}`
- Instagram/Facebook: `Save this before you plan the setup: space + access, total load, staffing, load-in + transport, cleaning + storage, guest + payment flow, and local + venue review. It is a question set—not an approval. Full guide: {tracked_url}`

## Asset 3: dessert add-on comparison carousel

Asset ID: `dessert-carousel-v1`  
Primary channels: Instagram carousel, Facebook carousel, LinkedIn document  
Format: eight 4:5 panels  
Destination: dessert add-on comparison

Panel copy:

1. `Which dessert add-on fits the operation you already run?`
2. `Compare the work—not a winner` / `Look at prep, storage, cooking, power, footprint, service rhythm, staffing, waste, weather, portability, visual draw, catering fit, and complexity.`
3. `Robotic cotton candy` / `Strong visual theater and a bounded menu path; confirm machine fit, complete load, staffing, humidity/weather, cleaning, and transport.`
4. `Cookies + brownies` / `Familiar and potentially simple at service; upstream baking, packaging, freshness, storage, and differentiation still matter.`
5. `Churros + fried desserts` / `Made-to-order appeal; cooking equipment, oil, heat, ventilation, cleaning, safety, and service rhythm create heavier obligations.`
6. `Ice cream + frozen desserts` / `Familiar and flexible; cold-chain capacity, freezer power, temperature control, melt risk, and weather sensitivity are central.`
7. `Fresh fruit cups + skewers` / `Fresh visual option; refrigeration, washing/prep controls, cut-fruit handling, spoilage, and short holding windows need a real plan.`
8. `The best add-on is the one your workflow can support.` / `Compare all thirteen operating criteria.`

Do not add price, margin, food cost, popularity, demand, speed, permit status, or a combined score. Cotton candy must retain its heavier-obligation items.

Cover: `Compare dessert add-ons by operating fit`  
Alternative text: `Eight-panel balanced comparison of robotic cotton candy, cookies and brownies, fried desserts, frozen desserts, and fresh fruit across practical operating obligations.`

Channel-ready copy:

- LinkedIn: `A useful dessert comparison should not force one category to win. It should make the operating work visible. We compared five add-on paths across thirteen criteria—from prep and power to staffing, waste, weather, portability, and catering fit—without inventing price or profit claims. Compare the tradeoffs: {tracked_url}`
- Instagram/Facebook: `Do not pick a dessert add-on from the highlight reel. Compare the work: prep, storage, cooking, power, footprint, staffing, waste, weather, portability, service rhythm, and catering fit. Five categories, thirteen criteria, no forced winner: {tracked_url}`

## Asset 4: catering-package explainer short

Asset ID: `catering-short-v1`  
Primary channels: Instagram Reel, Facebook Reel, LinkedIn native video; optional YouTube Short  
Length/master: 30-40 seconds, 9:16  
Destination: catering dessert-menu guide

### Required sequence

1. Hook over a real staffed service moment: `A dessert package needs more than a menu.`
2. Show a blank proposal/clipboard: `Define the service window, planning estimate, menu, and staffing.`
3. Show load-in/power/space details: `Assign travel, load-in, power, setup, and venue responsibilities.`
4. Show weather and paperwork prompts: `State the weather, change, cancellation, payment/deposit, COI, and paperwork questions.`
5. Show two blank structure cards: `Fixed-event and per-serving are planning structures—not recommended prices.`
6. CTA over the static reusable outline: `Build your own package outline.`

Cover: `What belongs in a catering dessert package?`  
Alternative text: `A real staffed dessert-service sequence paired with a blank package outline covering service, staffing, setup responsibilities, weather, changes, payment posture, and venue paperwork.`

Channel-ready copy:

- LinkedIn: `A catering dessert package is understandable when the buyer can see the scope and responsibility split—not when they are given a vague menu and a price. This outline covers ten decisions, two planning structures, and the questions the operator must answer. It is not a Bloomjoy offer, quote, contract, or pricing recommendation. Build the outline: {tracked_url}`
- Instagram/Facebook: `A package needs more than a menu. Define the service window, planning estimate, staffing, travel/load-in, power/setup responsibility, payment posture, weather, changes, and venue paperwork. Build your own outline—without a made-up price promise: {tracked_url}`
- YouTube title/description: `Build a clearer food-truck catering dessert package` / `Use a blank operator-owned outline for scope, responsibilities, weather, changes, payment posture, and venue paperwork. This is planning guidance—not a Bloomjoy package or price recommendation: {tracked_url}`

## Asset 5: real event/setup workflow clip

Asset ID: `workflow-clip-v1`  
Primary channels: Instagram Reel, Facebook Reel, LinkedIn native video; optional YouTube Short  
Length/master: 35-45 seconds, 9:16  
Destination: mobile setup fit checker

### Required footage and sequence

Use one real Bloomjoy-owned or fully permissioned setup. Label it `One example workflow—not an approved configuration.`

1. Arrival and access-path check.
2. Measured placement/clearance check; do not show an improvised mount or unsafe lift as recommended practice.
3. Data-plate and approved-source/total-load review; do not claim generator compatibility.
4. Supplies and cleaning/reset staging.
5. Staff position, payment, guest queue, and handoff.
6. Shutdown, clean, inventory, and pack-out.
7. CTA: `See which questions are resolved—and which still need confirmation.`

If no real, permissioned full workflow exists, publish a shot list preview only inside the issue and keep the asset unpublished. Do not create a composite "customer" workflow.

Cover: `A mobile setup is a workflow, not a footprint`  
Alternative text: `One permissioned example of arrival, placement review, power planning, supply staging, staffed service flow, cleaning, and pack-out for a robotic cotton-candy setup.`

Channel-ready copy:

- LinkedIn: `A machine can fit on paper and still fail the operating workflow. This example walks through access, placement, total-load review, supplies, staffing, guest flow, cleaning, and pack-out. It is one example—not an approved configuration. Check which categories your setup has resolved: {tracked_url}`
- Instagram/Facebook: `A mobile setup is a workflow, not just a footprint: access, placement, total load, supplies, staff position, payment, queue, handoff, cleaning, and pack-out. One example—not a universal approval. Check your setup: {tracked_url}`
- YouTube title/description: `A mobile robotic cotton-candy setup is more than a footprint` / `Walk through one example workflow from arrival to pack-out, then use the categorical checker to identify unresolved questions. This is not a compatibility approval: {tracked_url}`

## Five-week launch calendar

`T` is the owner-approved launch date after the release gate passes. Marketing/CMO publishes; Operations signs off on facts and visible workflow; Sales records aggregate question/lead-quality themes. If a scheduled asset lacks approved real footage, skip it and continue with the next approved asset rather than filling the slot with generic material.

| Window | Channel + format | Asset / reuse | Owner and approval state | CTA + destination | Follow-up |
| --- | --- | --- | --- | --- | --- |
| T-3 to T-1 business days | Native composer drafts only | All five covers, captions, links, crops, alt text, and caption files | Marketing builds; Operations and owner approve; not public | No publish action | Run the launch QA checklist and record approved asset versions privately |
| T (Week 1) | LinkedIn native video; Instagram/Facebook Reel | `fit-video-v1` | Marketing; owner + Operations approval required | Review the food-truck machine path -> solution page | Sales gets one-response guidance: ask about setting, available space, approved power plan, staffing, and timeline |
| T+3 to T+5 | Instagram/Facebook carousel; LinkedIn document | `setup-carousel-v1` | Marketing; Operations approval required | Use the seven-point setup guide -> setup guide | Recut panels 2, 3, and 4 as story/static reminders only after the anchor post is live |
| T+8 to T+11 (Week 2) | LinkedIn/Instagram/Facebook native video | `workflow-clip-v1` | Publish only with complete footage permission and final factual review | Check the setup -> fit checker | Use one unresolved-check clip as the Week 5 recut; do not publish if permission is incomplete |
| T+15 to T+18 (Week 3) | Instagram/Facebook carousel; LinkedIn document | `dessert-carousel-v1` | Marketing; owner approves balanced comparison copy | Compare the operating tradeoffs -> comparison page | Sales records which category/criterion prospects ask about; no category is declared the winner |
| T+22 to T+25 (Week 4) | LinkedIn native video; Instagram/Facebook Reel | `catering-short-v1` | Marketing; Operations confirms offer/price boundary | Build the package outline -> catering guide | Reuse the blank outline as one static post; do not turn it into a Bloomjoy package |
| T+29 to T+34 (Week 5) | Best-fit native channel from early evidence | One approved `-recut-v1` from the strongest question, not the highest raw view count | Marketing chooses from privacy-safe engagement + Sales usefulness | Same destination as the parent asset | Record public link/date and a redacted Week 5 observation for `#726` |

Cadence rule: one anchor asset at a time. Do not publish the same caption and crop simultaneously on every channel. LinkedIn may lead with the operator decision and context; Instagram/Facebook may lead with the visual check; YouTube Shorts remains optional until the owner confirms the channel and upload workflow.

## Launch QA checklist

Before every post:

- Open the tracked URL in a private browser window. Confirm HTTP 200, exact canonical, intended H1, and the expected page rather than a redirect or 404.
- Confirm `utm_source`, `utm_medium`, `utm_campaign`, and `utm_content` match this document; no other repository-authored parameter is present.
- Confirm the published asset has one destination and the visible CTA matches it.
- Compare every number and product statement with `Docs/MOBILE_OPERATOR_SEO_EVIDENCE.md` and the current product page.
- Watch once muted and once with sound. Captions, disclaimers, and the CTA must be understandable and must remain clear of interface overlays.
- Review every automatic caption; upload/edit native captions where supported.
- Add meaningful alt text for static posts and a descriptive caption for video.
- Confirm permission for every identifiable person, customer/venue mark, location, machine setup, and performance statement.
- Confirm no unsafe action, improvised mounting, cable hazard, blocked path, or unapproved operating method is visually endorsed.
- Preview all carousel panels in order and at phone size; no clipped text, tiny footnotes, or color-only meaning.
- Confirm the final caption contains no price, income, ROI, payback, permit, compatibility, availability, delivery, service-level, or typical-results promise.
- Record the asset ID, channel, publish date, and public link in a redacted `#728` comment. Keep account analytics and credentials out of GitHub.

## Measurement handoff to `#726`

The social launch starts the distribution input, not the 30/60/90 clock by itself. `#726` begins only when its full start condition is met: the canonical solution page is live, analytics/attribution are verified, and Search Console has discovered the route.

For each published asset, record only:

- Channel, Asset ID, publish date, and public link.
- Tracked sessions and agreed next actions from the privacy-safe analytics view.
- Aggregate Sales feedback on audience fit and unresolved questions.
- Whether the destination/event coverage was complete; mark missing data rather than estimating it.

Do not compare channel view counts as though they use the same definition. Use them as platform-local context. The program decision should prioritize qualified destination sessions, meaningful next actions, and lead quality, with low-volume data labeled as directional.

Issue-comment template:

```text
Published: YYYY-MM-DD
Channel: linkedin | instagram | facebook | youtube
Asset: fit-video-v1 | setup-carousel-v1 | dessert-carousel-v1 | catering-short-v1 | workflow-clip-v1
Public link: https://...
Destination: https://www.bloomjoyusa.com/...
Tracking check: pass | partial | unavailable
Redacted observation: one aggregate sentence; no account data or PII
```

## Owner decisions still required

- Confirm the owned accounts and whether YouTube Shorts is included in the first launch.
- Confirm the human publisher and backup publisher for each account.
- Approve the final real footage, releases, visible locations/marks, voiceover, covers, and music rights.
- Approve `T` and the final native-composer previews after `#615` and `#616` are production-verified.
- Decide whether comments are actively monitored by Marketing or handed to Sales, and define the response window without publishing an unsupported service promise.

No external posting, scheduling, audience upload, or account change is authorized by this document alone.
