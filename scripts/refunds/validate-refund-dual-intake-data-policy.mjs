import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const policy = fs.readFileSync(path.join(rootDir, 'Docs', 'REFUND_DUAL_INTAKE_DATA_POLICY.md'), 'utf8');

const checks = [];
const check = (name, condition) => checks.push({ name, pass: Boolean(condition) });

const requiredSections = [
  '## Recommended pilot decisions',
  '## Data-flow inventory',
  '## Sanitized Google Form contract',
  '## Least-privilege access standard',
  '## Attachment policy',
  '## Retention and deletion procedure',
  '## Logs, metrics, alerts, and evidence',
  '## Independent kill switches',
  '## Synthetic approval tests',
  '## Required approvals',
];

const formFields = [
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
  'Policy remains an explicit production-copying gate, not inferred approval',
  policy.includes('PENDING OWNER AND PRIVACY/SECURITY APPROVAL — production copying remains off') &&
    policy.includes('This document is a decision packet, not approval')
);
check('Every required policy section exists', requiredSections.every((section) => policy.includes(section)));
check(
  'Every system has a purpose/access/retention/owner inventory',
  ['SMS provider', 'Public Google Form', 'Linked Google response Sheet', 'Sheet-to-Hub bridge',
    'Hub canonical refund case', 'Designated Gmail mailbox', 'Hub Gmail text copy',
    'Hub Gmail attachments', 'Hosted-form attachments', 'GPT triage', 'GitHub/CI/alerts/QA']
    .every((system) => policy.includes(`| ${system} |`))
);
check(
  'Recommended transport, derived-copy, ledger, and canonical retention decisions are explicit',
  policy.includes('30 days after confirmed Hub ingestion') &&
    policy.includes('90-day maximum') &&
    policy.includes('Retain 400 days after last activity') &&
    policy.includes('180-day maximum') &&
    policy.includes('Maximum 30 days') &&
    policy.includes('proposed ceiling of seven years after case closure') &&
    policy.includes('not claims about current Google or Hub deletion behavior or universal legal requirements')
);
check(
  'The exact sanitized 11-field Google contract is present',
  formFields.every((field, index) => policy.includes(`${index + 1}. ${field}`)) &&
    policy.includes('The Google Form has no file-upload question')
);
check(
  'Google access keeps the bridge read-only and cleanup separately authorized',
  policy.includes('dedicated bridge service account is Viewer-only') &&
    policy.includes('Do not expand the bridge credential') &&
    policy.includes('different owner-controlled authorization')
);
check(
  'Gmail authorization is label-scoped and provider-independent retention is required',
  policy.includes('explicit refund label') &&
    policy.includes('Gmail read-only and send') &&
    policy.includes('provider-independent local purge')
);
check(
  'Pilot attachments are recommended disabled and a safe enabled contract is complete',
  policy.includes('disable new attachment copying from Gmail and the hosted website form') &&
    policy.includes('quarantine before malware scanning') &&
    policy.includes('confirmed byte deletion before metadata redaction') &&
    policy.includes('`#711` remains a launch blocker')
);
check(
  'Deletion covers Form plus Sheet, legal holds, provider revocation, and canonical records',
  policy.includes('both the Google Form response store and linked Sheet') &&
    policy.includes('A legal hold suspends deletion only for the identified records') &&
    policy.includes('even when Google authorization is revoked') &&
    policy.includes('Preserve the canonical case and official audit')
);
check(
  'SMS, Sheet, Gmail, cleanup, attachments, GPT, and Nayax have independent stop controls',
  ['Google Sheet bridge', 'Gmail intake/send', 'Google source cleanup', 'Attachments', 'GPT', 'Nayax official actions']
    .every((lane) => policy.includes(`| ${lane} |`))
);
check(
  'Synthetic approval covers access, revocation, retention, attachments, offboarding, rollback, and privacy requests',
  ['**Google access:**', '**Hub access:**', '**Sheet revoke:**', '**Gmail revoke:**', '**Source retention:**',
    '**Hub retention:**', '**Attachment disabled:**', '**Offboarding:**', '**Quick disable/restore:**', '**Privacy request:**']
    .every((test) => policy.includes(test))
);
check(
  'Owner/privacy decisions visibly remain pending',
  ['Operations owner: **Pending**', 'Operations backup: **Pending**',
    'Privacy/security owner and incident contact: **Pending**', 'Final pilot go/no-go: **Pending**']
    .every((value) => policy.includes(value))
);
check(
  'No raw phone number, account ID, URL, UUID, or email address is committed',
  !/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(policy) &&
    !/\bAC[0-9a-f]{24,}\b/i.test(policy) &&
    !/https?:\/\//i.test(policy) &&
    !/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i.test(policy) &&
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(policy)
);

for (const result of checks) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}`);

const failed = checks.filter((result) => !result.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} dual-intake data-policy validation check(s) failed.`);
  process.exit(1);
}

console.log('\nRefund dual-intake data policy and approval gates validated.');
