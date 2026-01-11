# Docs — how to use this folder

This folder is the “context layer” for AI agents and humans.

## Precedence
If docs disagree, `Docs/DECISIONS.md` wins.

## Update rules
- Keep docs short, concrete, and skimmable.
- Prefer adding bullet points over rewriting whole sections.
- When a feature is completed, update:
  - `Docs/CURRENT_STATUS.md` (what changed + how to test)
  - `Docs/QA_SMOKE_TEST_CHECKLIST.md` (add the new smoke steps)

## What each doc is for
- `CURRENT_STATUS.md`: what’s done, what’s in progress, what’s blocked.
- `POC_NOTES.md`: what Loveable generated + what we discovered during intake (routing, structure, quirks).
- `MVP_SCOPE.md`: what we are building for MVP (and what we are not).
- `BACKLOG.md`: prioritized task list. Keep items small (PR-sized).
- `DECISIONS.md`: decision log (stack choices, tradeoffs, etc).
- `QA_SMOKE_TEST_CHECKLIST.md`: manual test steps for sponsor review.
- `LOCAL_DEV.md`: how to run and test locally.
- `ARCHITECTURE.md`: high-level architecture and repo layout.
