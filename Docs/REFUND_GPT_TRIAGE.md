# Refund GPT Triage

Last updated: 2026-07-21

## Purpose and current state

GPT assistance is a narrow, human-reviewed aid for refund inbox triage. It may classify a message, extract a strict set of refund facts, identify missing information, summarize the request, and prepare a reply that asks only for those missing facts.

The credential-independent policy, database ledger, manager review UI, and sanitized evaluation suite are implemented for issue `#635`. No model-provider request runner is included, no provider credential is configured, and triage processing is disabled by default. The existing deterministic missing-information reply remains available when no GPT suggestion exists.

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

1. Only inbound Gmail text from the linked refund case is eligible. At most the latest eight inbound messages and 6,000 characters are prepared.
2. Sender and recipient identities are excluded. Full card numbers, security codes, and credential-like text are redacted before model input.
3. Customer text is marked as untrusted content. It cannot override the system policy or add actions.
4. The model must return the exact `refund_gpt_triage_v1` schema. Extra fields, unexpected extracted fields, and inconsistent missing-field or safety-flag results are rejected.
5. Deterministic checks recompute missing fields and policy flags. A flagged or low-confidence result is routed to a person with no draft.
6. Only the derived result is written to the service-only ledger. Raw model input and raw provider output are not stored.
7. An authorized manager may edit and approve a safe draft or reject it with a reason. Email is delivered before the review ledger records approval, preventing the system from claiming an unsent reply was sent.

Derived summary and draft content is retained for 30 days and then cleared by `service_purge_refund_gpt_triage_expired_content`. The canonical refund case and redacted audit outcome remain governed by their existing retention rules.

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

Before enabling a real model, approve a secure server-only credential destination and the privacy controls in issue `#635`. Then run a sanitized, human-reviewed evaluation without automatic sending. Required pilot thresholds are:

- classification accuracy at least 95%;
- missing-field accuracy at least 95%;
- unsafe-action rate exactly 0%;
- false-routing rate no more than 2%;
- draft acceptance target at least 80%; and
- edit rate measured and reviewed rather than treated as a failure by itself.

Reviewer outcomes must record approve-as-written, approve-after-edit, or reject, plus any false routing or missing-field correction. Do not enable broader use if any unsafe draft occurs.

## Enablement and rollback

Provider execution remains off until the technical, support, privacy/security, and sponsor owners approve the server-only credential destination and the live evaluation in `#635`. Provider credentials must never be stored in a browser-exposed `VITE_` variable, a repository file, an issue, or a PR.

Rollback is immediate and non-destructive: set the triage setting `enabled=false` and stop the provider runner. Gmail and hosted-form cases continue to work, and managers fall back to the deterministic missing-information reply. Do not delete triage or review rows during an incident; preserve the audit record and allow the 30-day content purge to run.
