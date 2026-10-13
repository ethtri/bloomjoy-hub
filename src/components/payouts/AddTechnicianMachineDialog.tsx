import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchTimekeepingSetupContext, type TechnicianPayReportTechnician } from '@/lib/operatorPayouts';
import {
  addOperatorMachineArrangement, ArrangementSaveError, fetchOperatorMachineArrangementResult,
  type AddMachineArrangementInput,
} from '@/lib/operatorMachineArrangement';

const storageKey = (profileId: string) => `operator-machine-arrangement:${profileId}`;
const readPending = (profileId: string): AddMachineArrangementInput | null => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(profileId)) || 'null');
    return saved?.requestId && saved.operatorProfileId === profileId ? saved : null;
  } catch { return null; }
};

export function AddTechnicianMachineDialog({ technician, month, onClose }: {
  technician: TechnicianPayReportTechnician;
  month: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(() => readPending(technician.operatorProfileId));
  const [machineId, setMachineId] = useState(pending?.machineId ?? '');
  const [startDate, setStartDate] = useState(pending?.effectiveStartDate ?? `${month}-01`);
  const [endDate, setEndDate] = useState(pending?.effectiveEndDate ?? '');
  const [shiftRate, setShiftRate] = useState(pending ? (pending.shiftRateCents / 100).toFixed(2) : '');
  const [commission, setCommission] = useState(pending ? (pending.commissionBasisPoints / 100).toFixed(2) : '');
  const [commissionDate, setCommissionDate] = useState(pending?.commissionStartDate ?? `${month}-01`);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(pending ? 'A previous save needs checking before another machine is added.' : null);
  const choices = useQuery({
    queryKey: ['timekeeping-setup-context'], queryFn: fetchTimekeepingSetupContext, retry: false, staleTime: 0,
  });
  const assigned = new Set((technician.assignments ?? []).filter((assignment) => assignment.editable).map((assignment) => assignment.machineId));
  const machines = (choices.data?.accounts.find((account) => account.accountId === technician.accountId)?.machines ?? [])
    .filter((machine) => !assigned.has(machine.machineId) || machine.machineId === pending?.machineId);
  const selectedMachine = machines.find((machine) => machine.machineId === machineId);
  const locked = busy || Boolean(pending);

  const clearPending = () => {
    sessionStorage.removeItem(storageKey(technician.operatorProfileId));
    setPending(null);
  };
  const finish = () => {
    clearPending();
    void queryClient.invalidateQueries({ queryKey: ['technician-pay-report'] });
    void queryClient.invalidateQueries({ queryKey: ['operator-time-report'] });
    toast.success('Machine and pay arrangement added. Existing arrangements are unchanged.');
    onClose();
  };
  const save = async (input: AddMachineArrangementInput) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      // Keep the exact identity across a reload or lost response. A retry uses
      // the same request and the server returns its atomic audit receipt.
      sessionStorage.setItem(storageKey(technician.operatorProfileId), JSON.stringify(input));
      setPending(input);
      await addOperatorMachineArrangement(input);
      finish();
    } catch (saveError) {
      if (saveError instanceof ArrangementSaveError && !saveError.outcomeUnknown) {
        clearPending();
        setError(`${saveError.message} No changes were saved.`);
      } else {
        setError('We could not confirm this save. Check its status or retry this same save safely. Your submitted details are kept.');
      }
    } finally { busyRef.current = false; setBusy(false); }
  };
  const submit = () => {
    const cents = Math.round(Number(shiftRate) * 100);
    const basisPoints = Math.round(Number(commission) * 100);
    if (!selectedMachine || !startDate || !commissionDate || !shiftRate.trim() || !commission.trim()) {
      setError('Choose a machine and complete the dates, pay, and commission. Enter 0 for no commission.'); return;
    }
    if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isSafeInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000) {
      setError('Enter pay greater than zero and commission from 0 to 100%.'); return;
    }
    if ((endDate && endDate < startDate) || commissionDate < startDate || (endDate && commissionDate > endDate)) {
      setError('Commission must start within the assignment dates.'); return;
    }
    void save({ requestId: crypto.randomUUID(), operatorProfileId: technician.operatorProfileId, machineId,
      effectiveStartDate: startDate, effectiveEndDate: endDate || null, shiftRateCents: cents,
      commissionBasisPoints: basisPoints, commissionStartDate: commissionDate });
  };
  const checkSave = async () => {
    if (!pending || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      const result = await fetchOperatorMachineArrangementResult(pending.requestId);
      if (result) finish();
      else setError('No completed save is confirmed yet. Retry the same save safely, or close and check again later.');
    } catch {
      setError('The save status is still unavailable. Your submitted details are kept; do not create a separate replacement request.');
    } finally { busyRef.current = false; setBusy(false); }
  };

  return <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
      <form onSubmit={(event) => { event.preventDefault(); if (!pending) submit(); }}>
        <DialogHeader>
          <DialogTitle>Add machine</DialogTitle>
          <DialogDescription>{technician.displayName} · Add one machine and its pay terms to this payroll profile. Existing assignments and rates stay unchanged.</DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-4">
          {choices.isLoading ? <p className="text-sm text-muted-foreground">Loading available machines…</p>
            : choices.error ? <div role="alert" className="text-sm text-destructive">Machine choices could not load. <Button type="button" variant="link" onClick={() => void choices.refetch()}>Try again</Button></div>
              : !machines.length && !pending ? <p className="text-sm text-muted-foreground">No additional machines are available in this payroll account. Existing assignments can be changed with Assignment dates.</p> : null}
          {(machines.length > 0 || pending) && <fieldset disabled={locked} className="space-y-4">
            <div><label htmlFor="add-payroll-machine" className="text-sm font-medium">Machine</label>
              <Select value={machineId} onValueChange={setMachineId} disabled={locked || Boolean(choices.error)}>
                <SelectTrigger id="add-payroll-machine" className="mt-2 min-h-11"><SelectValue placeholder="Choose a machine" /></SelectTrigger>
                <SelectContent>{machines.map((machine) => <SelectItem key={machine.machineId} value={machine.machineId}>{machine.machineLabel}</SelectItem>)}</SelectContent>
              </Select>
              {pending && !selectedMachine && <p className="mt-2 text-sm text-muted-foreground">Checking the machine from your saved request.</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label htmlFor="add-machine-start" className="text-sm font-medium">Assigned from</label><Input id="add-machine-start" type="date" className="mt-2 min-h-11" value={startDate} onChange={(event) => { const value = event.target.value; setStartDate(value); if (commissionDate === startDate) setCommissionDate(value); }} required /></div>
              <div><label htmlFor="add-machine-end" className="text-sm font-medium">Assigned through (optional)</label><Input id="add-machine-end" type="date" className="mt-2 min-h-11" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></div>
            </div>
            <div><label htmlFor="add-machine-rate" className="text-sm font-medium">Pay per started hour ($)</label><Input id="add-machine-rate" type="number" min="0.01" step="0.01" className="mt-2 min-h-11" value={shiftRate} onChange={(event) => setShiftRate(event.target.value)} required /></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div><label htmlFor="add-machine-commission" className="text-sm font-medium">Commission (%)</label><Input id="add-machine-commission" type="number" min="0" max="100" step="0.01" className="mt-2 min-h-11" value={commission} onChange={(event) => setCommission(event.target.value)} required /></div>
              <div><label htmlFor="add-machine-commission-start" className="text-sm font-medium">Commission starts</label><Input id="add-machine-commission-start" type="date" min={startDate} max={endDate || undefined} className="mt-2 min-h-11" value={commissionDate} onChange={(event) => setCommissionDate(event.target.value)} required /></div>
            </div>
          </fieldset>}
          {commissionDate > startDate && <p className="text-sm text-muted-foreground">Commission is 0% from the assignment start until the commission start date.</p>}
          <p className="text-xs leading-5 text-muted-foreground">These terms apply only to this machine. Backdating changes pay attribution for those dates. The complete arrangement saves together and stays in the audit history.</p>
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter className="mt-6 gap-2">
          <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={onClose}>{pending ? 'Close' : 'Cancel'}</Button>
          {pending ? <>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void checkSave()}>Check save status</Button>
            <Button type="button" className="min-h-11" disabled={busy} onClick={() => void save(pending)}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Retry same save</Button>
          </> : <Button type="submit" className="min-h-11" disabled={busy || choices.isLoading || Boolean(choices.error) || !selectedMachine}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add machine and pay</Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
