# Bloomjoy Hub

Bloomjoy Hub is the Bloomjoy Sweets MVP web app (Vite + React + TypeScript + Tailwind + shadcn/ui) with Supabase Auth/DB and Stripe-powered checkout flows.

## Local development
1) Copy `.env.example` to `.env` and set values.
2) Install dependencies:
   - `npm ci`
3) Start dev server:
   - `npm run dev`
4) Open the URL printed in terminal (usually `http://localhost:8080`).

See `Docs/LOCAL_DEV.md` for full setup notes and preflight checks.

## Testing
Use the repo verification baseline:
- `npm ci`
- `npm run build`
- `npm test --if-present`
- `npm run lint --if-present`

Use `Docs/QA_SMOKE_TEST_CHECKLIST.md` for manual flow verification.

## Deployment
Production deployment and rollback are documented in:
- `Docs/PRODUCTION_RUNBOOK.md`

This includes:
- production env var/secret matrix
- deploy order (migrations -> function secrets -> function deploy -> webhook -> frontend)
- launch-day verification
- rollback checklist
