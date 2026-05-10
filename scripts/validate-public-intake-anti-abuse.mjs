import { readFileSync } from 'node:fs';

const files = {
  helper: 'supabase/functions/_shared/public-intake-abuse-controls.ts',
  intakeFunction: 'supabase/functions/lead-submission-intake/index.ts',
  refundIntakeFunction: 'supabase/functions/refund-case-intake/index.ts',
  migration: 'supabase/migrations/202604290003_public_intake_anti_abuse.sql',
  globalKeyMigration: 'supabase/migrations/202604290004_public_intake_global_key_type.sql',
  refundMigration: 'supabase/migrations/202605090001_refund_operations_mvp.sql',
};

const read = (path) => readFileSync(path, 'utf8');

const helper = read(files.helper);
const intakeFunction = read(files.intakeFunction);
const refundIntakeFunction = read(files.refundIntakeFunction);
const migration = read(files.migration);
const globalKeyMigration = read(files.globalKeyMigration);
const refundMigration = read(files.refundMigration);

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const extractLimit = (scope, keyType) => {
  const pattern = new RegExp(
    `eventScope:\\s*"${scope}"[\\s\\S]*?keyType:\\s*"${keyType}"[\\s\\S]*?maxCount:\\s*(\\d+)`
  );
  const match = helper.match(pattern);
  assert(match, `Missing ${scope}/${keyType} anti-abuse limit.`);
  return Number(match[1]);
};

const simulateRepeatedPosts = (limit) => {
  let firstBlockedAttempt = null;
  for (let attempt = 1; attempt <= limit + 2; attempt += 1) {
    if (attempt > limit && firstBlockedAttempt === null) {
      firstBlockedAttempt = attempt;
    }
  }
  return firstBlockedAttempt;
};

const submissionIpLimit = extractLimit('submission', 'ip');
const submissionEmailLimit = extractLimit('submission', 'email');
const submissionGlobalLimit = extractLimit('submission', 'global');
const notificationEmailLimit = extractLimit('notification', 'email');
const notificationGlobalLimit = extractLimit('notification', 'global');

assert(
  simulateRepeatedPosts(submissionIpLimit) === submissionIpLimit + 1,
  'Repeated direct POST simulation did not trip the IP submission throttle.'
);
assert(
  simulateRepeatedPosts(submissionEmailLimit) === submissionEmailLimit + 1,
  'Repeated direct POST simulation did not trip the email submission throttle.'
);
assert(
  simulateRepeatedPosts(notificationEmailLimit) === notificationEmailLimit + 1,
  'Repeated quote notification simulation did not trip the email notification quota.'
);
assert(
  simulateRepeatedPosts(submissionGlobalLimit) === submissionGlobalLimit + 1,
  'Repeated direct POST simulation did not trip the non-caller-controlled global submission throttle.'
);
assert(
  simulateRepeatedPosts(notificationGlobalLimit) === notificationGlobalLimit + 1,
  'Repeated quote notification simulation did not trip the non-caller-controlled global notification quota.'
);

const handlerStartIndex = intakeFunction.indexOf('serve(async (req) => {');
assert(handlerStartIndex > -1, 'Could not find lead intake request handler.');

const requestHandler = intakeFunction.slice(handlerStartIndex);
const insertIndex = requestHandler.search(/\.from\("lead_submissions"\)\s*\.insert\(\{/);
const submissionLimitIndex = requestHandler.indexOf('rules: PUBLIC_INTAKE_SUBMISSION_LIMITS');
const notificationLimitIndex = requestHandler.indexOf('rules: PUBLIC_INTAKE_NOTIFICATION_LIMITS');
const sendInternalEmailIndex = requestHandler.indexOf('sendInternalEmail({');

assert(insertIndex > -1, 'Could not find lead_submissions insert path.');
assert(submissionLimitIndex > -1, 'Missing submission throttle wiring.');
assert(
  submissionLimitIndex < insertIndex,
  'Submission throttle must run before lead_submissions persistence.'
);
assert(notificationLimitIndex > -1, 'Missing notification quota wiring.');
assert(sendInternalEmailIndex > -1, 'Could not find internal email dispatch path.');
assert(
  notificationLimitIndex < sendInternalEmailIndex,
  'Notification quota must run before internal email dispatch.'
);
assert(
  intakeFunction.includes('req.body?.getReader()'),
  'Body size enforcement must stream the request body instead of trusting Content-Length alone.'
);
assert(
  intakeFunction.includes('internallyNotifiedSubmissionTypes.has(leadSubmission.submission_type)'),
  'Notification eligibility must use the persisted lead type, not the current request type.'
);
assert(
  intakeFunction.includes('server_dedupe_key'),
  'Missing server-side dedupe key on public intake insert.'
);
assert(
  !intakeFunction.includes('console.error("lead-submission-intake error", error)'),
  'Intake errors should not log raw error objects that may include private payload context.'
);

const refundHandlerStartIndex = refundIntakeFunction.indexOf('serve(async (req) => {');
assert(refundHandlerStartIndex > -1, 'Could not find refund intake request handler.');

const refundRequestHandler = refundIntakeFunction.slice(refundHandlerStartIndex);
const refundInsertIndex = refundRequestHandler.search(/\.from\("refund_cases"\)\s*\.insert\(\{/);
const refundSubmissionLimitIndex = refundRequestHandler.indexOf('rules: PUBLIC_INTAKE_SUBMISSION_LIMITS');
const refundNotificationLimitIndex = refundRequestHandler.indexOf('rules: PUBLIC_INTAKE_NOTIFICATION_LIMITS');
const refundSendEmailIndex = refundRequestHandler.indexOf('sendTransactionalEmail({');
const refundPrepareAttachmentsIndex = refundRequestHandler.indexOf('prepareAttachments(rawAttachments)');
const refundServerDedupeIndex = refundRequestHandler.indexOf('serverDedupeKey');

assert(refundInsertIndex > -1, 'Could not find refund_cases insert path.');
assert(refundSubmissionLimitIndex > -1, 'Missing refund submission throttle wiring.');
assert(
  refundSubmissionLimitIndex < refundInsertIndex,
  'Refund submission throttle must run before refund_cases persistence.'
);
assert(refundPrepareAttachmentsIndex > -1, 'Missing refund attachment pre-validation call.');
assert(
  refundPrepareAttachmentsIndex < refundInsertIndex,
  'Refund attachments must be pre-validated before refund_cases persistence.'
);
assert(refundServerDedupeIndex > -1, 'Missing refund server-side dedupe key.');
assert(
  refundServerDedupeIndex < refundInsertIndex,
  'Refund server-side dedupe key must be built before refund_cases persistence.'
);
assert(refundNotificationLimitIndex > -1, 'Missing refund notification quota wiring.');
assert(refundSendEmailIndex > -1, 'Could not find refund customer email dispatch path.');
assert(
  refundNotificationLimitIndex < refundSendEmailIndex,
  'Refund notification quota must run before customer email dispatch.'
);
assert(
  refundIntakeFunction.includes('cleanupPartialRefundCase'),
  'Refund attachment upload failures must clean up partial PII cases.'
);
assert(
  !refundIntakeFunction.includes('console.error("refund-case-intake error", error)'),
  'Refund intake errors should not log raw error objects that may include private payload context.'
);
assert(
  !refundIntakeFunction.includes('console.error("refund-case-intake email failed", emailError)'),
  'Refund email errors should not log raw provider error objects.'
);

assert(
  migration.includes('public_intake_rate_limit_events'),
  'Missing public intake rate-limit table migration.'
);
assert(
  migration.includes('record_public_intake_rate_limit_event'),
  'Missing atomic public intake rate-limit RPC.'
);
assert(
  migration.includes("key_hash ~ '^[0-9a-f]{64}$'"),
  'Rate-limit storage should use hashed keys, not raw IP/email/source values.'
);
assert(
  migration.includes("'global'"),
  'Migration should allow the non-caller-controlled global rate-limit key type.'
);
assert(
  globalKeyMigration.includes('drop constraint if exists public_intake_rate_limit_events_key_type_check') &&
    globalKeyMigration.includes("check (key_type in ('ip', 'email', 'source', 'global'))"),
  'Follow-up migration should forward-repair existing rate-limit key constraints to allow global quotas.'
);
assert(
  !/ip_address|email_address|raw_email|raw_ip/i.test(migration),
  'Migration should not introduce raw IP/email rate-limit columns.'
);
assert(
  refundMigration.includes('server_dedupe_key text') &&
    refundMigration.includes('refund_cases_server_dedupe_key_idx'),
  'Refund case migration must include server-side dedupe storage and a unique dedupe index.'
);

console.log('Public intake anti-abuse validation passed.');
console.log(
  `Submission limits: global=${submissionGlobalLimit}/hour, ip=${submissionIpLimit}/hour, email=${submissionEmailLimit}/hour. ` +
    `Notification quotas: global=${notificationGlobalLimit}/hour, email=${notificationEmailLimit}/hour. ` +
    'Refund intake includes submission throttling, dedupe, attachment pre-validation, and customer-email quotas.'
);
