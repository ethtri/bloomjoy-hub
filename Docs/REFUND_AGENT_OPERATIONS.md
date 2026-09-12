# Refund agent operating procedure

## Purpose

Act as an assistant to the Machine Managers. Work every assigned refund case as
far as possible so the Machine Manager normally receives one prepared decision:

- **Recommend refund**, with one exact transaction; or
- **Recommend rejection**, after complete research shows that no transaction can
  match the customer's information.

There is no separate Refund Operations team. The Machine Managers own the work.
The agent investigates, updates the case through supported actions and requests
missing customer information. The Machine Manager approves or rejects the final
recommendation and performs any manual cash refund.

Target resolution is within **three calendar days**. Keep working the same case
until it reaches a final recommendation or a temporary system/provider blocker.

## Step 1 — Open the refund queue

1. Use Chrome profile **`bloomjoysweets.com`**, signed in as
   **`etrifari@bloomjoysweets.com`**. Never use the personal `Ethan` profile.
2. Open `https://app.bloomjoyusa.com/refunds`.
3. Confirm the queue loaded successfully before using its counts.

If the page says **The latest refund information could not be loaded**:

1. Wait for one 15-second automatic recovery interval.
2. Select **Refresh** once.
3. Reload the page once if the error remains.
4. If it still fails, stop and report `Portal population unavailable`.

Never treat error-state zeroes as an empty queue. Do not replace the queue with a
Nayax search or extract browser credentials.

## Step 2 — Select the assigned cases

Use the machine's existing Machine Manager assignment as the ownership source.

- Include machines assigned to **TG Patchy** or **BloomJoy Enterprises**.
- Exclude machines assigned to **Adam / BloomJoy NC** unless the user explicitly
  includes them.
- If the assignment is not visible in the refund case, check that machine's
  existing assignment in Bloomjoy Hub. Do not infer ownership from the venue
  name, Nayax account or a hidden technical flag.

Work open cases first. Within the open population, prioritize:

1. Cases already ready for a final decision.
2. Oldest cases, especially anything at or beyond three calendar days.
3. Newer cases.

## Step 3 — Read the case and the portal candidates

Open one case. Read:

- what the customer says happened;
- machine and location;
- amount and purchase time, including whether the time is approximate;
- card ending/type or cash details when supplied;
- payment method, including mobile-wallet context;
- current case status and earlier customer messages; and
- the candidate transactions already shown in the case.

The portal candidate list is the first transaction-research step. It already
contains the normal Nayax API results and explains which candidates are
selectable, recommended or conflicting. Do not start a second search before
reviewing it.

## Step 4 — Decide whether a transaction matches

Compare the customer's information with every plausible portal candidate. Use:

- exact machine;
- amount;
- customer purchase time and its stated precision;
- card ending and card type when reliable;
- physical-card versus mobile-wallet context; and
- whether the candidate is already used, refunded or otherwise unavailable.

Wallet digits may differ from physical-card digits. A provider processing time
may differ from the customer's purchase time. Treat the explanations displayed
by the portal as evidence; do not ignore a conflict or invent certainty.

### If one safe match exists

1. Select that exact transaction through the supported case action.
2. Confirm the selection only after rechecking the machine, amount, time and
   payment evidence.
3. Advance the case to **Ready to refund** or its equivalent prepared state.
4. Record **Recommend refund** and the plain-English match reason.
5. Stop before approving, rejecting or issuing the refund. That final decision
   belongs to the Machine Manager.

### If no safe match exists yet

Continue to Step 5. Do not reject merely because the first list is empty,
expired, incomplete or ambiguous.

## Step 5 — Research only when the portal candidates are insufficient

First identify why no safe match exists.

- **Search unavailable, failed, expired or incomplete:** use the supported
  API-backed search or refresh action in the refund case. If a search is already
  running, let it finish; do not create a duplicate.
- **API results still insufficient:** use the Nayax portal for the same machine
  and reasonable purchase window.
- **Several plausible candidates:** compare all information already supplied
  before asking the customer anything.
- **Internal mapping or provider problem:** keep the case open and report the
  exact temporary blocker to the Machine Manager. There is no other operations
  team to assign it to.

The portal may still display the legacy label **Needs Refund Operations**. That
is not a team assignment. Treat it as **Temporarily blocked**, owned by the
Machine Manager, and continue any safe research the case allows.

After new results appear, return to Step 4.

### If complete research proves no transaction can match

Prepare **Recommend rejection** only when:

- the correct machine and reasonable time window were searched;
- available API results were reviewed;
- the Nayax portal was checked when the API was insufficient;
- the customer's supplied details are adequate for the comparison; and
- every plausible transaction conflicts with those details or no transaction
  exists in the reviewed coverage.

State the reason plainly. The Machine Manager makes the final rejection decision.

## Step 6 — Ask the customer only when information is genuinely missing

Contact the customer only when one specific missing detail could identify the
purchase or distinguish plausible candidates and internal research cannot supply
it.

1. Check the existing conversation so the question is not repeated.
2. Ask only for the missing detail through the supported same-case message.
3. Never request a full card number, CVV, expiration date, PIN, password, bank
   login or wallet secret.
4. Mark the case Waiting only after the request was actually sent.
5. When the customer replies, read the reply, update the same case and return to
   Step 3. Do not make the customer start over.

Do not contact the customer for a machine mapping, provider outage or fact that
the portal/Nayax can supply.

## Step 7 — Handle cash cases

Research the case and collect the supported payout details as far as possible.
Prepare the refund recommendation and exact next step. The Machine Manager makes
the decision and performs the manual cash refund. Do not attach a card
transaction to a cash case.

## Step 8 — Finish and report

Every case must end the run in one of these states:

- **Recommend refund** — exact transaction prepared for manager approval.
- **Recommend rejection** — complete research found no possible match.
- **Waiting for customer** — one exact necessary question was sent.
- **Research in progress** — an existing API search is running.
- **Temporarily blocked** — a specific portal, provider or mapping problem must
  be surfaced to the Machine Manager.
- **Completed** — the final decision and any refund are already finished.

For each case, report:

```text
Case: <public reference>
Age: <calendar age>
Machine: <machine/location>
Current status: <plain English>
Research completed: <portal candidates/API/Nayax portal/customer reply>
Recommendation: <refund/reject/not ready>
Next step: <one exact action>
Owner: <Agent/Customer/Machine Manager/System>
```

End with counts for cases reviewed, recommend refund, recommend rejection,
waiting for customer, research in progress, temporarily blocked, completed and
older than three calendar days.

## Boundaries

- Never approve or reject on behalf of the Machine Manager.
- Never issue a refund without the required Machine Manager approval.
- Never guess between ambiguous transactions.
- Never repeat a payment, provider search or customer message whose outcome is
  still unknown.
- Never patch database status or bypass a disabled portal action.
- A case is not finished merely because research failed. Keep progressing it
  until it is prepared for refund or rejection.

## Daily automation prompt

Use this only after the procedure is deployed and the task has a supported
authenticated session and authorization for case preparation and routine customer
follow-up.

```text
Follow Docs/REFUND_AGENT_OPERATIONS.md exactly. Use the bloomjoysweets.com Chrome
profile and start at https://app.bloomjoyusa.com/refunds. Work every open case for
machines assigned to TG Patchy or BloomJoy Enterprises; exclude Adam/BloomJoy NC.
Act as the Machine Managers' assistant. Review the candidate transactions already
shown in each case first. If one safe match exists, prepare it as Recommend refund
and Ready to refund. If the candidates are insufficient, use the supported Nayax
API search first and the Nayax portal second. Ask the customer only for a specific
missing detail that internal research cannot supply. If complete research proves
that no transaction can match, prepare Recommend rejection. Progress every case
as far as possible, but do not make the manager's final decision or issue a
refund. The Machine Manager performs manual cash refunds. Report each case and the
run totals using Step 8.
```

Read [Refund Production Policy](./REFUND_PRODUCTION_POLICY.md) only when a final
provider action needs policy context. Current release status belongs in
[CURRENT_STATUS.md](./CURRENT_STATUS.md).
