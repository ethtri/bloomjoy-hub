# Design

## Register

product

## Design Intent

Bloomjoy Hub's authenticated surfaces should feel like an operations tool: calm, structured, scannable, and trustworthy under repeated use. The public storefront can carry more warmth and candy-forward brand energy, but portal and admin work should prioritize orientation, permissions, and task completion.

For visible frontend work, use `impeccable` to shape, audit, or polish app-shell, dashboard, navigation, admin, reporting, refund, payout, account, team, onboarding, training, empty-state, and responsive behavior.

## Stack And Constraints

- Vite, React, TypeScript, Tailwind, shadcn/ui, Radix primitives, lucide-react icons, React Router, Supabase, and Stripe/Supabase Edge Functions.
- Prefer existing components, route guards, design tokens, data helpers, and local route patterns before adding new abstractions.
- Do not introduce a new design system, routing platform, CMS, auth provider, or app framework unless a GitHub issue and decision entry explicitly approve it.
- Keep `/portal` and `/admin` direct-load behavior stable unless route churn is explicitly scoped.

## Typography

- Base font: `Inter`.
- Display font: `Nunito`.
- Product UI should use compact, readable type with restrained hierarchy.
- Do not scale interface type directly with viewport width.
- Avoid display-like treatment for labels, buttons, table data, form controls, and navigation.

## Current Tokens

Current Tailwind and CSS tokens use a light candy-inspired HSL variable system. Do not migrate tokens opportunistically. If a future issue scopes token work, prefer OKLCH for new token decisions while preserving visual compatibility.

- Background: `hsl(340 30% 99%)`
- Foreground: `hsl(220 20% 14%)`
- Card: `hsl(0 0% 100%)`
- Primary: `hsl(345 72% 68%)`
- Primary foreground: `hsl(0 0% 100%)`
- Secondary: `hsl(340 40% 96%)`
- Muted: `hsl(340 20% 94%)`
- Accent: `hsl(340 35% 97%)`
- Destructive: `hsl(0 72% 51%)`
- Border/input: `hsl(340 20% 90%)`
- Ring: `hsl(345 72% 68%)`
- Radius token: `0.75rem`
- Sidebar background: `hsl(340 30% 99%)`
- Sidebar accent: `hsl(340 40% 96%)`

Use the existing tokens unless the issue explicitly calls for design-system work.

## Authenticated App Shell

The target portal/admin shell should borrow the Bloomjoy Events structure:

- persistent sectioned sidebar on desktop
- mobile drawer using the same grouped navigation
- one primary navigation model per viewport
- role-aware destination filtering
- clear active-route state
- account, language, main-site, and sign-out controls that remain discoverable without crowding task navigation

Avoid stacked horizontal navigation strips for global portal/admin movement. Local tabs or steps are acceptable only when they represent a true page-level workflow.

## Product UI Guidance

- Operator, admin, reporting, refund, payout, access, team, account, and training surfaces should feel calm, utilitarian, and work-focused.
- Use restrained color. Reserve saturated pink/coral emphasis for primary actions, current selection, and important state.
- Use consistent shadcn/Radix component vocabulary for buttons, menus, sheets, tabs, selects, dialogs, tables, forms, and toasts.
- Use lucide icons for recognizable tool actions and navigation labels when an appropriate icon exists.
- Keep cards for repeated records, modals, and genuinely framed tools. Do not nest cards inside cards.
- Prefer skeletons or structured empty states over centered spinners for page content.
- Empty states should explain the next operational step, not just say that nothing exists.
- Destructive, payment-adjacent, access, refund, and payout actions need clear confirmation, permission context, and rollback language.

## Dashboard And IA Guidance

- `/portal` should be task-first, not a second navigation directory.
- Prioritize "Needs attention", current work, recent status, and a small number of high-value actions per persona.
- Group destinations by user job and operational intent, not by implementation module.
- Admin should feel like a clean operations/governance area, not a duplicate portal tab.
- Refunds, payouts, reporting, access, machines, partnerships, support, team, account, training, and onboarding need clear homes in the shell before deeper page refactors.

## Public Page Guidance

- Public pages may use warmer brand energy, real product imagery, candy color, and clearer sales storytelling.
- The product or offer should be visible in the first viewport.
- Avoid vague value-prop filler. Make the concrete action and offer visible.

## Verification

- Run standard repo verification for implementation PRs: `npm ci`, `npm run build`, `npm test --if-present`, and `npm run lint --if-present`.
- For workflow or agent-context changes, run the relevant agent validation script from `package.json`.
- For visible UI changes, verify rendered desktop and mobile states in browser.
- Check text overflow, accidental overlap, keyboard focus, tap target clarity, loading, empty, error, success, and permission states.
- For authenticated UI changes, capture persona evidence using the owner UAT playbook where applicable.
