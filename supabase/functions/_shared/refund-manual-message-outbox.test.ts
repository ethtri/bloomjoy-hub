import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  claimRefundManualMessageDeliveries,
  deliverRefundManualMessageClaim,
  drainRefundManualMessageOutbox,
  refundManualMessageManagerCopyPolicy,
  refundOutboxAutomaticSendGate,
} from "./refund-manual-message-outbox.ts";
import { RefundGmailError, sha256Hex } from "./refund-gmail.ts";

const messageId = "b2000000-0000-4000-8000-000000000001";
const claimToken = "b2100000-0000-4000-8000-000000000001";
const secondMessageId = "b2000000-0000-4000-8000-000000000002";
const secondClaimToken = "b2100000-0000-4000-8000-000000000002";

const withAutomaticEnvironment = async (
  automation: string,
  contact: string,
  run: () => Promise<void> | void,
) => {
  const beforeAutomation = Deno.env.get("REFUND_AUTOMATION_ENABLED");
  const beforeContact = Deno.env.get(
    "REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED",
  );
  Deno.env.set("REFUND_AUTOMATION_ENABLED", automation);
  Deno.env.set("REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED", contact);
  try {
    await run();
  } finally {
    if (beforeAutomation === undefined) {
      Deno.env.delete("REFUND_AUTOMATION_ENABLED");
    } else Deno.env.set("REFUND_AUTOMATION_ENABLED", beforeAutomation);
    if (beforeContact === undefined) {
      Deno.env.delete("REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED");
    } else {
      Deno.env.set(
        "REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED",
        beforeContact,
      );
    }
  }
};

const claimedMessage = (
  providerAttemptedAt: string | null,
  overrides: Record<string, unknown> = {},
) => ({
  id: messageId,
  refund_case_id: "b2200000-0000-4000-8000-000000000001",
  message_type: "completed",
  status: "pending",
  recipient_email: "customer@example.invalid",
  subject: "Your refund is confirmed",
  body: "Your refund is confirmed.",
  delivery_kind: "automatic",
  template_version: null,
  nayax_refund_attempt_id: null,
  manual_delivery_intent_id: "b2700000-0000-4000-8000-000000000001",
  manual_delivery_provider_attempted_at: providerAttemptedAt,
  delivery_transport: null,
  provider_message_id: null,
  delivery_state: "unknown",
  delivery_state_updated_at: null,
  manual_delivery_state: "claimed",
  manual_delivery_claim_token: claimToken,
  manual_delivery_expected_case_version: 7,
  manual_delivery_status_link_requested: false,
  synthetic_gmail_proof_authorization_id: null,
  manual_delivery_triage_suggestion_id: null,
  created_by: "b2300000-0000-4000-8000-000000000001",
  ...overrides,
});

const currentCase = {
  official_action_version: 7,
  case_population: "customer",
  customer_email: "customer@example.invalid",
  deterministic_fact_version: 3,
};

const singleRowQuery = (data: unknown) => {
  const query = {
    select: () => query,
    eq: (_key?: string, _value?: unknown) => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({ data, error: null }),
  };
  return query;
};

const withGmailEnvironment = async (run: () => Promise<void>) => {
  const values: Record<string, string> = {
    REFUND_GMAIL_ENABLED: "true",
    GMAIL_SUPPORT_CLIENT_ID: "client-id",
    GMAIL_SUPPORT_CLIENT_SECRET: "client-secret",
    GMAIL_SUPPORT_REFRESH_TOKEN: "refresh-token",
    GMAIL_SUPPORT_MAILBOX: "info@bloomjoysweets.com",
    GMAIL_SUPPORT_SEND_AS_ALIASES: "refunds@bloomjoysweets.com",
    REFUND_CUSTOMER_FROM_EMAIL: "refunds@bloomjoysweets.com",
    GMAIL_REFUND_LABEL_ID: "refund-label",
  };
  const before = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    before.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  try {
    await run();
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
};

Deno.test("recovered receipt uses its exact original thread; sent and unknown transport never resend", async () => {
  await withAutomaticEnvironment("true", "true", async () => {
    await withGmailEnvironment(async () => {
      const threadId = "b2400000-0000-4000-8000-000000000001";
      const intentId = "b2700000-0000-4000-8000-000000000001";
      const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
      const originalFetch = globalThis.fetch;
      let providerCalls = 0;
      globalThis.fetch = (() => {
        providerCalls++;
        throw new Error("existing completion evidence must never resend");
      }) as typeof fetch;
      try {
        for (const state of ["sent", "delivery_unknown"]) {
          const filters: Array<[string, unknown]> = [];
          let targetThread: unknown;
          let transactionalCalls = 0;
          const supabase = {
            from: (table: string) => {
              if (table === "refund_case_messages") return singleRowQuery(claimedMessage(null, {
                template_version: "refund_receipt_completion_v1", manual_delivery_intent_id: intentId,
                nayax_refund_attempt_id: "b2800000-0000-4000-8000-000000000001",
              }));
              if (table === "refund_cases") return singleRowQuery(currentCase);
              if (table === "refund_receipt_completion_intents") {
                const query = singleRowQuery({ gmail_thread_id: threadId });
                query.eq = (key?: string, value?: unknown) => { filters.push([key ?? "", value]); return query; };
                return query;
              }
              if (table === "refund_gmail_threads") return singleRowQuery({ id: threadId, mailbox_hash: mailboxHash });
              throw new Error(`unexpected completion source lookup: ${table}`);
            },
            rpc: (name: string, args: Record<string, unknown>) => {
              if (name === "service_mark_refund_transactional_delivery_attempt") transactionalCalls++;
              if (name === "service_verify_refund_synthetic_gmail_proof_transport") return Promise.resolve({
                data: { required: false, allowed: true, status: "not_required" }, error: null,
              });
              if (name === "service_claim_refund_gmail_outbound_v3") {
                targetThread = args.p_target_gmail_thread_id;
                return Promise.resolve({ data: {
                  linked: true, claimed: false, status: state, reconciled: state === "sent",
                  subject: "Your refund is confirmed", managerCcEmails: [],
                  managerRecipientOverlap: false, managerRecipientCount: 1, recipientResolutionStatus: "resolved",
                }, error: null });
              }
              if (name === "service_mark_refund_manual_message_provider_attempt") return Promise.resolve({
                data: { marked: true, replayed: false, payloadRedacted: true }, error: null,
              });
              if (name === "service_finish_refund_manual_message_delivery") return Promise.resolve({
                data: { finished: true, payloadRedacted: true }, error: null,
              });
              return Promise.resolve({ data: null, error: { code: "unexpected_rpc" } });
            },
          } as never;
          const result = await deliverRefundManualMessageClaim({ supabase, reference: { messageId, claimToken } });
          assertEquals(filters, [["intent_id", intentId], ["refund_case_id", "b2200000-0000-4000-8000-000000000001"], ["message_id", messageId]]);
          assertEquals(targetThread, threadId);
          assertEquals(result.outcome, state === "sent" ? "sent" : "delivery_unknown");
          assertEquals(transactionalCalls, 0);
        }
        assertEquals(providerCalls, 0);
      } finally { globalThis.fetch = originalFetch; }
    });
  });
});

Deno.test("missing exact receipt intent binding fails before any provider marker or fallback", async () => {
  await withAutomaticEnvironment("true", "true", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (() => { providerCalls++; throw new Error("missing source attempted delivery"); }) as typeof fetch;
    try {
      for (const boundIntent of [null, { gmail_thread_id: null }]) {
      calls.length = 0;
      const supabase = {
        from: (table: string) => {
          calls.push(table);
          if (table === "refund_case_messages") return singleRowQuery(claimedMessage(null, {
            template_version: "refund_receipt_completion_v1",
            nayax_refund_attempt_id: "b2800000-0000-4000-8000-000000000001",
          }));
          if (table === "refund_cases") return singleRowQuery(currentCase);
          return singleRowQuery(boundIntent);
        },
        rpc: (name: string) => {
          calls.push(name);
          return Promise.resolve({ data: { finished: true, payloadRedacted: true }, error: null });
        },
      } as never;
      const result = await deliverRefundManualMessageClaim({ supabase, reference: { messageId, claimToken } });
      assertEquals(result.outcome, "failed");
      assertEquals(providerCalls, 0);
      assertEquals(calls.includes("service_mark_refund_manual_message_provider_attempt"), false);
      assertEquals(calls.includes("refund_gmail_threads"), false);
      assertEquals(calls.includes("service_mark_refund_transactional_delivery_attempt"), false);
      }
    } finally { globalThis.fetch = originalFetch; }
  });
});

Deno.test("customer questions and completions stay in the customer thread without changing decision routes", () => {
  assertEquals(refundManualMessageManagerCopyPolicy({
    message_type: "more_info",
    delivery_kind: "automatic",
  }), "automatic_portal_only");
  assertEquals(refundManualMessageManagerCopyPolicy({
    message_type: "more_info",
    delivery_kind: "manual",
  }), "customer_thread_only");
  assertEquals(refundManualMessageManagerCopyPolicy({
    message_type: "completed",
    delivery_kind: "manual",
  }), "customer_thread_only");
  assertEquals(refundManualMessageManagerCopyPolicy({
    message_type: "completed",
    delivery_kind: "automatic",
  }), "automatic_portal_only");
  assertEquals(refundManualMessageManagerCopyPolicy({
    message_type: "approved",
    delivery_kind: "manual",
  }), "manager_cc_required");
});

Deno.test("manual-message outbox claims a bounded exact message contract", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: [{
          refund_case_message_id: messageId,
          claim_token: claimToken,
        }],
        error: null,
      });
    },
  };

  const claims = await claimRefundManualMessageDeliveries({
    supabase: supabase as never,
    messageId,
    limit: 100,
  });

  assertEquals(claims, [{ messageId, claimToken }]);
  assertEquals(calls, [{
    name: "service_claim_refund_manual_message_deliveries",
    args: {
      p_refund_case_message_id: messageId,
      p_limit: 25,
    },
  }]);
});

Deno.test("manual-message outbox rejects an invalid message identity before database access", async () => {
  let called = false;
  await assertRejects(
    () =>
      claimRefundManualMessageDeliveries({
        supabase: {
          rpc: () => {
            called = true;
            return Promise.resolve({ data: [], error: null });
          },
        } as never,
        messageId: "not-a-message-id",
      }),
    Error,
    "requires a valid message id",
  );
  assertEquals(called, false);
});

Deno.test("manual-message outbox fails closed on malformed claim evidence", async () => {
  await assertRejects(
    () =>
      claimRefundManualMessageDeliveries({
        supabase: {
          rpc: () =>
            Promise.resolve({
              data: [{
                refund_case_message_id: messageId,
                claim_token: "not-a-claim-token",
              }],
              error: null,
            }),
        } as never,
      }),
    Error,
    "claim contract is invalid",
  );
});

Deno.test("manual-message incident stop leaves queued work unclaimed", async () => {
  const original = Deno.env.get("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED");
  Deno.env.set("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED", "false");
  let called = false;
  try {
    const results = await drainRefundManualMessageOutbox({
      supabase: {
        rpc: () => {
          called = true;
          return Promise.resolve({ data: [], error: null });
        },
      } as never,
    });
    assertEquals(results, []);
    assertEquals(called, false);
  } finally {
    if (original === undefined) {
      Deno.env.delete("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED");
    } else {
      Deno.env.set("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED", original);
    }
  }
});

Deno.test("automatic outbox fresh-send gates do not affect manual messages", async () => {
  await withAutomaticEnvironment("false", "false", () => {
    assertEquals(refundOutboxAutomaticSendGate("manual"), null);
    assertEquals(
      refundOutboxAutomaticSendGate("automatic"),
      "refund_automation_disabled",
    );
  });
  await withAutomaticEnvironment("true", "false", () => {
    assertEquals(
      refundOutboxAutomaticSendGate("automatic"),
      "automatic_contact_disabled",
    );
  });
  await withAutomaticEnvironment("true", "true", () => {
    assertEquals(refundOutboxAutomaticSendGate("automatic"), null);
  });
});

Deno.test("fresh automatic shutdown defers the exact claim without provider access", async () => {
  await withAutomaticEnvironment("false", "false", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (() => {
      providerCalls += 1;
      throw new Error("fresh automatic shutdown attempted provider access");
    }) as typeof fetch;
    try {
      const supabase = {
        from: (table: string) => {
          calls.push(`from:${table}`);
          return singleRowQuery(
            table === "refund_case_messages" ? claimedMessage(null) : currentCase,
          );
        },
        rpc: (name: string) => {
          calls.push(`rpc:${name}`);
          if (name === "service_defer_refund_automatic_completion_delivery") {
            return Promise.resolve({
              data: { deferred: true, payloadRedacted: true },
              error: null,
            });
          }
          return Promise.resolve({
            data: null,
            error: { code: "unexpected_rpc" },
          });
        },
      } as never;
      const result = await deliverRefundManualMessageClaim({
        supabase,
        reference: { messageId, claimToken },
      });
      assertEquals(result.outcome, "deferred");
      assertEquals(providerCalls, 0);
      assertEquals(calls, [
        "from:refund_case_messages",
        "from:refund_cases",
        "rpc:service_defer_refund_automatic_completion_delivery",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("mark-only automatic crash cannot send after env shutdown and defers transactional fallback", async () => {
  await withAutomaticEnvironment("false", "false", async () => {
    await withGmailEnvironment(async () => {
      const calls: string[] = [];
      const originalFetch = globalThis.fetch;
      let providerCalls = 0;
      globalThis.fetch = (() => {
        providerCalls += 1;
        throw new Error("mark-only crash attempted provider access");
      }) as typeof fetch;
      try {
        const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
        const supabase = {
          from: (table: string) => {
            calls.push(`from:${table}`);
            if (table === "refund_case_messages") {
              return singleRowQuery(claimedMessage("2026-09-05T12:00:00Z"));
            }
            if (table === "refund_cases") return singleRowQuery(currentCase);
            if (table === "refund_gmail_threads") {
              return singleRowQuery({
                id: "b2400000-0000-4000-8000-000000000001",
                mailbox_hash: mailboxHash,
              });
            }
            return singleRowQuery(null);
          },
          rpc: (name: string) => {
            calls.push(`rpc:${name}`);
            if (name === "service_mark_refund_manual_message_provider_attempt") {
              return Promise.resolve({
                data: { marked: true, replayed: true, payloadRedacted: true },
                error: null,
              });
            }
            if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
              return Promise.resolve({
                data: { required: false, payloadRedacted: true },
                error: null,
              });
            }
            if (name === "service_authorize_refund_customer_outbound") {
              return Promise.resolve({
                data: {
                  allowed: true,
                  recipientResolutionStatus: "resolved",
                  managerCcEmails: [],
                  managerRecipientOverlap: false,
                  managerRecipientCount: 1,
                },
                error: null,
              });
            }
            if (name === "service_claim_refund_gmail_outbound_v3") {
              return Promise.resolve({
                data: {
                  linked: true,
                  claimed: true,
                  transportMessageId:
                    "b2500000-0000-4000-8000-000000000001",
                  providerThreadId: "provider-thread",
                  subject: "Your refund is confirmed",
                  managerCcEmails: ["manager@example.invalid"],
                  managerRecipientOverlap: false,
                  managerRecipientCount: 1,
                  recipientResolutionStatus: "resolved",
                },
                error: null,
              });
            }
            if (name === "service_finish_refund_gmail_outbound") {
              return Promise.resolve({ data: true, error: null });
            }
            if (name === "service_finish_refund_manual_message_delivery") {
              return Promise.resolve({
                data: { finished: true, payloadRedacted: true },
                error: null,
              });
            }
            if (name === "service_defer_refund_automatic_completion_delivery") {
              return Promise.resolve({
                data: { deferred: true, payloadRedacted: true },
                error: null,
              });
            }
            return Promise.resolve({
              data: null,
              error: { code: "unexpected_rpc" },
            });
          },
        } as never;
        const result = await deliverRefundManualMessageClaim({
          supabase,
          reference: { messageId, claimToken },
        });
        assertEquals(result.outcome, "deferred");
        assertEquals(providerCalls, 0);
        assertEquals(calls.includes(
          "rpc:service_claim_refund_gmail_outbound_v3",
        ), false);
        assertEquals(calls.includes(
          "rpc:service_finish_refund_gmail_outbound",
        ), false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

Deno.test("shutdown Gmail-claim settlement failure escapes the outbox delivery", async () => {
  await withAutomaticEnvironment("false", "false", async () => {
    await withGmailEnvironment(async () => {
      const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
      const supabase = {
        from: (table: string) => {
          if (table === "refund_case_messages") {
            return singleRowQuery(claimedMessage("2026-09-05T12:00:00Z", {
              synthetic_gmail_proof_authorization_id:
                "b2600000-0000-4000-8000-000000000001",
            }));
          }
          if (table === "refund_cases") return singleRowQuery(currentCase);
          if (table === "refund_gmail_threads") {
            return singleRowQuery({
              id: "b2400000-0000-4000-8000-000000000001",
              mailbox_hash: mailboxHash,
            });
          }
          return singleRowQuery(null);
        },
        rpc: (name: string) => {
          if (name === "service_mark_refund_manual_message_provider_attempt") {
            return Promise.resolve({
              data: { marked: true, replayed: true, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
            return Promise.resolve({
              data: {
                required: true,
                allowed: true,
                status: "authorized",
                gmailThreadId: "b2400000-0000-4000-8000-000000000001",
                expectedManagerCount: 1,
                managerRouteDigest: "a".repeat(64),
                payloadRedacted: true,
              },
              error: null,
            });
          }
          if (name === "service_claim_refund_gmail_outbound_v3") {
            return Promise.resolve({
              data: {
                linked: true,
                claimed: true,
                transportMessageId:
                  "b2500000-0000-4000-8000-000000000002",
                providerThreadId: "provider-thread",
                subject: "Your refund is confirmed",
                managerCcEmails: ["manager@example.invalid"],
                managerRecipientOverlap: false,
                managerRecipientCount: 1,
                recipientResolutionStatus: "resolved",
              },
              error: null,
            });
          }
          if (name === "service_finish_refund_gmail_outbound") {
            return Promise.resolve({
              data: null,
              error: { message: "settlement unavailable" },
            });
          }
          return Promise.resolve({
            data: null,
            error: { code: "unexpected_rpc" },
          });
        },
      } as never;
      await assertRejects(
        () =>
          deliverRefundManualMessageClaim({
            supabase,
            reference: { messageId, claimToken },
          }),
        RefundGmailError,
        "could not be settled",
      );
    });
  });
});

Deno.test("started automatic delivery reaches Gmail sent or unknown reconciliation after env shutdown", async () => {
  await withAutomaticEnvironment("false", "false", async () => {
    await withGmailEnvironment(async () => {
      const calls: string[] = [];
      const originalFetch = globalThis.fetch;
      let providerCalls = 0;
      globalThis.fetch = (() => {
        providerCalls += 1;
        throw new Error(
          "provider access is not expected during reconciliation",
        );
      }) as typeof fetch;
      try {
        const mailboxHash = await sha256Hex("info@bloomjoysweets.com");
        for (const status of ["sent", "delivery_unknown"] as const) {
          calls.length = 0;
          providerCalls = 0;
          const supabase = {
            from: (table: string) => {
              calls.push(`from:${table}`);
              if (table === "refund_case_messages") {
                return singleRowQuery(claimedMessage("2026-09-05T12:00:00Z", {
                  synthetic_gmail_proof_authorization_id:
                    "b2600000-0000-4000-8000-000000000002",
                }));
              }
              if (table === "refund_cases") return singleRowQuery(currentCase);
              if (table === "refund_gmail_threads") {
                return singleRowQuery({
                  id: "b2400000-0000-4000-8000-000000000001",
                  mailbox_hash: mailboxHash,
                });
              }
              return singleRowQuery(null);
            },
            rpc: (name: string) => {
              calls.push(`rpc:${name}`);
              if (
                name === "service_mark_refund_manual_message_provider_attempt"
              ) {
                return Promise.resolve({
                  data: { marked: true, replayed: true, payloadRedacted: true },
                  error: null,
                });
              }
              if (
                name === "service_verify_refund_synthetic_gmail_proof_transport"
              ) {
                return Promise.resolve({
                  data: {
                    required: true,
                    allowed: true,
                    status: "authorized",
                    gmailThreadId: "b2400000-0000-4000-8000-000000000001",
                    expectedManagerCount: 1,
                    managerRouteDigest: "a".repeat(64),
                    payloadRedacted: true,
                  },
                  error: null,
                });
              }
              if (name === "service_claim_refund_gmail_outbound_v3") {
                return Promise.resolve({
                  data: {
                    linked: true,
                    claimed: false,
                    reconciled: status === "sent",
                    status,
                    subject: "Your refund is confirmed",
                    managerCcEmails: status === "sent"
                      ? ["manager@example.invalid"]
                      : [],
                    managerRecipientOverlap: false,
                    managerRecipientCount: 1,
                    recipientResolutionStatus: "resolved",
                  },
                  error: null,
                });
              }
              if (name === "service_finish_refund_manual_message_delivery") {
                return Promise.resolve({
                  data: { finished: true, payloadRedacted: true },
                  error: null,
                });
              }
              return Promise.resolve({
                data: null,
                error: { code: "unexpected_rpc" },
              });
            },
          } as never;
          const result = await deliverRefundManualMessageClaim({
            supabase,
            reference: { messageId, claimToken },
          });
          assertEquals(result.outcome, status);
          assertEquals(
            result.transport,
            status === "sent" ? "gmail_thread" : null,
          );
          assertEquals(providerCalls, 0);
          assertEquals(
            calls.indexOf(
              "rpc:service_mark_refund_manual_message_provider_attempt",
            ) < calls.indexOf("rpc:service_claim_refund_gmail_outbound_v3"),
            true,
          );
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

Deno.test("automatic transactional sent and unknown evidence reconcile before shutdown gates", async () => {
  await withAutomaticEnvironment("false", "false", async () => {
    for (
      const recovery of [
        {
          state: "accepted",
          providerMessageId: "provider_message_123",
          outcome: "sent",
          transport: "transactional_email",
        },
        {
          state: "unknown",
          providerMessageId: null,
          outcome: "delivery_unknown",
          transport: null,
        },
      ] as const
    ) {
      const calls: string[] = [];
      const supabase = {
        from: (table: string) => {
          calls.push(`from:${table}`);
          return singleRowQuery(
            table === "refund_case_messages"
              ? claimedMessage("2026-09-05T12:00:00Z", {
                delivery_transport: "resend",
                provider_message_id: recovery.providerMessageId,
                delivery_state: recovery.state,
                delivery_state_updated_at: "2026-09-05T12:00:01Z",
              })
              : currentCase,
          );
        },
        rpc: (name: string) => {
          calls.push(`rpc:${name}`);
          if (name === "service_mark_refund_manual_message_provider_attempt") {
            return Promise.resolve({
              data: { marked: true, replayed: true, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_finish_refund_manual_message_delivery") {
            return Promise.resolve({
              data: { finished: true, payloadRedacted: true },
              error: null,
            });
          }
          return Promise.resolve({
            data: null,
            error: { code: "unexpected_rpc" },
          });
        },
      } as never;
      const result = await deliverRefundManualMessageClaim({
        supabase,
        reference: { messageId, claimToken },
      });
      assertEquals(result.outcome, recovery.outcome);
      assertEquals(result.transport, recovery.transport);
      assertEquals(calls, [
        "from:refund_case_messages",
        "from:refund_cases",
        "rpc:service_mark_refund_manual_message_provider_attempt",
        "rpc:service_finish_refund_manual_message_delivery",
      ]);
    }
  });
});

Deno.test("PR #1051 regression: portal completion with a later Gmail thread uses one deterministic transactional send", async () => {
  await withAutomaticEnvironment("true", "true", async () => {
    const values: Record<string, string> = {
      REFUND_GMAIL_ENABLED: "true",
      REFUND_CUSTOMER_FROM_EMAIL: "refunds@bloomjoysweets.com",
      REFUND_REPLY_TO_EMAIL: "refunds@bloomjoysweets.com",
      RESEND_API_KEY: "synthetic-resend-key",
      INTERNAL_NOTIFICATION_FROM_EMAIL: "refunds@bloomjoysweets.com",
    };
    const before = new Map<string, string | undefined>();
    for (const [name, value] of Object.entries(values)) {
      before.set(name, Deno.env.get(name));
      Deno.env.set(name, value);
    }
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    let providerIdempotencyKey = "";
    globalThis.fetch = ((_input, init) => {
      providerCalls += 1;
      providerIdempotencyKey = new Headers(init?.headers).get(
        "idempotency-key",
      ) ?? "";
      return Promise.resolve(new Response(
        JSON.stringify({ id: "resend_provider_001" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    }) as typeof fetch;
    try {
      const supabase = {
        from: (table: string) => {
          calls.push(`from:${table}`);
          if (table === "refund_case_messages") {
            return singleRowQuery(claimedMessage(null));
          }
          if (table === "refund_cases") return singleRowQuery(currentCase);
          if (table === "refund_gmail_threads") {
            return singleRowQuery({
              id: "unrelated-later-gmail-thread",
              mailbox_hash: "synthetic-later-link-hash",
            });
          }
          throw new Error(`unexpected portal-completion table: ${table}`);
        },
        rpc: (name: string) => {
          calls.push(`rpc:${name}`);
          if (name === "service_mark_refund_manual_message_provider_attempt") {
            return Promise.resolve({
              data: { marked: true, replayed: false, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
            return Promise.resolve({
              data: { required: false, allowed: true, status: "not_required" },
              error: null,
            });
          }
          if (name === "service_authorize_refund_customer_outbound") {
            return Promise.resolve({
              data: {
                allowed: true,
                recipientResolutionStatus: "resolved",
                managerCcEmails: [],
                managerRecipientOverlap: false,
                managerRecipientCount: 1,
              },
              error: null,
            });
          }
          if (name === "service_mark_refund_transactional_delivery_attempt") {
            return Promise.resolve({
              data: { marked: true, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_bind_refund_transactional_delivery") {
            return Promise.resolve({
              data: { bound: true, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_finish_refund_manual_message_delivery") {
            return Promise.resolve({
              data: { finished: true, payloadRedacted: true },
              error: null,
            });
          }
          return Promise.resolve({
            data: null,
            error: { code: "unexpected_rpc" },
          });
        },
      } as never;

      const result = await deliverRefundManualMessageClaim({
        supabase,
        reference: { messageId, claimToken },
      });

      assertEquals(result.outcome, "sent");
      assertEquals(result.transport, "transactional_email");
      assertEquals(providerCalls, 1);
      assertEquals(providerIdempotencyKey, `refund-message-${messageId}`);
      assertEquals(
        calls.includes("rpc:service_claim_refund_gmail_outbound_v3"),
        false,
      );
      assertEquals(calls.includes("from:refund_gmail_threads"), false);
      assertEquals(
        calls.filter((call) =>
          call === "rpc:service_mark_refund_transactional_delivery_attempt"
        ).length,
        1,
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of before) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
    }
  });
});

Deno.test("manual question and completion delivery sends only to the customer and records zero manager copies", async () => {
  const values: Record<string, string> = {
    REFUND_GMAIL_ENABLED: "false",
    REFUND_CUSTOMER_FROM_EMAIL: "refunds@bloomjoysweets.com",
    REFUND_REPLY_TO_EMAIL: "refunds@bloomjoysweets.com",
    RESEND_API_KEY: "synthetic-resend-key",
  };
  const before = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    before.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  const originalFetch = globalThis.fetch;
  let providerPayload: Record<string, unknown> = {};
  let settledManagerCcCount: unknown = null;
  globalThis.fetch = ((_input, init) => {
    providerPayload = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(new Response(
      JSON.stringify({ id: "resend_provider_more_info_001" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
  }) as typeof fetch;
  try {
    for (const messageType of ["more_info", "completed"]) {
      providerPayload = {};
      settledManagerCcCount = null;
      const supabase = {
        from: (table: string) => {
          if (table === "refund_case_messages") {
            return singleRowQuery(claimedMessage(null, {
              message_type: messageType,
              delivery_kind: "manual",
              subject: "Update your refund request",
              body: "Please share the one missing detail.",
            }));
          }
          if (table === "refund_cases") return singleRowQuery(currentCase);
          if (table === "refund_gmail_threads") return singleRowQuery(null);
          throw new Error(`unexpected clarification table: ${table}`);
        },
        rpc: (name: string, args: Record<string, unknown>) => {
          if (name === "service_mark_refund_manual_message_provider_attempt") {
            return Promise.resolve({ data: { marked: true, payloadRedacted: true }, error: null });
          }
          if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
            return Promise.resolve({ data: { required: false, allowed: true }, error: null });
          }
          if (name === "service_authorize_refund_customer_outbound") {
            return Promise.resolve({
              data: {
                allowed: true,
                recipientResolutionStatus: "resolved",
                managerCcEmails: ["manager-a@example.test", "manager-b@example.test"],
                managerRecipientOverlap: false,
                managerRecipientCount: 2,
              },
              error: null,
            });
          }
          if (name === "service_mark_refund_transactional_delivery_attempt") {
            return Promise.resolve({ data: { marked: true, payloadRedacted: true }, error: null });
          }
          if (name === "service_bind_refund_transactional_delivery") {
            return Promise.resolve({ data: { bound: true, payloadRedacted: true }, error: null });
          }
          if (name === "service_finish_refund_manual_message_delivery") {
            settledManagerCcCount = args.p_manager_cc_count;
            return Promise.resolve({ data: { finished: true, payloadRedacted: true }, error: null });
          }
          throw new Error(`unexpected clarification RPC: ${name}`);
        },
      } as never;

      const result = await deliverRefundManualMessageClaim({
        supabase,
        reference: { messageId, claimToken },
      });

      assertEquals(result.outcome, "sent");
      assertEquals(result.managerCcCount, 0);
      assertEquals(settledManagerCcCount, 0);
      assertEquals(providerPayload.to, ["customer@example.invalid"]);
      assertEquals(providerPayload.cc, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of before) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});

Deno.test("mark-only automatic fallback cannot start transactional provider access after shutdown", async () => {
  await withAutomaticEnvironment("false", "false", async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    let providerCalls = 0;
    globalThis.fetch = (() => {
      providerCalls += 1;
      throw new Error("transactional provider access was not expected");
    }) as typeof fetch;
    try {
      const supabase = {
        from: (table: string) => {
          calls.push(`from:${table}`);
          if (table === "refund_case_messages") {
            return singleRowQuery(claimedMessage("2026-09-05T12:00:00Z"));
          }
          if (table === "refund_cases") return singleRowQuery(currentCase);
          return singleRowQuery(null);
        },
        rpc: (name: string) => {
          calls.push(`rpc:${name}`);
          if (name === "service_mark_refund_manual_message_provider_attempt") {
            return Promise.resolve({
              data: { marked: true, replayed: true, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
            return Promise.resolve({
              data: { required: false, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_authorize_refund_customer_outbound") {
            return Promise.resolve({
              data: {
                allowed: true,
                recipientResolutionStatus: "resolved",
                managerCcEmails: [],
                managerRecipientOverlap: false,
                managerRecipientCount: 1,
              },
              error: null,
            });
          }
          if (name === "service_finish_refund_manual_message_delivery") {
            return Promise.resolve({
              data: { finished: true, payloadRedacted: true },
              error: null,
            });
          }
          if (name === "service_defer_refund_automatic_completion_delivery") {
            return Promise.resolve({
              data: { deferred: true, payloadRedacted: true },
              error: null,
            });
          }
          return Promise.resolve({
            data: null,
            error: { code: "unexpected_rpc" },
          });
        },
      } as never;
      const result = await deliverRefundManualMessageClaim({
        supabase,
        reference: { messageId, claimToken },
      });
      assertEquals(result.outcome, "deferred");
      assertEquals(providerCalls, 0);
      assertEquals(calls.includes(
        "rpc:service_mark_refund_transactional_delivery_attempt",
      ), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("one uncontactable automatic claim does not abort a later valid claim", async () => {
  await withAutomaticEnvironment("true", "true", async () => {
    const delivered: string[] = [];
    const clientFor = (valid: boolean) => ({
      from: (table: string) => {
        if (table === "refund_case_messages") {
          return singleRowQuery(valid
            ? claimedMessage("2026-09-05T12:00:00Z", {
              id: secondMessageId,
              manual_delivery_claim_token: secondClaimToken,
              delivery_transport: "resend",
              provider_message_id: "provider_message_456",
              delivery_state: "accepted",
              delivery_state_updated_at: "2026-09-05T12:00:01Z",
            })
            : claimedMessage(null));
        }
        if (table === "refund_cases") return singleRowQuery(currentCase);
        return singleRowQuery(null);
      },
      rpc: (name: string) => {
        if (name === "service_mark_refund_manual_message_provider_attempt") {
          return Promise.resolve({
            data: { marked: true, replayed: false, payloadRedacted: true },
            error: null,
          });
        }
        if (name === "service_verify_refund_synthetic_gmail_proof_transport") {
          return Promise.resolve({
            data: { required: false, payloadRedacted: true },
            error: null,
          });
        }
        if (name === "service_authorize_refund_customer_outbound") {
          return Promise.resolve({
            data: {
              allowed: false,
              status: "manager_cc_required",
              recipientResolutionStatus: "uncontactable",
            },
            error: null,
          });
        }
        if (name === "service_finish_refund_manual_message_delivery") {
          return Promise.resolve({
            data: { finished: true, payloadRedacted: true },
            error: null,
          });
        }
        return Promise.resolve({
          data: null,
          error: { code: "unexpected_rpc" },
        });
      },
    }) as never;
    const results = await drainRefundManualMessageOutbox({
      supabase: {
        rpc: () =>
          Promise.resolve({
            data: [
              { refund_case_message_id: messageId, claim_token: claimToken },
              {
                refund_case_message_id: secondMessageId,
                claim_token: secondClaimToken,
              },
            ],
            error: null,
          }),
      } as never,
      deliverClaim: ({ reference }) => {
        delivered.push(reference.messageId);
        return deliverRefundManualMessageClaim({
          supabase: clientFor(reference.messageId === secondMessageId),
          reference,
        });
      },
    });
    assertEquals(delivered, [messageId, secondMessageId]);
    assertEquals(results.map((result) => result.outcome), ["failed", "sent"]);
  });
});

Deno.test("an unknown delivery settlement error still stops the batch", async () => {
  let attempts = 0;
  const unsettledClient = {
    from: (table: string) =>
      singleRowQuery(
        table === "refund_case_messages"
          ? claimedMessage("2026-09-05T12:00:00Z", {
            delivery_transport: "resend",
            provider_message_id: null,
            delivery_state: "unknown",
            delivery_state_updated_at: "2026-09-05T12:00:01Z",
          })
          : currentCase,
      ),
    rpc: (name: string) => name ===
        "service_mark_refund_manual_message_provider_attempt"
      ? Promise.resolve({
        data: { marked: true, replayed: true, payloadRedacted: true },
        error: null,
      })
      : Promise.resolve({
        data: null,
        error: { code: "settlement_unavailable" },
      }),
  } as never;
  await assertRejects(
    () =>
      drainRefundManualMessageOutbox({
        supabase: {
          rpc: () =>
            Promise.resolve({
              data: [
                { refund_case_message_id: messageId, claim_token: claimToken },
                {
                  refund_case_message_id: secondMessageId,
                  claim_token: secondClaimToken,
                },
              ],
              error: null,
            }),
        } as never,
        deliverClaim: ({ reference }) => {
          attempts += 1;
          return deliverRefundManualMessageClaim({
            supabase: unsettledClient,
            reference,
          });
        },
      }),
    Error,
    "could not be recorded",
  );
  assertEquals(attempts, 1);
});
