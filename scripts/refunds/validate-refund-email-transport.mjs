import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

const transport = await read("supabase/functions/_shared/refund-customer-transport.ts");
const refundEmail = await read("supabase/functions/_shared/refund-email.ts");
const gmail = await read("supabase/functions/_shared/refund-gmail.ts");
const runbook = await read("Docs/REFUND_CUSTOMER_MESSAGES_RUNBOOK.md");

assert.match(
  transport,
  /REFUND_CUSTOMER_SENDER_NAME = "Bloomjoy Refunds"/,
  "customer-visible refund sender name must remain stable",
);
assert.match(
  transport,
  /REFUND_MONITORED_REPLY_TO_EMAIL = "info@bloomjoysweets\.com"/,
  "customer replies must stay on the monitored mailbox",
);
assert.match(
  refundEmail,
  /configured && configured !== REFUND_MONITORED_REPLY_TO_EMAIL/,
  "a mismatched configured Reply-To must fail closed",
);
assert.match(
  refundEmail,
  /replyTo: getRefundReplyToEmail\(\)[\s\S]*senderName: REFUND_CUSTOMER_SENDER_NAME/,
  "transactional customer mail must bind the monitored Reply-To and sender name",
);
assert.match(
  gmail,
  /formatRefundCustomerSender\(from\)/,
  "Gmail customer mail must standardize the sender name without changing the mailbox",
);

for (const path of [
  "supabase/functions/refund-case-intake/index.ts",
  "supabase/functions/refund-case-message-send/index.ts",
  "supabase/functions/refund-nayax-outcome-resolve/index.ts",
  "supabase/functions/_shared/refund-nayax-customer-correction.ts",
]) {
  const source = await read(path);
  assert.match(
    source,
    /sendRefundTransactionalEmail/,
    `${path} must use the refund-specific transactional transport`,
  );
  assert.doesNotMatch(
    source,
    /sendTransactionalEmail/,
    `${path} must not bypass the refund-specific transport`,
  );
}

for (const requiredText of [
  "Bloomjoy Refunds <info@bloomjoysweets.com>",
  "Reply-To: info@bloomjoysweets.com",
  "No transactional fallback",
  "Completion receipt",
  "Denial",
  "Appeal receipt",
  "Manager notice",
]) {
  assert.ok(
    runbook.includes(requiredText),
    `transport matrix must include: ${requiredText}`,
  );
}

console.log(
  "Refund email transport validation passed: customer mail uses the Bloomjoy Refunds identity, preserves Gmail threads or the verified transactional sender, routes replies to info@bloomjoysweets.com, and cannot fall through to a second transport.",
);
