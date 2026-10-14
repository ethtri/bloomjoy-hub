import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearTimeEntryDraft, readTimeEntryDraft, timeEntryDraftKey, writeTimeEntryDraft,
  TIME_DRAFT_USER_KEY, type TimeEntryDraft, type TimeEntryDraftFields, type TimeEntryDraftScope,
} from '@/lib/timeEntryDrafts';

type DraftState = {
  key: string;
  draft: TimeEntryDraft | null;
  pending: boolean;
  status: 'ready' | 'saved' | 'unavailable' | 'changed';
};

export function useTimeEntryDraft(scope: TimeEntryDraftScope | null, ready: boolean) {
  const key = scope ? timeEntryDraftKey(scope) : '';
  const [state, setState] = useState<DraftState | null>(null);
  const stateRef = useRef(state);
  const scopeRef = useRef(scope);
  stateRef.current = state;
  scopeRef.current = scope;

  const initialize = useCallback(() => {
    const currentScope = scopeRef.current;
    if (!currentScope) return;
    const result = readTimeEntryDraft(currentScope);
    const draft = result.status === 'ready' ? result.draft : null;
    const next: DraftState = { key: timeEntryDraftKey(currentScope), draft, pending: Boolean(draft), status: result.status };
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (!key) {
      stateRef.current = null;
      setState(null);
    } else if (ready && stateRef.current?.key !== key) initialize();
  }, [initialize, key, ready]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const current = stateRef.current;
      if (!current || (event.key !== current.key && event.key !== TIME_DRAFT_USER_KEY && event.key !== null)) return;
      if (event.key === TIME_DRAFT_USER_KEY || event.key === null) {
        stateRef.current = null;
        setState(null);
        return;
      }
      // Keep unsaved on-screen values intact when another tab changes or removes its draft.
      const next = { ...current, status: 'changed' as const };
      stateRef.current = next;
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const write = (fields: TimeEntryDraftFields, originalUpdatedAt: string | null) => {
    const current = stateRef.current;
    const currentScope = scopeRef.current;
    if (!currentScope || !current || current.key !== timeEntryDraftKey(currentScope) || current.pending) return;
    const result = writeTimeEntryDraft(currentScope, fields, current.draft?.revision ?? null, originalUpdatedAt);
    const next: DraftState = result.status === 'ready'
      ? { ...current, draft: result.draft, status: 'saved' }
      : { ...current, status: result.status };
    stateRef.current = next;
    setState(next);
  };

  const resume = () => {
    const current = stateRef.current;
    if (!current?.draft) return null;
    const next: DraftState = { ...current, pending: false, status: current.status === 'changed' ? 'changed' : 'saved' };
    stateRef.current = next;
    setState(next);
    return current.draft;
  };

  const discard = () => {
    const current = stateRef.current;
    const currentScope = scopeRef.current;
    if (!current?.draft || !currentScope) return false;
    if (!clearTimeEntryDraft(currentScope, current.draft.revision)) {
      initialize();
      return false;
    }
    const next: DraftState = { ...current, draft: null, pending: false, status: 'ready' };
    stateRef.current = next;
    setState(next);
    return true;
  };

  return {
    initialized: Boolean(key && state?.key === key), key,
    draft: state?.key === key ? state.draft : null,
    pending: state?.key === key && state.pending,
    status: state?.key === key ? state.status : 'ready',
    write, resume, discard,
    capture: () => scope && stateRef.current?.key === key && stateRef.current.draft
      ? { scope: { ...scope }, revision: stateRef.current.draft.revision } : null,
  };
}
