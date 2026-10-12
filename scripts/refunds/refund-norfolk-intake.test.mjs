import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { resolveLocalDateTimeInZone } from '../../supabase/functions/_shared/timezone-resolution.mjs';
import { incidentTimeIsMateriallyFuture } from '../../supabase/functions/_shared/refund-request-time-boundary.mjs';

const source = fs.readFileSync(new URL('../../supabase/functions/refund-case-intake/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20261012100100_refund_norfolk_intake_timezone.sql', import.meta.url), 'utf8');
const form = fs.readFileSync(new URL('../../src/pages/RefundRequest.tsx', import.meta.url), 'utf8');

test('the reviewed Norfolk clock corrects a synthetic evening receipt boundary without accepting a later date', () => {
  const received = '2026-09-01T23:00:00Z';
  const local = { localDate: '2026-09-01', localTime: '18:30' };
  const eastern = resolveLocalDateTimeInZone({ ...local, timeZone: 'America/New_York' });
  const pacific = resolveLocalDateTimeInZone({ ...local, timeZone: 'America/Los_Angeles' });
  assert.equal(eastern.instant, '2026-09-01T22:30:00.000Z');
  assert.equal(incidentTimeIsMateriallyFuture({ incidentAt: eastern.instant, customerRequestReceivedAt: received }), false);
  assert.equal(incidentTimeIsMateriallyFuture({ incidentAt: pacific.instant, customerRequestReceivedAt: received }), true);
  const later = resolveLocalDateTimeInZone({ ...local, localDate: '2026-09-02', timeZone: 'America/New_York' });
  assert.equal(incidentTimeIsMateriallyFuture({ incidentAt: later.instant, customerRequestReceivedAt: received }), true);
});

test('existing Eastern DST fold and gap handling remains explicit', () => {
  assert.equal(resolveLocalDateTimeInZone({ localDate: '2026-03-08', localTime: '02:30', timeZone: 'America/New_York' }).resolution, 'nonexistent');
  assert.equal(resolveLocalDateTimeInZone({ localDate: '2026-11-01', localTime: '01:30', timeZone: 'America/New_York' }).resolution, 'ambiguous');
});

test('migration changes only the clock projection and exposes no browser resolver', () => {
  assert.match(migration, /p_machine_id = '0bcc055d-122f-4d30-aca4-2648a4f0516a'/u);
  assert.match(migration, /p_location_timezone = 'America\/Los_Angeles'/u);
  assert.match(migration, /p_manual_enabled is true/u);
  assert.match(migration, /p_manual_timezone = 'America\/New_York'/u);
  assert.match(migration, /security invoker/u);
  assert.match(migration, /from public, anon, authenticated/u);
  assert.doesNotMatch(migration, /(?:update|insert into|delete from)\s+public\./iu);
  assert.doesNotMatch(migration, /disable trigger|session_replication_role/iu);
});

test('conversion, saved facts and QR consume the resolver; recovery fallback is read-only', () => {
  assert.match(source, /timeZone: intakeTimezone/u);
  assert.match(source, /incident_timezone: intakeTimezone/u);
  assert.match(source, /locationTimezone: intakeTimezone/u);
  assert.match(source, /outcome === "conflict" && refundCaseId === null && allowPreviousClockReplay/u);
  assert.match(source, /claimSubmissionIdentity\(null, previousFingerprint, false\)/u);
  assert.match(source, /previous\.refundCaseId === claimedCaseId/u);
});

test('specific date guidance is localized and does not append blind retry instructions', () => {
  assert.match(form, /error\.data\?\.errorCode === 'refund_purchase_time_after_request'/u);
  assert.match(form, /isPurchaseTimeError \? message :/u);
  assert.match(form, /incidentDate: ''/u);
  assert.match(form, /incidentTime: ''/u);
});
