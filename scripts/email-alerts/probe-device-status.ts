import { explicitNayaxConnectivity } from "../../supabase/functions/_shared/machine-email-alert-signals.ts";

// Read-only, no database access and no mail. IDs/tokens must be provided via the environment, never CLI arguments.
const account = Deno.env.get("EMAIL_ALERT_PROBE_ACCOUNT") ?? "TGPACI_USA_DB";
const machine = Deno.env.get("EMAIL_ALERT_PROBE_MACHINE_ID") ?? "";
const token = /^[A-Z0-9_]{1,80}$/.test(account)
  ? Deno.env.get(`NAYAX_LYNX_API_TOKEN_${account}`) ||
    (account === "TGPACI_USA_DB"
      ? Deno.env.get("NAYAX_LYNX_API_TOKEN")
      : undefined)
  : undefined;
let result: Record<string, unknown> = {
  endpoint: "machine_status",
  component: "Nayax payment device",
  configured: Boolean(token && /^[A-Za-z0-9_-]{1,160}$/.test(machine)),
  recognizedBoolean: false,
};
if (result.configured) {
  try {
    const base = new URL(
      Deno.env.get("NAYAX_LYNX_BASE_URL") ||
        "https://lynx.nayax.com/operational/v1",
    );
    if (
      base.protocol !== "https:" || base.username || base.password ||
      base.search || base.hash
    ) throw new Error("invalid_base");
    const response = await fetch(
      `${base.toString().replace(/\/+$/, "")}/machines/${
        encodeURIComponent(machine)
      }/status`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    result = { ...result, httpStatus: response.status };
    if (response.ok) {
      const raw = await response.text();
      if (raw.length <= 65_536) {
        const observation = explicitNayaxConnectivity(JSON.parse(raw));
        result = {
          ...result,
          recognizedBoolean: observation !== null,
          field: observation?.providerField ?? null,
          fieldType: observation ? "boolean" : "unrecognized",
          isOnline: observation?.isOnline ?? null,
        };
      }
    }
  } catch {
    result = { ...result, error: "status_unavailable" };
  }
}
console.log(JSON.stringify(result));
