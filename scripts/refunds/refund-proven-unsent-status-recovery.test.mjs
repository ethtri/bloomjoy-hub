import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260919214959_refund_proven_unsent_status_recovery.sql',
  import.meta.url,
);

test('proven-unsent status recovery stays exact, replay-safe, and outside payment execution', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /service_release_proven_unsent_refund_status\(\s*p_refund_case_message_id uuid/);
  assert.match(sql, /message_row\.status is distinct from 'failed'/);
  assert.match(sql, /message_row\.error_message is distinct from 'gmail_source_thread_required'/);
  assert.match(sql, /message_row\.sent_at is not null/);
  assert.match(sql, /message_row\.provider_message_id is not null/);
  assert.match(sql, /message_row\.delivery_transport is not null/);
  assert.match(sql, /message_row\.delivery_state is not null and message_row\.delivery_state <> 'unknown'/);
  assert.match(sql, /message_row\.delivery_state_updated_at is not null/);
  assert.match(sql, /message_row\.manual_delivery_provider_attempted_at is not null/);
  assert.match(sql, /refund_gmail_messages gmail_message[\s\S]*gmail_message\.refund_case_message_id = message_row\.id/);
  assert.match(sql, /case_row\.case_population is distinct from 'customer'/);
  assert.match(sql, /case_row\.status not in \('submitted', 'needs_review', 'correlated', 'card_refund_pending'\)/);
  assert.match(sql, /case_row\.decision is not null/);
  assert.match(sql, /message_row\.reason_code is distinct from 'sla_at_risk'/);
  assert.match(sql, /refund_case_nayax_refund_attempts attempt/);
  assert.match(sql, /refund_authoritative_receipts receipt/);
  assert.match(sql, /later_message\.status = 'sent'/);
  assert.match(sql, /event\.event_type = 'customer_status_update_sent'/);
  assert.match(sql, /event\.event_type = 'customer_status_recovery_released'/);
  assert.match(sql, /action_row\.status is distinct from 'failed'/);
  assert.match(sql, /recovered-failed-status:/);
  assert.match(sql, /'replayed', true/);
  assert.ok(
    sql.indexOf("'replayed', true") < sql.indexOf("case_row.case_population is distinct from 'customer'"),
    'exact recovery replay must return before mutable current-case eligibility guards',
  );
  assert.match(sql, /grant execute on function public\.service_release_proven_unsent_refund_status\(uuid\)[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /service_(claim|settle|hold)_nayax_refund_attempt/);
});
