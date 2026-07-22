# Refund GPT Triage

Last updated: 2026-07-22

## Purpose and current state

GPT assistance is a narrow, human-reviewed aid for refund inbox triage. It may classify a message, extract a strict set of refund facts, identify missing information, summarize the request, and prepare a reply that asks only for those missing facts.

The policy, server-only OpenAI Responses API runner, content-free job ledger, manager review UI, and sanitized evaluation suite are implemented for issue `#635`. The production provider credential is not configured and all three production controls default off: the GitHub schedule, the Edge Function, and the database setting. The existing deterministic missing-information reply remains available when no GPT suggestion exists.

## Safety boundary

GPT may:

- classify a message as refund-related, unrelated, or uncertain;
- extract location or machine, incident date and time, payment method, amount, and card last four;
- identify which of those fields are missing;
- write a concise summary; and
- draft an English reply that asks only for the missing fields.

GPT may not:

- choose or confirm a Nayax transaction;
- approve, deny, promise, or execute a refund;
- request a full card number, CVV, PIN, login credential, or payment link;
- send a message without a manager's explicit approval;
- process legal, safety, threat, chargeback, abusive/escalated, prompt-injection, high-value, wallet-payment, prohibited-payment-data, low-confidence, unrelated, uncertain, or non-English input without a person; or
- create any payment or refund action.

The database requires human review and has a check constraint that permanently rejects `auto_send_enabled=true`. Changing that boundary requires a reviewed migration and an explicit sponsor decision; it is not a runtime toggle.

## Data flow and minimization

1. Only the latest eligible inbound Gmail message for an open linked refund case can start a job. At most the latest eight inbound messages and 6,000 characters are prepared.
2. Sender and recipient identities are excluded. Full card numbers, security codes, and credential-like text are redacted before model input.
3. Customer text is marked as untrusted content. It cannot override the system policy or add actions.
4. The server sends the request with `store=false`, no tools, no action capability, and a one-way hashed safety identifier. The OpenAI key never enters the browser or GitHub Actions. Provider execution also fails closed unless `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=true` records the separate privacy/security approval described below.
5. The model must return the exact strict `refund_gpt_triage_v1` JSON schema. Extra fields, unexpected extracted fields, and inconsistent missing-field or safety-flag results are rejected again in local code and in the database.
6. Deterministic checks recompute missing fields and policy flags. A flagged or low-confidence result is routed to a person with no draft.
7. Only the derived result is written to the service-only review ledger. The separate idempotency ledger contains source IDs, model/version metadata, fingerprints, and sanitized failure codes only. Raw model input and raw provider output are not stored.
8. Failed jobs do not automatically retry. A newer customer message can create a new job and supersedes any older unreviewed suggestion after successful validation.
9. An authorized manager may edit and approve a safe draft or reject it with a reason. Email is delivered before the review ledger records approval, preventing the system from claiming an unsent reply was sent.

Derived summary and draft content is retained for 30 days and then cleared by `service_purge_refund_gpt_triage_expired_content`. The canonical refund case and redacted audit outcome remain governed by their existing retention rules.

### OpenAI retention and data-control gate

`store=false` disables Responses API application-state storage for this request; it does **not** by itself mean zero provider retention. OpenAI's published data-control documentation states that API data is not used to train models by default, but `/v1/responses` content may be retained for abuse monitoring for up to 30 days unless the selected organization/project has an approved Modified Abuse Monitoring or Zero Data Retention configuration. Prompt caching may also apply under the selected project settings. Source: [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Before any real-model evaluation, the privacy/security owner must inspect the exact OpenAI organization and project used by the production key and record in issue `#635`, without customer content or secret values:

- the project data-control mode (`default`, Modified Abuse Monitoring, or Zero Data Retention);
- whether the approved evaluation may use sanitized synthetic content under that mode;
- the approver and approval date/window; and
- any required expiry, revocation, or follow-up review.

Keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until that record exists. Set it to `true` only in the server-side Supabase secret store for the approved evaluation or pilot. This acknowledgement is a fail-closed runtime gate; it does not change the provider's actual retention setting and must never be used as a substitute for inspecting the OpenAI project.

## Manager experience

The Refunds workbench shows assistance inside the existing reply flow, not as a separate dashboard. A safe suggestion displays the summary, exact missing fields, and editable subject/body followed by one `Approve and reply in Gmail` action. A manager can reject the suggestion without sending anything.

Policy-sensitive or uncertain input displays `Needs a person before any reply`, the applicable flags, and no GPT draft or send action. The workbench states that assistance cannot approve or issue a refund.

## Validation and pilot gates

Run the credential-independent checks with:

```bash
npm run refunds:validate-gpt-triage
npm run db:validate-migrations
npm run refunds:validate-portal-uat -- --app-url http://127.0.0.1:8081
```

Before configuring any server environment, verify secret names without printing values:

```bash
npm run refunds:preflight-gpt-triage -- --env-file .env.local
```

The developer credential destination is a gitignored local `.env.local`; it is not a production secret store. Before enabling a real model in production, approve the Supabase server-secret destination and the project-level OpenAI retention/privacy controls in issue `#635`, then set the server-only acknowledgement flag for that approved window. Run only a sanitized, human-reviewed evaluation without automatic sending. Required pilot thresholds are:

- classification accuracy at least 95%;
- missing-field accuracy at least 95%;
- unsafe-action rate exactly 0%;
- false-routing rate no more than 2%;
- draft acceptance target at least 80%; and
- edit rate measured and reviewed rather than treated as a failure by itself.

Reviewer outcomes must record approve-as-written, approve-after-edit, or reject, plus any false routing or missing-field correction. Do not enable broader use if any unsafe draft occurs.

## Enablement and rollback

Provider execution remains off until the technical, support, privacy/security, and sponsor owners approve the production server-secret destination, OpenAI project data-control mode, and live evaluation in `#635`. Provider credentials must never be stored in a browser-exposed `VITE_` variable, a tracked repository file, GitHub Actions, an issue, or a PR.

Enablement requires the privacy acknowledgement plus all three execution controls: keep `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` until the recorded approval exists and keep `REFUND_GPT_TRIAGE_SYNC_ENABLED=false` while configuring; set the acknowledgement, Edge secret `REFUND_GPT_TRIAGE_ENABLED=true`, and database `refund_gpt_triage_settings.enabled=true` only for the same approved window. Automatic customer sending cannot be enabled.

Rollback is immediate and non-destructive: set `REFUND_GPT_TRIAGE_SYNC_ENABLED=false`, then `REFUND_GPT_TRIAGE_ENABLED=false`, then set the database triage setting `enabled=false`, and finally reset `OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED=false` when the approved window ends. Gmail and hosted-form cases continue to work, and managers fall back to the deterministic missing-information reply. Do not delete job, triage, or review rows during an incident; preserve the audit record and allow the bounded 30-day content purges to run.
