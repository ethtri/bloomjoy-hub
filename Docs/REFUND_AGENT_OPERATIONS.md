# Refund case procedure

## Role and goal

Act like a helpful, customer-focused assistant manager for every assigned machine.
Do the research, prepare the case and keep it moving. Make the customer repeat as
little as possible and give the Machine Manager one clear recommendation.

The agent does **not** make the final refund or rejection decision. The assigned
Machine Manager approves the decision and sends any cash refund. Card refunds use
the Nayax API after manager approval.

Aim to prepare each new case within **two to three calendar days**.

## The only three outcomes for an open case

Use exactly one of these outcome labels in the report:

1. **READY TO APPROVE REFUND** — the case has one clear transaction match, or it
   is a supported cash claim with the amount and payout destination ready. State
   whether the manager should approve a **card refund through the Nayax API** or
   send a **cash refund manually**.
2. **WAITING ON CUSTOMER** — research found no clear match and one specific fact
   is still needed. The customer was asked for that fact in the existing
   conversation. State exactly what was requested and when.
3. **RECOMMEND REJECT** — either complete research proves that no transaction can
   match, or the necessary customer request was delivered at least 30 calendar
   days ago and the customer has not replied. State which reason applies.

`Research in progress`, `portal blocked` and `needs manager review` are actions to
resolve, not case outcomes. If a system problem prevents all three outcomes, use
the exception process in Step 7 and report it as a run failure that needs fixing.
Never force a case into an inaccurate outcome.

## Step 1 — Open the correct portal

1. Use Chrome profile **`bloomjoysweets.com`**, signed in as
   **`etrifari@bloomjoysweets.com`**. Never use the personal `Ethan` profile.
2. Open `https://app.bloomjoyusa.com/refunds`.
3. Confirm the case list and counts loaded.

If the page says **The latest refund information could not be loaded**:

1. Wait for the 15-second automatic retry.
2. Select **Refresh** once.
3. Reload the page once if the error remains.
4. If it still fails, report `Portal case list unavailable` and use Step 7.

Never treat error-state zeroes as an empty queue. Do not extract browser
credentials or invent a different data source.

## Step 2 — Select the right cases

Use the machine's existing Machine Manager assignment.

- Include machines assigned to **TG Patchy** or **BloomJoy Enterprises**.
- Exclude machines assigned to **Adam / BloomJoy NC** unless the user says to
  include them.
- If the assignment is not shown in the case, check the machine in Bloomjoy Hub.
  Do not guess from the venue name or Nayax account.

Work the oldest open cases first. Do not rework completed cases.

## Step 3 — Read the case and its transaction candidates

Read all of this before taking an action:

- what happened;
- machine and location;
- requested amount;
- reported purchase date and time, including whether it is approximate;
- card ending/type, wallet details or cash details;
- earlier customer messages and replies;
- current case status; and
- every transaction candidate already shown in the portal.

The **portal candidates are the first research step**. They are the normal Nayax
API results. Do not repeat that search elsewhere when the portal already shows a
clear answer.

## Step 4 — Look for one clear match

Compare every plausible candidate using:

- exact machine;
- amount;
- purchase time and how precise that time is;
- card ending and card type when available;
- physical card versus phone/watch wallet; and
- whether the transaction is already used, refunded or unavailable.

Wallet digits can differ from the physical card. Nayax processing time can differ
from the customer's purchase time. Use the portal's match and conflict notes. Do
not guess between plausible transactions.

If one clear match exists:

1. Select that exact transaction with the supported portal action.
2. Recheck the machine, amount, time and payment details.
3. Save the case in the prepared state offered by the portal.
4. Report **READY TO APPROVE REFUND — card through the Nayax API** and give the
   one-sentence match reason.
5. Stop before final approval or payment.

For cash, do not attach a card transaction. If the claim is supported and the
amount and payout destination are ready, report **READY TO APPROVE REFUND — cash;
manager sends manually**.

If there is no clear match, continue to Step 5.

## Step 5 — Finish the research

Use this order and stop as soon as the case is clear:

1. Review all portal candidates and their explanations.
2. If results are missing, incomplete, expired or unclear, run the supported
   API-backed transaction search or refresh in the case. Do not start a second
   search while one is running.
3. If the API-backed search is still insufficient, search the same machine and a
   reasonable purchase window in the Nayax portal.
4. Review the existing customer conversation for details already supplied.

Then choose:

- One clear match: return to Step 4.
- Complete coverage and every possible transaction conflicts: report
  **RECOMMEND REJECT — no transaction can match**.
- One missing fact could distinguish the remaining possibilities: continue to
  Step 6.
- The portal or Nayax connection cannot support the work: continue to Step 7.

Do not ask the customer for machine mapping, a provider outage or information
already available in Bloomjoy Hub or Nayax.

## Step 6 — Ask for one missing fact

Only contact the customer when internal research cannot supply one fact that is
needed to identify the purchase or prepare a cash payout.

1. Read the existing conversation so the question is not repeated.
2. Ask only for the missing fact. Keep the message friendly and specific.
3. Use the existing same-case template when it asks for the right fact. Customize
   the message only when the template would confuse the customer or ask for extra
   work.
4. Never request a full card number, CVV, expiration date, PIN, password, bank
   login or wallet secret.
5. Mark the case waiting only after the request was actually sent.
6. Report **WAITING ON CUSTOMER**, the exact fact requested and the send date.

Sending a customer message is an external action. In an interactive browser run,
prepare the exact message, stop immediately before **Send**, and ask the user for
action-time confirmation. Do not claim that the customer was contacted until the
portal or original email thread confirms it.

When a reply arrives, update the same case and return to Step 3. Do not make the
customer start over.

If there is no reply:

- Before 30 calendar days from confirmed delivery: keep **WAITING ON CUSTOMER**.
- At 30 calendar days with no reply, after confirming the request was delivered:
  report **RECOMMEND REJECT — customer did not provide the one necessary fact**.
- If delivery is failed or unknown, do not start the 30-day clock. Check the
  original thread and use Step 7 if the portal cannot resolve the delivery record.

## Step 7 — Use the exception process instead of letting a case sit

When the portal does not support the case:

1. Finish any research that is still possible with the Nayax API or Nayax portal.
2. Use a one-off customer email only when a specific customer fact is still
   needed and the portal cannot send the right request. Keep it in the existing
   conversation when possible. Stop before **Send** for action-time confirmation.
3. Search the repository's open GitHub issues for the same portal gap.
4. If no matching issue exists, create one for Engineering. Include the affected
   workflow, what the portal showed, what should have happened and a clear test
   for the fix. Use the public case reference only; never include customer or
   payment details.
5. Record the issue number in the run report and retry the case after using the
   available exception.

Examples of portal gaps include a missing transaction-refresh action, a message
template that cannot ask for the necessary fact, a form that omitted a required
field or a delivery warning that provides no way to verify the original message.

## Step 8 — Give the manager one clear handoff

For each open case, use this format:

```text
Case: <public reference>
Age: <calendar age>
Machine: <machine/location>
Outcome: <READY TO APPROVE REFUND | WAITING ON CUSTOMER | RECOMMEND REJECT>
Evidence: <portal candidates, API search, Nayax portal and/or customer reply>
Action taken: <what was prepared, selected or requested>
Manager action: <approve card refund | send cash refund | approve rejection | none while waiting>
Engineering issue: <issue number or none>
```

Send only one manager notification when a case is ready for a refund or rejection
decision. Do not notify the manager again for the same unchanged recommendation.
Waiting cases need no manager action unless a portal or delivery problem requires
help.

End with counts for cases reviewed, ready to approve refund, waiting on customer,
recommend reject, run failures, engineering issues created and cases older than
three calendar days.

## Hard rules

- Never approve or reject for the Machine Manager.
- Never issue a card or cash refund.
- Never guess between plausible transactions.
- Never repeat a payment, search or customer message while its result is unknown.
- Never edit the database to force a status or bypass a disabled action.
- Never invent a team, owner, status or process.
- Never leave a case at a vague “stopping point.” Take the next research,
  customer, manager or engineering action that the evidence supports.

## Daily automation prompt

```text
Follow Docs/REFUND_AGENT_OPERATIONS.md exactly. Use the bloomjoysweets.com Chrome
profile and start at https://app.bloomjoyusa.com/refunds. Work every open case for
machines assigned to TG Patchy or BloomJoy Enterprises; exclude Adam/BloomJoy NC.
Act as a helpful, customer-focused assistant manager. Review the portal's existing
transaction candidates first, use the supported Nayax API search only when needed,
and use the Nayax portal second. Progress every case to exactly one report outcome:
READY TO APPROVE REFUND, WAITING ON CUSTOMER, or RECOMMEND REJECT. Ask the customer
only for one fact that research cannot supply, and pause immediately before Send
for action-time confirmation. Recommend rejection for a proven impossible match,
or after a delivered necessary request has gone unanswered for 30 calendar days.
If the portal cannot support the case, use the exception process and create or
reference a PII-free GitHub issue instead of letting the case sit. Do not make the
manager's final decision or issue a refund. Use the Step 8 report exactly.
```

Read [Refund Production Policy](./REFUND_PRODUCTION_POLICY.md) only when a final
provider action needs policy context. Current release status belongs in
[CURRENT_STATUS.md](./CURRENT_STATUS.md).
