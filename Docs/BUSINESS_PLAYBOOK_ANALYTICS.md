# Bloomjoy Business Playbook Analytics

## Purpose
Track whether the public Business Playbook is helping serious operators move from education into quote, machine-fit, Plus, and login paths.

This tracking is intentionally light. Events should explain content performance and buyer intent without sending names, emails, messages, phone numbers, or other contact details to analytics.

## Event Inventory
- `view_business_playbook_article`: Fires when a playbook article page loads.
- `click_resources_playbook_card`: Fires when someone clicks a Resources or Playbook discovery card.
- `click_business_playbook_cta`: Fires when someone clicks a primary Business Playbook CTA, including article sidebar CTAs and index hero CTAs.
- `click_plus_preview_resource`: Fires when someone clicks a Plus preview resource action from the Resources page.
- `click_buyer_flow_playbook_link`: Fires when someone clicks contextual Playbook links from buyer surfaces such as Machines, machine detail pages, and Contact success.
- `submit_contact_from_playbook`: Fires after a contact submission succeeds when the request originated from a Business Playbook article.

## Allowed Properties
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

Do not add contact names, emails, free-form messages, phone numbers, addresses, uploaded files, or raw lead notes to analytics events.

## Current Surfaces
- `/resources`: hero buttons, featured article cards, category cards, and Plus preview actions.
- `/resources/business-playbook`: hero CTAs, featured article cards, category jump links, and article list cards.
- `/resources/business-playbook/:slug`: article sidebar CTAs, related article cards, and all-guides CTA.
- `/machines`: Business Playbook comparison CTA.
- `/machines/commercial-robotic-machine`: Commercial location guide CTA.
- `/machines/mini`: Mini event business guide CTA.
- `/machines/micro`: vending/events/Micro-fit CTA.
- `/plus`: public Playbook CTA.
- `/contact`: Playbook-originated successful submissions and post-submit Playbook links.

## Review Cadence
- Owner: Marketing/CMO owns the review; Sales and Operations should bring qualitative buyer questions and customer-success notes into the discussion.
- First 30 days after launch: review weekly by article and surface.
- After baseline is established: review monthly with sales feedback.
- Watch for content that earns reads but not downstream intent; those articles likely need clearer examples, stronger CTAs, or better placement.
- Watch for buyer surfaces with low Playbook click-through; those placements may need simpler copy or a more relevant article.

## QA Notes
In local development, `trackEvent` logs `[Analytics]` messages to the browser console. Use those logs to confirm event names and payload shape during browser QA.

Production analytics implementations should map these same event names to the connected provider, currently represented by the `posthog` and `gtag` client stubs.
