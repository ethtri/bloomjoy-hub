/** Synthetic only. No network, database or provider calls. */
import { fixtureVariants } from "../supabase/functions/_shared/machine-email-alert-fixtures.ts";
import { buildMachineEmail } from "../supabase/functions/_shared/machine-email-alert.ts";
import { machineEmailLinks } from "../supabase/functions/_shared/machine-email-alert-delivery.ts";
const p = fixtureVariants()["new-refund"];
p.machines[0].machineLabel = "Riverside Cotton Candy";
p.machines[0].timezone = "America/Los_Angeles";
Object.assign(p.machines[0].refundCases[0], {
  receivedAt: "2026-10-11T16:42:00Z",
  incidentAt: "2026-10-11T16:30:00Z",
  commentKind: "sanitized-narrative",
  commentExcerpt:
    "The machine charged me, but the candy never came out. The arm stopped halfway through.",
});
const variants = {
  standard: p,
  long: structuredClone(p),
  missing: structuredClone(p),
};
variants.long.machines[0].machineLabel =
  "Riverside Shopping Center, Cotton Candy Machine beside the North Entrance";
variants.long.machines[0].refundCases[0].commentExcerpt =
  "La m\u00e1quina cobr\u00f3 pero no entreg\u00f3 el algod\u00f3n. ".repeat(6);
Object.assign(variants.missing.machines[0].refundCases[0], {
  receivedAt: null,
  incidentAt: null,
  issueCategory: null,
  commentExcerpt: null,
  requestedAmountCents: null,
});
const directory = "output/playwright/new-refund-email";
await Deno.mkdir(directory, { recursive: true });
for (const [variant, projection] of Object.entries(variants)) {
  const email = buildMachineEmail({
    projection,
    links: machineEmailLinks("https://app.example.test"),
  });
  await Deno.writeTextFile(`${directory}/${variant}.html`, email.html);
  await Deno.writeTextFile(`${directory}/${variant}.txt`, email.text);
}
console.log(
  JSON.stringify({
    synthetic: true,
    emailsSent: 0,
    variants: Object.keys(variants),
  }),
);
