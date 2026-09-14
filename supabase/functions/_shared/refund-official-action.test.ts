import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeRefundAuthorizationAuthority } from "./refund-official-action.ts";

Deno.test("authorization authority accepts the two explicit manager roles", () => {
  assertEquals(normalizeRefundAuthorizationAuthority({
    authorityKind: "machine_manager", authorityVersion: 4,
  }), { authorityKind: "machine_manager", authorityVersion: 4 });
  assertEquals(normalizeRefundAuthorizationAuthority({
    authorityKind: "super_admin", authorityVersion: 1,
  }), { authorityKind: "super_admin", authorityVersion: 1 });
});

Deno.test("legacy mapped-manager receipts remain readable", () => {
  assertEquals(normalizeRefundAuthorizationAuthority({ mappingVersion: 3 }), {
    authorityKind: "machine_manager", authorityVersion: 3,
  });
});

Deno.test("unknown or malformed authority fails closed", () => {
  assertEquals(normalizeRefundAuthorizationAuthority({
    authorityKind: "scoped_admin", authorityVersion: 1,
  }), null);
  assertEquals(normalizeRefundAuthorizationAuthority({
    authorityKind: "super_admin", authorityVersion: 0,
  }), null);
  assertEquals(normalizeRefundAuthorizationAuthority({}), null);
});
