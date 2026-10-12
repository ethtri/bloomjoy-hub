/// <reference lib="deno.ns" />
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { latestVerifiedCustomerNote, type CustomerNoteMessage } from './refundCustomerNotes.ts';

const note = (values: Partial<CustomerNoteMessage> = {}): CustomerNoteMessage => ({
  id: '1', direction: 'inbound', kind: 'message', participantRole: 'customer', participantTrust: 'verified',
  body: 'Machine stopped.', receivedAt: '2026-10-12T12:00:00Z', contentDeleted: false, ...values,
});

Deno.test('latest note excludes staff, automated, unknown and deleted content', () => {
  const rows = [note(), note({ id: '2', receivedAt: '2026-10-12T13:00:00Z', body: 'Screen error.' }),
    note({ participantRole: 'assigned_manager' }), note({ kind: 'bounce' }), note({ participantTrust: 'unverified' }),
    note({ contentDeleted: true }), note({ direction: 'outbound' }), note({ receivedAt: 'invalid' })];
  assertEquals(latestVerifiedCustomerNote(rows)?.id, '2');
  assertEquals(rows[0].id, '1');
});

Deno.test('comments stay optional and multiline customer words remain intact', () => {
  assertEquals(latestVerifiedCustomerNote([]), null);
  assertEquals(latestVerifiedCustomerNote([note({ body: ' ' })]), null);
  const text = 'No salió nada.\nThe screen showed <error>.';
  assertEquals(latestVerifiedCustomerNote([note({ body: text })])?.body, text);
});
