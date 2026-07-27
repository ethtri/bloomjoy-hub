import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createRefundQrClaimToken,
  hashRefundQrClaimToken,
  isRefundQrOpaqueToken,
  REFUND_QR_CLAIM_TTL_MINUTES,
} from "./refund-qr-claim.ts";

Deno.test("refund QR opaque tokens reject identifiers and unsafe characters", () => {
  assert(!isRefundQrOpaqueToken("83000000-0000-4000-8000-000000000001"));
  assert(!isRefundQrOpaqueToken("nayax-machine:123"));
  assert(!isRefundQrOpaqueToken("short"));
  assert(!isRefundQrOpaqueToken("refund_qr_code_with_query?machine=123456789"));
  assert(isRefundQrOpaqueToken("refund_qr_public_code_machine_one_000001"));
});

Deno.test("refund QR claim tokens are high entropy base64url values", () => {
  const first = createRefundQrClaimToken();
  const second = createRefundQrClaimToken();

  assertEquals(first.length, 43);
  assertMatch(first, /^[A-Za-z0-9_-]+$/);
  assert(isRefundQrOpaqueToken(first));
  assertNotEquals(first, second);
});

Deno.test("refund QR claim tokens are stored as deterministic SHA-256 hashes", async () => {
  const token = "refund_qr_claim_token_for_hash_test_00001";
  const firstHash = await hashRefundQrClaimToken(token);
  const secondHash = await hashRefundQrClaimToken(token);

  assertEquals(firstHash, secondHash);
  assertMatch(firstHash, /^[a-f0-9]{64}$/);
  assertNotEquals(firstHash, token);
});

Deno.test("refund QR claim sessions use the approved short lifetime", () => {
  assertEquals(REFUND_QR_CLAIM_TTL_MINUTES, 30);
});
