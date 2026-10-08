# Authenticated Portal UX Audit

Date: 2026-07-16

Audit baseline: `origin/main` at `374ae64`

Related work: #547, #550, #551, #552, #553, PR #558, PR #563, PR #581

## Executive Readout

The recent authenticated sidebar overhaul was a meaningful improvement. The portal now has one role-aware desktop sidebar, one matching mobile drawer, clear active states, and no primary horizontal navigation scroller. Existing persona UAT passes, and the audited routes did not overflow horizontally at 390px.

The navigation is no longer the main problem. Page-level hierarchy is.

Most portal pages still behave like small marketing landing pages inside the application. A route title and description appear in the app header, then a large gradient-framed intro repeats the title, description, badges, and actions. The content below is usually divided into many similar rounded cards. This creates visual weight, repeated explanation, and long mobile pages even when the user's job is simple.

The highest-value next move is not another navigation redesign. It is a portal-wide distillation pass:

1. Fix the app-only color contrast failure.
2. Replace repeated shell and page framing with one clear page header.
3. Finish #551 by turning the dashboard into a short attention and next-action view.
4. Reduce Training to one start path, one search path, and one browse path.
5. Simplify login, support selection, empty states, and secondary portal workflows in small follow-up slices.

There are no P0 blocking findings. There are four P1 findings that materially affect clarity, accessibility, or task completion.

## Scope

Included:

- `/login`
- authenticated app shell and navigation
- `/portal`
- `/portal/orders`
- `/portal/training`
- `/portal/onboarding`
- `/portal/support`
- `/portal/account`
- `/portal/team`
- `/portal/reports`
- `/portal/time`
- `/portal/time-review` through source review and existing UAT coverage
- baseline, Plus owner, timekeeper, and Super Admin shell states where local fixtures existed

Excluded:

- public marketing and storefront pages
- deep Admin Console workflow redesigns
- the internal logic of the shared `/refunds` workflow
- production data correctness
- authorization, RLS, role, or route changes
- a new visual brand direction

Admin routes were inspected only where they helped verify the shared shell. The recommendations in this document are for the login and customer/operator portal experience.

## Method And Evidence

The audit combined source review and rendered browser evidence:

- Read the canonical product, design, status, scope, architecture, decision, and smoke-test documentation.
- Reviewed current routes, navigation metadata, app layout, portal page framing, and portal page source.
- Inspected existing issues and PRs so the plan would not duplicate the completed sidebar work.
- Ran `npm run agent:github-hygiene` before planning.
- Ran `npm run portal-nav:uat -- --app-url http://127.0.0.1:8081` against mocked local personas.
- Ran the production build and reviewed route chunk output. Portal routes are split, while the Reports route remains the largest portal chunk at 443.30 kB raw and 120.99 kB gzip.
- Captured and inspected desktop at 1366x768 and mobile at 390x844.
- Audited the rendered login page with axe-core 4.12.1 against WCAG 2 A, AA, and 2.1 AA rules.
- Measured route titles, headings, visible word count, interactive control count, touch-target size, console errors, and horizontal overflow on representative portal pages.

The local audit used synthetic accounts and mocked responses. No real customer data, payment data, vendor data, or secrets were used.

The Impeccable deterministic detector was attempted but unavailable because its bundled detector was not present. The fallback evidence is axe-core, browser metrics, screenshots, source inspection, and the repository's existing persona UAT.

## Health Scores

### Technical Health

| Dimension | Score | Key finding |
| --- | ---: | --- |
| Accessibility | 2/4 | The app primary color fails AA contrast in common text and filled-control uses. |
| Performance | 3/4 | Routes are lazy loaded and no render errors appeared, but Reports is a 443.30 kB raw route chunk and Training remains a complex surface. |
| Responsive design | 3/4 | No horizontal overflow was found, and the drawer works; mobile pages remain unnecessarily long and some controls are 40px tall. |
| Theming | 2/4 | Tokens are widely used, but the app color pair is inaccessible and the defined dark tokens are not wired to an app theme. |
| Anti-patterns | 2/4 | Repeated gradient intro panels, identical card grids, nested cards, and interface-explaining copy are systemic. |
| **Total** | **12/20** | **Acceptable foundation, significant UX work remains.** |

### Nielsen Heuristic Review

| Heuristic | Score | Key observation |
| --- | ---: | --- |
| Visibility of system status | 3/4 | Progress, active navigation, badges, and refresh states are generally visible. |
| Match with the real world | 3/4 | Labels are mostly task based, though some copy describes the interface instead of the user's work. |
| User control and freedom | 3/4 | Sidebar navigation, back paths, and route preservation are strong. |
| Consistency and standards | 3/4 | Component vocabulary is consistent, sometimes to the point of visual sameness. |
| Error prevention | 3/4 | Sensitive forms include confirmation and reason patterns. |
| Recognition rather than recall | 2/4 | Training and dashboard content present several competing ways to find the same destination or resource. |
| Flexibility and efficiency | 2/4 | Frequent users must scan long pages; shortcuts are presented as another card catalog. |
| Aesthetic and minimalist design | 1/4 | Repeated titles, descriptions, badges, cards, and helper copy make simple workflows feel heavier than they are. |
| Error recovery | 3/4 | Login and blocked states generally offer a recovery path. |
| Help and documentation | 3/4 | Help is plentiful, but some pages over-explain before allowing action. |
| **Total** | **26/40** | **Workable and trustworthy, but unnecessarily effortful.** |

## What Is Working

### One primary navigation model

PR #563 and PR #581 materially improved orientation:

- one persistent desktop sidebar
- one mobile drawer using the same groups
- role-aware destination filtering
- one active item at a time
- portal switching treated as a utility in admin context
- no primary horizontal portal/admin scroller

The current shell should be preserved and refined, not replaced.

### Permission-aware visibility

Baseline, timekeeper, and admin fixtures saw different destination sets. A baseline user did not see Time, while a configured timekeeper did. Unauthorized destinations are hidden instead of shown as a large locked catalog.

### Responsive structural behavior

The audited portal routes showed no page-level horizontal overflow at 390px. The mobile admin drawer focused the first destination and used touch-friendly navigation items.

### Clearer task language in newer workflows

Time uses a dominant `Add completed shift` action and plain review-state language. The blocked Time state explains what setup is missing and returns the user to Dashboard. These are patterns to preserve while reducing the surrounding framing.

## Priority Findings

### P1: Shell context and page intros repeat the same information

Evidence:

- `AppLayout` renders the current route label and route description in the top app header.
- Nine portal route components also use `PortalPageIntro` to render another eyebrow, H1, description, badges, actions, and optional child content.
- Support, Account, Team, and Reporting repeat the same route title in both places.
- The audited portal source contains 42 instances of the large rounded-card patterns used for page framing and content grouping.

Impact:

- The actual task begins lower on every page.
- Mobile users pay the highest cost because the repeated framing stacks vertically.
- Page importance becomes flat: route context, status, instructions, and actions all receive similar visual weight.
- Users must scan explanatory copy before reaching controls they already selected from the sidebar.

Recommendation:

- Keep the sidebar as the primary locator.
- On desktop, let the page own the H1 and remove the route description from the app header.
- On mobile, keep a compact route label in the sticky header, but do not repeat its description.
- Replace `PortalPageIntro` with a lean product page header: one H1, at most one sentence, actions, and only decision-relevant status.
- Remove the default `Member portal` eyebrow from routine pages.
- Do not use a gradient panel merely to frame every page title.

Primary locations:

- `src/components/layout/AppLayout.tsx`
- `src/components/portal/PortalPageIntro.tsx`
- the nine portal pages that render `PortalPageIntro`

### P1: Dashboard is still a second navigation map

Evidence:

- The dashboard renders 270 visible words and 25 interactive controls in the audited Plus desktop state.
- It contains a primary next step, reporting access, portal access, setup progress, a Quick actions card grid, an onboarding snapshot, and recommended training.
- `dashboardActions` is derived from portal navigation metadata, then rendered again as destination cards.
- On mobile, the same content becomes a long sequence of stacked containers. The primary action is visible, but supporting content continues for many screens.
- Copy such as `Your portal is now organized...` describes the redesign instead of helping the user complete work.

Impact:

- The sidebar answers where to go, while the dashboard repeats many of the same destinations.
- The most important next action competes with access summaries and shortcuts.
- Repeated onboarding and training content makes it harder to distinguish what actually needs attention now.

Recommendation:

- Use #551 as the implementation issue.
- Make the first viewport answer only: what needs attention, what is my next action, and what changed recently.
- Show one dominant next action and no more than three attention items.
- Remove the generic Quick actions grid. The sidebar is the shortcut system.
- Keep membership or access status only when it changes an available action.
- Link to Onboarding and Training instead of reproducing both workflows on the home page.

### P1: Training offers too many competing discovery models

Evidence from the audited Plus state:

- 873 visible words
- 40 interactive controls on desktop and 28 on mobile
- eight H2 sections
- a start path, shortest sequence, task categories, jobs-by-moment cards, search, filters, grouped task browsing, certificate status, and support guidance
- several resources appear in more than one discovery section before the user reaches the canonical task library

Impact:

- The page tries to be a home page, curriculum, search interface, reference library, task browser, certificate tracker, and support router at once.
- New operators face too many equally plausible starting points.
- Returning operators must scroll through introductory material before reaching search and browse controls.
- Mobile density makes findability worse even though the content itself is useful.

Recommendation:

Use a three-layer model:

1. Start or resume the primary operator path.
2. Search all training and reference resources.
3. Browse by task category.

Then:

- use one canonical resource card pattern
- avoid showing the same resource in several sections
- make filters progressive, not permanently expanded
- move certificate details into the primary track or a compact progress area
- move development catalog diagnostics out of the main content flow, even when visible only in local development

### P1: The app primary color fails WCAG AA contrast

Automated login evidence found one serious rule with six failing nodes:

- white on `#e87390`: 2.88:1
- `#e87390` on the near-white app background: 2.81:1
- expected for the audited normal text: 4.5:1

Affected examples included:

- selected language control
- selected Password method
- primary sign-in button
- forgot-password link
- create-account link
- Plus link

The same primary token is used throughout portal buttons, active states, labels, and links, so this is a systemic app issue rather than a login-only defect.

Recommendation:

- Do not change the global public-site palette as part of this portal-only work.
- Introduce an app-scoped interactive color pair, or use a darker existing app-safe tone for text and filled controls.
- Separate decorative pink from accessible action text if both are needed.
- Verify normal text, large text, focus rings, hover, active, disabled, and selected states.
- Require zero serious axe contrast violations on the audited app routes before closeout.

Standard: WCAG 2.1 AA, 1.4.3 Contrast (Minimum).

### P2: Login presents three entry methods without a clear recommended path

Evidence:

- Password is the default selected method.
- Google, Password, and Email Link all appear as peer choices.
- `Docs/MVP_SCOPE.md` still says magic link is preferred.
- The desktop layout contains a top route description, a full operator-benefit panel, a sign-in intro, method guidance, and multiple links back to the public site.
- The mobile layout correctly puts the form first, but still includes account creation, reset, email-link guidance, and Plus promotion in the same flow.

Impact:

- New users must decide how their account was created before they can sign in.
- Password receives the strongest visual emphasis even though the documented preferred method is Email Link.
- Recovery, account creation, and marketing links compete with the primary sign-in task.

Recommendation:

- Confirm the current business-preferred sign-in method before implementation.
- If Email Link remains preferred, make it primary, keep Google secondary, and place Password under `Other ways to sign in`.
- If Password is now preferred, record that decision and update the scope documentation.
- Remove duplicate public-site links and shorten the desktop benefit panel.
- Keep recovery adjacent to the chosen method, not as a peer primary action.

### P2: Support and empty states use equal cards where guided selection would work better

Support presents four same-weight cards. `Get Manufacturer Support` and `WeChat Onboarding Help` are close enough that a user may need to read both descriptions before choosing.

Orders renders a full table header with only `No orders yet`. Reporting can show zero-value metrics and three separate empty panels for the same no-data condition.

Recommendation:

- Start Support with the user's problem: machine issue, WeChat/setup, parts, or general concierge help.
- Explain the channel after the problem is selected.
- Give Orders an empty state with the next useful action and hide the empty table structure.
- In Reporting, collapse related no-data panels into one explanation tied to the current filters.

### P2: Several controls miss the project's 44px touch-target goal

The browser audit found 40px-tall primary and secondary actions on Dashboard, Training, Account, and Reporting. Reporting also uses 36px period controls. The 16px checkbox controls are wrapped by larger clickable labels in the audited flows and are not counted as standalone failures.

This is not automatically a WCAG AA failure because WCAG 2.2 AA permits smaller targets under defined spacing and exception rules. It does miss the repository's own 44px mobile target and increases error risk in dense controls.

Recommendation:

- Standardize primary mobile actions and toggle targets at 44px minimum.
- Treat compact desktop controls separately when spacing and keyboard access are strong.
- Verify focus, hover, active, disabled, loading, and selected states for every shared control.

### P2: Too much copy explains the interface instead of the task

Examples include:

- `Your portal is now organized...`
- `without dealing with a cramped mobile table`
- `without bouncing through the sales shell`
- `Choose the right lane first`
- access-summary cards that restate available navigation

Impact:

The copy documents implementation history and interface structure instead of helping users decide or act. It also makes the portal feel less confident.

Recommendation:

- Delete release-note and implementation language from routine screens.
- Use helper copy only for risk, eligibility, prerequisites, or the next step.
- Cap normal page introductions at one sentence.
- Prefer concrete outcomes such as `View receipts and shipping status` over interface commentary.

## Route-Level Summary

| Surface | What works | Main opportunity |
| --- | --- | --- |
| Login | Form first on mobile, labels and recovery paths are clear | Establish one recommended method, remove duplicate context, fix contrast |
| Dashboard | Role-aware next action exists | Remove the second navigation catalog and repeated onboarding/training summaries |
| Orders | Reorder and refresh actions are visible | Replace the empty table shell with a useful empty state |
| Training | Strong task taxonomy and useful content | Collapse several discovery systems into start, search, and browse |
| Onboarding | Checklist state is understandable | Show progress once and emphasize only the current milestone |
| Support | Four service types are available | Route by user problem instead of equal service cards |
| Account | Profile, shipping, billing, and membership are grouped | Remove repeated page framing and avoid duplicate billing/team prompts |
| Team | Scope and training-only consequences are explicit | Use progressive disclosure so the invite form is not preceded by several explanation layers |
| Reporting | Filters and data freshness are visible | Simplify empty states and enlarge compact controls on touch devices |
| Time | Dominant add-shift action and clear state language | Remove repeated header framing and reduce empty cards |
| Review Time | Review boundary and correction reason are clear in source | Apply the same lean page-header and empty-queue patterns |

## Implementation Plan

### Phase 0: Align the existing issue queue

No runtime changes.

- Treat #550 as complete because the sidebar shell shipped in PR #563.
- Treat the navigation portion of #552 as largely delivered by PR #581, then update or close the stale issue rather than redoing the work.
- Keep #551 as the dashboard implementation issue and remove its stale dependency blocker after owner approval of this audit.
- Keep #553 as the final persona and responsive QA gate.
- Do not merge PR #558 as if it describes the current implementation. Its useful IA decisions have already been implemented or superseded on `main`; close or annotate it after owner review.

### Phase 1: Fix the app foundation in two small PRs

#### Slice 1A: Accessible app-only interaction tokens

- Add app-scoped accessible action and link colors.
- Update login, portal active states, buttons, and inline links.
- Keep the public marketing palette out of scope.
- Add axe verification for login and representative authenticated pages.

Acceptance:

- normal text contrast is at least 4.5:1
- large text contrast is at least 3:1
- focus indicators are visible
- no serious axe contrast violations on the audited app routes

#### Slice 1B: Lean portal page header

- Remove the desktop app-header description.
- Keep the mobile route label compact.
- Replace `PortalPageIntro` with a lean page-header pattern.
- Migrate the simplest pages first: Orders, Support, Account, Team, and Onboarding.
- Migrate Reporting, Time, and Review Time only after their route-specific actions and status needs are checked.

Acceptance:

- exactly one H1 per page
- no repeated route title and description in the same viewport hierarchy
- the first task control begins higher on desktop and mobile
- at most one introductory sentence on routine pages
- status badges appear only when they affect a decision

### Phase 2: Complete #551 as the task-first dashboard

- Keep one primary next action.
- Add a small `Needs attention` list backed only by real state.
- Optionally show recent status if a reliable source already exists.
- Remove the Quick actions grid.
- Remove duplicated onboarding and training mini-workflows.
- Keep access or membership status only when it explains a missing or available action.

Acceptance:

- the primary action is visible in the first mobile viewport
- no more than three attention items are shown before a `View all` path
- the dashboard does not repeat the sidebar destination catalog
- baseline, Technician, Plus, Corporate Partner, timekeeper, and admin-capable states each have an intentional primary action

### Phase 3: Distill Training

- Make start or resume the primary action.
- Move search directly below the start action.
- Keep one task-category browse model.
- Make advanced filters progressive.
- Remove repeated resource cards from secondary sections.
- Move certificate detail into the operator path or a compact progress panel.

Acceptance:

- only three primary discovery choices appear above the library: start/resume, search, browse
- one training item has one canonical card in the main discovery flow
- returning users can reach search without scrolling through promotional sections
- mobile users do not encounter repeated copies of the same resource before the library

### Phase 4: Simplify secondary workflows in separate risk-sized PRs

Do not combine all of these into one redesign PR.

1. Login method hierarchy and copy, because auth changes require focused UAT.
2. Support problem routing.
3. Orders and Reporting empty states.
4. Onboarding current-milestone focus.
5. Account and Team copy and progressive disclosure.
6. Touch-target and interaction-state polish.

### Phase 5: Run #553 as the closeout gate

Required personas:

- signed out
- baseline authenticated user
- training-only Technician
- Plus owner
- Corporate Partner
- timekeeper
- time reviewer or Machine Manager
- refund operations user
- Scoped Admin
- Super Admin

Required evidence:

- desktop and 390px mobile screenshots
- direct-load and active-route checks
- keyboard navigation and focus checks
- 200% text zoom check on representative pages
- axe on login and representative portal routes
- no horizontal page overflow
- 44px mobile target check for primary controls
- loading, empty, error, success, and blocked states

## Recommended PR Sequence

| Order | Slice | Priority | Tracking |
| ---: | --- | --- | --- |
| 1 | App-only accessible interaction colors | P1 | New focused issue under #547 |
| 2 | Lean portal page header and copy budget | P1 | New focused issue under #547 |
| 3 | Task-first dashboard | P1 | Reuse #551 |
| 4 | Training discovery simplification | P1 | New focused issue under #547 |
| 5 | Login hierarchy and copy | P2 | New auth-focused issue under #547 |
| 6 | Support and empty-state simplification | P2 | New portal-flow issue under #547 |
| 7 | Persona, accessibility, and responsive QA | P1 | Reuse #553 |

Each implementation PR should stay incremental, preserve routes and permissions, include a `How to test` section, and provide rendered desktop and mobile evidence.

## Guardrails

- Do not redesign the public site in these slices.
- Do not replace the current sidebar or mobile drawer.
- Do not change routes, RLS, roles, capabilities, or business permissions as part of visual simplification.
- Do not make a global color-token change without separately checking the public site.
- Do not combine auth, dashboard, training, and reporting changes into one PR.
- Do not add fake metrics or placeholder operational state.
- Do not introduce a new design system, app framework, router, CMS, or auth provider.

## Owner Decisions Needed Before Implementation

1. Confirm the preferred login path: Email Link, Google, or Password.
2. Confirm that the dashboard sidebar, not Quick actions cards, should be the primary shortcut system.
3. Confirm that Training should optimize for start/resume first, with search second and browse third.
4. Approve app-scoped accessible color changes even if the authenticated portal becomes slightly darker and less candy-pink than the public site.

These decisions affect sequencing and acceptance, but they do not block merging this audit document.
