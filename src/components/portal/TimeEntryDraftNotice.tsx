import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TimeEntryDraft } from '@/lib/timeEntryDrafts';

type Props = {
  draft: TimeEntryDraft | null;
  pending: boolean;
  status: 'ready' | 'saved' | 'unavailable' | 'changed';
  conflict: 'missing' | 'changed' | 'locked' | null;
  machineName: string | undefined;
  checking: boolean;
  onContinue: () => void;
  onDiscard: () => void;
};

export function TimeEntryDraftNotice({ draft, pending, status, conflict, machineName, checking, onContinue, onDiscard }: Props) {
  const { t } = useLanguage();
  if ((pending || conflict) && draft) {
    return <section aria-labelledby="time-draft-heading" className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-4 sm:p-6">
      <h2 id="time-draft-heading" className="font-semibold">{t(conflict ? 'timeDraft.reviewTitle' : 'timeDraft.resumeTitle')}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t(conflict ? `timeDraft.${conflict}` : 'timeDraft.resumeDescription')}</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">{t('timeDraft.date')}</dt><dd className="font-medium">{draft.fields.workDate || t('timeDraft.notEntered')}</dd></div>
        <div><dt className="text-muted-foreground">{t('timeDraft.machine')}</dt><dd className="break-words font-medium">{machineName ?? t('timeDraft.unavailableMachine')}</dd></div>
        <div><dt className="text-muted-foreground">{t('timeDraft.start')}</dt><dd className="font-medium">{draft.fields.startTime || t('timeDraft.notEntered')}</dd></div>
        <div><dt className="text-muted-foreground">{t('timeDraft.end')}</dt><dd className="font-medium">{draft.fields.endTime || t('timeDraft.notEntered')}</dd></div>
      </dl>
      {status === 'changed' && <p role="status" className="mt-3 text-sm text-muted-foreground">{t('timeDraft.anotherTab')}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        {!conflict && <Button type="button" onClick={onContinue} disabled={checking} className="min-h-11">{t('timeDraft.continue')}</Button>}
        <Button type="button" variant="outline" onClick={onDiscard} className="min-h-11">{t('timeDraft.discard')}</Button>
      </div>
    </section>;
  }
  if (status === 'ready') return null;
  return <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
    <p role="status">{t(status === 'saved' ? 'timeDraft.saved' : status === 'changed' ? 'timeDraft.anotherTab' : 'timeDraft.unavailable')}</p>
    {draft && status === 'saved' && <Button type="button" variant="ghost" onClick={onDiscard} className="min-h-11">{t('timeDraft.discard')}</Button>}
  </div>;
}
