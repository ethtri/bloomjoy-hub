import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';
import { fetchPartnershipReportingSetup, upsertReportingMachineAssignmentAdmin, type PartnershipReportingSetup, type ReportingMachinePartnershipAssignment } from '@/lib/partnershipReporting';
import { overlappingMachinePartnerships, validAssignmentDate } from '@/lib/machinePartnershipAssignment';
import { getActiveMachineAssignments, today } from '@/pages/admin/reportingSetupUi';

const setupKey = ['admin-partnership-reporting-setup'];
const displayDate = (value: string) => validAssignmentDate(value) ? new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'choose a date';
const dateWindow = (assignment: ReportingMachinePartnershipAssignment) => `${displayDate(assignment.effective_start_date)}${assignment.effective_end_date ? ` to ${displayDate(assignment.effective_end_date)}` : ' onward'}`;

export function MachinePartnershipAssignment({ machineId, machineName, setup, canManage, verified, loading, readError, machineDirty, busy, resetVersion, demo, onDirtyChange, onSavingChange }: {
  machineId: string;
  machineName: string;
  setup: PartnershipReportingSetup;
  canManage: boolean;
  verified: boolean;
  loading: boolean;
  readError: boolean;
  machineDirty: boolean;
  busy: boolean;
  resetVersion: number;
  demo: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [partnershipId, setPartnershipId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [initialDate, setInitialDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<ReportingMachinePartnershipAssignment | null>(null);
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const partnerships = setup.partnerships.filter((item) => item.status !== 'archived');
  const selected = partnerships.find((item) => item.id === partnershipId);
  const allAssignments = saved && !setup.assignments.some((item) => item.id === saved.id) ? [...setup.assignments, saved] : setup.assignments;
  const current = getActiveMachineAssignments({ ...setup, assignments: allAssignments }, machineId);
  const scheduled = allAssignments.filter((item) => item.machine_id === machineId && item.status === 'active' && item.effective_start_date > today());
  const overlaps = overlappingMachinePartnerships(allAssignments, machineId, startDate);
  const hasOngoingPrimary = allAssignments.some((item) => item.machine_id === machineId && item.status === 'active' && item.assignment_role === 'primary_reporting' && !item.effective_end_date);
  const dirty = editing && Boolean(partnershipId || startDate !== initialDate);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { setEditing(false); setPickerOpen(false); setPartnershipId(''); setError(''); }, [resetVersion]);

  const refresh = async () => {
    // Keep a failed post-write read local, so the page's shared query stays usable.
    const refreshed = await fetchPartnershipReportingSetup();
    queryClient.setQueryData(setupKey, refreshed);
    setRefreshNeeded(false);
  };
  const add = async () => {
    if (!canManage || !verified || loading || readError || busy || saving || machineDirty || !selected || !validAssignmentDate(startDate) || overlaps.length || demo || refreshNeeded) return;
    setSaving(true); onSavingChange(true); setError('');
    try {
      const result = await upsertReportingMachineAssignmentAdmin({ assignmentId: null, machineId, partnershipId: selected.id, assignmentRole: 'primary_reporting', effectiveStartDate: startDate, effectiveEndDate: '', status: 'active', notes: null, reason: 'Machine added to partnership from machine page' });
      const assignment = { ...result, machine_id: machineId, machine_label: machineName, partnership_id: selected.id, partnership_name: selected.name, assignment_role: 'primary_reporting', effective_start_date: startDate, effective_end_date: null, status: 'active' as const, notes: null };
      // A confirmed write remains visible if the subsequent read fails; Retry only reads.
      setSaved(assignment); setEditing(false); setPartnershipId(''); onDirtyChange(false);
      queryClient.setQueryData<PartnershipReportingSetup>(setupKey, (previous) => previous ? { ...previous, assignments: [...previous.assignments.filter((item) => item.id !== assignment.id), assignment] } : previous);
      try { await refresh(); } catch { setRefreshNeeded(true); setError('Partnership added. Refresh the assignments to verify the latest list.'); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to add this partnership.');
      // Re-read after a rejected or uncertain response before another deliberate attempt.
      setRefreshNeeded(true);
      try { await refresh(); } catch { /* Keep the selected draft and a read-only retry. */ }
    } finally { setSaving(false); onSavingChange(false); }
  };
  const cancel = () => { setEditing(false); setPickerOpen(false); setPartnershipId(''); setStartDate(today()); setError(''); onDirtyChange(false); };
  const readBlocked = loading || readError || !verified;
  return <div className="mt-4 border-b border-border pb-5" role="region" aria-label="Partnership assignment">
    <h3 className="text-base font-semibold">Partnership</h3>
    {current.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Not assigned</p> : <ul className="mt-2 space-y-2 text-sm">{current.map((assignment) => <li key={assignment.id}><span className="font-medium">{assignment.partnership_name}</span><span className="block text-muted-foreground">{dateWindow(assignment)}</span></li>)}</ul>}
    {scheduled.length > 0 && <div className="mt-2 text-sm"><p className="text-muted-foreground">Scheduled</p>{scheduled.map((assignment) => <p key={assignment.id}>{assignment.partnership_name}: {dateWindow(assignment)}</p>)}</div>}
    {saved && !editing && !refreshNeeded && <p className="mt-2 text-sm" role="status">Partnership added.</p>}
    {canManage && !editing && !hasOngoingPrimary && <Button type="button" variant="outline" className="mt-3 min-h-11 text-base" disabled={readBlocked || busy || demo || refreshNeeded || partnerships.length === 0} onClick={() => { const date = today(); setInitialDate(date); setStartDate(date); setError(''); setEditing(true); }}>Add to partnership</Button>}
    {!canManage && <p className="mt-2 text-sm text-muted-foreground">You can view this machine’s partnership assignments.</p>}
    {canManage && partnerships.length === 0 && !loading && !readError && <p className="mt-2 text-sm text-muted-foreground">No partnerships are available to assign.</p>}
    {canManage && readBlocked && <p className="mt-2 text-sm text-muted-foreground">{loading ? 'Loading partnership assignments…' : readError ? 'Partnership assignments could not be loaded.' : 'Verify the imported source before adding a partnership.'}</p>}
    {editing && canManage && <div className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="min-w-0 space-y-1"><Label htmlFor="machine-partnership">Partnership</Label><Popover open={pickerOpen} onOpenChange={setPickerOpen}><PopoverTrigger asChild><Button id="machine-partnership" type="button" role="combobox" aria-expanded={pickerOpen} aria-required="true" variant="outline" className="h-auto min-h-11 w-full justify-between whitespace-normal text-left text-base font-normal" disabled={saving || busy}>{selected?.name || 'Choose partnership'}<ChevronDown className="ml-2 h-4 w-4 shrink-0" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"><Command><CommandInput placeholder="Search partnerships" className="h-11 text-base" /><CommandList><CommandEmpty>No matching partnership.</CommandEmpty>{partnerships.map((item) => <CommandItem key={item.id} value={`${item.name} ${item.id}`} className="min-h-11 whitespace-normal text-base" onSelect={() => { setPartnershipId(item.id); setPickerOpen(false); setError(''); }}>{item.name}</CommandItem>)}</CommandList></Command></PopoverContent></Popover></div>
        <div className="space-y-1"><Label htmlFor="machine-partnership-start">Effective from</Label><Input id="machine-partnership-start" type="date" required value={startDate} onChange={(event) => { setStartDate(event.target.value); setError(''); }} disabled={saving || busy} className="h-11 min-w-0 text-base" /></div>
      </div>
      {selected && <p className="text-sm">{machineName} → {selected.name}, from {displayDate(startDate)}. Uses this partnership’s existing terms.</p>}
      {startDate && !validAssignmentDate(startDate) && <p className="text-sm text-destructive">Choose a valid effective start date.</p>}
      {overlaps.length > 0 && <p className="text-sm" role="status">Already assigned to {overlaps.map((item) => `${item.partnership_name} (${dateWindow(item)})`).join(', ')} for these dates. <Link className="underline underline-offset-4" to="/admin/partnerships">Manage partnerships</Link></p>}
      {machineDirty && <p className="text-sm text-muted-foreground">Save or cancel your machine changes before adding a partnership.</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11 text-base" onClick={() => void add()} disabled={!canManage || !selected || !validAssignmentDate(startDate) || overlaps.length > 0 || saving || busy || machineDirty || readBlocked || demo || refreshNeeded}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Add to partnership</Button><Button type="button" variant="outline" className="min-h-11 text-base" aria-label="Cancel partnership change" onClick={cancel} disabled={saving}>Cancel</Button></div>
    </div>}
    {error && <p className="mt-3 text-sm" role="alert">{error}</p>}
    {(refreshNeeded || readError) && canManage && <Button type="button" variant="outline" className="mt-2 min-h-11 text-base" disabled={saving} onClick={() => { setSaving(true); onSavingChange(true); void refresh().catch(() => setError('Partnership assignments could not be refreshed. Try again.')).finally(() => { setSaving(false); onSavingChange(false); }); }}>Refresh assignments</Button>}
    {canManage && !editing && <Button type="button" variant="link" className="mt-2 min-h-11 px-0 text-base" asChild><Link to="/admin/partnerships">Manage partnerships</Link></Button>}
  </div>;
}
