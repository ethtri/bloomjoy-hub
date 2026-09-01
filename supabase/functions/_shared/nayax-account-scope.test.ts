import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeNayaxAccountKey,
  resolveNayaxTokenForAccount,
} from "./nayax-lookup.ts";

const environmentReader = (values: Record<string, string>) =>
  (name: string) => values[name];

Deno.test("Nayax account keys normalize only an explicit configured scope", () => {
  assertEquals(normalizeNayaxAccountKey("secondary-east:ops"), "SECONDARY_EAST_OPS");
  assertEquals(normalizeNayaxAccountKey(null), "");
});

Deno.test("a separate Nayax account uses only its exact scoped credential", () => {
  const readEnvironment = environmentReader({
    NAYAX_LYNX_API_TOKEN_SECONDARY_EAST: "secondary-token",
    NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB: "default-token",
    NAYAX_LYNX_API_TOKEN: "legacy-default-token",
  });
  assertEquals(
    resolveNayaxTokenForAccount("SECONDARY_EAST", readEnvironment),
    "secondary-token",
  );
});

Deno.test("a missing separate-account credential never borrows the default account", () => {
  const readEnvironment = environmentReader({
    NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB: "default-token",
    NAYAX_LYNX_API_TOKEN: "legacy-default-token",
  });
  assertEquals(resolveNayaxTokenForAccount("SECONDARY_EAST", readEnvironment), "");
});

Deno.test("the canonical default account retains its reviewed legacy fallback", () => {
  const readEnvironment = environmentReader({
    NAYAX_LYNX_API_TOKEN: "legacy-default-token",
  });
  assertEquals(
    resolveNayaxTokenForAccount("TGPACI_USA_DB", readEnvironment),
    "legacy-default-token",
  );
});

Deno.test("an absent account mapping never resolves any credential", () => {
  const readEnvironment = environmentReader({
    NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB: "default-token",
    NAYAX_LYNX_API_TOKEN: "legacy-default-token",
  });
  assertEquals(resolveNayaxTokenForAccount("", readEnvironment), "");
});
