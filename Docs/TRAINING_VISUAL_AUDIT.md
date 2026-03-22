# Training Visual Audit

Date: 2026-03-21
Scope: `/portal/training` task-first library and detail pages in `agent/training-hub-ux`

## Audit standard
- Each non-video guide should include at least one purposeful source-manual visual.
- Core procedural guides should usually include two visuals when the manuals contain clear supporting figures.
- Visuals should clarify a control, threshold, location, or sequence. Avoid decorative galleries.
- Quick aids belong near the current task. `Recommended next task` should only point to downstream training.

## Card thumbnail coverage pass (2026-03-22)
- Added a shared training-card thumbnail metadata layer keyed by training id so card art no longer depends on ad hoc `thumbnailUrl` edits.
- Reused existing source-manual imagery for the visible document-first library cards instead of introducing stock or AI assets in this pass.
- Updated the training-card renderer so any non-placeholder thumbnail can render, including guides, checklists, quick aids, and manuals that do not have a primary video.
- Visible card coverage now includes:
  - `Software Setup Quickstart`
  - `Pricing, Passwords, and Payment Settings`
  - `Alarm and Power Timer Setup`
  - `Timer Control Reference`
  - `Maintenance Guide Reference Manual`
  - `Safe Power Off and Cooldown`
  - `Cleaning and Hygiene Checklist`
  - `Daily Cleaning Hotspots`
  - `Module Function Check Guide`
  - `Consumables Loading and Stick Handling`
  - `Consumables Loading Reference`
- No procured, licensed, or AI-generated assets were required to close the current visible thumbnail gaps. Future modules should use the same priority order: explicit card-thumbnail metadata, existing live thumbnail, first purposeful document visual, then placeholder only as a last resort.

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
- No confirmed visible card-thumbnail blocker is open after the `2026-03-22` coverage pass.
- Future polish, if needed, should focus on tighter crops or selectively replacing a low-signal screenshot with a stronger operational visual, not reintroducing placeholder cards.

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
1. Re-test the library cards and detail pages on desktop and mobile with authenticated localhost QA.
2. If operators still need more clarity, replace only the weakest card crop or highest-friction guide with a stronger dedicated cover instead of expanding every page indiscriminately.
