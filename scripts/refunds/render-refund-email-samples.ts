import { buildRefundCustomerEmail } from "../../supabase/functions/_shared/refund-email.ts";
import { buildRefundFirstContactEmail } from "../../supabase/functions/_shared/refund-first-contact.ts";
import { buildNayaxCustomerCorrectionEmail } from "../../supabase/functions/_shared/refund-nayax-customer-correction.ts";
import { buildRefundManagerActionEmail } from "../../supabase/functions/_shared/refund-manager-email.ts";

const outputDirectory = "output/playwright/refund-email-samples";
await Deno.mkdir(outputDirectory, { recursive: true });

const samples = {
  "first-contact": buildRefundFirstContactEmail({
    publicReference: "RF-PILOT01",
    customerName: "Jamie",
    refundRequestUrl:
      "https://www.bloomjoyusa.com/refunds/request?emailContext=preview-only",
    supportUrl: "https://www.bloomjoyusa.com/resources#support-boundaries",
  }),
  denial: buildRefundCustomerEmail({
    messageType: "denied",
    publicReference: "RF-PILOT02",
    customerName: "Jamie",
    customerEmail: "customer@example.test",
    machineLabel: "Snapcase 03",
    locationName: "Great Mall",
    refundAmountCents: 700,
    decisionReason:
      "We could not confirm a matching purchase at the machine and time provided",
  }),
  "appeal-received": buildRefundCustomerEmail({
    messageType: "appeal_received",
    publicReference: "RF-PILOT02",
    customerName: "Jamie",
    customerEmail: "customer@example.test",
    machineLabel: "Snapcase 03",
    locationName: "Great Mall",
  }),
  completed: buildRefundCustomerEmail({
    messageType: "completed",
    publicReference: "RF-PILOT03",
    customerName: "Jamie",
    customerEmail: "customer@example.test",
    machineLabel: "Snapcase 03",
    locationName: "Great Mall",
    paymentMethod: "card",
    refundAmountCents: 700,
    cardLast4: "4242",
  }),
  "targeted-card-correction": buildNayaxCustomerCorrectionEmail({
    messageType: "no_safe_match",
    followUpReason: "no_safe_match",
    publicReference: "RF-PREVIEW4",
    customerName: "Jamie",
    customerEmail: "customer@example.test",
    machineLabel: "Cotton Candy",
    locationName: "Example venue",
    paymentMethod: "card",
    refundAmountCents: 1090,
    missingFields: ["card_last4"],
  }),
  "manager-action-ready": buildRefundManagerActionEmail({
    context: {
      schemaVersion: "refund_manager_action_email_v1",
      publicReference: "RF-MANAGER1",
      amountCents: 700,
      currencyCode: "USD",
      machineLabel: "Snapcase 03",
      locationName: "Great Mall",
      ageMinutes: 185,
      paymentMethodCategory: "card",
      queueLabel: "Ready to refund",
      actionCode: "refund",
      actionOwner: "Machine Manager",
      lifecycleActor: "system",
      whatChanged:
        "The server recorded one high-confidence transaction match after corrected wallet details.",
      payloadRedacted: true,
    },
    noticeReason: "wallet_match_ready",
    caseUrl: "https://app.bloomjoyusa.com/refunds?case=synthetic-manager-case",
    queueUrl: "https://app.bloomjoyusa.com/refunds",
    routingNote:
      "This action notice was routed only to the currently assigned Machine Managers.",
  }),
  "manager-provider-exception": buildRefundManagerActionEmail({
    context: {
      schemaVersion: "refund_manager_action_email_v1",
      publicReference: "RF-MANAGER2",
      amountCents: null,
      currencyCode: null,
      machineLabel: "Machine not recorded",
      locationName: "Location not recorded",
      ageMinutes: 2_880,
      paymentMethodCategory: "not_recorded",
      queueLabel: "Needs manager review",
      actionCode: "refund_operations",
      actionOwner: "Machine Manager",
      lifecycleActor: "system",
      whatChanged:
        "The server recorded an inconclusive payment-provider result.",
      payloadRedacted: true,
    },
    noticeReason: "provider_unknown",
    caseUrl: "https://app.bloomjoyusa.com/refunds?case=synthetic-provider-case",
    queueUrl: "https://app.bloomjoyusa.com/refunds",
    routingNote:
      "This action notice was routed to the assigned Machine Manager.",
  }),
};

for (const [name, sample] of Object.entries(samples)) {
  await Deno.writeTextFile(`${outputDirectory}/${name}.html`, sample.html);
  await Deno.writeTextFile(`${outputDirectory}/${name}.txt`, sample.text);
}

console.log(`Rendered ${Object.keys(samples).length} refund email samples.`);
