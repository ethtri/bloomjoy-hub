import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const sunze = read('supabase/functions/sunze-sales-ingest/index.ts');
const migration = read('supabase/migrations/20260929134500_refund_technical_incident_agent_routing.sql');

test('refund technical health uses existing incidents without executive email delivery', () => {
  assert.doesNotMatch(sweep, /sendInternalEmail/u);
  assert.doesNotMatch(sweep, /sendAutomationHealthAlert/u);
  assert.match(sweep, /service_claim_refund_automation_health_notification/u);
  assert.match(sweep, /technical_incident_recovery_recorded/u);
  assert.match(sweep, /_routed_for_agent/u);
  assert.match(sweep, /p_outcome: "routed_for_agent"/u);
  assert.match(sweep, /service_settle_refund_completion_outbox_notification/u);
  assert.match(sweep, /sendRefundManagerActionNotice/u);
  assert.match(sweep, /runManagerDigestSweep/u);
  assert.match(sweep, /sendTransactionalEmail/u);
});

test('completion incident settlement distinguishes agent routing from email delivery', () => {
  assert.match(migration, /p_outcome not in \('sent','failed','routed_for_agent'\)/u);
  assert.match(migration, /initial_agent_routed_at/u);
  assert.match(migration, /recovery_agent_routed_at/u);
  assert.match(migration, /return jsonb_build_object\('settled',true,'outcome','routed_for_agent'/u);
  assert.match(migration, /initial_notification_sent_at/u);
  assert.match(migration, /recovery_notification_sent_at/u);
});

test('only Sunze technical failures move to the GPT route', () => {
  const healthStart = sunze.indexOf('const handleHealthCheck');
  const serveStart = sunze.indexOf('serve(async', healthStart);
  const healthSource = sunze.slice(healthStart, serveStart);
  assert.match(healthSource, /technical_agent_route: "bloomjoy-technical-incident-repair"/u);
  assert.match(
    healthSource,
    /if \(!healthRunId\) \{\s*return jsonResponse\(\{ error: "Unable to record Sunze technical incident\." \}, 503\);/u,
  );
  assert.doesNotMatch(healthSource, /sendReportingAlert\(/u);

  const importFailureStart = sunze.indexOf('if (importRunId) {', serveStart);
  const importFailureSource = sunze.slice(importFailureStart);
  assert.match(importFailureSource, /routeTechnicalIncidentToAgent\(importRunId\)/u);
  assert.doesNotMatch(importFailureSource, /title: "Sunze sales ingest failed"/u);

  assert.match(sunze, /title: "Sunze machines need reporting mapping"/u);
  assert.match(sunze, /sendInternalEmail\(/u);
  assert.match(sunze, /sendWeComAlertResult/u);
});

test('only exact governed terminal thread evidence resolves an old status obligation', () => {
  assert.match(migration, /refund_completion_obligation_resolved_existing_thread/u);
  assert.match(migration, /result,currentObligationState/u);
  assert.match(migration, /resolved_by_existing_thread_copy/u);
  assert.match(migration, /completion\.message_type='completed'/u);
  assert.match(migration, /c\.status='completed' and c\.decision='approved'/u);
  assert.match(migration, /c\.refund_completed_at is not null/u);
  assert.match(migration, /resolution\.created_at>m\.created_at/u);
});
