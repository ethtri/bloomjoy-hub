import { checkoutMaintenanceResponse } from "./checkout-maintenance.ts";

Deno.test("merchant maintenance returns a retryable browser response", async () => {
  const response = checkoutMaintenanceResponse("true");
  if (!response || response.status !== 503) throw new Error("Checkout did not pause");
  if (response.headers.get("Retry-After") !== "120") throw new Error("Missing retry guidance");
  if (!response.headers.get("Access-Control-Allow-Origin")) throw new Error("Browser cannot read the pause");
  const body = await response.json();
  if (body.errorCode !== "CHECKOUT_TEMPORARILY_PAUSED") throw new Error("Missing maintenance code");
});

Deno.test("missing or false maintenance setting preserves normal checkout", () => {
  for (const value of ["", "false", "TRUE"]) {
    if (checkoutMaintenanceResponse(value) !== null) throw new Error("Unexpected checkout pause");
  }
});
