# Refund customer messages

The product workflow is [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md). This file
defines message content and delivery boundaries only; it cannot add a customer
question, Manager approval, or payment state.

## Voice

Write person to person with one clear purpose. Tell the customer what Bloomjoy
knows, what Bloomjoy is doing, and the one action—if any—the customer can take.
Do not expose internal scores, provider codes, engineering problems, or agent
checklists.

## Required behavior

- Acknowledge a new request promptly.
- Search internal and provider records before asking for clarification.
- Ask one targeted question only when one fact is truly needed.
- Send one follow-up only when there is no reply.
- Keep every reply and correction on the same case and conversation.
- Close after 30 days without a useful response.
- Send completion only after the payment fact is confirmed.
- Let a customer reply request another human review without automatically
  reopening or paying the case.

## Payment wording

For card, use the full charged provider total by default and say the refund was
approved only after Nayax confirms it. Keep bank-arrival wording qualified.

For cash, say the refund was sent through Zelle only after the Manager selects
**Confirm refund sent via Zelle**. Do not create or describe an approved-but-
unpaid state.

## Delivery

Use **Bloomjoy Refunds <refunds@bloomjoysweets.com>**, keep the customer as the sole
**To** recipient, and use the current established Manager-CC route. Preserve the
original Gmail thread where one exists. An unknown delivery result is reconciled,
not resent blindly.

Reply-To: refunds@bloomjoysweets.com

See [REFUND_EMAIL_ASSISTANT_RUNBOOK.md](REFUND_EMAIL_ASSISTANT_RUNBOOK.md) for
the current transport reference.
