# Adding a separate Nayax account

Use the existing account-specific integration; keep the connected account's
credentials and operation intact. This guide prepares #1913 under #944. It does
not activate NC refunds or change the temporary NC operating scope in `AGENTS.md`.
The refund product workflow remains [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md).

## Prepare and verify the reporting token

`BLOOMJOY_NC_ADAM` is the proposed logical key corresponding to the existing
`bloomjoy_nc_adam` manual scope. Confirm the exact active Nayax user, operator
Actor ID and machine identities privately when the account becomes available.
An email address alone is not an account identity. Do not infer the provider
inventory from the stored Hub roster or assume its count must stay fixed.

The existing server-side credential slots for this logical key are:

- `NAYAX_LYNX_API_TOKEN_BLOOMJOY_NC_ADAM` for inventory and Last Sales reads.
- `NAYAX_REFUND_REQUEST_WRITE_TOKEN_BLOOMJOY_NC_ADAM` for refund requests.
- `NAYAX_REFUND_APPROVE_WRITE_TOKEN_BLOOMJOY_NC_ADAM` for refund approvals.

Keep token values in a private env file outside Git/worktrees, then use the
approved Supabase secret path when configuring production. Never send them in
email or chat, paste them into issues, or put them in browser-exposed env vars.
The reporting token never substitutes for either write credential. Use separate
request and approval tokens under the existing working contract; a successful
GET or presence of a token does not prove refund permission.

Run the offline preparation command now:

```powershell
npm run nayax:account-readiness -- --account-key BLOOMJOY_NC_ADAM
```

When the reporting token is available, put it and the privately confirmed
`NAYAX_EXPECTED_ACTOR_ID_BLOOMJOY_NC_ADAM` in the private env file. From the PR
worktree, run (replace only the private file path):

```powershell
node --env-file=C:/Users/ethtr/.codex/credentials/Bloomjoy_hub/nayax-nc.env scripts/nayax/account-readiness.mjs --account-key BLOOMJOY_NC_ADAM --probe
```

The probe makes only GET requests to the production hierarchy, machine list and
one returned machine's Last Sales. It checks the expected actor and returned
machine/transaction scope, refuses redirects, bounds response sizes and prints
only fixed statuses and counts. The offline default makes no provider calls.
It never updates the database, publishes inventory, issues a refund, changes
permissions or sends a message. Visibility is not proof of complete historical
coverage or a complete provider census. No real refund is needed to test reads.

## Connect inventory and original machine identities

After verifying the actual account, store its reporting secret and append its
logical key to `REFUND_NAYAX_INVENTORY_ACCOUNT_KEYS`, preserving every existing
key and the current scheduler settings. Use
[inventory operations](REFUND_NAYAX_INVENTORY_RUNBOOK.md) to discover and review
the provider inventory. Match the exact account and immutable Nayax machine ID
to the existing physical machine and reader history; names alone are not proof.
Preserve existing sales, prior reader ownership, timezone and Manager mappings.
Do not create a duplicate physical machine simply to attach a new source.

## Account-specific activation work

Two existing implementation boundaries require deliberate follow-through before
calling the full NC integration ready:

1. Keep the existing `NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEY` intact. The prepared
   worker adds accounts through `NAYAX_REFUND_ATTEMPT_QUEUE_ACCOUNT_KEYS` and
   processes each independently with its own paired write credentials and exact
   claim/account binding. Each account retains the existing two-attempt bound
   per sweep; a failure in one does not stop another. Leave the additional list
   empty until NC identity, write access, mapping and synthetic/portal checks are
   confirmed. Deploy the reviewed worker through the normal release path before
   enabling the additional account. Do not change global execution or
   scope-confirmation settings to assert that unverified NC credentials work.
2. The observed scheduled-report parser accepts the two existing actor IDs, and
   attachment recognition and persisted report/sales account attribution use
   the existing delivery contract. Obtain an authenticated NC report sample and
   confirm its actor hierarchy, file format, delivery route and exact account
   mappings before extending that contract. A token does not add scheduled
   report support. Keep already-connected report imports running.

Machine/Last Sales access can be prepared independently of report delivery and
refund-write access. Historical transaction exports/backfill and optional
dashboard permissions are reporting work, not new refund approval requirements.
See [the working refund contract](NAYAX_REFUND_WORKING_CONTRACT.md) and
[native scheduled reports](NAYAX_SCHEDULED_REPORTS.md).

Use synthetic transport for request/approval account isolation and portal UAT;
do not issue a customer refund to demonstrate readiness. Record redacted
verification in #944; leave actual account access and identity unresolved until
the credentials and provider evidence arrive.
