# Reporting UAT result - issues #656 and #657

- Status: **PASS**
- App: `http://127.0.0.1:8097`
- Fixed fixture clock: `2026-07-22T16:00:00.000Z`
- Data: sanitized, intercepted Auth/RPC/function responses only

## Checks

- PASS - Operator-only reporting user cannot see partner controls or revenue-share data
- PASS - Operator default toolbar keeps advanced and custom controls out of the primary path
- PASS - Operator date-range control keeps all presets and reveals dates only for Custom
- PASS - Operator More filters contains visible Daily/Weekly/Monthly and one payment selector
- PASS - Operator KPIs, daily totals, and detail rows reconcile exactly
- PASS - Operator fresh status is separate from a loaded zero-sales date
- PASS - Operator breakdown control supports keyboard focus movement
- PASS - Operator summary changes to weekly grouping while retaining reconciled totals
- PASS - Operator machine and payment filters scope every total and export
- PASS - Operator desktop has no horizontal overflow
- PASS - Operator mobile defaults to compact filters and collapsed detail
- PASS - Operator mobile preserves exact daily reconciliation
- PASS - Operator mobile is usable at 390px without horizontal overflow
- PASS - Operator stale import state remains distinct from loaded zero sales
- PASS - Operator unavailable import state remains distinct from loaded zero sales
- PASS - Partner all-machines view shows six actions, locations, duplicate-name context, and zero sales
- PASS - Partner machine picker becomes searchable at the six-machine threshold
- PASS - Partner row action supports keyboard selection and a persistent selected scope
- PASS - Corporate Partner hides non-blocking internal notes without false review messaging
- PASS - Partner selected-machine KPIs, history, and export retain machine scope
- PASS - Partner desktop has no horizontal overflow
- PASS - Partner mobile all-machines view preserves location and action context
- PASS - Partner mobile selected zero-sales machine keeps scope, history, back action, and no overflow
- PASS - Super Admin can open and leave a scoped partner machine drilldown
- PASS - Operator compact boundary 360px has no horizontal overflow
- PASS - Operator expanded-filter boundary 360px has no horizontal overflow
- PASS - Operator compact boundary 414px has no horizontal overflow
- PASS - Operator expanded-filter boundary 414px has no horizontal overflow
- PASS - Partner responsive boundary 414px keeps all-machine and selected-machine scopes in bounds
- PASS - Baseline account remains blocked from reporting
- PASS - Signed-out reporting route still redirects to login
- PASS - No unexpected browser errors occurred

## Screenshots

- `operator-custom-date-desktop.png`
- `operator-detail-expanded-desktop.png`
- `operator-detail-expanded-mobile-390.png`
- `operator-filter-default-desktop.png`
- `operator-filter-default-mobile-390.png`
- `operator-filter-more-desktop.png`
- `operator-filter-more-mobile-390.png`
- `operator-payment-menu-desktop.png`
- `operator-weekly-summary-desktop.png`
- `operator-zero-sales-stale-desktop.png`
- `partner-all-machines-desktop.png`
- `partner-all-machines-mobile-390.png`
- `partner-selected-machine-desktop.png`
- `partner-selected-zero-machine-mobile-390.png`
