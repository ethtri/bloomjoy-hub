import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { emailAlertsQueryKey, useEmailAlerts } from '@/hooks/useEmailAlerts';
import { alertDefinitions, alertSchedule, changeMachineSubscriptions, machinesForAlert, preferencesFrom, saveEmailAlertPreferences, type EmailAlertContext, type EmailAlertId } from '@/lib/emailAlerts';
import { ManagerAlertNotice } from './EmailAlertControls';

export function MachineEmailAlerts({ machineId }: { machineId: string }) {
  const query = useEmailAlerts();
  const [open, setOpen] = useState(false);
  const machine = query.data?.machines.find(item => item.machineId === machineId);
  if (!query.data?.eligible || !machine) return null;
  return <><Button variant="outline" className="min-h-11" onClick={() => setOpen(true)}><Bell className="mr-2 h-4 w-4"/>Email alerts</Button>{open && <MachinePanel context={query.data} machineId={machineId} onClose={() => setOpen(false)}/>}</>;
}

function MachinePanel({ context: initialContext, machineId, onClose }: { context: EmailAlertContext; machineId: string; onClose: () => void }) {
  const [context] = useState(initialContext);
  const { user } = useAuth();
  const navigate = useNavigate();
  const cache = useQueryClient();
  const machine = context.machines.find(item => item.machineId === machineId)!;
  const initial = context.alerts.filter(alert => alert.enabled && machinesForAlert(alert, context.machines).some(item => item.machineId === machineId)).map(alert => alert.id);
  const [selected, setSelected] = useState<EmailAlertId[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...initial].sort());
  const guard = (action: () => void) => { if (saving) return; if (dirty) setLeave(() => action); else action(); };
  const save = async () => {
    setSaving(true); setError('');
    try {
      const next = changeMachineSubscriptions(preferencesFrom(context), context.machines, machineId, selected);
      const result = await saveEmailAlertPreferences(next, context.revision);
      cache.setQueryData(emailAlertsQueryKey(user?.id), result);
      toast.success(`Email preferences saved for ${machine.machineLabel}.`); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your changes could not be saved.'); }
    finally { setSaving(false); }
  };
  return <><Sheet open onOpenChange={open => { if (!open) guard(onClose); }}><SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
    <SheetHeader className="border-b px-6 py-6 text-left"><SheetTitle>Email alerts</SheetTitle><SheetDescription>{machine.machineLabel}</SheetDescription></SheetHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><p className="mb-3 text-sm leading-relaxed text-muted-foreground">Choose updates for this machine. Your other machines keep their existing choices.</p>
      <fieldset disabled={saving}>{context.alerts.filter(alert => alert.id !== 'decision-ready' || machine.isManager).map(alert => {
        const allowed = alert.available && machine.availableAlertIds.includes(alert.id);
        return <label key={alert.id} className="flex min-h-20 items-start justify-between gap-4 border-b py-5"><span><span className="block text-sm font-semibold">{alertDefinitions[alert.id].name}</span><span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{allowed ? alertSchedule(alert.id, context.settings) : alert.unavailableReason || 'This update is not available for this machine.'}</span></span><Checkbox className="mt-1" aria-label={`Receive ${alertDefinitions[alert.id].name}`} disabled={!allowed && !selected.includes(alert.id)} checked={selected.includes(alert.id)} onCheckedChange={checked => setSelected(previous => checked === true ? [...previous.filter(id => id !== alert.id), alert.id] : previous.filter(id => id !== alert.id))}/></label>;
      })}</fieldset>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Delivery follows your email preferences in {context.settings.timezone.replace(/_/g, ' ')}.</p>
      <Button asChild variant="link" className="mt-3 h-auto min-h-11 whitespace-normal px-0"><Link to="/portal/notifications" onClick={event => { event.preventDefault(); guard(() => { onClose(); navigate('/portal/notifications'); }); }}>Manage all alerts & delivery times</Link></Button><ManagerAlertNotice context={context}/>
      {error && <Alert variant="destructive" className="mt-5" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    </div><div className="flex shrink-0 justify-end gap-3 border-t bg-background p-5"><Button variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button disabled={saving || !dirty} onClick={() => void save()}>{saving ? 'Saving…' : 'Save preferences'}</Button></div>
  </SheetContent></Sheet><AlertDialog open={Boolean(leave)} onOpenChange={open => { if (!open) setLeave(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave without saving?</AlertDialogTitle><AlertDialogDescription>Your saved machine subscriptions will stay as they are.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { const action = leave; setLeave(null); action?.(); }}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

export function SubscribeToDigest({ machineIds }: { machineIds: string[] }) {
  const query = useEmailAlerts();
  if (!query.data?.eligible) return null;
  const ids = machineIds.filter(id => query.data.machines.some(machine => machine.machineId === id && machine.availableAlertIds.includes('daily')));
  const search = new URLSearchParams({ setup: 'digests', machines: ids.join(',') });
  return <Button asChild variant="outline" className="min-h-11" disabled={!ids.length}><Link to={`/portal/notifications?${search}`} aria-disabled={!ids.length} onClick={event => { if (!ids.length) event.preventDefault(); }}><Bell className="mr-2 h-4 w-4"/>Subscribe to digest</Link></Button>;
}
