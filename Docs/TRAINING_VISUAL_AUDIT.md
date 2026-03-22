# Training Visual Audit

Date: 2026-03-21
Scope: `/portal/training` task-first library and detail pages in `agent/training-hub-ux`

## Audit standard
- Each non-video guide should include at least one purposeful source-manual visual.
- Core procedural guides should usually include two visuals when the manuals contain clear supporting figures.
- Visuals should clarify a control, threshold, location, or sequence. Avoid decorative galleries.
- Quick aids belong near the current task. `Recommended next task` should only point to downstream training.

## Remediation completed in this pass
- `Software Setup Quickstart`
  - Added admin-access visual from `Software setup.pdf`
  - Added Wi-Fi/timezone setup visual from `Software setup.pdf`
- `Pricing, Passwords, and Payment Settings`
  - Added price-setting screen visual
  - Added payment/contact settings visual
- `Alarm and Power Timer Setup`
  - Added local alarm screen visual
  - Tightened the timer control reference crop to remove excess bottom whitespace
- `Start-Up & Shutdown Procedure`
  - Keeps the cooldown reference visual from `Cotton Candy Maintenance Guide.pdf`
- `Daily Maintenance Routine`
  - Keeps the cleaning hotspot visual from `Cotton Candy Maintenance Guide.pdf`
- `Module Function Check Guide`
  - Added debug-page visual
  - Added output/module-check visual
- `Consumables Loading and Stick Handling`
  - Replaced the generic consumables image with the sugar-bin fill-line visual
  - Added separate pipe-routing visual
- `Consumables Loading Reference`
  - Added sugar fill-line visual
  - Swapped pipe-routing visual to the maintenance-guide routing crop

## Flow corrections completed in this pass
- Detail pages now separate:
  - `Use during this task` for quick aids and manuals
  - `Recommended next task` for true downstream training
- Shared manuals no longer pollute canonical task search terms, so task search is closer to MECE boundaries.

## Remaining content gaps
- No confirmed content/visual blocker is open after the `2026-03-21` metadata correction for `provider_video_id=1167976486`.
- Future polish, if needed, should focus on instructional depth or tighter crops, not mislabeled routes.

## Source-manual figure map used in this pass
- `Software setup.pdf`
  - Admin access / Android menu reveal
  - Wi-Fi and date/time setup
  - Pricing screen
  - Payment/contact settings
  - Local alarm screen
  - Power timer screen
  - Timer button legend
- `Cotton Candy Maintenance Guide.pdf`
  - Shutdown / cooldown figure
  - Cleaning hotspots
  - Debugging page
  - Stick output checks
  - Sugar fill line
  - Pipe routing and check-valve checks
  - Paper-stick loading

## Next recommended pass
1. Re-test detail pages on desktop and mobile with authenticated localhost QA.
2. If operators still need more clarity, add 1 more image only to the highest-friction guide pages instead of expanding every page indiscriminately.
