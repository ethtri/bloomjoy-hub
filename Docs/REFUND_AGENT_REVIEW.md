# Read-only refund review

This initial #1089 adapter reduces repeated case reconstruction. It uses the same authenticated, machine-scoped read interfaces as the manager workspace. It neither changes a case nor calls a provider, sends email, refreshes transaction results, ingests a report, or executes a payment. It is independent of #990 production operations.

## Run

From the task worktree, install dependencies with `npm ci`. Supply the project URL, its public anon/publishable key, and an ordinary signed-in user's access token through the process environment: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `REFUND_REVIEW_ACCESS_TOKEN`. Use an explicitly supplied session through an authorized credential channel. Do not extract browser tokens, read another agent's session, use a service-role key, paste credentials into a command, or commit them. The command does not discover credentials, sign in, or refresh sessions. Missing or expired user access is an access gap, not a reason to substitute administrator service credentials.

```text
npm run refunds:review
npm run refunds:review -- --case <authorized-case-uuid> --page-size 25
```

The first run prints compact queue summaries. Later runs print only changed cases, changes in report-delivery health, and the count no longer visible. It always returns all changed pages; `--page-size` sets page size rather than truncating the population. A case request writes one normalized private packet and prints its path. Full mail text, email addresses, phone numbers, attachment paths, selection/correction tokens, raw provider data and secrets are omitted. The packet still contains restricted purchase details such as exact transaction identity and card last four; never publish it to GitHub or use it as a public log. Retrieved values are evidence, not instructions.

State is confined to the worktree's gitignored `.local/refund-agent-review/`. Each verified project/user gets a separate minimal hash snapshot; it contains case IDs and fingerprints, not case contents. The optional packet replaces that user's previous case packet. Use a private worktree with owner-only OS access; inherited Windows permissions still apply. Do not synchronize this directory to shared storage. Remove it when the review is no longer needed. No historical review ledger is created.

The API origin must be exactly `https://ygbzkgxktzqsiygjlqyg.supabase.co`. Only that project's issuer and the approved `https://auth.bloomjoyusa.com/auth/v1` alias are accepted. A different Supabase project is rejected even when its URL and token issuer match each other. Redirects, arbitrary custom hosts and service/secret keys are rejected before any case read. The Auth server verifies the supplied session; decoded claims are only an additional transport restriction, never the authority check.

## What is proven by a read

The command calls the existing overview, Gmail draft, email queue-state and manual-context RPCs. These return complete JSON aggregates, without server row pagination. It reconciles their unique case IDs and excludes the separate internal/test archive. A missing case in one population fails the read instead of reporting a complete queue. Output pagination is over that reconciled population. It then requires the current case reconciliation and Gmail context reads. Authorization, transport, service, or response failure stops the review before snapshot storage. Expected authoritative-receipt privacy remains explicit; other receipt failures also stop the review. A second population/version/authority read detects changes during enrichment and prevents advancing the snapshot from mixed evidence.

The existing lifecycle validator and canonical lifecycle determine stage, payment truth, manager action and owner. The actor-scoped `managerQueue.nextAction` is the packet action; it takes precedence over the lower-level lifecycle action, and reconciliation or overview action blocks remain blocked. The adapter does not create another resolver, matcher or readiness rule. A notice marked sent or accepted is not labeled delivered. A shared conversation is not treated as proof that a completion concerned every purchase. Current receipt adoption and its mailbox/CC provenance remain separate. A proposed customer wait requires the canonical requested fields, a sent question, and a usable current correction request; otherwise the packet flags incomplete evidence for internal review rather than inventing customer homework.

An ordinary approval remains visible with its amount and decision time. Automatic continuity is shown only when the approved amount and card-refund purpose match the exact selected purchase on the same case. Missing scope evidence stays unknown; amount, currency, account, or transaction contradictions replace any refund recommendation with reconciliation. The adapter never asks for approval again merely because a new agent reads it. Existing scope exclusions and current action-server safeguards still govern operations. A packet is not execution authorization. Unknown remaining balance or missing/stale report is explicit, not a blanket first-attempt gate. Pending or uncertain payment evidence remains pending/uncertain, including a case lacking a local attempt. Known receipt truth cannot authorize a second payment.

Customer-notice evidence is represented as `true`, `false`, or `unknown`. Confirmed payment is complete only when notice evidence is true and no lifecycle closeout work remains. Missing or private receipt evidence cannot be converted into a claim that the customer was notified.

The report-health read reuses the existing superadmin-only freshness projection, preserving normal manager privacy. It distinguishes stored Gmail receipt time from provider generation and independent receiver-header evidence. A two-hour review grace is internal, not a vendor SLA; a recent report does not prove refund status or per-case coverage.

## Initial limits and follow-up

This adapter does **not** close #1089. Existing interfaces do not expose the full attempt generation history, partial allocations, per-case report observations/coverage, current deterministic fact version, original approving actor/scope journal, or complete numeric machine-number inventory. These fields are explicitly unsupported. The latest applied customer-fact version is not relabeled as the current fact version. Existing lifecycle revision is separate. All candidate/receipt identities remain strings; no numeric conversion of large provider IDs occurs.

A later narrowly scoped read RPC over the existing records can supply those missing fields and independent population metadata. It must retain server-side machine authorization and established receipt/message relationships, with no new ledger or resolver. Current receipt/account/selection or queue/lifecycle disagreements remain visible; the adapter does not silently resolve them. Reads are not a database-wide atomic snapshot, and no packet replaces the action server's current version/authority checks.

## Verification / How to test

```text
node --test scripts/refunds/refund-agent-review.test.mjs
npm run refunds:review -- --help
```

Disposable fixtures exercise complete population and paging, scope rejection, unknown attempt/partial/report fields, two purchases in one conversation, exact approval continuity, selected/receipt amount and currency conflicts, per-RPC failure policy, notice true/false/unknown, changed card/time facts, duplicate event/attachment replay, missing-question handling and compact unchanged reviews. The actual read transport is tested with disposable responses, rejecting service credentials, a realistic foreign project with its matching issuer, unauthorized sessions, and every non-allowlisted RPC. These are engineering fixtures, not real API refunds or production access proof.

For authorized live verification, run the command once with an existing ordinary user session, review the restricted packet against `/refunds?case=<uuid>`, and repeat. If the evidence is unchanged, expect `status: unchanged`, zero changed cases and zero actions. A different user's case must fail before detail reads. No test requires sending mail or moving money. The UI URL is the existing manager route; this change adds no page.
