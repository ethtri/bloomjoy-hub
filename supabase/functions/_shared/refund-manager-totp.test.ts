import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  beginRefundManagerTotpEnrollment,
  bestEffortCompensateRefundManagerTotpEnrollment,
  cancelRefundManagerTotpEnrollment,
  refundManagerTotpFactorBindingHash,
  removeRefundManagerTotpFactor,
  RefundManagerTotpError,
  verifyRefundManagerTotp,
  verifyRefundManagerTotpEnrollment,
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

  const verification = await verifyRefundManagerTotp({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: "aal1-token",
    code: "123456",
    fetchImpl,
  });

  assertEquals(verification.accessToken, "fresh-aal2-token");
  assertEquals(
    verification.factorBindingHash,
    await refundManagerTotpFactorBindingHash("server-only-factor-id"),
  );
  assert(!verification.factorBindingHash.includes("server-only-factor-id"));
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

Deno.test("real Auth enrollment-disabled response fails before QR material reaches the UI", async () => {
  let requestNumber = 0;
  const error = await assertRejects(
    () =>
      beginRefundManagerTotpEnrollment({
        supabaseUrl: "https://project.example",
        supabaseAnonKey: "anon-key",
        accessToken: "token",
        fetchImpl: (async () => {
          requestNumber += 1;
          if (requestNumber === 1) return jsonResponse({ factors: [] });
          return jsonResponse({
            code: "mfa_totp_enroll_not_enabled",
            msg: "MFA enroll is disabled for TOTP",
          }, 422);
        }) as typeof fetch,
      }),
    RefundManagerTotpError,
  );

  assertEquals(error.code, "auth_enrollment_disabled");
  assertEquals(error.status, 409);
  assertEquals(requestNumber, 2);
  assert(!error.message.includes("qr"));
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

Deno.test("verified enrollment returns an internal binding and supports compensating factor removal", async () => {
  const requests: Array<{ url: string; method: string; token: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method ?? "GET",
      token: headers.get("Authorization") ?? "",
    });
    if (url.endsWith("/auth/v1/user")) {
      return jsonResponse({
        factors: [{
          id: "new-refund-factor",
          factor_type: "totp",
          status: "unverified",
        }],
      });
    }
    if (url.endsWith("/challenge")) return jsonResponse({ id: "challenge-id" });
    if (url.endsWith("/verify")) {
      return jsonResponse({ access_token: "new-aal2-token" });
    }
    if (init?.method === "DELETE") return jsonResponse({ id: "removed" });
    return jsonResponse({}, 404);
  }) as typeof fetch;

  const verification = await verifyRefundManagerTotpEnrollment({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: "aal1-token",
    code: "123456",
    fetchImpl,
  });

  assertEquals(verification.accessToken, "new-aal2-token");
  assertEquals(verification.factorId, "new-refund-factor");
  assertEquals(
    verification.factorBindingHash,
    await refundManagerTotpFactorBindingHash("new-refund-factor"),
  );

  await removeRefundManagerTotpFactor({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    accessToken: verification.accessToken,
    factorId: verification.factorId,
    fetchImpl,
  });

  const removal = requests.at(-1);
  assertEquals(removal?.method, "DELETE");
  assert(removal?.url.endsWith("/new-refund-factor"));
  assertEquals(removal?.token, "Bearer new-aal2-token");
});

Deno.test("enrollment verification rejects a second TOTP when a verified factor already exists", async () => {
  let requestCount = 0;
  const error = await assertRejects(
    () =>
      verifyRefundManagerTotpEnrollment({
        supabaseUrl: "https://project.example",
        supabaseAnonKey: "anon-key",
        accessToken: "aal1-token",
        code: "123456",
        fetchImpl: (async () => {
          requestCount += 1;
          return jsonResponse({
            factors: [
              { id: "generic-factor", factor_type: "totp", status: "verified" },
              { id: "new-refund-factor", factor_type: "totp", status: "unverified" },
            ],
          });
        }) as typeof fetch,
      }),
    RefundManagerTotpError,
  );

  assertEquals(error.code, "factor_ambiguous");
  assertEquals(requestCount, 1);
});

Deno.test("enrollment compensation still removes Auth factor when durable rollback fails", async () => {
  let durableAttempts = 0;
  let removalAttempts = 0;
  const result = await bestEffortCompensateRefundManagerTotpEnrollment({
    supabaseUrl: "https://project.example",
    supabaseAnonKey: "anon-key",
    verifiedAccessToken: "verified-aal2-token",
    factorId: "verified-factor",
    factorBindingHash: await refundManagerTotpFactorBindingHash("verified-factor"),
    compensateDurableState: () => {
      durableAttempts += 1;
      return Promise.reject(new Error("database unavailable"));
    },
    fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
      removalAttempts += 1;
      assertEquals(init?.method, "DELETE");
      return jsonResponse({ id: "removed" });
    }) as typeof fetch,
  });

  assertEquals(durableAttempts, 1);
  assertEquals(removalAttempts, 1);
  assertEquals(result, { durableCompensated: false, factorRemoved: true });
});
