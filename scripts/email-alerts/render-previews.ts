import { buildMachineEmail } from "../../supabase/functions/_shared/machine-email-alert.ts";
import {
  decorateReadySubscription,
  machineEmailLinks,
} from "../../supabase/functions/_shared/machine-email-alert-delivery.ts";
import {
  fixtureReadyNotice,
  fixtureVariants,
} from "../../supabase/functions/_shared/machine-email-alert-fixtures.ts";
import {
  buildRefundManagerReadyEmail,
  parseRefundManagerReadyNotice,
} from "../../supabase/functions/_shared/refund-manager-ready-email.ts";

// Run from the repository root. Output is ignored by Git; this runner never sends email.
const output = "output/email-alert-previews";
await Deno.mkdir(output, { recursive: true });
const links = machineEmailLinks();
const messages = Object.fromEntries(
  Object.entries(fixtureVariants()).map((
    [name, projection],
  ) => [name, buildMachineEmail({ projection, links })]),
);
messages["decision-ready"] = {
  ...decorateReadySubscription(
    buildRefundManagerReadyEmail({
      notice: parseRefundManagerReadyNotice(fixtureReadyNotice),
      caseUrl: links.caseUrl(fixtureReadyNotice.caseId),
    }),
    links.preferencesUrl,
  ),
  itemCount: 1,
};
for (const [name, message] of Object.entries(messages)) {
  await Deno.writeTextFile(`${output}/${name}.html`, message.html);
  await Deno.writeTextFile(`${output}/${name}.txt`, message.text);
  console.log(
    `${name}: ${new TextEncoder().encode(message.html).length} HTML bytes; ${
      message.itemCount ?? 1
    } cases`,
  );
}
