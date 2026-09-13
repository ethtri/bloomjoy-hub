# People & Permissions Design QA

- Source visual truth: `C:\Users\ethtr\.codex\generated_images\01a08be7-6b27-7a90-9957-e76a3a5878c2\exec-24269a4f-aa6b-4547-af07-8b9fd2ede903.png`
- Implementation: `https://app.bloomjoyusa.com/admin/access`
- Implementation screenshot: Codex CUA inline captures named **The deployed roster** and **Chelsea's live permissions drawer**. The CUA browser does not expose a filesystem path for screenshots.
- Viewport: 1264 × 710 CSS px, device density 1
- Source pixels: 1440 × 1024
- Implementation pixels: 1264 × 710
- Normalization: compared at fit-to-width scale with browser chrome excluded; the information density and drawer proportion were judged relative to each content viewport.
- State: authenticated Super Admin, production data, Chelsea selected; editor closed for the primary comparison drawer comparison.

## Full-view comparison evidence

The production implementation retains the approved Option 1 composition: existing Bloomjoy sidebar, People & Permissions heading, exposed roster, optional search, compact filters, status views, six roster columns, and a contextual right drawer. Production uses real role, account, machine, status, and updated values rather than the concept's illustrative data. The original implementation drawer occupied roughly half of the observed desktop viewport; it was reduced to a 512px maximum to recover the concept's roster-first balance while retaining enough width for the existing access forms.

## Focused drawer comparison evidence

Chelsea's production drawer shows identity, active status, primary Edit access action, Technician Pay handoff, combined access summary, TGPaci scope, two machines, pay readiness, activity access, and collapsed Advanced details. This covers the approved drawer hierarchy. The source-specific edit forms appear only after Edit access, which is an intentional safety and density adaptation because the real forms contain required reasons, machine scope, invite state, and revocation controls.

## Required fidelity surfaces

- Fonts and typography: production uses the existing Bloomjoy Nunito display and Inter UI stack, matching the approved hierarchy and optical weight. Names, emails, labels, and badges remain readable without harmful wrapping in the observed state.
- Spacing and layout rhythm: the roster grid, 44px controls, card boundary, row density, and revised 512px drawer preserve the concept's clean list-first rhythm.
- Colors and visual tokens: production uses existing Bloomjoy pink, neutral surfaces, green active status, borders, and muted text tokens; contrast and semantic status treatment are consistent with the source.
- Image quality and asset fidelity: the production sidebar uses the existing Bloomjoy logo asset. All interface icons use the existing Lucide system; no fake or placeholder visual assets were introduced.
- Copy and content: labels are plain-language and task-oriented. Production adds a truthful passive updated label and concrete pay readiness. There is no manual Refresh control.

## Findings

No actionable P0, P1, or P2 visual issues remain after the drawer-width correction.

- P3: The concept displays recent activity inline, while production exposes it through the Activity button to keep the default drawer concise. This is an intentional product tradeoff and remains one click away.
- P3: The concept includes illustrative tab counts. Production omits counts because the read model currently returns the selected view total rather than three independent counts; showing invented or extra-query counts would be less trustworthy.

## Comparison history

1. Initial production comparison found one P2 proportion mismatch: the drawer occupied about half of the desktop viewport instead of remaining contextual to the roster. Fixed by reducing the desktop maximum from 672px to 512px and keeping the mobile width at 100%.
2. Post-fix build and component contract checks passed. Production PPV of the preceding implementation confirmed the full information hierarchy and interactions; the width-only correction preserves those states.

## Implementation checklist

- [x] Auto-load the authorized roster with no search gate or manual refresh.
- [x] Preserve approved filters, views, roster columns, and responsive cards.
- [x] Show Chelsea's contextual access and pay summary.
- [x] Keep audited edit actions and advanced authority secondary.
- [x] Deep-link to Technician Pay with Chelsea selected.
- [x] Resolve production navigation and database-read failures found during PPV.

final result: passed
