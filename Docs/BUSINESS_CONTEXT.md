# Bloomjoy Sweets — Business Context & Build Spec (AI Agent Edition)


> **Stack note:** This doc includes an older “suggested technical approach” section that mentions Next.js.
> The current project is a Loveable-generated POC built with **Vite + React + TypeScript + Tailwind + shadcn/ui**.
> Use `Docs/DECISIONS.md` as the canonical source of truth for the stack.

## 1) Executive summary
Bloomjoy Sweets sells robotic cotton candy machines and optimized premium sugar in the United States.

We are pivoting away from a franchise-based business model (low adoption and high friction) to a simple model:
1) Sell machines (no strings attached)
2) Sell sugar + sticks + select accessories
3) Offer an optional paid membership ("Bloomjoy Plus") that provides onboarding, training, and concierge support

The website must serve two roles:
A) Public-facing storefront + sales funnel
B) Authenticated member portal for subscription management, orders, training library, and support workflows

## 2) Business goals (ranked)
1) Increase machine sales conversion (especially for non-franchise buyers)
2) Create recurring revenue via sugar + membership
3) Reduce operational burden via clear support boundaries and self-serve training
4) Build a scalable operating model that does not require selling spare parts or providing true 24/7 first-line support

## 3) Key differentiators
- Deep operational experience: 5+ years operating machines across ~12 U.S. states
- Strong manufacturer relationship with Sunze (direct access, wholesale pricing, bilingual support)
- Premium sugar supply chain: dust-free, optimized granularity, resealable 1kg bags, consistent performance
- English-first onboarding + operator playbooks (concierge layer above manufacturer support)

## 4) Product catalog (MVP)
### Machines
1) Bloomjoy Sweets Robotic Cotton Candy Machine (commercial / high-volume)
   - Price target: ~ $10,000 (exact price configurable)
   - Ideal for: retail centers, stadiums, high-traffic venues

2) Bloomjoy Sweets Micro (consumer/home)
   - Price target: ~ $400
   - Limitation: basic shapes only (no floral patterns)

3) Bloomjoy Sweets Mini (new, portable)
   - Target use: fairs, large events, pop-ups
   - Size: ~ 1/5 the full machine
   - Capability: can produce most complex patterns
   - Limitation: no automatic stick dispenser; operator manually feeds a stick each order
   - Asset constraint: professional photos may not exist at MVP launch; site must support "coming soon / waitlist" mode

### Consumables
1) Premium Sugar
   - $8 per KG (resealable 1KG bags)
   - Optimized for Bloomjoy/Sunze machines (dust-free, ideal granularity)
   - Franchise owners are being phased out; members may get discounts and/or shipping benefits (configurable)

2) Sticks
   - Offer plain sticks in MVP
   - Future: custom/branded sticks as higher-margin upsell

### Accessories (optional MVP)
- Minimal: cleaning tools / small accessories only if operationally easy
- Do NOT sell spare parts as inventory; parts are fulfilled by manufacturer (Sunze)

## 5) Bloomjoy Plus membership (MVP = Plus Basic)
### Bloomjoy Plus Basic (MVP)
Core promise: "Operate with confidence and get set up fast."

Included:
- Onboarding (English-first): setup checklist + we help you get manufacturer WeChat support working
- Training library access (hosted on Bloomjoy website; NOT buried in manufacturer WeChat threads)
- Member community access (exclusive member chat; currently WeChat or equivalent)
- Concierge support (business/operator guidance + warm transfer to Sunze when needed)
- Optional: member sugar pricing and/or shipping perks (configurable rules)

Support boundary:
- Sunze provides 1st-line 24/7 support via WeChat for technical troubleshooting/repairs
- Bloomjoy provides concierge: triage, best-practice guidance, translation/escalation, and operational advice
- Bloomjoy does NOT promise 24/7 response; publish clear response expectations (e.g., business hours + best-effort)

### Parts ordering (MVP approach)
- We do NOT sell parts in a storefront
- Members can request help manually:
  1) Member posts in member chat / submits form request
  2) Bloomjoy helps diagnose which part is needed
  3) Bloomjoy assists in ordering from Sunze (manual concierge)
- Website should include a simple "Parts Assistance" request flow (ticket/form) but fulfillment is manual

## 6) Target customer segments
1) Commercial operators (venues, malls, stadiums, FECs)
   - Care about: uptime, throughput, reliability, support clarity, procurement paperwork

2) Event operators (fairs, festivals, pop-ups)
   - Care about: portability, setup speed, staffing model, pattern “wow factor”

3) Consumer/home buyers (Micro)
   - Care about: simplicity, fun, gifts, easy sugar reorders

## 7) Website — MVP scope
### Public site (unauthenticated)
- Home (value prop + product entry points)
- Products:
  - Full machine product page
  - Mini product page (or waitlist page if photos missing)
  - Micro product page
- Supplies:
  - Sugar product listing + details
  - Sticks (if offered in MVP)
- Bloomjoy Plus:
  - Pricing + benefits + onboarding + boundaries
- Resources (public):
  - FAQs, what to expect, basic “how it works,” contact
- About / Trust:
  - Operator experience, footprint, mission, manufacturer relationship (avoid unprovable absolute claims)
- Contact / Lead capture:
  - Quote request, demo request, venue procurement questions

### Authenticated member portal
- Login / signup
- Dashboard (simple)
  - Subscription status (Plus Basic)
  - Orders (history, tracking links, invoices)
  - Training library (catalog + search/filter, progress optional)
  - Onboarding checklist (steps + links; track completion)
  - Support:
    - "Get Manufacturer Support (WeChat setup guide)"
    - "Request Concierge Help" (form/ticket + links to community chat)
    - "Parts Assistance" request form (manual fulfillment)
- Account settings
  - Manage billing (Stripe customer portal or native UI)
  - Shipping addresses
  - Profile

## 8) Critical UX principles
- Keep tiers simple: Buy machine without membership; membership is optional upsell
- Clear support boundaries to prevent unpaid support overload
- Training content must be easy to find; avoid “go hunt in chat history”
- Reorder sugar in < 30 seconds from dashboard
- Make Mini easy to understand: capabilities + manual stick limitation + best fit (events/pop-ups)

## 9) Commerce rules (configurable)
- Products may have different purchase flows:
  - Machines: "Buy now" OR "Request a quote" (configurable)
  - Supplies: direct checkout
- Membership affects:
  - Sugar pricing discounts (optional)
  - Shipping perks (e.g., free shipping for members OR free shipping above threshold)
- Tax/shipping:
  - Keep it simple in MVP; allow rules to evolve

## 10) Suggested technical approach (agent guidance)
Recommended baseline stack (adjustable):
- Frontend: Next.js (App Router), TypeScript
- Auth: Supabase Auth (email magic link) OR NextAuth
- DB: Supabase Postgres
- Payments: Stripe (Checkout + Billing + Customer Portal)
- Content/training:
  - MVP: gated pages + video embeds (Vimeo unlisted or similar)
  - Later: proper LMS-like catalog with tags/search/progress
- Email: Postmark/Resend for transactional messages
- Analytics: PostHog or GA4 (events listed below)
- File storage: Supabase Storage or S3-compatible bucket for PDFs/resources

## 11) Data model (minimum viable)
Entities:
- User
- Membership
  - plan_id (Plus Basic)
  - status (active, canceled, past_due)
  - stripe_customer_id, stripe_subscription_id
- Order
  - order_id, user_id, items, totals, status, fulfillment metadata
- Product
  - sku, name, type (machine/supply), price, inventory flags
- TrainingContent
  - title, description, tags, access_level (public/member), media_url, sort_order
- SupportRequest
  - type (concierge/parts_assistance/onboarding)
  - status (new, triaged, waiting_on_customer, resolved)
  - notes + links

## 12) MVP analytics events (instrument these)
Public funnel:
- view_home
- view_product_{sku}
- click_buy_{sku}
- click_request_quote_{sku}
- start_checkout
- purchase_completed
Membership funnel:
- view_plus_pricing
- start_plus_checkout
- plus_subscription_activated
Portal usage:
- login
- view_dashboard
- view_training_catalog
- open_training_item
- submit_support_request_{type}
- reorder_sugar_click
- reorder_sugar_completed

## 13) SEO/content requirements (MVP)
- Each product must have indexable landing pages (public)
- Clear headings: commercial machine vs mini vs micro
- FAQ sections targeting intent: "robotic cotton candy machine", "cotton candy vending machine sugar", "event cotton candy machine"
- Avoid unverifiable superlatives; focus on operator experience + quality control + training

## 14) Operating model alignment (how the business actually runs)
- Machines are sourced wholesale from Sunze
- Manufacturer provides 24/7 first-line support via WeChat
- Bloomjoy provides concierge and operational guidance (English-first)
- Bloomjoy sells sugar and sticks; does not stock spare parts
- Parts issues are handled via:
  - Sunze troubleshooting + warranty workflow
  - Bloomjoy concierge helps coordinate diagnosis and ordering (manual)

## 15) Roadmap (post-MVP ideas)
- Plus Pro tier (priority concierge, quarterly tune-ups, faster response)
- Auto-ship sugar subscriptions
- Custom/branded sticks ordering
- Waitlist + deposit system for Mini
- Better training: certifications, quizzes, operator checklists
- Venue toolkit: printable signage, pricing calculator, SOPs
- CRM-lite: customer management + machine health check reminders (optional)

## 16) Non-goals / out of scope for MVP
- Selling spare parts as inventory
- Automated parts catalog and fulfillment
- True 24/7 Bloomjoy support
- Complex multi-warehouse logistics
- Heavy franchise licensing constructs

## 17) Tone/brand notes (for UI copy)
- Confident, operator-first, practical
- Emphasize: performance, reliability, ease of onboarding
- Avoid: heavy franchise language, “strings attached,” ambiguous support promises
- Make membership feel like “operating system + confidence,” not “exclusive club”