## Summary
- 

## User-facing change
- What changes for a customer, operator, partner, or admin?
- If there is no user-facing change, write `None - internal/docs only`.

## Risk level
- [ ] Low - docs, copy, or small cleanup
- [ ] Medium - UI/admin UX/non-critical scripts
- [ ] High - database, Edge Functions, auth, Stripe/payments, reporting math, GitHub Actions, or production data paths

## AI review evidence
- Implementing agent self-check:
- Independent AI/subagent review, if medium/high risk:
- Labels applied:

## Verification
- `npm ci`:
- `npm run build`:
- `npm test --if-present`:
- `npm run lint --if-present`:
- Other relevant checks:

## UAT / how to test
- Preview URL or localhost URL:
- Exact pages/routes:
- Steps:
  1.
  2.
  3.
- Expected result:
- Owner UAT required?
  - [ ] No
  - [ ] Yes - user-facing or high-risk change

## Screenshots
- Required for UI changes. Add desktop and mobile screenshots or write `Not applicable`.

## Rollback plan
- Usually: revert this PR.
- If not that simple, explain the rollback steps:

## Notes / open decisions
- 
