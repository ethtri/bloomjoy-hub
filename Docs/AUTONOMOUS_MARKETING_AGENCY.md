# Autonomous Marketing Agency

Purpose: define the v1 hands-off marketing operating system for Bloomjoy. This is an implementation contract for agents, not a campaign brainstorm.

## Strategy

- Primary KPI: qualified machine quote leads.
- First revenue path: machine quote pipeline.
- Follow-on revenue path: Bloomjoy Plus, sugar, and sticks.
- Channel mix: owned-first. Prioritize the website, SEO, opt-in email, LinkedIn, YouTube/short-form repurposing, and lightweight social distribution.
- Monthly budget cap: under `$500` until attribution and lead scoring show reliable signal.
- Email policy: opt-in only. No cold campaigns in v1.

## Agent Roles

- CMO Orchestrator: owns the weekly scorecard, content calendar, budget cap, and escalation log.
- Growth Intelligence: reviews Supabase leads/orders, Stripe, GA4/Search Console, GitHub issues/PRs, and the Bloomjoy events repo for next actions.
- Content + SEO: ships machine-buyer pages, resource updates, FAQs, case studies, comparison content, and Plus/support content.
- Lifecycle Email: uses Resend Audience/Broadcast only for opted-in contacts after sender, unsubscribe, and seed-list checks pass.
- Social Repurposing: turns approved owned content and anonymized event lessons into LinkedIn posts, short-form scripts, and captions.
- Compliance + QA: blocks unsupported claims, franchise-era language, unapproved client/logo use, missing unsubscribe paths, and 24/7 Bloomjoy support promises.

## Guardrails

- Do not introduce a paid marketing platform without a decision entry in `Docs/DECISIONS.md`.
- Do not use client/event names, logos, or identifiable event details in public content unless written permission is documented.
- Do not auto-send one-to-one Gmail replies. Existing Bloomjoy Gmail automation may draft but not send external replies.
- Do not send marketing email to contacts unless `lead_submissions.marketing_consent = true` or another explicit opt-in source is documented.
- Do not spend paid media budget until UTM capture, lead scoring, and the weekly scorecard are working.
- Paid search/social tests are capped at `$300/month` inside the overall `$500/month` v1 cap.

## Attribution And Lead Scoring

Website quote submissions now capture:

- Source page and stored attribution (`utm_*`, click IDs, first/latest landing page, first/latest external referrer).
- Machine interest, buyer segment, purchase timeline, budget/procurement status, Plus interest, and marketing consent.
- Qualification grade:
  - `A`: use case, timeline, budget/procurement signal, and contact quality are all present.
  - `B`: three of the four signals are present.
  - `C`: fewer than three signals are present.

Contact quality means a valid name/email plus a company/venue, or a consumer/home buyer segment.

## Weekly Cadence

1. Run the marketing scorecard:

```bash
npm run marketing:scorecard -- --days 7
```

2. Review:
   - qualified quote leads by grade
   - machine interest and buyer segment mix
   - UTM source/campaign performance
   - Plus-interest leads
   - supply orders and Plus activations

3. Ship one owned-first improvement:
   - one SEO/resource/page update
   - one opt-in email/nurture improvement
   - one conversion experiment or landing-page cleanup

4. Repurpose only approved owned content into social posts.

## Email QA

Before any Resend Broadcast goes live:

- Confirm the contact segment is opt-in only.
- Send to an internal seed list first.
- Verify unsubscribe handling.
- Verify sender domain and reply-to.
- Confirm no unsupported claims, unapproved client names, or unapproved logos are present.

## Compliance References

- FTC CAN-SPAM guide: https://www.ftc.gov/node/81459
- FTC endorsement guidance: https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides
- Google helpful content guidance: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Resend Audiences/Broadcasts docs: https://resend.com/docs/dashboard/audiences/introduction
