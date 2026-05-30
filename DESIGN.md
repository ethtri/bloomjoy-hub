# DESIGN

Register: product

## Stack

- Vite, React, TypeScript, Tailwind, shadcn/ui, Radix primitives, lucide-react icons.
- Prefer existing components and route patterns before adding new abstractions.
- Use browser verification for visible UI changes.

## Typography

- Base font: Inter.
- Display font: Nunito.
- Keep interface text compact and legible. Do not scale type directly with viewport width.

## Existing Tokens

Current Tailwind and CSS tokens use a light candy-inspired system:

- Background: `hsl(340 30% 99%)`
- Foreground: `hsl(340 20% 15%)`
- Primary: `hsl(345 72% 68%)`
- Primary foreground: `hsl(0 0% 100%)`
- Secondary: `hsl(195 85% 85%)`
- Accent: `hsl(45 95% 85%)`
- Success: `hsl(120 45% 65%)`
- Destructive: `hsl(0 84.2% 60.2%)`
- Border: `hsl(340 20% 90%)`
- Radius token: `0.75rem`

Use the existing tokens unless the issue explicitly calls for design-system work.

## Product UI Guidance

- Operator, admin, reporting, refund, and training surfaces should feel calm, utilitarian, and work-focused.
- Prefer restrained color, clear hierarchy, table/card density where useful, predictable controls, and visible state.
- Use icons for tool actions when a standard lucide icon exists.
- Keep cards for repeated items, modals, and genuinely framed tools. Avoid nesting cards inside cards.
- Do not add decorative blobs, one-note gradients, or generic hero compositions to operational surfaces.

## Public Page Guidance

- Public pages may use warmer brand energy, real product imagery, candy color, and clearer sales storytelling.
- The product or offer should be visible in the first viewport.
- Avoid vague value-prop filler. Make the concrete action and offer visible.

## Verification

- Check desktop and mobile layouts for text overflow, accidental overlap, and tap target clarity.
- Confirm empty, loading, error, and success states for user-facing flows.
- For UX-sensitive work, use `impeccable` to shape, audit, or polish the design before final verification.
