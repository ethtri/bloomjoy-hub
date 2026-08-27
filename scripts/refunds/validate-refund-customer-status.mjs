import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');
const checks = [];

const assert = (name, passed) => {
  checks.push({ name, passed });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`);
};

const includesAll = (text, values) => values.every((value) => text.includes(value));

const run = async () => {
  const [
    migration,
    capability,
    intake,
    adminUpdate,
    automationSweep,
    messageSend,
    gmailTransport,
    gmailSync,
    nayaxRefund,
    outcomeResolve,
    managerStepUp,
    request,
    status,
    operations,
    app,
    seo,
    vercel,
    email,
  ] =
    await Promise.all([
      read('supabase/migrations/20260827011500_refund_customer_status_capability.sql'),
      read('supabase/functions/_shared/refund-status-capability.ts'),
      read('supabase/functions/refund-case-intake/index.ts'),
      read('supabase/functions/refund-case-admin-update/index.ts'),
      read('supabase/functions/refund-case-automation-sweep/index.ts'),
      read('supabase/functions/refund-case-message-send/index.ts'),
      read('supabase/functions/_shared/refund-gmail-transport.ts'),
      read('supabase/functions/refund-gmail-sync/index.ts'),
      read('supabase/functions/nayax-card-refund/index.ts'),
      read('supabase/functions/refund-nayax-outcome-resolve/index.ts'),
      read('supabase/functions/refund-manager-action-step-up/index.ts'),
      read('src/pages/RefundRequest.tsx'),
      read('src/pages/RefundStatus.tsx'),
      read('src/lib/refundOperations.ts'),
      read('src/App.tsx'),
      read('src/lib/seoRoutes.ts'),
      read('vercel.json'),
      read('supabase/functions/_shared/refund-email.ts'),
    ]);

  assert(
    'Capability tokens are 256-bit, stored only as SHA-256 digests, and bounded to 45 days',
    includesAll(capability, [
      'REFUND_STATUS_TOKEN_BYTES = 32',
      'crypto.getRandomValues(bytes)',
      'crypto.subtle.digest("SHA-256"',
      'REFUND_STATUS_MAX_TTL_DAYS = 45',
      'url.hash = `token=${token}`',
    ]) && !migration.includes('raw_token'),
  );
  assert(
    'Status access is service-only, RLS-protected, rate-limited, revocable, and privacy-audited',
    includesAll(migration, [
      'enable row level security',
      'service_read_refund_status_capability',
      'service_revoke_refund_status_capabilities',
      'service_attach_refund_status_capability_to_message',
      'service_prune_refund_status_access_evidence',
      'rate_limited',
      'refund_case_status_access_audit',
      ') to service_role',
    ]) && migration.includes('from public, anon, authenticated'),
  );
  assert(
    'Unknown, expired, and revoked links use one generic read envelope without an existence oracle',
    includesAll(migration, ['payloadRedacted', "'available', false"]) &&
      includesAll(intake, ['150 - (Date.now() - startedAt)', 'refund_status_unavailable', 'readStatus']),
  );
  assert(
    'The public status route strips the fragment, keeps it same-tab, and refreshes nonterminal states within 15 seconds',
    includesAll(status, [
      'window.history.replaceState',
      'sessionStorage',
      'const isChecking = !isDemoMode && tokenPattern.test(token) && statusQuery.isPending',
      'genericUnavailable && !isChecking',
      'refetchIntervalInBackground: false',
      'fetchRefundCustomerStatus',
    ]) && (await read('src/lib/refundCustomerStatus.ts')).includes('Math.min(15_000'),
  );
  assert(
    'The status page is non-indexed, non-referring, non-cached, and excluded from analytics',
    includesAll(vercel, [
      'src": "/refunds/status/?"',
      'private, no-store, max-age=0',
      'no-referrer',
      'noindex, nofollow, noarchive',
      "script-src 'self'",
    ]) && includesAll(seo, ['/refunds/status', 'privateRoutes']),
  );
  assert(
    'Customer responses expose only the canonical lifecycle allowlist',
    includesAll(operations, ['fetchRefundCustomerStatus', 'requireRefundCustomerLifecycle']) &&
      !status.includes('providerReference') &&
      !status.includes('nayaxTransactionId'),
  );
  assert(
    'The short intake keeps diagnostics optional and provides accessible inline errors',
    includesAll(request, [
      'Add optional details',
      'aria-invalid',
      'aria-describedby',
      'field?.focus()',
      'noValidate',
    ]) && !request.includes('Customer name is required'),
  );
  assert(
    'Intake and every eligible refund email can issue the fragment status link behind a default-off gate',
    includesAll(intake, ['issueRefundStatusCapability', 'statusToken', 'statusExpiresAt']) &&
      adminUpdate.includes('tryIssueRefundStatusCapability') &&
      automationSweep.includes('tryIssueRefundStatusCapability') &&
      messageSend.includes('tryIssueRefundStatusCapability') &&
      gmailSync.includes('tryIssueRefundStatusCapabilityForMessage') &&
      includesAll(email, ['statusUrl', 'Check refund status']) &&
      capability.includes('?.trim().toLowerCase() === "true"'),
  );
  assert(
    'A status-link outage cannot block an otherwise eligible customer message',
    includesAll(capability, [
      'tryIssueRefundStatusCapability',
      'refund status capability issuance unavailable',
      'return null',
    ]) &&
      [adminUpdate, automationSweep, messageSend].every((source) =>
        source.includes('tryIssueRefundStatusCapability')
      ),
  );
  assert(
    'Raw status tokens are redacted from message and Gmail transport persistence',
    includesAll(migration, ['status_capability_id', 'status_link_included']) &&
      includesAll(email, [
        'redactRefundStatusLinksForStorage',
        '[Secure refund status link included at delivery]',
      ]) &&
      [intake, adminUpdate, automationSweep, messageSend, gmailTransport].every((source) =>
        source.includes('redactRefundStatusLinksForStorage')
      ),
  );
  assert(
    'Authoritative Nayax completion paths attach a status link without changing provider execution',
    [nayaxRefund, outcomeResolve, managerStepUp].every((source) =>
      source.includes('tryIssueRefundStatusCapabilityForMessage') &&
      source.includes('buildRefundStoredTextWithStatus')
    ),
  );
  assert(
    'Privacy-safe access evidence is actively removed after its retention window',
    includesAll(migration, [
      'service_prune_refund_status_access_evidence',
      'delete from public.refund_case_status_access_windows',
      'delete from public.refund_case_status_access_audit',
    ]) && automationSweep.includes('service_prune_refund_status_access_evidence'),
  );
  assert(
    'Confirmed card-refund copy is exact and avoids a false bank-posted claim',
    email.includes('Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.') &&
      !email.includes('Your refund has posted to your account'),
  );
  assert(
    'The application exposes the customer request, thank-you, and secure status route',
    includesAll(app, ['/refunds/request', '/refunds/thank-you', '/refunds/status']),
  );

  const failed = checks.filter(({ passed }) => !passed);
  if (failed.length) {
    console.error(`\nRefund customer-status validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }
  console.log('\nRefund customer-status validation passed.');
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
