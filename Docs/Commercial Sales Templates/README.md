# Bloomjoy Commercial Sales Templates

This package is structured for repeat use with Commercial Machine sales.

1. Start with **Commercial Machine Sale Agreement** for every sale. Its first section is the deal-specific order form; the remaining terms and exhibits are reusable.
2. Complete **Delivery and Commissioning Certificate** for each delivered machine. It documents condition, commissioning, open items, and the date that triggers the delivery balance.
3. Use **Permitted Operations and Commissary Agreement** only when Bloomjoy will provide a site-specific permit/compliance and commissary program for a percentage of sales. Sign one master program agreement and one Site Activation Schedule for each approved location.

The sale template intentionally treats Bloomjoy Plus as an optional online subscription rather than a machine license fee. The permitted-operations template intentionally does not transfer or “rent” a health permit; activation depends on the local agency, commissary, venue, insurance, and site documents identified in the schedule.

The Word templates and interactive PDFs prefill Bloomjoy's legal name, notice address, and legal email. Lightly outlined areas in the PDFs are fillable; square controls are clickable checkboxes. The coordinated layouts use consistent typography, generous answer fields, and compact checklist columns for repeat use.

Before sending a document for signature:

- Complete every applicable field and delete unused options.
- Attach the final quote, confirmed equipment specifications, wrap proof, and freight scope.
- The sale template states that the remaining 50% is due within 5 calendar days after Confirmed Delivery, inspection problems must be reported within 7 business days, and the limited warranty lasts one year from the Agreement date. Verify the date and included services for the order; the warranty begins before delivery if signing occurs earlier.
- Select the deposit refund policy before sending the sale agreement for signature.
- Bloomjoy completes Exhibit A from the order and manufacturer information. Buyers should not have to supply technical specifications. Hover over a PDF text field for its completion instructions.
- For the 6% program, confirm the legal permit holder, merchant of record, settlement flow, tax responsibility, insurance, and written local-agency/commissary approvals for the exact site and operator.
- Obtain California counsel review before first use and local counsel review for a site outside California.

Regenerate the Word files after editing the source script with:

`python scripts/generate-commercial-sale-docs.py`

After rendering the Word files to PDF under `tmp/pdfs/base`, regenerate the interactive PDFs with:

`python scripts/generate-commercial-sale-pdfs.py`
