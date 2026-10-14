import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchMonthlyVisitAgreements, saveMonthlyVisitAgreement, type TechnicianPayReportTechnician } from '@/lib/operatorPayouts';
import { monthlyAgreementMoney, type MonthlyVisitAgreement } from '@/lib/monthlyVisitCompensation';

export function MonthlyVisitAgreementDialog({ technician, month, onClose }: {
  technician: TechnicianPayReportTechnician; month: string; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const current = technician.monthlyVisitLines?.[0]?.agreement;
  const [revision, setRevision] = useState<number | null>(current?.revision ?? null);
  const [agreementId, setAgreementId] = useState(current?.id ?? '');
  const [machineId, setMachineId] = useState(current?.reporting_machine_id ?? technician.assignments[0]?.machineId ?? '');
  const [start, setStart] = useState(current?.effective_start_date ?? `${month}-01`);
  const [end, setEnd] = useState(current?.effective_end_date ?? '');
  const [base, setBase] = useState(current ? (current.monthly_base_cents / 100).toFixed(2) : '');
  const [visits, setVisits] = useState(current?.included_visits.toString() ?? '');
  const [minutes, setMinutes] = useState(current?.included_minutes_per_visit.toString() ?? '60');
  const [extra, setExtra] = useState(current ? (current.extra_hour_rate_cents / 100).toFixed(2) : '');
  const [active, setActive] = useState(current?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const agreements = useQuery({ queryKey: ['monthly-visit-agreements', technician.operatorProfileId], queryFn: () => fetchMonthlyVisitAgreements(technician.operatorProfileId) });
  const choices = [...new Map(technician.assignments.map(a => [a.machineId, a.machineLabel])).entries()];
  const load = (agreement?: MonthlyVisitAgreement) => {
    setRevision(agreement?.revision ?? null); setAgreementId(agreement?.id ?? ''); setMachineId(agreement?.reporting_machine_id ?? choices[0]?.[0] ?? '');
    setStart(agreement?.effective_start_date ?? `${month}-01`); setEnd(agreement?.effective_end_date ?? '');
    setBase(agreement ? (agreement.monthly_base_cents / 100).toFixed(2) : ''); setVisits(agreement?.included_visits.toString() ?? '');
    setMinutes(agreement?.included_minutes_per_visit.toString() ?? '60'); setExtra(agreement ? (agreement.extra_hour_rate_cents / 100).toFixed(2) : '');
    setActive(agreement?.active ?? true); setError(null);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (![visits, minutes].every(v => /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 2147483647)) throw new Error('Enter whole positive numbers for visits and included minutes.');
      if (!machineId || !start || (end && end < start)) throw new Error('Choose an assigned machine and valid effective dates.');
      return saveMonthlyVisitAgreement({ id: agreementId || null, revision, operator_profile_id: technician.operatorProfileId, reporting_machine_id: machineId,
        effective_start_date: start, effective_end_date: end || null, monthly_base_cents: monthlyAgreementMoney(base),
        included_visits: Number(visits), included_minutes_per_visit: Number(minutes), extra_hour_rate_cents: monthlyAgreementMoney(extra), active });
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] }), queryClient.invalidateQueries({ queryKey: ['monthly-visit-agreements'] })]);
      onClose();
    }, onError: e => setError(e instanceof Error ? e.message : 'Unable to save the agreement.'),
  });
  const field = (id: string, label: string, value: string, update: (v: string) => void, type = 'text') => <div>
    <label className="text-sm font-medium" htmlFor={id}>{label}</label>
    <Input id={id} type={type} inputMode={type === 'text' ? 'decimal' : undefined} value={value} onChange={e => update(e.target.value)} className="mt-2 min-h-11" required={id !== 'monthly-end'} />
  </div>;
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <form onSubmit={e => { e.preventDefault(); setError(null); save.mutate(); }} className="space-y-5">
        <DialogHeader><DialogTitle>Monthly base plus extra time</DialogTitle><DialogDescription>{technician.displayName} · Set the agreed monthly terms for one assigned machine. Commission keeps its existing rate.</DialogDescription></DialogHeader>
        {agreements.data && agreements.data.length > 0 && <div><label htmlFor="monthly-agreement" className="text-sm font-medium">Agreement</label><select id="monthly-agreement" className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={agreementId} onChange={e => load(agreements.data.find(a => a.id === e.target.value))}>
          <option value="">New agreement</option>{agreements.data.map(a => <option key={a.id} value={a.id}>{a.effective_start_date} – {a.effective_end_date ?? 'Ongoing'}{a.active ? '' : ' · Inactive'}</option>)}
        </select></div>}
        <div><label htmlFor="monthly-machine" className="text-sm font-medium">Machine</label><select id="monthly-machine" required value={machineId} onChange={e => setMachineId(e.target.value)} className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Choose a machine</option>{choices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('monthly-base', 'Monthly base (USD)', base, setBase)}
          {field('monthly-visits', 'Included visits per month', visits, setVisits)}
          {field('monthly-minutes', 'Included minutes per visit', minutes, setMinutes)}
          {field('monthly-extra', 'Extra pay per hour (USD)', extra, setExtra)}
          {field('monthly-start', 'Effective from', start, setStart, 'date')}
          {field('monthly-end', 'Effective through (optional)', end, setEnd, 'date')}
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm leading-6"><p className="font-medium">Rules not yet agreed</p><p className="mt-1 text-muted-foreground">Fewer visits, additional visits, partial months, and fractional extra hours. A month needing any of these rules will show a specific issue before a Pay Stub can be published. Full months with the included visits and no fractional extra hours can be calculated.</p></div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="h-4 w-4" />Use this agreement for its effective dates</label>
        <p className="text-xs leading-5 text-muted-foreground">This replaces started-hour pay for this machine during the agreement. Actual time records and earlier Pay Stub versions stay saved. Changes may require a revised Pay Stub.</p>
        {(error || agreements.error) && <p role="alert" className="text-sm text-destructive">{error ?? 'Unable to load existing agreements. Close and try again.'}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>Cancel</Button><Button type="submit" disabled={save.isPending || agreements.isPending || Boolean(agreements.error)}>{save.isPending ? 'Saving…' : 'Save agreement'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
