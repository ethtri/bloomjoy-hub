# Bloomjoy Business Playbook Analytics

## Purpose
Track whether the public Business Playbook is helping serious operators move from education into quote, machine-fit, Plus, and login paths.

This tracking is intentionally light. Events should explain content performance and buyer intent without sending names, emails, messages, phone numbers, or other contact details to analytics.

## Provider and ownership
- Provider: Google Analytics 4 through the existing `gtag` path.
- Destination: the isolated `Bloomjoy` account and `Bloomjoy USA` property.
- Production owner: Ethan Trifari (`etrifari@bloomjoysweets.com`).
- Review owner: Marketing/CMO monthly, with Sales and Operations contributing conversion-quality context.
- Configuration: `VITE_GA_MEASUREMENT_ID` is a public measurement identifier, not a secret. `VITE_GA_DEBUG_MODE` is local/preview-only and remains false in production.
- Consent: analytics defaults off. The Google tag loads only after `granted`; `denied` loads no tag, and the saved choice can be changed from `/privacy`.

## Core funnel events
- `page_view`: One event per public route change, with a canonical path and no arbitrary query string.
- `buyer_cta_click`: A tracked internal buyer destination such as quote, machine, supplies, Plus, planner, or content.
- `lead_form_start`: First focus within the public Contact form.
- `lead_form_submit`: Successful lead intake, without contact fields or message text.
- `lead_form_error`: Failed lead intake, with only controlled form context and a generic failure step.
- `planner_start`: First view of the machine-fit or payback planner.
- `planner_complete`: First usable machine recommendation or first copied/printed payback summary.
- `checkout_start`: Sugar, sticks, or Plus checkout begins. Legacy `start_checkout` and `start_plus_checkout` calls map here.
- `checkout_success`: The server verifies a paid storefront order or Plus subscription after checkout return. Legacy `purchase_completed` and `plus_subscription_activated` calls map here; a query parameter alone can never emit success.
- `plus_explore`: Public Plus pricing is viewed. The existing `view_plus_pricing` call maps here.

Repeated React effects do not emit a duplicate page view for the same route, and each planner lifecycle milestone fires at most once per route visit.

The GA4 web stream must disable Enhanced Measurement's **Page changes based on browser history events** option because Bloomjoy sends manual SPA page views. Leaving both enabled would double-count route changes.

## Event Inventory
- `view_business_playbook_article`: Fires when a playbook article page loads.
- `click_resources_playbook_card`: Fires when someone clicks a Resources or Playbook discovery card.
- `click_business_playbook_cta`: Fires when someone clicks a primary Business Playbook CTA, including article sidebar CTAs and index hero CTAs.
- `click_plus_preview_resource`: Fires when someone clicks a Plus preview resource action from the Resources page.
- `click_buyer_flow_playbook_link`: Fires when someone clicks contextual Playbook links from buyer surfaces such as Machines, machine detail pages, and Contact success.
- `submit_contact_from_playbook`: Fires after a contact submission succeeds when the request originated from a Business Playbook article.
- `view_business_playbook_payback_planner`: Fires when the Payback Scenario Planner loads.
- `update_business_playbook_payback_planner`: Fires when a visitor selects a scenario, applies a fictional preset, edits a planner input, copies a summary, or prints a plan.
- `view_mobile_setup_fit_checker`: Fires when the categorical mobile setup checker loads.
- `update_mobile_setup_fit_checker`: Fires for bounded checker start, completion, result navigation, copy, print, and reset actions.

## Allowed Properties
- `route`: Canonical current pathname.
- `destination`: Canonical internal destination pathname.
- `planner`: `machine_fit` or `payback`.
- `checkout_type`: Controlled checkout category such as `sugar`, `blank_sticks`, or `plus`.
- `surface`: The page area or funnel surface where the click happened.
- `cta`: A short internal label for the clicked action.
- `href`: The destination path.
- `destination_type`: Normalized destination bucket such as `playbook_article`, `playbook_index`, `contact`, `machines`, `plus`, or `operator_login`.
- `slug`: Business Playbook article slug when applicable.
- `category`: Business Playbook category when applicable.
- `machine`: Machine context when applicable.
- `source_page`: Normalized Playbook source path for successful contact submissions. Query strings, hashes, unknown slugs, and external URLs must not be sent.
- `inquiry_type`: Contact inquiry type for successful Playbook-originated submissions.
- `machine_interest`: Machine interest selected on a Playbook-originated quote request.
- Mobile fit properties may include only `action`, `result_band`, `machine_signal`, `placement`, and `open_question_band`.
- Machine-fit planner properties may include only `action`, `question`, `answer`, `recommended_machine`, `budget_machine`, `budget_band`, and `open_question_band`.
- Payback planner properties may include `action`, `scenario_type`, `has_rent`, `has_revenue_share`, `demand_band`, `cost_band`, and `preset_id`.

Do not add contact names, emails, free-form messages, phone numbers, addresses, uploaded files, or raw lead notes to analytics events.

Payback planner analytics must not include exact dollar values, foot traffic, sales volume, serving count, price, cost, rent, revenue-share percentage, event size, or free-form notes. Use bands and booleans only.

All properties pass a runtime allowlist. Numeric values are dropped from the public provider payload, so legacy calls containing quantities, prices, monthly totals, or IDs cannot leak those values when GA4 is enabled. Path-like properties are reduced to pathnames before transmission.

## Current Surfaces
- `/resources`: hero buttons, featured article cards, category cards, and Plus preview actions.
- `/resources/business-playbook`: hero CTAs, featured article cards, category jump links, and article list cards.
- `/resources/business-playbook/:slug`: article sidebar CTAs, related article cards, and all-guides CTA.
- `/resources/business-playbook/payback-planner`: planner view, scenario selection, fictional preset selection, input updates, copy/print summary, article links, and quote CTA.
- `/resources/business-playbook/mobile-setup-fit-checker`: bounded setup-checker lifecycle, result-band, and next-action events.
- `/resources/business-playbook/food-truck-mobile-setup-guide`: canonical page views and bounded Playbook CTA events.
- `/resources/business-playbook/food-truck-dessert-add-ons`: canonical page views, article views, and bounded Playbook CTA events.
- `/resources/business-playbook/food-truck-catering-dessert-menu`: canonical page views, article views, and bounded Playbook CTA events.
- `/solutions/food-trucks`: canonical page views and bounded Playbook CTA events.
- `/machines`: Business Playbook comparison CTA.
- `/machines/commercial-robotic-machine`: Commercial location guide, payback planner, and revenue-share/rent CTAs.
- `/machines/mini`: Mini event business guide, payback planner, and ROI/payback guide CTAs.
- `/machines/micro`: vending/events/Micro-fit, payback planner, and ROI/payback guide CTAs.
- `/plus`: public Playbook CTA.
- `/contact`: Playbook-originated successful submissions and post-submit Playbook links.

## Review Cadence
- Owner: Marketing/CMO owns the review; Sales and Operations should bring qualitative buyer questions and customer-success notes into the discussion.
- First 30 days after launch: review weekly by article and surface.
- After baseline is established: review monthly with sales feedback.
- Watch for content that earns reads but not downstream intent; those articles likely need clearer examples, stronger CTAs, or better placement.
- Watch for buyer surfaces with low Playbook click-through; those placements may need simpler copy or a more relevant article.

## QA Notes
In local development, `trackEvent` logs `[Analytics disabled]` when no valid measurement ID is present and `[Analytics debug]` when GA4 is enabled. Both paths log only the sanitized payload that would be eligible for the provider.

Use `?analytics_debug=1` only for controlled GA4 DebugView verification. The query parameter is never sent as part of a page path or location.
