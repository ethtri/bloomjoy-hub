// deno-lint-ignore-file no-import-prefix require-await
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { automaticRefundCustomerContactEnabled } from "../../supabase/functions/_shared/refund-deterministic-follow-up.ts";
import { buildRefundFirstContactEmail } from "../../supabase/functions/_shared/refund-first-contact.ts";
import { dispatchRefundCaseGmailReply } from "../../supabase/functions/_shared/refund-gmail-transport.ts";
import {
  claimRefundGmailDeliveryWhenEnabled,
  parseEmailAddressList,
  REFUND_GMAIL_DISABLED_CODE,
  REFUND_GMAIL_DISABLED_MESSAGE,
  type RefundGmailConfig,
  refundGmailEnabled,
  RefundGmailError,
  requireRefundGmailEnabled,
  sendRefundGmailReply,
} from "../../supabase/functions/_shared/refund-gmail.ts";
import { requireRefundCustomerManagerCcResolution } from "../../supabase/functions/_shared/refund-gmail-transport.ts";

const SYNTHETIC_ENV = {
  GMAIL_SUPPORT_CLIENT_ID: "synthetic-client-id",
  GMAIL_SUPPORT_CLIENT_SECRET: "synthetic-client-secret",
  GMAIL_SUPPORT_REFRESH_TOKEN: "synthetic-refresh-token",
  GMAIL_SUPPORT_MAILBOX: "info@bloomjoysweets.com",
  GMAIL_SUPPORT_SEND_AS_ALIASES: "support@bloomjoysweets.com",
  GMAIL_REFUND_LABEL_ID: "Label_Synthetic",
};

const FIRST_CONTACT_FIXTURE = {
  providerThreadId: "first-contact-cc-thread-one",
  sourceProviderMessageId: "first-contact-cc-message-one",
  laterProviderMessageId: "first-contact-cc-message-later",
  sourceMessageHeader: "<first-contact-cc-message-one@example.test>",
  priorMessageHeader: "<prior-first-contact@example.test>",
  customerEmail: "first-contact-customer-one@example.test",
  managers: [
    "first-contact-manager-a@example.test",
    "first-contact-manager-b@example.test",
  ],
  sourceRecordId: "79850000-0000-4000-8000-000000000011",
  laterRecordId: "79850000-0000-4000-8000-000000000012",
  operationId: "79870000-0000-4000-8000-000000000011",
  operationKey: "refund-first-contact:first-contact-cc-thread-one",
};

const gmailConfig: RefundGmailConfig = {
  clientId: SYNTHETIC_ENV.GMAIL_SUPPORT_CLIENT_ID,
  clientSecret: SYNTHETIC_ENV.GMAIL_SUPPORT_CLIENT_SECRET,
  refreshToken: SYNTHETIC_ENV.GMAIL_SUPPORT_REFRESH_TOKEN,
  mailbox: SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX,
  mailboxIdentities: [
    SYNTHETIC_ENV.GMAIL_SUPPORT_MAILBOX,
    SYNTHETIC_ENV.GMAIL_SUPPORT_SEND_AS_ALIASES,
  ],
  labelId: SYNTHETIC_ENV.GMAIL_REFUND_LABEL_ID,
  startAt: new Date("2026-08-03T00:00:00Z"),
};

const email = buildRefundFirstContactEmail({
  publicReference: "RF-SYNTHETIC1",
  customerName: "Synthetic Customer One",
  refundRequestUrl: "https://www.bloomjoyusa.com/refunds/request",
  legacyRefundUrl: "https://forms.gle/synthetic-test",
  supportUrl: "https://www.bloomjoyusa.com/resources#support-boundaries",
});

const withEnvironment = async <T>(
  values: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> => {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
};

const withFetch = async <T>(
  replacement: typeof fetch,
  run: () => Promise<T>,
): Promise<T> => {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

class FakeLinkQuery {
  constructor(private readonly link: Record<string, unknown> | null) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    return { data: this.link, error: null };
  }
}

const fakeSupabase = ({
  link,
  rpc,
}: {
  link: Record<string, unknown> | null;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: null;
  }>;
}) => ({
  from: () => new FakeLinkQuery(link),
  rpc,
});

const decodeRawMime = (raw: string) => {
  const normalized = raw.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return new TextDecoder().decode(
    Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)),
  );
};

const headerValue = (mime: string, name: string) =>
  mime.match(new RegExp(`^${name}:\\s*(.+)$`, "mi"))?.[1]?.trim() ?? "";

const captureRefundGmailError = async (run: () => Promise<unknown>) => {
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof RefundGmailError);
  return caught;
};

const runKillSwitchAssertions = async () => {
  const gmailOutbound = await withEnvironment(
    {
      ...SYNTHETIC_ENV,
      REFUND_GMAIL_ENABLED: "false",
      REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "true",
    },
    async () => {
      let deliveryClaimCount = 0;
      let firstContactClaimCount = 0;
      let providerFetchCount = 0;
      let providerSendCount = 0;
      const supabase = fakeSupabase({
        link: {
          id: "synthetic-linked-thread",
          mailbox_hash: "not-read-while-disabled",
        },
        rpc: async (name) => {
          if (name === "service_claim_refund_gmail_outbound_v3") {
            deliveryClaimCount += 1;
          }
          return { data: null, error: null };
        },
      });

      await withFetch(
        async (input) => {
          providerFetchCount += 1;
          if (String(input).includes("/messages/send")) providerSendCount += 1;
          throw new Error("disabled Gmail transport attempted provider access");
        },
        async () => {
          const firstContactError = await captureRefundGmailError(() =>
            claimRefundGmailDeliveryWhenEnabled(async () => {
              firstContactClaimCount += 1;
              return { claimed: true };
            })
          );
          assertEquals(firstContactError.code, REFUND_GMAIL_DISABLED_CODE);

          const dispatchError = await captureRefundGmailError(() =>
            dispatchRefundCaseGmailReply({
              supabase: supabase as never,
              refundCaseId: "79850000-0000-4000-8000-000000000021",
              refundCaseMessageId: "79860000-0000-4000-8000-000000000021",
              recipientEmail: FIRST_CONTACT_FIXTURE.customerEmail,
              email,
              deliveryKind: "manual",
              gmailThreadId: "synthetic-linked-thread",
            })
          );
          assertEquals(dispatchError.code, REFUND_GMAIL_DISABLED_CODE);
          assertEquals(dispatchError.message, REFUND_GMAIL_DISABLED_MESSAGE);

          const directSendError = await captureRefundGmailError(() =>
            sendRefundGmailReply({
              config: gmailConfig,
              providerThreadId: FIRST_CONTACT_FIXTURE.providerThreadId,
              operationKey: FIRST_CONTACT_FIXTURE.operationKey,
              recipientEmail: FIRST_CONTACT_FIXTURE.customerEmail,
              ccEmails: FIRST_CONTACT_FIXTURE.managers,
              deliveryKind: "automatic",
              subject: email.subject,
              text: email.text,
              html: email.html,
              inReplyTo: FIRST_CONTACT_FIXTURE.sourceMessageHeader,
              references:
                `${FIRST_CONTACT_FIXTURE.priorMessageHeader} ${FIRST_CONTACT_FIXTURE.sourceMessageHeader}`,
            })
          );
          assertEquals(directSendError.code, REFUND_GMAIL_DISABLED_CODE);
        },
      );

      const disabled = !refundGmailEnabled();
      assert(disabled);
      assertEquals(deliveryClaimCount, 0);
      assertEquals(firstContactClaimCount, 0);
      assertEquals(providerFetchCount, 0);
      assertEquals(providerSendCount, 0);
      return {
        disabled,
        deliveryClaimCount,
        firstContactClaimCount,
        providerFetchCount,
        providerSendCount,
      };
    },
  );

  const customerContact = await withEnvironment(
    {
      ...SYNTHETIC_ENV,
      REFUND_GMAIL_ENABLED: "true",
      REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "false",
    },
    async () => {
      let deliveryClaimCount = 0;
      let providerFetchCount = 0;
      let providerSendCount = 0;
      const supabase = fakeSupabase({
        link: {
          id: "synthetic-linked-thread",
          mailbox_hash: "not-read-while-customer-contact-disabled",
        },
        rpc: async (name) => {
          if (name === "service_claim_refund_gmail_outbound_v3") {
            deliveryClaimCount += 1;
          }
          return { data: null, error: null };
        },
      });

      await withFetch(
        async (input) => {
          providerFetchCount += 1;
          if (String(input).includes("/messages/send")) providerSendCount += 1;
          throw new Error(
            "disabled customer contact attempted provider access",
          );
        },
        async () => {
          const contactError = await captureRefundGmailError(() =>
            dispatchRefundCaseGmailReply({
              supabase: supabase as never,
              refundCaseId: "79850000-0000-4000-8000-000000000022",
              refundCaseMessageId: "79860000-0000-4000-8000-000000000022",
              recipientEmail: FIRST_CONTACT_FIXTURE.customerEmail,
              email,
              deliveryKind: "automatic",
              gmailThreadId: "synthetic-linked-thread",
            })
          );
          assertEquals(contactError.code, "automatic_contact_disabled");
        },
      );

      const disabled = !automaticRefundCustomerContactEnabled();
      assert(disabled);
      assertEquals(deliveryClaimCount, 0);
      assertEquals(providerFetchCount, 0);
      assertEquals(providerSendCount, 0);
      return {
        disabled,
        deliveryClaimCount,
        providerFetchCount,
        providerSendCount,
      };
    },
  );

  return {
    schemaVersion: 2,
    evidenceType: "gmail_kill_switch_fragment",
    evidenceMode: "synthetic_executable_transport",
    executableCoverage: {
      gmailOutbound: true,
      customerContact: true,
      managerAging: false,
      intakeAvailability: false,
      portalAvailability: false,
    },
    switches: {
      gmailOutbound,
      customerContact,
    },
    requiresIntegrationAggregation: true,
  };
};

const assertSqlFixtureAlignment = async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../supabase/tests/refund_gmail_first_contact_manager_cc.sql",
      import.meta.url,
    ),
  );
  for (
    const expected of [
      FIRST_CONTACT_FIXTURE.providerThreadId,
      FIRST_CONTACT_FIXTURE.sourceProviderMessageId,
      FIRST_CONTACT_FIXTURE.laterProviderMessageId,
      FIRST_CONTACT_FIXTURE.sourceMessageHeader,
      FIRST_CONTACT_FIXTURE.priorMessageHeader,
      FIRST_CONTACT_FIXTURE.customerEmail,
      ...FIRST_CONTACT_FIXTURE.managers,
      "service_claim_refund_gmail_first_contact",
      "service_prepare_refund_gmail_first_contact_delivery",
      "service_finish_refund_gmail_first_contact",
      "operation_already_exists",
      "later_thread_message",
      "exactly one case, thread, acknowledgement operation, and sent outbound message",
    ]
  ) {
    assert(
      sql.includes(expected),
      `SQL first-contact fixture drifted: ${expected}`,
    );
  }
};

const runFirstContactMimeAssertions = async () => {
  await assertSqlFixtureAlignment();
  return await withEnvironment(
    {
      ...SYNTHETIC_ENV,
      REFUND_GMAIL_ENABLED: "true",
      REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED: "true",
    },
    async () => {
      let providerFetchCount = 0;
      let providerSendCount = 0;
      let firstContactOperationCount = 0;
      let firstContactPrepareCount = 0;
      let firstContactFinalizeCount = 0;
      let sentOutboundCount = 0;
      let claimAttemptCount = 0;
      let providerRequest: Record<string, unknown> = {};
      const rpcCalls: string[] = [];

      const rpc = async <T>(
        name: string,
        args: Record<string, unknown>,
      ): Promise<T> => {
        rpcCalls.push(name);
        if (name === "service_resolve_refund_customer_manager_cc") {
          return {
            status: "resolved",
            managerCcEmails: FIRST_CONTACT_FIXTURE.managers,
          } as T;
        }
        if (name === "service_claim_refund_gmail_first_contact") {
          claimAttemptCount += 1;
          if (
            args.p_source_message_id === FIRST_CONTACT_FIXTURE.sourceRecordId
          ) {
            if (claimAttemptCount === 1) {
              firstContactOperationCount += 1;
              return {
                eligible: true,
                claimed: true,
                operationId: FIRST_CONTACT_FIXTURE.operationId,
                operationKey: FIRST_CONTACT_FIXTURE.operationKey,
                providerThreadId: FIRST_CONTACT_FIXTURE.providerThreadId,
                recipientEmail: FIRST_CONTACT_FIXTURE.customerEmail,
                subject: email.subject,
                inReplyTo: FIRST_CONTACT_FIXTURE.sourceMessageHeader,
                references:
                  `${FIRST_CONTACT_FIXTURE.priorMessageHeader} ${FIRST_CONTACT_FIXTURE.sourceMessageHeader}`,
              } as T;
            }
            return {
              eligible: true,
              claimed: false,
              reason: "operation_already_exists",
              status: "sent",
            } as T;
          }
          assertEquals(
            args.p_source_message_id,
            FIRST_CONTACT_FIXTURE.laterRecordId,
          );
          return {
            eligible: false,
            claimed: false,
            reason: "later_thread_message",
          } as T;
        }
        if (name === "service_prepare_refund_gmail_first_contact_delivery") {
          firstContactPrepareCount += 1;
          assertEquals(
            args.p_operation_id,
            FIRST_CONTACT_FIXTURE.operationId,
          );
          return {
            status: "resolved",
            managerCcEmails: FIRST_CONTACT_FIXTURE.managers,
          } as T;
        }
        if (name === "service_finish_refund_gmail_first_contact") {
          firstContactFinalizeCount += 1;
          assertEquals(args.p_operation_id, FIRST_CONTACT_FIXTURE.operationId);
          assertEquals(args.p_status, "sent");
          assert(typeof args.p_provider_message_id === "string");
          assert(typeof args.p_provider_message_header === "string");
          sentOutboundCount += 1;
          return true as T;
        }
        throw new Error(`Unexpected first-contact RPC: ${name}`);
      };

      await withFetch(
        async (input, init) => {
          providerFetchCount += 1;
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.href
            : input.url;
          if (url.includes("oauth2.googleapis.com/token")) {
            return new Response(
              JSON.stringify({
                access_token: "synthetic-access-token",
                expires_in: 3600,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (
            url.includes("gmail.googleapis.com/gmail/v1/users/me/messages/send")
          ) {
            providerSendCount += 1;
            providerRequest = JSON.parse(String(init?.body ?? "{}"));
            return new Response(
              JSON.stringify({
                id: "synthetic-first-contact-provider-send",
                threadId: FIRST_CONTACT_FIXTURE.providerThreadId,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          throw new Error("Unexpected synthetic provider URL");
        },
        async () => {
          requireRefundGmailEnabled();
          const initialResolution = await rpc<Record<string, unknown>>(
            "service_resolve_refund_customer_manager_cc",
            {
              p_refund_case_id: "79850000-0000-4000-8000-000000000031",
              p_customer_email: FIRST_CONTACT_FIXTURE.customerEmail,
              p_mailbox_identities: gmailConfig.mailboxIdentities,
            },
          );
          requireRefundCustomerManagerCcResolution({
            resolution: initialResolution,
            customerEmail: FIRST_CONTACT_FIXTURE.customerEmail,
            mailboxIdentities: gmailConfig.mailboxIdentities,
          });

          const claim = await claimRefundGmailDeliveryWhenEnabled(() =>
            rpc<Record<string, unknown>>(
              "service_claim_refund_gmail_first_contact",
              {
                p_source_message_id: FIRST_CONTACT_FIXTURE.sourceRecordId,
                p_mode: "active",
                p_template_key: "refund_first_contact_v1",
                p_sender_email: gmailConfig.mailbox,
                p_plain_body: email.text,
                p_thread_has_outbound: false,
              },
            )
          );
          assertEquals(claim.claimed, true);

          const prepared = await rpc<Record<string, unknown>>(
            "service_prepare_refund_gmail_first_contact_delivery",
            {
              p_operation_id: claim.operationId,
              p_mailbox_identities: gmailConfig.mailboxIdentities,
            },
          );
          const managerResolution = requireRefundCustomerManagerCcResolution({
            resolution: prepared,
            customerEmail: String(claim.recipientEmail),
            mailboxIdentities: gmailConfig.mailboxIdentities,
          });
          const sent = await sendRefundGmailReply({
            config: gmailConfig,
            providerThreadId: String(claim.providerThreadId),
            operationKey: String(claim.operationKey),
            recipientEmail: String(claim.recipientEmail),
            ccEmails: managerResolution.managerCcEmails,
            deliveryKind: "automatic",
            subject: String(claim.subject),
            text: email.text,
            html: email.html,
            inReplyTo: String(claim.inReplyTo),
            references: String(claim.references),
          });
          const finalized = await rpc<boolean>(
            "service_finish_refund_gmail_first_contact",
            {
              p_operation_id: claim.operationId,
              p_status: "sent",
              p_provider_message_id: sent.providerMessageId,
              p_provider_message_header: sent.providerMessageHeader,
              p_error_code: null,
            },
          );
          assert(finalized);

          const replay = await claimRefundGmailDeliveryWhenEnabled(() =>
            rpc<Record<string, unknown>>(
              "service_claim_refund_gmail_first_contact",
              { p_source_message_id: FIRST_CONTACT_FIXTURE.sourceRecordId },
            )
          );
          assertEquals(replay.claimed, false);
          assertEquals(replay.reason, "operation_already_exists");

          const laterReply = await claimRefundGmailDeliveryWhenEnabled(() =>
            rpc<Record<string, unknown>>(
              "service_claim_refund_gmail_first_contact",
              { p_source_message_id: FIRST_CONTACT_FIXTURE.laterRecordId },
            )
          );
          assertEquals(laterReply.claimed, false);
          assertEquals(laterReply.reason, "later_thread_message");
        },
      );

      const raw = typeof providerRequest.raw === "string"
        ? providerRequest.raw
        : "";
      const mime = decodeRawMime(raw);
      const toRecipients = parseEmailAddressList(headerValue(mime, "To"));
      const ccRecipients = parseEmailAddressList(headerValue(mime, "Cc"));
      const mailboxIdentities = new Set(gmailConfig.mailboxIdentities);
      const managers = new Set(FIRST_CONTACT_FIXTURE.managers);
      const sourceThreadPinned = providerRequest.threadId ===
        FIRST_CONTACT_FIXTURE.providerThreadId;
      const replyHeadersPresent = headerValue(mime, "In-Reply-To") ===
          FIRST_CONTACT_FIXTURE.sourceMessageHeader &&
        headerValue(mime, "References") ===
          `${FIRST_CONTACT_FIXTURE.priorMessageHeader} ${FIRST_CONTACT_FIXTURE.sourceMessageHeader}`;
      const automaticHeadersPresent =
        headerValue(mime, "Auto-Submitted") === "auto-generated" &&
        headerValue(mime, "X-Auto-Response-Suppress") === "All";
      const internalLinkCount = (
        `${email.subject}\n${email.text}\n${email.html}\n${mime}`.match(
          /\/refunds\?case=/gi,
        ) ?? []
      ).length;
      const duplicateMessageCount = Math.max(0, providerSendCount - 1);
      const replaySuppressed = claimAttemptCount >= 2 &&
        providerSendCount === 1;
      const laterReplySuppressed = claimAttemptCount >= 3 &&
        providerSendCount === 1;

      assertEquals(toRecipients, [FIRST_CONTACT_FIXTURE.customerEmail]);
      assertEquals(ccRecipients, FIRST_CONTACT_FIXTURE.managers);
      assert(sourceThreadPinned);
      assert(replyHeadersPresent);
      assert(automaticHeadersPresent);
      assertEquals(internalLinkCount, 0);
      assertEquals(providerSendCount, 1);
      assertEquals(firstContactOperationCount, 1);
      assertEquals(firstContactPrepareCount, 1);
      assertEquals(firstContactFinalizeCount, 1);
      assertEquals(sentOutboundCount, 1);
      assertEquals(duplicateMessageCount, 0);
      assert(replaySuppressed);
      assert(laterReplySuppressed);
      assertEquals(rpcCalls, [
        "service_resolve_refund_customer_manager_cc",
        "service_claim_refund_gmail_first_contact",
        "service_prepare_refund_gmail_first_contact_delivery",
        "service_finish_refund_gmail_first_contact",
        "service_claim_refund_gmail_first_contact",
        "service_claim_refund_gmail_first_contact",
      ]);

      return {
        schemaVersion: 2,
        evidenceType: "gmail_mime_roles",
        evidenceMode: "synthetic_executable_first_contact",
        roleCounts: {
          customerTo:
            toRecipients.filter((recipient) =>
              recipient === FIRST_CONTACT_FIXTURE.customerEmail
            ).length,
          managerCc: ccRecipients.filter((recipient) => managers.has(recipient))
            .length,
          mailboxTo:
            toRecipients.filter((recipient) => mailboxIdentities.has(recipient))
              .length,
          unrelatedTo:
            toRecipients.filter((recipient) =>
              recipient !== FIRST_CONTACT_FIXTURE.customerEmail &&
              !mailboxIdentities.has(recipient)
            ).length,
          unrelatedCc:
            ccRecipients.filter((recipient) => !managers.has(recipient)).length,
        },
        managerCcCount: ccRecipients.length,
        sourceThreadPinned,
        replyHeadersPresent,
        automaticHeadersPresent,
        internalLinkCount,
        providerFetchCount,
        providerSendCount,
        firstContactOperationCount,
        firstContactPrepareCount,
        firstContactFinalizeCount,
        sentOutboundCount,
        duplicateMessageCount,
        replaySuppressed,
        laterReplySuppressed,
      };
    },
  );
};

const collectStringValues = (value: unknown, values: string[] = []) => {
  if (typeof value === "string") values.push(value);
  else if (Array.isArray(value)) {
    for (const entry of value) collectStringValues(entry, values);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, values);
    }
  }
  return values;
};

const assertEvidenceIsSanitized = (evidence: unknown) => {
  const serialized = JSON.stringify(evidence);
  assert(!serialized.includes("@"), "Evidence must not contain addresses");
  assert(!/https?:\/\//i.test(serialized), "Evidence must not contain URLs");
  assert(
    !/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
      .test(serialized),
    "Evidence must not contain UUIDs",
  );
  assert(
    !/\b\d{12,19}\b/.test(serialized),
    "Evidence must not contain payment-like digits",
  );
  const allowedStrings = new Set([
    "gmail_mime_roles",
    "synthetic_executable_first_contact",
    "gmail_kill_switch_fragment",
    "synthetic_executable_transport",
  ]);
  assert(
    collectStringValues(evidence).every((value) => allowedStrings.has(value)),
    "Evidence must contain only enumerated schema strings, counts, and booleans",
  );
  assert(
    new TextEncoder().encode(serialized).byteLength < 16 * 1024,
    "Evidence must remain below 16 KiB",
  );
};

const parseEvidenceDirectory = () => {
  if (Deno.args.length === 0) return null;
  if (
    Deno.args.length !== 2 || Deno.args[0] !== "--evidence-dir" ||
    !Deno.args[1]?.trim()
  ) {
    throw new Error("Usage: --evidence-dir <artifact-directory>");
  }
  return Deno.args[1].trim();
};

const requireFreshEvidenceTargets = async (paths: string[]) => {
  for (const path of paths) {
    try {
      await Deno.stat(path);
      throw new Error(
        `Refusing to overwrite an existing evidence file: ${path}`,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
};

export const runRefundGmailEvidenceHarness = async () => {
  const killSwitchAssertions = await runKillSwitchAssertions();
  const mimeRoleAssertions = await runFirstContactMimeAssertions();
  assertEvidenceIsSanitized(killSwitchAssertions);
  assertEvidenceIsSanitized(mimeRoleAssertions);
  return {
    killSwitchEvidence: { ...killSwitchAssertions, passed: true },
    mimeRoleEvidence: { ...mimeRoleAssertions, passed: true },
  };
};

if (import.meta.main) {
  const evidenceDirectory = parseEvidenceDirectory();
  const { killSwitchEvidence, mimeRoleEvidence } =
    await runRefundGmailEvidenceHarness();
  if (evidenceDirectory) {
    await Deno.mkdir(evidenceDirectory, { recursive: true });
    const mimeEvidencePath = join(
      evidenceDirectory,
      "refund-gmail-mime-roles.json",
    );
    const killEvidencePath = join(
      evidenceDirectory,
      "refund-gmail-kill-fragment.json",
    );
    await requireFreshEvidenceTargets([mimeEvidencePath, killEvidencePath]);
    await Deno.writeTextFile(
      mimeEvidencePath,
      `${JSON.stringify(mimeRoleEvidence, null, 2)}\n`,
      { createNew: true },
    );
    await Deno.writeTextFile(
      killEvidencePath,
      `${JSON.stringify(killSwitchEvidence, null, 2)}\n`,
      { createNew: true },
    );
    console.log(
      "Executable Gmail assertions passed; wrote two sanitized evidence files.",
    );
  } else {
    console.log(
      "Executable Gmail evidence assertions passed; no artifact directory requested.",
    );
  }
}
