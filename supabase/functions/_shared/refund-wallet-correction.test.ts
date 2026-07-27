import {
  assert,
  assertEquals,
  assertMatch,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createRefundWalletCorrectionToken,
  getRefundWalletCorrectionExpiry,
  hashRefundWalletCorrectionToken,
  isRefundWalletCorrectionToken,
  REFUND_WALLET_CORRECTION_MAX_LINKS,
  REFUND_WALLET_CORRECTION_TTL_HOURS,
} from "./refund-wallet-correction.ts";

Deno.test("wallet correction links use high-entropy opaque tokens", () => {
  const first = createRefundWalletCorrectionToken();
  const second = createRefundWalletCorrectionToken();

  assertEquals(first.length, 43);
  assertMatch(first, /^[A-Za-z0-9_-]+$/);
  assert(isRefundWalletCorrectionToken(first));
  assertNotEquals(first, second);
  assert(!isRefundWalletCorrectionToken("short"));
  assert(!isRefundWalletCorrectionToken("83000000-0000-4000-8000-000000000001"));
});

Deno.test("wallet correction tokens are stored only as purpose-bound hashes", async () => {
  const token = "wallet_correction_token_for_hash_test_00000001";
  const firstHash = await hashRefundWalletCorrectionToken(token);
  const secondHash = await hashRefundWalletCorrectionToken(token);

  assertEquals(firstHash, secondHash);
  assertMatch(firstHash, /^[a-f0-9]{64}$/);
  assertNotEquals(firstHash, token);
});

Deno.test("wallet correction links follow the bounded contact policy", () => {
  const start = new Date("2026-07-27T12:00:00.000Z");
  const expiry = getRefundWalletCorrectionExpiry(start);

  assertEquals(REFUND_WALLET_CORRECTION_TTL_HOURS, 48);
  assertEquals(REFUND_WALLET_CORRECTION_MAX_LINKS, 2);
  assertEquals(expiry.toISOString(), "2026-07-29T12:00:00.000Z");
});
