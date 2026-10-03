# Daily and weekly digest design

Issue: [#1726](https://github.com/ethtri/bloomjoy-hub/issues/1726).

## Reader and purpose

Managers and technicians need to see how their selected machines performed and
where customers reported problems. The email should answer those questions within
a quick scan, with Hub providing the underlying detail.

## Content order

1. Small Bloomjoy identity, daily or weekly title, and one human-readable period.
2. Two headline metrics: sales and refunds requested, with new-request count.
3. Actual company groups, each with a subtotal and a compact table:
   **Machine | Sales | New refunds** (requested dollars and count).
4. Weekly only: up to two useful factual insights, including prior-week sales
   movement across the same comparable machines. No speculative fault diagnosis.
5. One report action, concise reporting-basis note and personal preference link.

No greeting essay, transaction/net/adjustment metric stack, old-case backlog,
per-request paragraphs, repeated date explanations or workflow instructions.
Customer symptoms and comments remain in Hub and optional immediate request mail.

## Data rules

- Use the selected, currently authorized machine set for every rollup.
- Group by canonical customer account, never provider credentials or name guesses.
- Sales are canonical tax-exclusive sales before refund deductions.
- Refunds mean deduplicated requests received during the machine-local period and
  customer-requested amounts supported by intake evidence. Later resolution does
  not remove them. Approval/payment/gift/accounting values are different measures.
- Label missing and partial amounts honestly. Technicians and managers can read
  requested amounts for their authorized machines (#1729); sales access remains
  separate from refund read access and manager approval/payment authority.
- Compare weekly sales only for machines with usable data in both periods; name
  partial comparison coverage. A zero baseline yields dollar change, not infinity.
- Preserve scheduled delivery identities, unknown-send holds, defaults and opt-outs.

## Visual direction and acceptance

Use Bloomjoy's existing mark, warm blush background, white content, charcoal type,
restrained coral accents, aligned numeric columns and fine dividers. Use compatible
email tables with semantic data headers, inline styles and system-font fallbacks.

Review actual production-renderer fixtures at desktop, 390 px and 320 px. Check
long names, multiple companies, large fleets, unknown values, technicians without
sales access, images blocked and dark-mode preference. Verify plain text and links, run
focused projection/renderer tests and full migration replay, then release through
a reviewed PR. Synthetic previewing must not send mail or reserve real deliveries.
