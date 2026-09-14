# Refund Gmail first-contact configuration

This technical note prevents two responders from acknowledging the same inbound
message. It is subordinate to [REFUND_WORKFLOW.md](REFUND_WORKFLOW.md) and does
not add a pilot, owner ceremony, or approval gate.

## Rule

Exactly one responder owns a configured Gmail message population. Before changing
that owner:

1. Disable and verify the old responder for the exact label/population.
2. Record the transition boundary and reconcile messages received during it.
3. Enable the new responder for that same population.
4. Verify one acknowledgement for one synthetic inbound message and no duplicate
   case or send.

Rollback uses the reverse order: disable and verify the new responder before
restoring the old one. The two responders must never overlap.

For local synthetic testing, keep `REFUND_GMAIL_FIRST_CONTACT_MODE=disabled` by
default. Use a dedicated non-production label, a distinct production label ID,
and an owner-controlled synthetic sender allowlist. The preflight rejects label
overlap and a missing allowlist.

This transport rule does not change the product's one clarification request, one
non-response follow-up, or 30-day closure policy.
