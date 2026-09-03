# Simple Card-Refund Release and UAT Runbook

This runbook closes issue `#949` up to the owner-controlled production boundary. A merged PR, synthetic UAT, or read-only audit does not authorize deployment, machine activation, customer contact, or a live refund.

## The manager promise

For a clearly matching transaction, a mapped Machine Manager should do only two things:

1. Select and confirm the correct transaction.
2. Select **Refund $X** and confirm the payment.

Transaction confirmation must immediately show **Transaction confirmed** and **Payment: Not issued**. It must survive reload. Machine or runtime blocks must name one exact reason; they must never send the manager to configuration or leave a vague dead end.

## Repository proof

Run from the immutable ordered release commit:

```bash
npm ci
npm run build
npm test
npm run lint -- --quiet
npm run db:validate-migrations
npm run db:validate-rpc-surface
npm run refunds:validate-machine-readiness-audit
npm run refunds:validate-release-tooling
npm run refunds:release:check
```

Run the focused production-shaped browser journey with a local UAT server:

```bash
npm run dev:uat
npm run refunds:validate-portal-uat -- --nayax-lookup-only --app-url http://127.0.0.1:8081 --artifact-dir output/refund-uat-evidence --fragment-dir output/refund-uat-fragments
```

The sanitized fixture contains one exact internal machine identity, `$7.00 USD`, matching synthetic card ending, two-minute time difference, and an unavailable provider approval field. It proves candidate ordering and selection; machine-disabled truth; reviewed activation; reload; one enabled **Refund $7.00** action; processing lock; confirmed success; and zero secondary browser mutations. Database suites separately prove wrong actor, stale version, expired evidence, duplicate transaction, confirmation replay/concurrency, global and machine pauses, cap rejection, provider rejection, timeout, reconciliation hold, exactly one provider attempt, one settlement, one reporting adjustment, and one customer operation.

## Read-only production readiness audit

After the ordered release is deployed, link only the exact reviewed project and run:

```bash
npm run refunds:machine-readiness-audit -- --project-ref <project-ref> --confirm-project-ref <project-ref> --allow-not-ready
```

The command sends one SELECT-only query and prints counts only. It never prints or writes machine, provider, case, manager, or customer identifiers. Before activation, review every **Ready to activate**, **Setup needed**, and approved-exception count. Tulsa must be exactly one reviewed machine and either ready or represented by one explicit blocker; unexplained Tulsa state is a stop condition. Every nonterminal confirmed card case must be either ready or have one exact server-owned blocker; an unknown next action is a stop condition.

## Owner UAT and activation

Only after deployment and a clean read-only baseline:

1. A pilot manager who did not implement the feature signs in without coaching.
2. Use one approved synthetic or explicitly approved real case. Do not expose customer or provider identifiers in screenshots or issue comments.
3. Confirm the closest safe transaction once. Verify the confirmed/unpaid state immediately and again after reload.
4. In Admin → Machines, review **Ready to activate** and every exception. Use the single-machine action for a bounded pilot or **Activate qualified machines** only after the owner go/no-go. Every activated machine receives the `$50` launch limit; approved exceptions remain off.
5. Rerun the readiness audit without `--allow-not-ready`. It must report zero ready-to-activate, unexplained-disabled, over-cap, Tulsa-unexplained, and confirmed-case-unknown rows.
6. Confirm the manager sees one enabled **Refund $X** action and visible **Deny request**. For any approved live refund, confirm once and require one provider attempt, one final settlement, one reporting adjustment, and one customer confirmation.
7. Reopen every nonterminal confirmed case and verify its one current next action.

## Stop and rollback

Stop immediately on duplicate selection, duplicate provider attempt, ambiguous completion, hidden blocker, incorrect amount, unauthorized action, customer-message uncertainty shown as success, or disagreement between Admin readiness and manager capability. Apply the global runtime pause first for a fleet-wide incident. Use the reviewed machine pause reason for one machine. Never retry an uncertain provider result.

## Closeout receipt

Post the privacy-safe aggregate receipt to `#949`, parent `#628`, and monitoring issue `#427`:

```markdown
## Simple refund production closeout
- Release commit / manifest ID:
- Ordered PRs #950 / #951 / #952 / #949 PR: MERGED / NOT MERGED
- Default-off deployment and production drift: PASS / HOLD / NOT RUN
- Machines: active / ready / approved exceptions / setup needed / unexplained / over cap
- Tulsa: ready / reviewed blocker / unexplained
- Nonterminal confirmed cases: total / ready / exact blocker / unknown
- Uncoached mapped-manager desktop and mobile UAT: PASS / FAIL / NOT RUN
- Selection replay/concurrency and reload: PASS / FAIL / NOT RUN
- Provider success/rejection/uncertainty and duplicate prevention: PASS / FAIL / NOT RUN
- Customer completion delivery: PASS / FAIL / NOT RUN
- Staffed monitoring window and owner:
- Stop condition encountered:
- Owner go/no-go and date:
```

Do not mark the production acceptance items complete until a human owner performs the UAT and records the go/no-go.
