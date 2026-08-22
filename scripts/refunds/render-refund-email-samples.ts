import { buildRefundCustomerEmail } from "../../supabase/functions/_shared/refund-email.ts";
import { buildRefundFirstContactEmail } from "../../supabase/functions/_shared/refund-first-contact.ts";

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
};

for (const [name, sample] of Object.entries(samples)) {
  await Deno.writeTextFile(`${outputDirectory}/${name}.html`, sample.html);
  await Deno.writeTextFile(`${outputDirectory}/${name}.txt`, sample.text);
}

console.log(`Rendered ${Object.keys(samples).length} refund email samples.`);
