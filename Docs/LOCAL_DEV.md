# Local Dev (Sponsor-Friendly)

## Prereqs
- Node.js LTS installed (recommend Node 20+)
- Git installed

## Setup
1) Clone the repo
2) Copy `.env.example` to `.env` (or `.env.local`) and fill in values
   - **Client-exposed env vars must be prefixed with `VITE_`** (Vite rule)
   - **Never put secrets** (Stripe secret key, webhook secret) in `VITE_` vars
   - **Do not commit `.env`**. It stays on your machine only.
   - If you do not see `.env` in File Explorer, turn on "Hidden items"
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


## Agent best practices (plain language)
- Each agent uses its own worktree and its own `.env` file.
- Do not copy another person's `.env`; create your own from `.env.example`.
- Never commit or paste secret keys in PRs, issues, or chat.
- Keep PRs small and focused; one change set per PR.
- Enable repo git hooks once per clone: `git config core.hooksPath .githooks`
- Write notes and docs so non-technical readers can follow.
- Avoid editing the main repo folder directly; work inside your worktree.



## Preflight check (1 minute)
1) Confirm you are in a worktree folder like `C:\Repos\wt-<task>`
2) Confirm your branch starts with `agent/`
3) Run `git status -sb` and make sure it looks clean
4) If you are in `C:\Repos\Bloomjoy_hub`, stop and switch to a worktree

## Priority workflow (P0-P3)
- Source of truth: GitHub Issues labeled `P0`, `P1`, `P2`, `P3`.
- Use a GitHub Project board for "Backlog -> Ready -> In Progress -> Review -> Done".
- Keep repo docs light: `Docs/CURRENT_STATUS.md` is a short, plain-language snapshot.
- If you keep personal notes, store them locally and do not commit them.


## Asset access (local-only)
- Create a local folder for photos, e.g. `C:\Repos\Bloomjoy_assets`.
- Do not place large assets in the Git repo. They should stay local.
- Agents should keep their own copy of this folder.
- If an asset is needed in the app, add a small optimized version in `public/` and document it.

## If/when we add Stripe serverless functions
Depending on the hosting decision, local dev may require one of:
- `vercel dev` (for Vercel Functions)
- `netlify dev` (for Netlify Functions)
- Supabase CLI for Edge Functions

When that's implemented, this doc must be updated with exact commands.

## Common issues
- Missing env vars can break pages. Check console + `.env` (or `.env.local`).
- If Stripe webhook forwarding isn't configured, subscription/order sync may not update locally.
