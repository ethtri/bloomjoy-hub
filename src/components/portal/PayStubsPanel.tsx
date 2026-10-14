import { usePayStubFormat } from '@/hooks/usePayStubFormat';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { OperatorPayStatementProfileContext, OperatorPayStatementSummary } from '@/lib/operatorPayouts';
import { usePublishedPayArtifact } from '@/hooks/usePublishedPayStubs';
import { newestPublishedStatements, payStubHref, publishedPayAmount } from '@/lib/publishedPayStub';
import { PayStubDownload, PayStubError, PayStubLoading } from './PayStubShared';

function StatementRow({ statement, profileId }: { statement: OperatorPayStatementSummary; profileId: string }) {
  const { t, date, money } = usePayStubFormat();
  const query = usePublishedPayArtifact(profileId, statement.id);
  const amount = query.isError ? null : publishedPayAmount(query.data?.statement);
  return <article className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
    <div className="min-w-0 space-y-1">
      <p className="break-words font-semibold">{statement.statementLabel}</p>
      <p className="text-sm leading-6 text-muted-foreground">{date(statement.periodStartDate)} – {date(statement.periodEndDate)}</p>
      {statement.version > 1 && <p className="text-sm text-muted-foreground">{t('payStub.revised', { version: statement.version })}</p>}
      {query.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t('payStub.loadingAmount')}</p> : amount !== null ? <p className="text-sm font-medium tabular-nums" data-published-pay-amount>{money(amount)} <span className="font-normal text-muted-foreground">USD</span></p> : <p role="status" className="text-sm text-muted-foreground">{t('payStub.amountUnavailable')}</p>}
    </div>
    <div className="flex shrink-0 flex-wrap gap-2"><Button asChild variant="secondary" className="min-h-11"><Link to={payStubHref(profileId, statement.id)}>{t('payStub.view')}</Link></Button><PayStubDownload statementId={statement.id} /></div>
  </article>;
}

export function PayStubsPanel({ profile, isLoading, error, onRetry, expanded = false }: {
  profile?: OperatorPayStatementProfileContext; isLoading: boolean; error: unknown; onRetry: () => void; expanded?: boolean;
}) {
  const { t } = usePayStubFormat();
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(6);
  const statements = newestPublishedStatements(profile?.statements ?? []);
  const content = error ? <div className="p-5"><PayStubError onRetry={onRetry} /></div> : isLoading ? <div className="p-5"><PayStubLoading /></div> : !statements.length ? <p className="p-5 text-sm leading-6 text-muted-foreground">{t('workday.noPay')}</p> : <div className="divide-y divide-border">{statements.slice(0, visibleCount).map(statement => <StatementRow key={statement.id} statement={statement} profileId={profile.id} />)}{statements.length > visibleCount && <div className="p-4"><Button variant="outline" className="min-h-11" onClick={() => setVisibleCount(count => count + 6)}>{t('payStub.more')}</Button></div>}</div>;
  if (expanded) return <section id="pay-stubs" aria-label={t('workday.payStubs')} className="overflow-hidden rounded-2xl border border-border bg-card">{content}</section>;
  return <details id="pay-stubs" onToggle={event => setOpen(event.currentTarget.open)} className="group overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
      <span className="flex min-w-0 items-center gap-3"><span className="rounded-lg bg-muted p-2 text-muted-foreground"><FileText className="h-5 w-5" aria-hidden="true" /></span><span><span className="block font-semibold">{t('workday.payStubs')}</span><span className="block text-sm text-muted-foreground">{t('workday.payDescription')}</span></span></span><ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
    </summary>
    {open && <div className="border-t border-border">{content}</div>}
  </details>;
}
