/// <reference lib="deno.ns" />
import {
  clearTimeEntryDraft, getEditDraftConflict, parseTimeEntryDraft, readTimeEntryDraft,
  setTimeEntryDraftUser, timeEntryDraftKey, TIME_DRAFT_PREFIX, TIME_DRAFT_USER_KEY,
  writeTimeEntryDraft, type TimeEntryDraft, type TimeEntryDraftScope,
} from './timeEntryDrafts.ts';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const fields = { workDate: '2026-08-31', machineId: 'machine-a', startTime: '09:20', endTime: '' };
const scope: TimeEntryDraftScope = { userId: 'user-a', accountId: 'account-a', profileId: 'profile-a', entryId: null };
class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}
const setup = () => { const storage = new MemoryStorage(); setTimeEntryDraftUser(scope.userId, storage); return storage; };
const save = (storage: MemoryStorage, target = scope, revision: string | null = null) => {
  const result = writeTimeEntryDraft(target, fields, revision, target.entryId ? '2026-09-01T00:00:00Z' : null, storage);
  if (result.status !== 'ready' || !result.draft) throw new Error('write failed');
  return result.draft;
};

Deno.test('partial and old drafts retain exact values without expiration or copied record fields', () => {
  const storage = setup();
  const draft = save(storage);
  const old = { ...draft, updatedAt: '2020-01-01T00:00:00Z', fields: { ...fields, token: 'never-retain' } };
  const parsed = parseTimeEntryDraft(JSON.stringify(old));
  assert(parsed?.fields.machineId === 'machine-a' && parsed.fields.endTime === '', 'partial fields retained');
  assert(!JSON.stringify(parsed).includes('never-retain'), 'extra fields stripped');
  assert(parsed?.updatedAt === old.updatedAt, 'no arbitrary expiration');
  assert(parseTimeEntryDraft('broken') === null, 'corrupt storage ignored');
  assert(parseTimeEntryDraft(JSON.stringify({ ...draft, version: 9 })) === null, 'unknown version ignored');
  assert(parseTimeEntryDraft(JSON.stringify({ ...draft, fields: { ...fields, startTime: 'bad' } })) === null, 'bad clock rejected');
  for (const workDate of ['2026-99-99', '2026-02-31', '2026-02-29']) {
    assert(parseTimeEntryDraft(JSON.stringify({ ...draft, fields: { ...fields, workDate } })) === null, 'impossible date rejected');
  }
});

Deno.test('user, account, profile and edit identity produce isolated drafts', () => {
  const storage = setup();
  const variants = [scope, { ...scope, accountId: 'other' }, { ...scope, profileId: 'other' },
    { ...scope, entryId: 'entry-a' }, { ...scope, entryId: 'entry-b' }];
  variants.forEach((target) => save(storage, target));
  assert(new Set(variants.map(timeEntryDraftKey)).size === variants.length, 'all keys differ');
  assert(variants.every((target) => readTimeEntryDraft(target, storage).status === 'ready'), 'all accessible in own scope');
  assert(readTimeEntryDraft({ ...scope, userId: 'other' }, storage).status === 'unavailable', 'other identity cannot read');
});

Deno.test('delayed save/discard cannot erase a newer revision or a different profile', () => {
  const storage = setup();
  const first = save(storage);
  const newer = save(storage, scope, first.revision);
  const otherScope = { ...scope, profileId: 'other' };
  const other = save(storage, otherScope);
  assert(!clearTimeEntryDraft(scope, first.revision, storage), 'stale successful save does not delete new work');
  assert(!clearTimeEntryDraft(otherScope, newer.revision, storage), 'different profile not deleted');
  assert(clearTimeEntryDraft(scope, newer.revision, storage), 'matching save removes draft');
  assert(parseTimeEntryDraft(storage.getItem(timeEntryDraftKey(otherScope)))?.revision === other.revision, 'other profile intact');
});

Deno.test('another tab cannot replace the revision the current tab has not seen', () => {
  const storage = setup();
  const first = save(storage);
  assert(writeTimeEntryDraft(scope, { ...fields, machineId: 'wrong-machine' }, null, null, storage).status === 'changed', 'second tab conflict');
  const newer = save(storage, scope, first.revision);
  assert(writeTimeEntryDraft(scope, fields, first.revision, null, storage).status === 'changed', 'older tab conflict');
  assert(parseTimeEntryDraft(storage.getItem(timeEntryDraftKey(scope)))?.revision === newer.revision, 'new draft unchanged');
});

Deno.test('same identity hydration retains work while signout/user change revokes writes and clears all profiles', () => {
  const storage = setup();
  save(storage);
  save(storage, { ...scope, profileId: 'other', entryId: 'entry-a' });
  setTimeEntryDraftUser(scope.userId, storage);
  assert(storage.length === 3, 'same-user hydration preserved');
  // Models the other tab updating the marker before this tab receives its auth event.
  storage.setItem(TIME_DRAFT_USER_KEY, '');
  assert(writeTimeEntryDraft(scope, fields, null, null, storage).status === 'unavailable', 'cross-tab signout prevents resurrection');
  setTimeEntryDraftUser(null, storage);
  assert(![...storage.values.keys()].some((key) => key.startsWith(TIME_DRAFT_PREFIX)), 'all signed-out drafts cleared');
  setTimeEntryDraftUser(scope.userId, storage);
  save(storage);
  setTimeEntryDraftUser('user-b', storage);
  assert(![...storage.values.keys()].some((key) => key.startsWith(TIME_DRAFT_PREFIX)), 'previous identity removed');
});

Deno.test('blocked/full storage fails softly and existing recovery values are retained after denied writes', () => {
  const storage = setup();
  const draft = save(storage);
  storage.setItem = () => { throw new Error('quota'); };
  assert(writeTimeEntryDraft(scope, fields, draft.revision, null, storage).status === 'unavailable', 'quota reports unavailable');
  assert(parseTimeEntryDraft(storage.getItem(timeEntryDraftKey(scope)))?.revision === draft.revision, 'existing draft survives');
  storage.getItem = () => { throw new Error('denied'); };
  assert(readTimeEntryDraft(scope, storage).status === 'unavailable', 'denied read reports unavailable');
  assert(!clearTimeEntryDraft(scope, draft.revision, storage), 'denied clear handled');
  setTimeEntryDraftUser(null, storage);
});

Deno.test('signout still removes private drafts when marker writes fail but removal works', () => {
  const storage = setup();
  save(storage);
  save(storage, { ...scope, profileId: 'second-profile' });
  storage.setItem = () => { throw new Error('quota'); };
  setTimeEntryDraftUser(null, storage);
  assert(![...storage.values.keys()].some((key) => key.startsWith(TIME_DRAFT_PREFIX)), 'cleanup must not depend on setItem succeeding');
});

Deno.test('edit recovery preserves identity and catches changed, deleted and closed originals', () => {
  const storage = setup();
  const editScope = { ...scope, entryId: 'entry-a' };
  const draft: TimeEntryDraft = save(storage, editScope);
  const entry = { id: 'entry-a', operatorProfileId: scope.profileId, updatedAt: draft.originalUpdatedAt!, technicianEditable: true };
  assert(getEditDraftConflict(draft, entry, editScope) === null, 'matching original can resume');
  assert(getEditDraftConflict(draft, { ...entry, updatedAt: '2026-09-02T00:00:00Z' }, editScope) === 'changed', 'changed original');
  assert(getEditDraftConflict(draft, null, editScope) === 'missing', 'deleted original');
  assert(getEditDraftConflict(draft, { ...entry, operatorProfileId: 'other' }, editScope) === 'missing', 'wrong profile');
  assert(getEditDraftConflict(draft, { ...entry, technicianEditable: false }, editScope) === 'locked', 'closed original');
});
