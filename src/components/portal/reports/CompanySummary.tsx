import { Button } from '@/components/ui/button';
import { companyBasis } from '@/lib/companyReporting';

export type CompanySummaryRow = { id: string; name: string; detail: string; value: string; note?: string };
export function CompanySummary({ rows, onCompany }: { rows: CompanySummaryRow[]; onCompany: (id: string) => void }) {
  return <section className="min-w-0 border-t border-border pt-4" aria-label="Company comparison">
    <h2 className="text-sm font-semibold">By company</h2><p className="mt-1 text-xs text-muted-foreground">{companyBasis}</p>
    <div className="mt-2 divide-y">{rows.map(row => <div key={row.id} className="grid min-w-0 gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
      <div className="min-w-0">{row.id === 'unassigned' ? <p className="break-words text-sm font-medium">{row.name}</p> : <Button variant="link" className="h-auto min-h-11 max-w-full justify-start whitespace-normal break-words px-0 text-left" onClick={() => onCompany(row.id)}>{row.name}</Button>}<p className="text-xs text-muted-foreground">{row.detail}</p></div>
      <div className="min-w-0 sm:text-right"><p className="break-words text-sm font-medium tabular-nums">{row.value}</p>{row.note && <p className="break-words text-xs text-muted-foreground">{row.note}</p>}</div>
    </div>)}</div>{!rows.length && <p className="mt-3 text-sm text-muted-foreground">No recorded activity in this scope.</p>}
  </section>;
}
