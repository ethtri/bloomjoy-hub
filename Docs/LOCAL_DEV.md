# Local Dev (Sponsor-Friendly)

## Prereqs
- Node.js LTS installed (recommend Node 20+)
- Git installed

## Setup
1) Clone the repo
2) Copy `.env.example` to `.env.local` and fill in values
   - **Client-exposed env vars must be prefixed with `VITE_`** (Vite rule)
   - **Never put secrets** (Stripe secret key, webhook secret) in `VITE_` vars
3) Install deps:
   - `npm ci`
4) Start dev server:
   - `npm run dev`
5) Open the URL printed in the terminal (usually):
   - http://localhost:5173

## Testing a PR branch
1) Checkout the PR branch (or use a worktree)
2) Run `npm ci`
3) Run `npm run dev`
4) Follow `Docs/QA_SMOKE_TEST_CHECKLIST.md`

## If/when we add Stripe serverless functions
Depending on the hosting decision, local dev may require one of:
- `vercel dev` (for Vercel Functions)
- `netlify dev` (for Netlify Functions)
- Supabase CLI for Edge Functions

When that’s implemented, this doc must be updated with exact commands.

## Common issues
- Missing env vars → pages may error. Check console + `.env.local`.
- If Stripe webhook forwarding isn’t configured, subscription/order sync may not update locally.
