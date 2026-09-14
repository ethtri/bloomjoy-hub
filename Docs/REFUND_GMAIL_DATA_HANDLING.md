# Refund Gmail data handling

This is the durable privacy and transport boundary for the directly connected
customer-service mailbox, `info@bloomjoysweets.com`. It is subordinate to
[REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) and does not authorize a message or add
a product gate.

## Data boundary

- Read only the explicitly configured refund label and the existing thread needed
  for the linked case.
- OAuth permissions remain limited to Gmail read-only and send.
- Store only sanitized text needed for the case. Replace a detected full card
  number with approved redacted last-four data before persistence.
- Keep provider thread/message identifiers, raw recipient addresses, and delivery
  metadata service-only except on the authorized message-review surface.
- Never place message content, addresses, payment data, tokens, or provider IDs in
  logs, GitHub artifacts, issues, or pull requests.
- Do not copy attachment metadata or bytes. Attachment support requires a separate
  privacy/security design and is not part of the refund workflow.
- Purge the sanitized Gmail copy and service-only recipient data after the
  approved 180-day period while preserving the separately governed canonical case
  and redacted audit history.

## Participant and thread boundary

- Gmail-linked customer communication originates from the designated support
  mailbox and remains in the original provider thread.
- Treat an alias as Bloomjoy-origin only when the connected mailbox and Gmail
  `SENT` evidence agree.
- A verified customer reply may update the allowlisted case facts. Manager,
  forwarded, automated, unknown, or spoof-suspected messages cannot masquerade as
  customer facts.
- A customer is the sole **To** recipient; current assigned Managers use the
  established visible-CC route.
- A hard bounce pauses additional automatic contact for that address until an
  authorized Manager verifies the correction. Unknown delivery is reconciled and
  never blindly resent.

## Incident response

For suspected credential compromise, disable Gmail sync and sending, revoke the
Google refresh token, and preserve case/linkage audit records. Do not delete
tables or message history as an incident shortcut.

For a privacy deletion request or legal hold, identify the exact case in the
authorized production system and use the reviewed service procedure. Never copy
the identifying data into GitHub.
