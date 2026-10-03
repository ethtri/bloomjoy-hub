import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReportingTaxAmountBasis, ReportingTaxTender } from '@/lib/reportingTaxTreatment';

export type TaxTreatmentDraft = { amountBasis: ReportingTaxAmountBasis; taxablePortionPercent: string };
type Props = {
  idPrefix?: string;
  values: Record<ReportingTaxTender, TaxTreatmentDraft>;
  rate: string;
  loading: boolean;
  error: boolean;
  disabled: boolean;
  onChange: (tender: ReportingTaxTender, value: TaxTreatmentDraft) => void;
  onRetry: () => void;
};

export function TaxTreatmentFields({ idPrefix = 'tax', values, rate, loading, error, disabled, onChange, onRetry }: Props) {
  return <details className="border-t border-border pt-2">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Tax treatment (optional)</summary>
    <p className="mb-3 text-xs leading-relaxed text-muted-foreground">Automatic preserves each source's reporting basis. Overrides source defaults; recorded tax details stay authoritative.</p>
    {loading ? <p role="status" className="py-2 text-sm text-muted-foreground">Loading saved treatment…</p> : error ? <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">Saved treatment could not be loaded. You can still save the rate above.</p><Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>Retry treatment</Button></div> : <>
      <div className="grid gap-3 sm:grid-cols-2">{(['card', 'cash'] as const).map(tender => <div key={tender}><Label htmlFor={`${idPrefix}-treatment-${tender}`}>{tender === 'card' ? 'Card source amounts' : 'Cash source amounts'}</Label><select id={`${idPrefix}-treatment-${tender}`} value={values[tender].amountBasis} disabled={disabled} className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event => onChange(tender, { ...values[tender], amountBasis: event.target.value as ReportingTaxAmountBasis })}><option value="source_default">Automatic</option><option value="tax_inclusive">Includes tax</option><option value="tax_exclusive">Excludes tax</option></select></div>)}</div>
      <details className="mt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Taxable portion</summary><p className="mb-3 text-xs leading-relaxed text-muted-foreground">Share of the tax-exclusive purchase value subject to the rate above. Use the documented treatment for this machine.</p><div className="grid gap-3 sm:grid-cols-2">{(['card', 'cash'] as const).map(tender => {
        const share = Number(values[tender].taxablePortionPercent); const statutoryRate = Number(rate);
        const valid = values[tender].taxablePortionPercent.trim() !== '' && Number.isFinite(share) && share >= 0 && share <= 100;
        return <div key={tender}><Label htmlFor={`${idPrefix}-portion-${tender}`}>{tender === 'card' ? 'Card taxable %' : 'Cash taxable %'}</Label><Input id={`${idPrefix}-portion-${tender}`} type="number" className="mt-1 h-11" min={0} max={100} step="0.01" value={values[tender].taxablePortionPercent} disabled={disabled} onChange={event => onChange(tender, { ...values[tender], taxablePortionPercent: event.target.value })} aria-invalid={!valid} aria-describedby={`${idPrefix}-portion-${tender}-help`}/><p id={`${idPrefix}-portion-${tender}-help`} className={`mt-1 text-xs ${valid ? 'text-muted-foreground' : 'text-destructive'}`}>{!valid ? 'Enter a percentage from 0 to 100.' : rate.trim() && Number.isFinite(statutoryRate) && statutoryRate >= 0 && statutoryRate <= 100 ? `${Number((statutoryRate * share / 100).toFixed(4))}% effective reporting rate` : '100% applies the full rate; 0% removes no tax.'}</p></div>;
      })}</div></details>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Uses the same Applies from date and reason. Customer-charge refund amounts retain their own tax basis.</p>
    </>}
  </details>;
}
