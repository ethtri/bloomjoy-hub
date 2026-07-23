# Operator reporting UX review packet

Issues: [#656](https://github.com/ethtri/bloomjoy-hub/issues/656) and [#657](https://github.com/ethtri/bloomjoy-hub/issues/657)

Status: **Ready for executive screenshot review; not approved for merge**

## What changed

- The primary filter path now shows Date range, Machine, More filters, and Export.
- All seven date presets remain available from one control.
- Custom dates appear only after Custom is selected.
- Daily, Weekly, Monthly, and payment choices live under More filters.
- The applied-filter summary and conditional Reset action make the current scope explicit.
- Sales by day/week/month is the one primary summary.
- Detailed breakdown is collapsed by default and retains every machine/payment reconciliation row.
- The rejected “Bloomjoy review in progress” notice is absent from the UI and final artifacts.

## Desktop review

### Compact default

![Compact default operator filters](./operator-filter-default-desktop.png)

### More filters

![Expanded advanced filters](./operator-filter-more-desktop.png)

### Payment choices

![Payment method multi-select](./operator-payment-menu-desktop.png)

### Custom date range

![Custom date range](./operator-custom-date-desktop.png)

### Weekly summary

Partial week labels are clamped to the actual selected dates.

![Weekly period summary](./operator-weekly-summary-desktop.png)

### Detailed breakdown expanded

![Expanded detailed breakdown](./operator-detail-expanded-desktop.png)

### Zero sales versus stale coverage

![Zero sales and stale coverage](./operator-zero-sales-stale-desktop.png)

## Mobile review at 390px

### Compact default

![Compact mobile filters](./operator-filter-default-mobile-390.png)

### More filters

![Expanded mobile filters](./operator-filter-more-mobile-390.png)

### Detailed breakdown expanded

![Expanded mobile details](./operator-detail-expanded-mobile-390.png)

## Partner notice regression check

The selected-machine partner view remains clear of the rejected review-in-progress notice.

![Partner selected machine without internal review notice](./partner-selected-machine-desktop.png)

## Authenticated-browser result

- **32/32 checks passed**
- Sanitized, intercepted authentication and reporting fixtures only
- Exact daily KPI/summary/detail reconciliation passed
- Weekly totals and partial-period labels passed
- Machine/payment filter and export scope passed
- Compact and expanded layouts passed at 360px, 390px, 414px, and desktop
- Keyboard, touch-target, permission, signed-out, and partner regression checks passed
- No unexpected browser errors

See [reporting-uat-results.md](./reporting-uat-results.md) and [reporting-uat-results.json](./reporting-uat-results.json).

## Release gate

Do not merge the draft PR and do not deploy this change until the executive sponsor has reviewed these screenshots and commented explicit approval.
