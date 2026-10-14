import { usePayStubFormat } from '@/hooks/usePayStubFormat';
import { ChevronRight } from 'lucide-react';
import type { OperatorPayStatementSummary } from '@/lib/operatorPayouts';
import type { PublishedPaySegment, PublishedPayStub, PublishedPayTotals } from '@/lib/publishedPayStub';
import { parsePublishedPayStub, publishedPayAmount, publishedStatementDate } from '@/lib/publishedPayStub';
import { usePublishedPayArtifact } from '@/hooks/usePublishedPayStubs';
import { PayStubDownload, PayStubError, PayStubLoading } from './PayStubShared';

function SavedEarnings({ statement }: { statement: PublishedPayStub }) {
  const { t, money, duration } = usePayStubFormat();
  const rows: Array<[string, keyof PublishedPayTotals]> = [
    [t('payStub.shiftPay'), 'shiftEarningsCents'], [t('payStub.commission'), 'commissionEarningsCents'],
    [t('payStub.bonus'), 'bonusCents'], [t('payStub.supply'), 'supplyCreditCents'], [t('payStub.expense'), 'expenseReimbursementCents'],
  ];
  return <section aria-labelledby="pay-earnings-title" className="border-t border-border pt-5">
    <h2 id="pay-earnings-title" className="text-xl font-semibold">{t('payStub.earnings')} <span className="text-sm font-normal text-muted-foreground">USD</span></h2>
    <dl className="my-5 grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">{t('payStub.worked')}</dt><dd className="mt-1 font-medium tabular-nums">{duration(statement.current.actualMinutes)}</dd></div><div><dt className="text-sm text-muted-foreground">{t('payStub.salesBasis')}</dt><dd className="mt-1 font-medium tabular-nums">{money(statement.current.commissionableSalesCents)}</dd></div></dl>
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{t('payStub.earnings')}</caption>
      <colgroup><col className="w-[40%]" /><col className="w-[30%]" /><col className="w-[30%]" /></colgroup>
      <thead><tr className="border-b border-border"><th scope="col" className="pb-3 text-left font-medium"><span className="sr-only">{t('payStub.earnings')}</span></th><th scope="col" className="break-words pb-3 pl-2 text-right font-medium">{t('payStub.current')}</th><th scope="col" className="break-words pb-3 pl-2 text-right font-medium">{t('payStub.ytd')}</th></tr></thead>
      <tbody>
        <tr className="border-b border-border"><th scope="row" className="py-3 pr-2 text-left align-top font-normal">{t('payStub.shifts')}</th><td className="break-all py-3 pl-2 text-right align-top tabular-nums">{statement.current.paidShifts}</td><td className="break-all py-3 pl-2 text-right align-top tabular-nums">{statement.yearToDate.paidShifts}</td></tr>
        {rows.map(([label, key]) => <tr key={key} className="border-b border-border"><th scope="row" className="py-3 pr-2 text-left align-top font-normal">{label}</th><td className="break-all py-3 pl-2 text-right align-top tabular-nums">{money(statement.current[key])}</td><td className="break-all py-3 pl-2 text-right align-top tabular-nums">{money(statement.yearToDate[key])}</td></tr>)}
        <tr><th scope="row" className="py-4 pr-2 text-left align-top font-semibold">{t('payStub.total')}</th><td className="break-all py-4 pl-2 text-right align-top font-semibold tabular-nums" data-published-pay-amount>{money(statement.current.totalEarningsCents)}</td><td className="break-all py-4 pl-2 text-right align-top font-semibold tabular-nums">{money(statement.yearToDate.totalEarningsCents)}</td></tr>
      </tbody>
    </table>
  </section>;
}

function CommissionLine({ line }: { line: Partial<Pick<PublishedPaySegment, 'taxRatePercent' | 'commissionBasisPoints'>> & Pick<PublishedPaySegment, 'grossSalesCents' | 'refundAdjustmentCents' | 'taxCents' | 'commissionableSalesCents' | 'commissionEarningsCents'> }) {
  const { t, money, percent } = usePayStubFormat();
  const rows = [
    [t('payStub.sales'), money(line.grossSalesCents)], [t('payStub.refunds'), money(line.refundAdjustmentCents)],
    [t('payStub.tax'), money(line.taxCents)], [t('payStub.salesBasis'), money(line.commissionableSalesCents)],
    [t('payStub.taxRate'), line.taxRatePercent == null ? t('payStub.notAvailable') : percent(line.taxRatePercent)],
    [t('payStub.commissionRate'), line.commissionBasisPoints == null ? t('payStub.notAvailable') : percent(line.commissionBasisPoints / 100)],
    [t('payStub.commission'), money(line.commissionEarningsCents)],
  ];
  return <dl className="mt-3 space-y-2 text-sm">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-words text-right tabular-nums">{value}</dd></div>)}</dl>;
}

function SavedPayDetails({ statement }: { statement: PublishedPayStub }) {
  const { t, money, date, duration } = usePayStubFormat();
  return <details className="group border-t border-border">
    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-4 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">{t('payStub.details')}<ChevronRight className="h-5 w-5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" /></summary>
    <div className="space-y-6 pb-5">
      {Boolean(statement.shiftRateLines?.length) && <section aria-label={t('payStub.shiftDetails')}><h3 className="font-semibold">{t('payStub.shiftDetails')}</h3><ul className="divide-y divide-border">{statement.shiftRateLines.map((line, index) => <li key={index} className="py-4">
        <p className="break-words text-sm font-medium">{line.machineLabel || t('payStub.allMachines')}</p>
        <dl className="mt-3 space-y-2 text-sm">{[
          [t('payStub.worked'), duration(line.actualDurationMinutes)], [t('payStub.shifts'), String(line.paidShifts)],
          [t('payStub.shiftRate'), line.shiftRateCents === null ? t('payStub.notAvailable') : money(line.shiftRateCents)], [t('payStub.shiftPay'), money(line.shiftEarningsCents)],
        ].map(([label, value]) => <div key={label} className="grid grid-cols-2 gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-words text-right tabular-nums">{value}</dd></div>)}</dl>
      </li>)}</ul></section>}
      {statement.machines.length > 0 && <section aria-label={t('payStub.commissionDetails')}><h3 className="font-semibold">{t('payStub.commissionDetails')}</h3><ul className="divide-y divide-border">{statement.machines.map(machine => <li key={machine.machineId} className="py-4"><p className="break-words text-sm font-medium">{machine.machineLabel}</p>{machine.commissionSegments.length ? machine.commissionSegments.map((segment, index) => <div key={index} className="mt-4 border-t border-border pt-3">
        {segment.segmentStartDate && segment.segmentEndDate && <p className="text-sm text-muted-foreground">{date(segment.segmentStartDate)} – {date(segment.segmentEndDate)}</p>}<CommissionLine line={segment} />
      </div>) : <CommissionLine line={machine} />}</li>)}</ul></section>}
      {Boolean(statement.otherEarnings?.length) && <section aria-label={t('payStub.otherDetails')}><h3 className="font-semibold">{t('payStub.otherDetails')}</h3><dl className="mt-3 space-y-3 text-sm">{statement.otherEarnings.map((item, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><dt className="break-words">{item.description}</dt><dd className="tabular-nums">{money(item.amountCents)}</dd></div>)}</dl></section>}
    </div>
  </details>;
}

export function PayStubDetails({ profileId, statement }: { profileId: string; statement: OperatorPayStatementSummary }) {
  const { t, date, money } = usePayStubFormat();
  const query = usePublishedPayArtifact(profileId, statement.id);
  if (query.isLoading) return <PayStubLoading />;
  if (query.isError || !query.data) return <PayStubError onRetry={() => void query.refetch()} busy={query.isFetching} />;
  const saved = parsePublishedPayStub(query.data.statement);
  const amount = publishedPayAmount(query.data.statement);
  const statementDate = publishedStatementDate(query.data.statement);
  return <article className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-6" data-pay-stub-detail>
    <header className="space-y-4 pb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h2 className="break-words text-xl font-semibold">{saved?.entity.name ?? statement.statementLabel}</h2>{saved && <p className="mt-1 break-words text-sm">{saved.contractor.displayName}{saved.contractor.positionTitle ? ` · ${saved.contractor.positionTitle}` : ''}</p>}{saved?.contractor.workerIdentifier && <p className="mt-1 break-words text-sm text-muted-foreground">{saved.contractor.workerIdentifier}</p>}<p className="mt-2 break-all text-xs text-muted-foreground">{t('payStub.number', { number: statement.statementNumber })}</p></div>
        <div className="shrink-0"><PayStubDownload statementId={statement.id} /></div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">{t('payStub.period')}</dt><dd className="mt-1">{date(saved?.period.periodStartDate ?? statement.periodStartDate)} – {date(saved?.period.periodEndDate ?? statement.periodEndDate)}</dd></div>{statementDate && <div><dt className="text-muted-foreground">{t('payStub.statementDate')}</dt><dd className="mt-1">{date(statementDate)}</dd></div>}</dl>
      {statement.version > 1 && <p className="text-sm font-medium">{t('payStub.revised', { version: statement.version })}</p>}
    </header>
    {saved ? <><SavedEarnings statement={saved} /><SavedPayDetails statement={saved} /><p className="border-t border-border pt-5 text-sm leading-6 text-muted-foreground">{saved.classificationNotice}</p></> : <div className="space-y-4 border-t border-border pt-5">{amount !== null && <p className="text-sm">{t('payStub.total')} (USD) <strong className="ml-2 tabular-nums" data-published-pay-amount>{money(amount)}</strong></p>}<p className="text-sm leading-6 text-muted-foreground">{t('payStub.fallback')}</p></div>}
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{t('payStub.noPayment')}</p>
  </article>;
}
