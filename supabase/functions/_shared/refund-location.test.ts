import { buildRefundCustomerEmail } from "./refund-email.ts";
import { resolveRefundPublicLabels } from "./refund-location.ts";

const assertEquals = (actual: unknown, expected: unknown, message: string) => {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
};

Deno.test("placeholder locations require customer-safe output", () => {
  const configured = resolveRefundPublicLabels({
    locationName: "Unmapped Sunze Machines",
    publicMachineLabel: "Bubble Planet - Atlanta",
    machineLabel: "Provider machine 123",
  });
  assertEquals(configured.machineLabel, "Bubble Planet - Atlanta", "public machine label");
  assertEquals(configured.locationName, "Bubble Planet - Atlanta", "public location label");

  const unconfigured = resolveRefundPublicLabels({
    locationName: "Unknown location",
    machineLabel: "Provider machine 123",
  });
  assertEquals(unconfigured.locationName, "Bloomjoy location", "safe fallback location");
});

Deno.test("refund emails never expose placeholder location names", () => {
  const email = buildRefundCustomerEmail({
    messageType: "confirmation",
    publicReference: "REF-TEST",
    customerEmail: "customer@example.com",
    machineLabel: "Bubble Planet - Seattle",
    locationName: "Unmapped Sunze Machines",
  });

  if (email.text.includes("Unmapped") || email.html.includes("Unmapped")) {
    throw new Error("Customer email exposed an internal placeholder location");
  }
  if (!email.text.includes("Location: Bloomjoy location")) {
    throw new Error("Customer email did not use the safe fallback location");
  }
});
