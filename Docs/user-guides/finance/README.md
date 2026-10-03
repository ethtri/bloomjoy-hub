# Finance team user guides

Use the eight-page guide in the preferred language:

- [English PDF](../../../output/pdf/bloomjoy-finance-guide.en.pdf) - [editable English source](finance-guide.en.md)
- [简体中文 PDF](../../../output/pdf/bloomjoy-finance-guide.zh-CN.pdf) - [可编辑中文原文](finance-guide.zh-CN.md)

The guides cover Finance, the detailed Sales view, Overview/Locations filters and comparisons, Refund reports, Timekeeping reports, exports, company grouping and consistent machine-company assignment. The Chinese edition retains English screen labels so readers can find the matching control. Live links require sign-in and the account's existing report access.

## Screenshot provenance

The original six workflow screenshots were captured October 2, 2026 from the actual React application at main commit `853c397270e2d84f44244418f14aaba24a7cd1b6`. The two company workflow screenshots were captured October 3 from the company grouping implementation in PR #1725, using the isolated company reporting preview and machine setup fixtures. The earlier images illustrate the unchanged calculations; the new Company controls are shown on pages 7–8. The existing user preview on port 8097 was untouched.

The preview uses the repository's synthetic reporting fixtures, a fixed sample date of July 22, 2026, a synthetic account and a loopback backend. It disables real credentials and external requests. These are illustrative examples, not company results or a dataset for reconciling totals across screens. No production data, customer/payment identifiers or private exports appear in the assets.

| Asset | Preview screen and capture |
| --- | --- |
| `finance-core.png` | `/portal/reports?view=finance`; complete Sales to net sales region |
| `finance-breakdown.png` | Same screen; complete expanded Sales, tax and refund breakdown |
| `filters.png` | `/portal/reports?view=overview`; top of main content with More filters open |
| `sales.png` | `/portal/reports?view=sales`; top of main content through the complete detail-control card |
| `refunds-core.png` | `/refunds?view=reports`; complete Requests received in this period section |
| `labor.png` | `/portal/time-review?view=reports`; Export CSV, labor metrics and rounding explanation |
| `company-reports.png` | `/portal/reports?view=finance`; Company filter and company comparison with synthetic company fixtures |
| `company-machines.png` | `/admin/machines`; saved company and read-only ordinary location, direct rendered form capture |

Captures are cropped to readable regions of actual rendered screens; the UI was not repainted or changed. Every PDF screenshot has a sample-data caption because crops can omit the preview banner.

## Maintain and rebuild

Edit the Markdown language sources and retain one workflow per `---`-separated page. Review both editions together when labels or definitions change. The PDFs derive from the same sources; the small builder handles links, bold labels, paragraphs, bullets and screenshots.

Requires Python with `reportlab` and Windows Arial / Microsoft YaHei font files. Codex's bundled Python already provides ReportLab. Run from the repository root:

```powershell
python Docs/user-guides/finance/build_guides.py
pdftoppm -r 95 -png output/pdf/bloomjoy-finance-guide.en.pdf tmp/pdfs/en
pdftoppm -r 95 -png output/pdf/bloomjoy-finance-guide.zh-CN.pdf tmp/pdfs/zh
```

The builder accepts `--font-dir` and `--output-dir`. The default PDFs go to `output/pdf/`; only these two finished PDFs are committed from that ignored artifact directory. Font files are embedded in the PDF, not copied into the repository. Inspect all final pages after rebuilding, including clickable links, Chinese glyphs, screenshot readability and footer spacing.

Definitions were checked against current reporting panels, export helpers and `CompanyAssignmentFields`. Company grouping follows the current canonical machine assignment while each domain retains its own permissions. This guide documents the implemented controls; reading it changes no report access, tax rate, machine assignment or refund policy.
