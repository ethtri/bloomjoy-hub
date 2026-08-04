import { runRefundManagerAgingWhenEnabled } from "../../supabase/functions/_shared/refund-manager-aging.ts";

const OUTPUT_FILENAME = "refund-manager-aging-kill-fragment.json";

if (Deno.args.length !== 2 || Deno.args[0] !== "--output") {
  throw new Error(`Usage: --output <evidence-directory>/${OUTPUT_FILENAME}`);
}
const outputPath = Deno.args[1].trim();
const normalizedOutputPath = outputPath.replaceAll("\\", "/");
if (
  !outputPath ||
  (normalizedOutputPath !== OUTPUT_FILENAME &&
    !normalizedOutputPath.endsWith(`/${OUTPUT_FILENAME}`))
) {
  throw new Error(`Output path must end with ${OUTPUT_FILENAME}.`);
}
const outputSeparatorIndex = Math.max(
  outputPath.lastIndexOf("/"),
  outputPath.lastIndexOf("\\"),
);
const outputDirectory = outputSeparatorIndex >= 0
  ? outputPath.slice(0, outputSeparatorIndex)
  : ".";

const rawEnabled = (Deno.env.get("REFUND_MANAGER_AGING_NOTICES_ENABLED") ?? "")
  .trim()
  .toLowerCase();
if (rawEnabled !== "false") {
  throw new Error(
    "Manager-aging kill evidence requires REFUND_MANAGER_AGING_NOTICES_ENABLED=false.",
  );
}
const managerAgingEnabled = rawEnabled === "true";

const calls = {
  fetchCallCount: 0,
  claimCallCount: 0,
  reservationCallCount: 0,
  sendCallCount: 0,
};
const gated = await runRefundManagerAgingWhenEnabled({
  enabled: managerAgingEnabled,
  run: async () => {
    calls.fetchCallCount += 1;
    calls.claimCallCount += 1;
    calls.reservationCallCount += 1;
    calls.sendCallCount += 1;
    return true;
  },
});
if (gated.executed || Object.values(calls).some((count) => count !== 0)) {
  throw new Error(
    "Disabled manager-aging evidence observed a side-effect dependency call.",
  );
}

const fragment = {
  schemaVersion: 1,
  evidenceType: "manager_aging_kill_fragment",
  evidenceMode: "synthetic_dependency_injection",
  passed: true,
  disabled: true,
  ...calls,
};

await Deno.mkdir(outputDirectory, { recursive: true });
await Deno.writeTextFile(
  outputPath,
  `${JSON.stringify(fragment, null, 2)}\n`,
  { createNew: true },
);
console.log(`Wrote sanitized ${OUTPUT_FILENAME}.`);
