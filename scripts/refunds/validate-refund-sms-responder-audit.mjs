import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const auditPath = path.join(rootDir, 'Docs', 'REFUND_SMS_RESPONDER_AUDIT.md');
const audit = fs.readFileSync(auditPath, 'utf8');

const checks = [];
const check = (name, condition) => checks.push({ name, pass: Boolean(condition) });

const requiredSections = [
  '## Plain-English outcome',
  '## Read-only evidence',
  '## Readiness scorecard',
  '## Target pilot behavior',
  '## Customer-facing copy target',
  '## Sanitized Google Form contract',
  '## Owner-supervised verification window',
  '## Monitoring and incident ownership',
  '## Stop conditions',
  '## Go-live evidence template',
];

const expectedFormColumns = [
  'Timestamp',
  'Your Name',
  'Email Address',
  'Location of Purchase',
  'Date and Time of Incident',
  'Incident Description',
  'Request Amount',
  'Payment Method',
  'Last 4 digits of the credit card used',
  'Refund Payment Preference',
  'Venmo/Zelle Payment ID',
];

check(
  'Audit is explicitly fail-closed for pilot launch',
  audit.includes('RED — not ready for a live refund pilot') &&
    audit.includes('Overall: **NO-GO for the SMS-dependent pilot lane.**')
);
check(
  'Read-only boundary records that no live message or configuration change occurred',
  audit.includes('No live messages were sent') &&
    audit.includes('no customer-facing configuration was changed') &&
    audit.includes('no credentials were entered or rotated')
);
check(
  'Provider evidence distinguishes GoDaddy from the suspended historical Twilio path',
  audit.includes('no Phone & SMS number connected') &&
    audit.includes('Historical Twilio path') &&
    audit.includes('suspended because its balance was empty') &&
    audit.includes('historical candidate, not a verified live responder')
);
check(
  'Every required operational section is present',
  requiredSections.every((section) => audit.includes(section))
);
check(
  'Owner and backup responsibilities remain an explicit launch gate',
  audit.includes('Primary owner and backup named') &&
    audit.includes('Name the primary operations owner and a backup on `#704`')
);
check(
  'Pilot response and duplicate-suppression targets are measurable',
  audit.includes('within 60 seconds') &&
    audit.includes('receive no additional automated Form response for 24 hours') &&
    audit.includes('send two ordinary follow-ups inside five minutes')
);
check(
  'Loop, bot, redelivery, delivery failure, STOP, and HELP paths are required',
  ['Provider redelivery', 'Automated sender', '**STOP and HELP:**', '**Delivery failure:**'].every((value) =>
    audit.includes(value)
  )
);
check(
  'SMS disable and rollback stay independent and timed',
  audit.includes('turn off only the SMS automation') &&
    audit.includes('email responder, hosted website Form, Hub queue, and default-off Sheet bridge remain available') &&
    audit.includes('Target 15 minutes; acceptance remains same-day at maximum')
);
check(
  'Customer copy is humble and makes no approval or payment promise',
  audit.includes('we’re sorry something went wrong') &&
    audit.includes('Do not use the responder to say that a refund is approved, completed, guaranteed, or being processed')
);
check(
  'The exact sanitized Google Form response contract is present',
  expectedFormColumns.every((column) => audit.includes(`| ${column} |`)) &&
    audit.includes('contains exactly the following 11 columns') &&
    audit.includes('No attachment or file-upload question was observed')
);
check(
  'Sheet ownership and notification verification remain explicit instead of inferred',
  audit.includes('response Sheet destination, access, notifications, and exact active location count must be privately verified') &&
    audit.includes('Response Sheet and notifications owner: `pass / fail`')
);
check(
  'No raw phone number, provider account ID, URL, UUID, or email address is committed',
  !/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(audit) &&
    !/\bAC[0-9a-f]{24,}\b/i.test(audit) &&
    !/https?:\/\//i.test(audit) &&
    !/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(audit) &&
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(audit)
);

for (const result of checks) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);
}

const failed = checks.filter((result) => !result.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} SMS responder readiness validation check(s) failed.`);
  process.exit(1);
}

console.log('\nRefund SMS responder audit and sanitized readiness controls validated.');
