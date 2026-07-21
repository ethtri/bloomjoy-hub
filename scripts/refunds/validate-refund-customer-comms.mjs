import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const readText = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

const checks = [];

const assert = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  const symbol = passed ? 'PASS' : 'FAIL';
  console.log(`[${symbol}] ${name}${detail && !passed ? ` - ${detail}` : ''}`);
};

const includesAll = (text, needles) => needles.every((needle) => text.includes(needle));

const run = async () => {
  const [adminUpdate, portalPage, portalUat] = await Promise.all([
    readText('supabase/functions/refund-case-admin-update/index.ts'),
    readText('src/pages/admin/Refunds.tsx'),
    readText('scripts/refunds/validate-refund-portal-uat.mjs'),
  ]);

  assert(
    'Primary admin update accepts an explicit customer message type',
    includesAll(adminUpdate, ['sanitizeRefundMessageType', 'customerMessageType', 'requestedMessageType'])
  );
  assert(
    'Primary admin update records failed customer email tasks',
    includesAll(adminUpdate, ['customer_message_failed', 'customer_email_delivery_failed', 'status: "failed"'])
  );
  assert(
    'Portal treats failed customer emails as visible manager work',
    includesAll(portalPage, ['Customer email failed', 'Retry customer email', 'getLatestCustomerMessage'])
  );
  assert(
    'Portal primary case actions send the matching customer message type',
    includesAll(portalPage, ['handleSaveCase(primaryActionEditor, primaryAction.messageType', 'customerMessageType'])
  );
  assert(
    'Normal path no longer has a standalone Send customer email button',
    !portalPage.includes('Send customer email')
  );
  assert(
    'Manager queue does not repeat identical location and machine labels',
    includesAll(portalPage, [
      'formatRefundMachineLocation',
      'locationName.trim().toLocaleLowerCase() === machineLabel.trim().toLocaleLowerCase()',
      'formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)',
      'formatRefundMachineLocation(selectedCase.locationName, selectedCase.machineLabel)',
    ])
  );
  assert(
    'Focused UAT covers guarded completion, failure, and retry wiring',
    includesAll(portalUat, [
      'runCustomerCommsFailureChecks',
      'refund-case-message-send',
      'nayax-card-refund',
      'Successful guarded card refund execution completes case through admin update',
      'messageType ===',
      'customer was not contacted',
    ])
  );

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    console.error(`\nRefund customer comms validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nRefund customer comms validation passed.');
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
