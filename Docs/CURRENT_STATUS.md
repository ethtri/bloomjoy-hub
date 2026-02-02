# Current Status

## Summary
- Starting point: **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- MVP scope defined in `Docs/MVP_SCOPE.md`.
- First priority is to **stabilize the POC** and align it to the MVP routing + docs workflow.
- Write updates in plain language so non-technical readers can follow.

## Next P0 milestones
1) Stripe: webhook sync (membership + orders)

## Owner next steps
- Set up Vimeo (Starter/Standard), restrict embeds to approved domains, and add video IDs + hashes into `training_assets`.

## Upcoming scope clarification (next sprint)
- Allow non-Plus users to log in and access baseline tasks (e.g., order machines/materials); gate premium features behind Bloomjoy Plus.

## Completed P0 milestones
1) POC intake + repo hygiene (build/lint/dev) + document findings in `Docs/POC_NOTES.md`
2) Public marketing site shell (Home, Machines, Supplies, Plus, Resources, Contact)
3) Auth + member portal shell (login, dashboard layout)
4) Routing + navigation skeleton aligned to MVP Machines paths (with legacy redirects)
5) Training library MVP (gated pages + embeds) + support request forms
6) Sugar checkout (Stripe Checkout via Supabase Edge Function + client redirect)
7) Plus subscription checkout + customer portal (Stripe via Supabase Edge Functions)

## Known risks / blockers
- Product photography availability (Mini may launch as waitlist/coming soon)
- Clear support boundary copy must be reviewed early (to prevent support overload)
- Stripe server-side surface choice (Vercel/Netlify/Supabase Edge) affects implementation layout
- Lint passes but still shows fast-refresh warnings in generated UI files

## Environments
- Local: `npm run dev` on a PR branch/worktree
- Production: not set up yet

## How to test on localhost (simple steps)
1) In the project folder, run `npm ci`
2) Start the app with `npm run dev`
3) Open the URL shown in the terminal (usually http://localhost:5173)
