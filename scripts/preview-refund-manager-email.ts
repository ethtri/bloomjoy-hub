import {
  buildRefundManagerActionEmail,
  type RefundManagerActionEmailContext,
} from "../supabase/functions/_shared/refund-manager-email.ts";
const context: RefundManagerActionEmailContext = {
  schemaVersion: "refund_manager_action_email_v1",
  publicReference: "RF-SAMPLE-1280",
  amountCents: 1090,
  currencyCode: "USD",
  machineLabel: "Riverside · Cotton Candy",
  locationName: "Retired location",
  ageMinutes: 65,
  paymentMethodCategory: "card",
  queueLabel: "Action needed",
  actionCode: "refund_operations",
  actionOwner: "Machine Manager",
  lifecycleActor: "system",
  whatChanged: "Internal change",
  payloadRedacted: true,
  requestedAmountCents: 1000,
  requestedCurrencyCode: "USD",
  issueLabel: "No product received",
  customerCommentExcerpt:
    "The machine charged me, but the candy never came out. The arm stopped halfway through.",
};
const variants = {
  setup: { context, noticeReason: "provider_setup" as const },
  ready: {
    context: { ...context, actionCode: "refund" },
    noticeReason: "wallet_match_ready" as const,
  },
  unknown: {
    context: { ...context, paymentOutcomeUnknown: true },
    noticeReason: "provider_unknown" as const,
  },
  operations: {
    context,
    noticeReason: "provider_setup" as const,
    audience: "operations" as const,
  },
  legacy: {
    context: Object.fromEntries(
      Object.entries(context).filter(([key]) =>
        ![
          "requestedAmountCents",
          "requestedCurrencyCode",
          "issueLabel",
          "customerCommentExcerpt",
        ].includes(key)
      ),
    ) as RefundManagerActionEmailContext,
    noticeReason: "manager_reminder" as const,
  },
  long: {
    context: {
      ...context,
      machineLabel:
        "A very long machine name in the north concourse outside the central shopping area",
      customerCommentExcerpt:
        "La máquina cobró pero no entregó el algodón. ".repeat(8).slice(
          0,
          319,
        ) + "…",
    },
    noticeReason: "wallet_match_ready" as const,
  },
};
const output = "output/playwright/refund-manager-email";
await Deno.mkdir(output, { recursive: true });
for (const [name, value] of Object.entries(variants)) {
  const email = buildRefundManagerActionEmail({
    ...value,
    caseUrl: "https://app.example.test/refunds?case=synthetic",
    queueUrl: "https://app.example.test/refunds",
    routingNote: "Synthetic routing note",
  });
  await Deno.writeTextFile(`${output}/${name}.html`, email.html);
  await Deno.writeTextFile(`${output}/${name}.txt`, email.text);
}
console.log(
  JSON.stringify({
    synthetic: true,
    emailsSent: 0,
    variants: Object.keys(variants),
  }),
);
