import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  beginRefundManagerTotpEnrollment,
  cancelRefundManagerTotpEnrollment,
  RefundManagerTotpError,
  verifyRefundManagerTotp,
} from "./refund-manager-totp.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.test("action step-up keeps factor details server-side and verifies exactly one TOTP", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({
        factors: [{
          id: "server-only-factor-id",
          factor_type: "totp",
          status: "verified",
        }],
      });
    }
    if (url.endsWith("/challenge")) return jsonResponse({ id: "challenge-id" });
    if (url.endsWith("/verify")) {
      return jsonResponse({ access_token: "fresh-aal2-token", refresh_token: "unused" });
    }
    return jsonResponse({}, 404);
  }) as typeof fetch;

  const token = await verifyRefundManagerTotp({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: "aal1-token",
    code: "123456",
    fetchImpl,
  });

  assertEquals(token, "fresh-aal2-token");
  assertEquals(requests.length, 3);
  assert(requests[1].url.includes("server-only-factor-id/challenge"));
  assert(requests[2].url.includes("server-only-factor-id/verify"));
  assertEquals(JSON.parse(requests[2].body), {
    challenge_id: "challenge-id",
    code: "123456",
  });
});

Deno.test("malformed codes fail before any Auth request", async () => {
  let requests = 0;
  const fetchImpl = (async () => {
    requests += 1;
    return jsonResponse({});
  }) as typeof fetch;

  await assertRejects(
    () =>
      verifyRefundManagerTotp({
        supabaseUrl: "https://project.example",
        supabaseAnonKey: "anon-key",
        accessToken: "token",
        code: "12 3456",
        fetchImpl,
      }),
    RefundManagerTotpError,
    "six-digit",
  );
  assertEquals(requests, 0);
});

Deno.test("zero or multiple verified factors fail closed", async () => {
  for (const factors of [
    [],
    [
      { id: "one", factor_type: "totp", status: "verified" },
      { id: "two", factor_type: "totp", status: "verified" },
    ],
  ]) {
    const fetchImpl = (async () => jsonResponse({ factors })) as typeof fetch;
    await assertRejects(
      () =>
        verifyRefundManagerTotp({
          supabaseUrl: "https://project.example",
          supabaseAnonKey: "anon-key",
          accessToken: "token",
          code: "123456",
          fetchImpl,
        }),
      RefundManagerTotpError,
    );
  }
});

Deno.test("supervised enrollment returns only transient QR material", async () => {
  let requestNumber = 0;
  const fetchImpl = (async () => {
    requestNumber += 1;
    if (requestNumber === 1) return jsonResponse({ factors: [] });
    return jsonResponse({
      id: "factor-id-must-not-leave-edge",
      totp: {
        qr_code: "<svg>one-time-qr</svg>",
        secret: "secret-must-not-leave-edge",
        uri: "otpauth://secret-must-not-leave-edge",
      },
    });
  }) as typeof fetch;

  const enrollment = await beginRefundManagerTotpEnrollment({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: "token",
    fetchImpl,
  });
  assert(enrollment.qrCode.startsWith("data:image/svg+xml"));
  assertEquals(Object.keys(enrollment), ["qrCode"]);
  assert(!JSON.stringify(enrollment).includes("factor-id-must-not-leave-edge"));
  assert(!JSON.stringify(enrollment).includes("secret-must-not-leave-edge"));
});

Deno.test("starting enrollment replaces one unfinished factor without exposing its ID", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({
        factors: [{
          id: "unfinished-server-only-factor",
          factor_type: "totp",
          status: "unverified",
        }],
      });
    }
    if (init?.method === "DELETE") return jsonResponse({ id: "removed" });
    return jsonResponse({
      id: "replacement-server-only-factor",
      totp: { qr_code: "<svg>replacement</svg>", secret: "server-only" },
    });
  }) as typeof fetch;

  const enrollment = await beginRefundManagerTotpEnrollment({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: "token",
    fetchImpl,
  });

  assertEquals(requests.map(({ method }) => method), ["GET", "DELETE", "POST"]);
  assert(requests[1].url.endsWith("/unfinished-server-only-factor"));
  assert(!JSON.stringify(enrollment).includes("unfinished-server-only-factor"));
});

Deno.test("cancelling enrollment removes only the caller's unfinished TOTP factor", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({
        factors: [
          { id: "verified-must-remain", factor_type: "totp", status: "verified" },
          { id: "unfinished-remove", factor_type: "totp", status: "unverified" },
        ],
      });
    }
    return jsonResponse({ id: "removed" });
  }) as typeof fetch;

  const result = await cancelRefundManagerTotpEnrollment({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: "token",
    fetchImpl,
  });

  assertEquals(result, { cancelled: true });
  assertEquals(requests.length, 2);
  assertEquals(requests[1].method, "DELETE");
  assert(requests[1].url.endsWith("/unfinished-remove"));
  assert(!requests[1].url.includes("verified-must-remain"));
});
