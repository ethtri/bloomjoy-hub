# MVP Scope — Bloomjoy Sweets Website

This MVP supports the new business model:
1) Sell machines (no strings attached)
2) Sell sugar + sticks + select accessories
3) Optional paid membership (“Bloomjoy Plus”) for onboarding/training/concierge

## P0 outcomes (MVP Definition of Done)
### Public site (unauthenticated)
- Home: clear value prop + entry points into Machines, Supplies, Plus
- Products
  - Full Machine product page
  - Micro product page
  - Mini page:
    - If no pro photos: “Coming soon” + waitlist form
- Supplies
  - Sugar product page (primary)
  - Sticks product page (optional, if offered)
- Bloomjoy Plus
  - Plus Basic: benefits + onboarding outline + support boundaries + pricing CTA
- Resources
  - FAQs (support boundaries + “how it works”)
- Trust/About
  - Operator experience, footprint, manufacturer relationship (no unverifiable claims)
- Contact / Lead capture
  - Quote request (machines)
  - Demo request
  - Procurement questions

### Commerce (MVP rules)
- Supplies: buy via Stripe Checkout (shipping address required)
- Machines: configurable CTA
  - Default MVP: “Request a quote” (lead capture)
  - Optional: “Buy now” for Micro if desired

### Authenticated member portal
- Auth: email magic link (preferred) or passwordless equivalent
- Dashboard:
  - Membership status (Plus Basic)
  - Orders (list + links to Stripe receipts / tracking links if available)
  - Training library (catalog + simple search/filter)
  - Onboarding checklist (track completion)
  - Support hub:
    - “Get Manufacturer Support” (WeChat setup guide)
    - “Request Concierge Help” (form/ticket)
    - “Parts Assistance” (form/ticket, manual fulfillment)
- Account settings
  - Billing management via Stripe Customer Portal
  - Shipping addresses (MVP: link out to Stripe or store in DB if needed)

## Explicit non-goals (do not build in MVP)
- Spare parts storefront or automated parts fulfillment
- 24/7 Bloomjoy support promises
- Complex multi-warehouse logistics
- Full LMS (quizzes/certifications) — keep to gated content + tags/search
- Franchise licensing constructs

## Acceptance checkpoints (sponsor-facing)
- Each P0 feature lands in a PR with:
  - localhost test steps
  - smoke checklist updates (if user-facing)
  - a “rollback plan” (usually: revert the PR)

## Optional P1 (after MVP)
- Auto-ship sugar subscriptions
- Plus Pro tier
- Mini deposits
- Custom/branded sticks
