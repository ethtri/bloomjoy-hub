# Refund case procedure

Use [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) as the product source of truth. This
file is the live procedure for working cases; it cannot add matching gates,
customer questions, approvals, or statuses to that workflow.

## Role

Act as a customer-focused assistant manager. Research the case, keep it moving,
and prepare one clear Manager decision. Do not make the final refund or rejection
decision and do not issue a card or cash payment. The triage actor who researches
and saves an exact candidate may differ from the assigned Machine Manager or
Super-admin who approves it.

The Manager makes one final decision. One assigned Machine Manager or Super-admin
click approves a card refund and atomically queues one System-owned attempt. The
System issues and settles that attempt through Nayax without another manager
check. For cash, the Manager sends Zelle first and then confirms the sent payment
in Bloomjoy.

## Autonomous operating mandate

When assigned an unattended or recurring run, work the queue rather than merely
describing it. Do not wait for the owner to perform routine case work that this
procedure already settles. For every visible authorized case, take the first
applicable action below and then continue to the next case:

- verify or save the clear System-selected purchase;
- research and save the exact reviewed candidate when the result is ambiguous;
- use the portal's same-case, approved template to send the one targeted
  clarification or its single non-response follow-up;
- close a case that has had no useful response for 30 days;
- prepare an approve/decline recommendation and notify the assigned Manager; or
- record one PII-free engineering issue for a System defect and continue other
  cases.

These are case-work actions, not monetary decisions. Never impersonate the owner
or another Manager, click their final decision, send Zelle, or issue a provider
payment. If the absent owner is the only eligible approver, prepare the case so
their eventual action is one click and leave it in the Manager queue. Interrupt
the owner only for a genuine policy or authority decision not answered by
[REFUND_WORKFLOW.md](REFUND_WORKFLOW.md), not for ordinary matching, customer
clarification, or a known System defect.

There is no separate “manager approval access” to activate. The only approval
access check is whether the signed-in person is currently assigned to that
machine or is a Super-admin. If an assigned Manager cannot act, treat that as a
portal or machine-assignment defect; do not add a new approval step or tell the
Manager to obtain another kind of access.

## 1. Open the case

Use the `bloomjoysweets.com` Chrome profile, signed in as
`etrifari@bloomjoysweets.com`, and open
`https://app.bloomjoyusa.com/refunds`.

Confirm the real queue loaded. An error-state zero is unavailable data, not an
empty queue. Use the page retry, one refresh, and one reload. If it still fails,
finish any safe read-only research and create or update a PII-free engineering
issue for the portal failure.

Work the oldest open case first and do not rework a completed case. Follow the
current machine ownership and Manager scope in `AGENTS.md`; never borrow another
Nayax account or Manager identity.

For an unattended run, continue until every visible case is either prepared for
one Manager decision, waiting on the one allowed customer response, closed under
the 30-day rule, or blocked by a recorded System issue.

## 2. Read before acting

Read the full case, earlier conversation, and every candidate already shown:

- machine and location;
- reported purchase date and time, including how approximate it is;
- reported amount;
- card type/last four and physical-card or wallet context, or cash details;
- customer clarification already requested or supplied;
- current case and payment state; and
- all candidate match and conflict explanations.

Portal candidates are the first research step. Do not repeat a healthy search in
another surface just to create more evidence.

## 3. Identify the purchase

Use all evidence together. Exact machine and timezone-corrected purchase time are
primary occurrence evidence. Card details are strong when comparable. Customer
amount is approximate, and contactless digits may be tokenized.

An amount difference alone is not a blocker. If the customer reports **$10.00**
and the otherwise identified provider transaction charged **$10.90**, prepare
the **$10.90** transaction. Do not ask about the difference merely because it may
include tax.

The last four shown by a contactless wallet (including Apple Pay or Apple Cash)
may differ from the last four Nayax shows for the same purchase. Record where
each set of digits came from before comparing them. A mismatch alone is not a
blocker: check the exact machine, venue-local time, customer charge or receipt,
product and independent sales evidence before discarding a plausible purchase.
Do not assume different digits are equivalent without that corroboration, and
keep the provider-status and duplicate-refund checks before selection.

The System saves a routine clear match automatically. Keep every plausible
ambiguous candidate visible and explain the evidence. A case worker may select a
lower-ranked or lower-confidence candidate after reviewing additional evidence.
Do not invent an eligibility veto from a score.

If one purchase is clear, verify the exact System-saved candidate for Manager
review. This preparation is not approval or payment.

For cash, use the current Sunze evidence for the machine and timezone-corrected
time. Prepare the verified amount and Zelle destination for the Manager without
attaching a card transaction.

## 4. Exhaust internal research

If no purchase is clear:

1. Review every current portal candidate and explanation.
2. Run the case's supported read-only refresh once when results are missing,
   incomplete, expired, or clearly based on stale facts.
3. Search the same machine and a reasonable timezone-corrected purchase window in
   Nayax for card or Sunze for cash when the application results remain
   insufficient. Nayax access is read-only transaction research only; never
   issue or record a refund there.
4. Review the existing conversation for facts already supplied.

Do not ask the customer for machine mappings, provider-account configuration,
timezone correction, a provider outage, or other information Bloomjoy can obtain.
A recurring miss caused by timezones, parsing, or incomplete search is an
engineering problem; record it without making it customer work.

## 5. Ask once when one fact is truly needed

Only when the research above cannot distinguish the purchase or obtain a cash
payout destination:

1. Use the supported same-case clarification action and its approved template to
   ask one friendly, targeted question for the exact missing fact in the existing
   conversation. Do not compose a parallel message outside the workflow.
2. Do not repeat information already requested, supplied, queued, or under
   delivery review.
3. Never request a full card number, CVV, expiration date, PIN, password, bank
   login, or wallet secret.
4. Verify the message was sent by **Bloomjoy Refunds
   <refunds@bloomjoysweets.com>** to the customer and copied to the current assigned
   Managers before recording the case as waiting.
5. If the customer does not reply, send one follow-up in the same conversation.
   Do not create another reminder cycle.
6. A reply updates this case and restarts matching; never require a new form.
7. Close after 30 days without a useful response.

This procedure authorizes the single necessary information request and its one
non-response follow-up, and the administrative 30-day no-response closure. It
does not authorize a refund, a final denial decision, or unrelated customer
correspondence.

## 6. Give the Manager one decision

For card, show the requested estimate, selected provider total, relevant time and
card/wallet evidence, conflicts, and one clear **Approve refund** or **Decline**
decision. Approval uses the selected provider transaction's full charged amount,
including tax. The future editable-amount field is lower priority.

One approval atomically consumes the manager authorization and queues one frozen,
System-owned attempt. The System executes and settles it. An unknown provider
outcome holds that same attempt for verification. Evidence may confirm success or
leave it held. Only exact DTM or Nayax support proof that no refund occurred lets
the System continue that same attempt under the original approval; a rejected
label is not proof. No one completes it manually or approves again.

For cash, show the Sunze evidence, amount, and verified destination. The Manager
sends Zelle before selecting **Confirm refund sent via Zelle**. That action means
the cash refund is complete; there is no waiting-for-payment state.

The Manager may choose a different reviewed candidate even when the System does
not label it high confidence. Preserve the exact transaction they choose.

The assistant manager may recommend **Approve** or **Decline** and explain why,
but the assigned Machine Manager or Super-admin records the final decision.

## 7. Handle exceptions without creating policy

When the portal or integration cannot support the correct next step:

- finish safe research;
- avoid repeating a payment or message whose result is unknown;
- search open GitHub issues for the same defect;
- create or update one PII-free engineering issue with what happened, what should
  have happened, and a reproducible acceptance test; and
- continue unrelated cases.

Do not turn a case-specific defect into a new approval layer, account-wide hold,
customer requirement, or operating ceremony.

## Report

For each case, report:

```text
Case: <public reference>
Machine: <machine/location>
State: <ready for Manager decision | waiting on customer | closed | system issue>
Evidence: <why the purchase is or is not identified>
Action taken: <prepared candidate, targeted request, follow-up, or issue>
Manager action: <approve/decline card | send Zelle then confirm | none>
Engineering issue: <issue number or none>
```

End an unattended run with one compact summary: cases reviewed, cases ready for
a Manager, customer requests/follow-ups sent, 30-day closures, System issues,
and whether any genuine owner decision is required. Use public references only;
do not copy customer or payment details into the summary.

## Non-negotiable boundaries

- One Manager decision; no second approval or routine TOTP ceremony.
- No exact customer-amount or high-confidence requirement.
- No manual Nayax card completion, browser continuation, blind retry, or separate attempt.
- Nayax research is read-only and may never issue or record a refund.
- No repeated customer-question loop.
- No intermediate cash-payout status.
- Never repeat an unknown payment, guess between genuinely plausible
  transactions, expose private payment data, or bypass exact-transaction and
  duplicate protections.
