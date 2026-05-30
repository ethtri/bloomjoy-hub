# GitHub Actions Security

GitHub Actions workflows should default to least privilege and avoid leaving repository credentials available to steps that do not need them.

## Permissions

- Set explicit workflow-level `permissions`.
- Use `contents: read` for validation, build, lint, test, migration-check, and scheduled read/sync jobs that do not push commits, create releases, or write issues.
- Add write permissions only at the job or workflow that needs them, with a comment or PR note explaining why.

## Checkout Credentials

- Set `persist-credentials: false` for `actions/checkout` unless the workflow intentionally pushes to the repository.
- Workflows that push generated commits or tags must document the write path and keep the write-scoped job separate from read-only validation jobs.

## Action Pinning

- Prefer official GitHub actions or trusted vendor actions with explicit major versions.
- Third-party actions should be reviewed before adoption and pinned to a version or commit SHA when the publisher, permissions, or supply-chain risk is unclear.
- When action SHAs are pinned, update them through a small PR that records the upstream release, changelog or commit, and verification result.
- Do not introduce broad token scopes to compensate for action failures without first confirming the action actually needs the permission.
