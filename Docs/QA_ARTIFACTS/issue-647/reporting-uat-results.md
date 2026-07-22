# Reporting UAT result - issue #647

- Status: **PASS**
- App: `http://127.0.0.1:8081`
- Fixed fixture clock: `2026-07-22T16:00:00.000Z`
- Data: sanitized, intercepted Auth/RPC/function responses only

## Checks

- PASS - Operator exposes Today, Last 7 days, and visible Daily/Weekly/Monthly controls
- PASS - Operator KPIs, daily totals, and detail rows reconcile exactly
- PASS - Operator fresh status is separate from a loaded zero-sales date
- PASS - Operator breakdown control supports keyboard focus movement
- PASS - Operator machine and payment filters scope every total and export
- PASS - Operator desktop has no horizontal overflow
- PASS - Operator mobile preserves exact daily reconciliation
- PASS - Operator mobile is usable at 390px without horizontal overflow
- PASS - Operator stale import state remains distinct from loaded zero sales
- PASS - Operator unavailable import state remains distinct from loaded zero sales
- PASS - Partner all-machines view shows six actions, locations, duplicate-name context, and zero sales
- PASS - Partner machine picker becomes searchable at the six-machine threshold
- PASS - Partner row action supports keyboard selection and a persistent selected scope
- PASS - Corporate Partner sees scoped warnings without internal-only leakage
- PASS - Partner selected-machine KPIs, history, warnings, and export retain machine scope
- PASS - Partner desktop has no horizontal overflow
- PASS - Partner mobile all-machines view preserves location and action context
- PASS - Partner mobile selected zero-sales machine keeps scope, history, back action, and no overflow
- PASS - Operator responsive boundary 360px has no horizontal overflow
- PASS - Operator responsive boundary 414px has no horizontal overflow
- PASS - Partner responsive boundary 414px keeps all-machine and selected-machine scopes in bounds
- PASS - Baseline account remains blocked from reporting
- PASS - Signed-out reporting route still redirects to login
- PASS - No unexpected browser errors occurred

## Screenshots

- `operator-daily-desktop.png`
- `operator-daily-mobile-390.png`
- `operator-zero-sales-stale-desktop.png`
- `partner-all-machines-desktop.png`
- `partner-all-machines-mobile-390.png`
- `partner-selected-machine-desktop.png`
- `partner-selected-zero-machine-mobile-390.png`

