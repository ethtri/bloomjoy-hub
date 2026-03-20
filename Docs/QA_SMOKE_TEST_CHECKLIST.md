# QA Smoke Test Checklist (Sponsor)

Run these checks on localhost for each PR that adds a user-facing feature.

## Global
- [ ] App starts: `npm ci` then `npm run dev`
- [ ] Open the URL printed in the terminal (usually http://localhost:8080)
- [ ] Browser tab title updates by route and includes Bloomjoy branding; favicon renders as Bloomjoy icon
- [ ] Public routes set page-specific metadata (title + description + canonical + OG tags) in browser devtools
- [ ] Public routes include JSON-LD structured data (`script[type="application/ld+json"]`) with Organization/WebSite/WebPage entries
- [ ] Private/auth routes (`/login`, `/cart`, `/portal/*`, `/admin/*`) set `meta[name="robots"]` to `noindex`
- [ ] Direct-load public routes in browser address bar (for example `/machines`, `/supplies`, `/plus`) and confirm they do not return hosting-level 404 pages
- [ ] View page source on a direct-loaded public route (for example `/machines`) and confirm title/description/canonical are route-specific before client-side JS executes
- [ ] View page source on a direct-loaded private route (for example `/portal`) and confirm robots is `noindex`
- [ ] `robots.txt` is reachable and includes a sitemap reference
- [ ] `sitemap.xml` is reachable and lists core public routes
- [ ] Apex host (`https://bloomjoyusa.com`) redirects to canonical host (`https://www.bloomjoyusa.com/`) with permanent redirect behavior
- [ ] Legacy paths (`/products`, `/products/mini`, `/products/micro`, `/products/commercial-robotic-machine`) return permanent redirects to `/machines*`
- [ ] No console errors on home page load
- [ ] Mobile header/nav works (basic)

## Public site
- [ ] Home loads and key CTAs navigate correctly
- [ ] Home machine cards show correct model images (Commercial, Mini, Micro) without awkward clipping
- [ ] Machine naming is consistent as `Commercial Machine`, `Mini Machine`, and `Micro Machine` on Home, Machines, Contact, and footer links
- [ ] Product pages load (Full, Micro, Mini)
  - [ ] Mini shows "Coming soon / Waitlist" when enabled
- [ ] Machine detail pages support image gallery selection (thumbnail click changes main image)
- [ ] Commercial page shows native specs content (not image-only text for core specs)
- [ ] Commercial page "Open full size" actions open in-page modal and can be closed to return to the same screen
- [ ] Commercial machine sales copy/quote CTA clearly shows wrap options and marks custom wrap as Commercial-only with offline design-team handoff
- [ ] Mini and Micro machine pages do not advertise custom wrap as an available option
- [ ] Micro machine page shows the updated target/list price (`$2,200`)
- [ ] Sugar page supports one-click equal split across white/blue/orange/red and allows custom per-color override
- [ ] Sugar page quick presets show `240 KG`, `400 KG`, and `800 KG`, with `400 KG` as the default target
- [ ] Sugar page handles high-volume setup (e.g., 500KG+) without repetitive click controls
- [ ] Sticks ordering on `/supplies` allows direct typed quantity input (not only +/- controls)
- [ ] Sticks ordering clearly supports blank paper sticks and custom paper sticks at `$130/box` with `2000 pieces/box`
- [ ] Blank sticks flow requires machine size selection and shipping address type selection before request/checkout
- [ ] Blank sticks orders under 5 boxes submit a procurement lead with box count, size, address type, and estimated shipping summary
- [ ] Blank sticks orders of 5+ boxes launch direct Stripe checkout with free shipping and do not use the shared cart
- [ ] Custom sticks flow accepts logo/image upload and submits a procurement lead with artwork URL, requested box count, selected size, and `$750` first-order plate-fee note
- [ ] Shared cart remains sugar-only and legacy stick items do not block checkout
- [ ] Plus page: pricing and boundaries are visible and clear
- [ ] Resources page shows Bloomjoy Plus teaser content for locked downloads (procedure docs, daily checklists, frequent updates)
- [ ] Footer legal links open `/privacy`, `/terms`, and `/billing-cancellation`
- [ ] Footer support links navigate to valid Resources anchors (`/resources#faq` and `/resources#support-boundaries`)
- [ ] Billing & cancellation page explains Stripe portal cancellation path and end-of-period effect
- [ ] Contact/Quote form submits (and confirmation is shown)
- [ ] Quote flow preserves machine context (for example, Commercial CTA preselects "Machine of Interest" on `/contact`)
- [ ] Contact/Quote submission creates a `lead_submissions` row in Supabase with expected type/email
- [ ] Quote submissions send internal notification email with full request summary (name/email/source/type/message)
- [ ] Quote submissions send a WeCom internal alert to configured `WECOM_ALERT_TO_USERIDS` recipients
- [ ] Mini waitlist submit creates a `mini_waitlist_submissions` row (duplicate email shows friendly already-on-list message)

## Auth / portal
- [ ] Login flow works (magic link or configured method)
- [ ] Login errors show actionable copy (for example: expired link, send rate-limit)
- [ ] Magic link email is received in the configured inbox and login completes via Supabase auth callback
- [ ] First-time sign-in copy clearly explains signup-confirmation-first behavior when applicable
- [ ] Password sign-in works for an existing email/password user
- [ ] Forgot-password flow sends reset email and `/reset-password` successfully updates password
- [ ] Google sign-in works when Supabase Google provider is enabled
- [ ] Google sign-in button follows official GIS rendering when `VITE_GOOGLE_CLIENT_ID` is configured locally
- [ ] For auth launch hardening, Google consent screen shows Bloomjoy branding (name/logo/support email)
- [ ] For auth launch hardening, Google callback host uses `auth.bloomjoyusa.com` (not `<project-ref>.supabase.co`)
- [ ] Logged-out visit to `/portal` redirects to login
- [ ] Dashboard loads and shows membership status placeholder
- [ ] Non-Plus login can access baseline pages (`/portal`, `/portal/orders`, `/portal/account`)
- [ ] Non-Plus login is blocked from premium pages (`/portal/training`, `/portal/onboarding`, `/portal/support`) with clear Plus messaging
- [ ] `/portal/orders` loads real `orders` data for the logged-in user (no mock rows)
- [ ] `/portal/account` shows live membership status and period from `subscriptions` (no hardcoded next billing date)
- [ ] `/portal/account` has no horizontal page overflow on mobile viewports (360x800, 390x844, 414x896)
- [ ] `/portal/account` profile save persists and reloads from `customer_profiles`
- [ ] `/portal/account` shipping save persists and reloads from `customer_profiles`
- [ ] Onboarding checklist progress updates when steps are toggled
- [ ] Onboarding progress persists for the same user after page refresh/re-login
- [ ] Training catalog visible to logged-in users
- [ ] Training catalog shows `Data source: Supabase` in local dev after auth/session settles
- [ ] Training hub shows an operator-first `Start Here` section and an `Operator Essentials` track card
- [ ] Training hub supports task filters (`Start Here`, `Software & Payments`, `Daily Operation`, `Cleaning & Maintenance`, `Troubleshooting`) plus format filters
- [ ] Training catalog supports module tag filtering/grouping (for example, Module 1/2/3) when tagged rows exist
- [ ] Training search finds relevant items by PDF-derived terms such as `burner`, `Nayax`, `timer`, and `waste water`
- [ ] Training catalog cards render thumbnail images for Vimeo-backed rows from first-party URLs (`training_assets.meta.thumbnail_url`) with no `vumbnail.com` dependency
- [ ] Training hub cards show live progress state (`In progress` / `Completed`) after training progress rows exist
- [ ] Training detail page opens and loads an embed frame (Vimeo for seeded modules; placeholder for local-only fallback modules)
- [ ] Training detail page loads Vimeo player iframe for Vimeo-backed rows (not `about:srcdoc` placeholder)
- [ ] Training detail Vimeo player shows a clear loading state and begins playback without excessive startup delay
- [ ] Training detail supports document-first guides with readable in-page guide sections when the primary asset is not a Vimeo video
- [ ] Training detail sections below video/guide ("What you will learn", "Checklist", "Resources") have clear purpose and readable structure
- [ ] Training resource cards expose real actions (`Open guide`, `Watch video`, `Go to support`, or `Download PDF`) instead of passive labels
- [ ] `Mark complete` persists to `training_progress` and the item remains completed after refresh/re-login
- [ ] Operator Essentials certificate stays locked until all required items are complete and the final acknowledgement is checked
- [ ] After unlocking, the Operator Essentials certificate remains available for download on later visits
- [ ] Private training documents are not publicly reachable by direct URL when using Supabase-backed document assets
- [ ] Support request forms submit and show success state
- [ ] Submitted support request appears in `support_requests` table with correct `request_type`, `status=new`, and customer identity
- [ ] Submitted support request triggers a WeCom alert with request type, customer email, and subject
- [ ] `/portal/support` includes a WeChat onboarding concierge form with phone region/number, blocked-step selection, and referral-needed selection
- [ ] WeChat onboarding concierge submit writes `support_requests.request_type=wechat_onboarding` and structured `support_requests.intake_meta` values (`phone_region`, `phone_number`, `device_type`, `blocked_step`, `referral_needed`, optional `wechat_id`)

## Payments (test mode)
- [ ] Sugar checkout completes with test card for high-quantity equal split (e.g., 500KG total)
- [ ] Sugar checkout completes with test card for unequal split mix (custom per-color quantities)
- [ ] Sugar checkout completed webhook sends internal order summary email (customer, totals, sugar mix, line items)
- [ ] Sugar checkout completed webhook sends a WeCom internal alert with order ID, customer, and sugar breakdown
- [ ] Blank sticks checkout completes with test card for 5+ boxes and shows free shipping in Stripe Checkout
- [ ] Blank sticks checkout completed webhook sends internal order summary email with box count, machine size, address type, and shipping total
- [ ] Blank sticks checkout completed webhook sends a WeCom internal alert with order ID, customer, and stick-order summary
- [ ] Plus subscription checkout computes expected monthly amount from selected machine count (e.g., 1x=$100, 3x=$300) and completes with test card
- [ ] Logged-out users on `/plus` are redirected to login before checkout can begin
- [ ] Stripe subscription from Plus checkout contains `metadata.user_id` and `metadata.machine_count`
- [ ] Customer Portal link opens (test mode)
- [ ] Account page Manage Billing opens Stripe portal (test mode)
- [ ] In Stripe test customer portal, cancel Plus subscription and return to `/portal/account?billing=return`
- [ ] Return to account shows confirmation that billing status was refreshed after Stripe portal return
- [ ] After canceling, account membership card shows end-of-period cancellation state/banner
- [ ] Stripe webhook updates subscriptions/orders tables (via Stripe CLI or Dashboard test event)

## Auth launch hardening (production-only)
- [ ] Branded auth emails send from approved Bloomjoy sender domain (not default Supabase sender)
- [ ] Signup confirmation, magic link, and password recovery emails use final branded templates
- [ ] Production auth smoke evidence is captured in `Docs/AUTH_PRODUCTION_SIGNOFF.md`

## Regression sanity
- [ ] Quote, order, and support primary flows still succeed when WeCom alert delivery fails (verify non-blocking warning logs in function output)
- [ ] `npm run build` passes
- [ ] `npm run lint` passes (if configured)
- [ ] `npm run seo:check` passes

## Admin (super-admin)
- [ ] Non-admin user cannot access `/admin/support`
- [ ] Super-admin user can access `/admin/support`
- [ ] Admin can search/filter support queue and update status/priority/assignment/notes
- [ ] Admin support queue can filter by request type and includes `wechat_onboarding`
- [ ] Admin support queue summary cards show open total, open new, and open WeChat onboarding counts
- [ ] Admin updates create `admin_audit_log` entries with `action=support_request.updated`
- [ ] Non-admin user cannot access `/admin/orders`
- [ ] Super-admin user can access `/admin/orders`
- [ ] Admin orders supports search by customer email/order ID and date range filtering
- [ ] Admin fulfillment updates create `admin_audit_log` entries with `action=order.fulfillment_updated`
- [ ] Non-admin user cannot access `/admin/accounts`
- [ ] Super-admin user can access `/admin/accounts`
- [ ] Admin account search returns rows by email/user ID and shows membership/order/support summary data
- [ ] Admin machine count edits require update reason and persist in `customer_machine_inventory`
- [ ] Machine count edits create `admin_audit_log` entries with `action=machine_inventory.upserted`
- [ ] Non-admin user cannot access `/admin/audit`
- [ ] Super-admin user can access `/admin/audit`
- [ ] Super-admin can grant and revoke super-admin role with reason metadata
- [ ] Audit log view supports filtering and shows role + operational actions (support, orders, machine inventory)
