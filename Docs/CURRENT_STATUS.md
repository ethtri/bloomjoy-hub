# Current Status

## Summary
- Starting point: **Loveable-generated POC** (Vite + React + TypeScript + Tailwind + shadcn/ui).
- MVP scope defined in `Docs/MVP_SCOPE.md`.
- First priority is to **stabilize the POC** and align it to the MVP routing + docs workflow.

## Next P0 milestones
1) POC intake + repo hygiene (build/lint/dev) + document findings in `Docs/POC_NOTES.md`
2) Public marketing site shell (Home, Machines, Supplies, Plus, Resources, Contact)
3) Auth + member portal shell (login, dashboard layout)
4) Stripe: supplies checkout (one product) + membership checkout (Plus Basic) + customer portal
5) Training library MVP (gated pages + embeds) + support request forms

## Known risks / blockers
- Product photography availability (Mini may launch as waitlist/coming soon)
- Clear support boundary copy must be reviewed early (to prevent support overload)
- Stripe server-side surface choice (Vercel/Netlify/Supabase Edge) affects implementation layout

## Environments
- Local: `npm run dev` on a PR branch/worktree
- Production: not set up yet
