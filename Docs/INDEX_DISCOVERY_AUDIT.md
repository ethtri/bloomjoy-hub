# Public Route Index Discovery Audit

Issue: `#731`

Audit date: 2026-08-10

Search Console baseline date: 2026-08-06

Scope: the 12 canonical public routes excluded in the baseline. Redirects, private routes, and `/cart` are intentionally outside this audit.

## Audit method

The production build was inspected for sitemap membership and `lastmod`, a route-specific title, one rendered H1, exact canonical, indexable robots directive, substantive HTML inside `#root` before client execution, and crawlable incoming links from the 25 canonical public routes. Source review checked query intent, overlap, and whether links occur in decision-useful main content rather than only global navigation.

A local production preview returned HTTP 200 for all 12 exact paths. Each direct response included the expected H1, exact canonical, and `data-prerendered="true"` root marker.

`node scripts/validate-public-route-discovery.mjs` makes the technical and contextual-link checks repeatable after `npm run build`.

## Route diagnoses

| Route | 2026-08-06 status | Build evidence | Diagnosis and action |
| --- | --- | --- | --- |
| `/machines/commercial-robotic-machine` | Discovered, not indexed | 665 main-content words; 24 incoming routes; unique metadata/H1; exact canonical | The baseline predates the quote-only structured-data and sitemap repair in #733. Recheck after that deployment; this is a high-value manual-inspection candidate, not a content-padding candidate. |
| `/resources/business-playbook/how-to-start-cotton-candy-vending-business` | Discovered, not indexed | 1,493 main-content words; 9 incoming routes; distinct launch intent | No current technical defect. Discovery remains unknown until recheck. A contextual About-page link now gives buyers an entity-to-launch path. |
| `/resources/business-playbook/best-locations-for-cotton-candy-vending-machines` | Crawled, not indexed | 1,350 main-content words; 7 incoming routes; location scorecard intent | Possible selection/overlap risk with the pitch and commercial-terms guides, but each has a distinct reader job. Keep separate and inspect query matching before rewriting. |
| `/resources/business-playbook/mini-micro-event-catering-business-guide` | Crawled, not indexed | 1,317 main-content words; 4 incoming routes including Mini and Resources | Technically sound and audience-specific. Likely lower-demand/selection uncertainty; do not invent depth or create another startup page without query evidence. |
| `/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business` | Crawled, not indexed | 1,351 main-content words; 10 incoming routes | Technically strong with distinct cost-category intent. Recheck before changing copy; no confirmed discovery defect remains. |
| `/resources/business-playbook/how-to-pitch-location-owners` | Discovered, not indexed | 1,477 main-content words; 6 incoming routes after this change | Weak contextual discovery was plausible. The Commercial page now links directly to the venue-owner pitch at the moment a buyer is planning a placement. |
| `/resources/business-playbook/revenue-share-vs-rent-cotton-candy-machine-placement` | Discovered, not indexed | 1,528 main-content words; 6 incoming routes including Commercial and the indexed payback planner | Technically and contextually strong. Recheck canonical selection/query fit; avoid merging it into the broader pitch guide without evidence. |
| `/resources/business-playbook/commercial-vending-vs-event-catering` | Crawled, not indexed | 1,115 main-content words; 7 incoming routes including the indexed machine comparison | Distinct model-choice comparison with adequate discovery. Treat as content-selection uncertainty pending query evidence. |
| `/resources/business-playbook/business-setup-basics-llc-ein-insurance-permits` | Crawled, not indexed | 1,176 main-content words; 3 incoming routes after this change | Confirmed weakest discovery path. The indexed ROI/payback guide now links to these admin-cost and readiness basics as a related decision. |
| `/contact` | Discovered, not indexed | 32 words in the prerendered main form introduction and 148 across the rendered page shell; 24 incoming routes; exact canonical | Expected low-priority conversion utility. Keep indexable for branded/contact queries, but do not pad the form or bulk-request indexing. Quote-form changes remain owned by #617. |
| `/about` | Discovered, not indexed | 226 main-content words; real imagery and unique entity copy; 24 mostly navigational incoming routes | Contextual depth was weak. The page now routes readers directly to the Commercial product, operator launch guide, or contact conversation. Recheck as a branded/entity page. |
| `/privacy` | Discovered, not indexed | 208 main-content words; 24 footer/navigation links; exact canonical | Expected low-priority legal utility. Keep crawlable and accurate; do not request indexing unless a concrete branded/legal search need appears. |

## Recheck and manual-inspection policy

After the link changes deploy, inspect the exact canonical URLs in Search Console in this order:

1. Commercial Machine, About, launch guide, venue-owner pitch, and business-setup guide.
2. The remaining decision guides if their exclusion persists after discovery refresh.
3. Contact and Privacy only for technical confirmation; do not use limited manual indexing requests on utility pages.

Record only the inspection date and redacted status in issue `#731`. Do not commit Search Console exports, account identifiers, or low-volume query data. A request to index is appropriate only after the inspected live response matches the canonical build and the route is high value; it is not a substitute for resolving a reported defect.
