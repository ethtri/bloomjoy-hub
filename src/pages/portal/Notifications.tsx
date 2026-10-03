import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { toast } from 'sonner';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { emailAlertsQueryKey, useEmailAlerts } from '@/hooks/useEmailAlerts';
import { alertDefinitions, alertSchedule, machinesForAlert, preferencesFrom, saveEmailAlertPreferences, validateEmailAlertPreferences, type EmailAlertContext, type EmailAlertId, type EmailAlertPreferences, type EmailAlertSubscription } from '@/lib/emailAlerts';
import { AlertMachineChoices, DeliveryFields, DigestTimeFields, InboxSummary, ManagerAlertNotice } from '@/components/email-alerts/EmailAlertControls';
import { alertIcons } from '@/components/email-alerts/alertIcons';

export default function Notifications() {
  const { user } = useAuth();
  const query = useEmailAlerts();
  return query.data ? <PortalLayout><PreferencesEditor key={user?.id} context={query.data}/></PortalLayout> : null;
}

function PreferencesEditor({ context }: { context: EmailAlertContext }) {
  const { user } = useAuth(); const cache = useQueryClient(); const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [base, setBase] = useState(context);
  const [draft, setDraft] = useState(() => preferencesFrom(context));
  const [expanded, setExpanded] = useState<EmailAlertId[]>([]);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0); const [flowSource, setFlowSource] = useState<'all' | 'digests'>('all');
  const [flowMachines, setFlowMachines] = useState<string[]>([]); const appliedScope = useRef<string | null>(null);
  const [leave, setLeave] = useState<(() => void) | null>(null); const [success, setSuccess] = useState(false);
  const initialized = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(preferencesFrom(base));
  const active = draft.alerts.filter(alert => alert.enabled && alert.available);
  const optional = draft.alerts.filter(alert => alert.id !== 'decision-ready' || alert.authorized);
  const affected = (preferences: EmailAlertPreferences) => preferences.alerts.filter(alert => (alert.id !== 'decision-ready' || alert.authorized) && (flowSource !== 'digests' || ['daily', 'weekly'].includes(alert.id)));
  const updateAlert = (alert: EmailAlertSubscription) => { setDraft(previous => ({ ...previous, alerts: previous.alerts.map(item => item.id === alert.id ? alert : item) })); setError(''); setSuccess(false); };
  const updateSettings = (settings: EmailAlertPreferences['settings']) => { setDraft(previous => ({ ...previous, settings })); setError(''); setSuccess(false); };
  const toggleExpanded = (id: EmailAlertId) => setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const guard = (action: () => void) => { if (dirty) setLeave(() => action); else action(); };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const focus = search.get('alert');
    if (focus && context.alerts.some(alert => alert.id === focus)) setExpanded([focus as EmailAlertId]);
    if (search.get('setup') === 'digests') {
      const requested = (search.get('machines') ?? '').split(',').filter(id => context.machines.some(machine => machine.machineId === id));
      setFlowSource('digests'); setFlowMachines(requested); setStep(1);
    }
  }, [context, search]);

  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault(); event.stopPropagation(); setLeave(() => () => navigate(`${url.pathname}${url.search}${url.hash}`));
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, navigate]);

  const startSetup = () => { const current = [...new Set(base.alerts.filter(alert => alert.enabled).flatMap(alert => machinesForAlert(alert, base.machines).map(machine => machine.machineId)))]; setDraft(preferencesFrom(base)); setFlowSource('all'); setFlowMachines(current); appliedScope.current = [...current].sort().join(','); setStep(1); setExpanded([]); setError(''); setSuccess(false); };
  const preset = (role: 'manager' | 'technician' | 'none') => {
    const ids: EmailAlertId[] = role === 'manager' ? ['daily', 'weekly', 'sales-quiet'] : role === 'technician' ? ['new-refund', 'device-offline'] : [];
    setDraft(previous => ({ ...previous, alerts: previous.alerts.map(alert => ({ ...alert, enabled: alert.available && ids.includes(alert.id) })) })); setError('');
  };
  const save = async () => {
    const invalid = validateEmailAlertPreferences(draft, base.machines);
    if (invalid) { setError(invalid); setExpanded(active.filter(alert => !machinesForAlert(alert, base.machines).length).map(alert => alert.id)); return; }
    setSaving(true); setError('');
    try {
      const result = await saveEmailAlertPreferences(draft, base.revision);
      setBase(result); setDraft(preferencesFrom(result)); cache.setQueryData(emailAlertsQueryKey(user?.id), result);
      setSuccess(step > 0); setStep(0); setExpanded([]); setSearch({}, { replace: true }); toast.success('Email preferences saved.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your changes could not be saved.'); }
    finally { setSaving(false); }
  };
  const next = () => {
    setError('');
    if (step === 1 && !affected(draft).some(alert => alert.enabled)) { setError(flowSource === 'digests' ? 'Choose a daily or weekly digest to continue.' : 'Choose an update to continue, or select Not now.'); return; }
    if (step === 2) {
      if (!flowMachines.length) { setError('Choose at least one machine for these updates.'); return; }
      const scopeKey = [...flowMachines].sort().join(',');
      const scopeChanged = appliedScope.current !== scopeKey;
      setDraft(previous => ({ ...previous, alerts: previous.alerts.map(alert => affected(previous).some(item => item.id === alert.id) && alert.enabled && (scopeChanged || !machinesForAlert(alert, base.machines).length) ? { ...alert, scopeMode: 'selected', isDefault: false, machineIds: flowMachines.filter(id => base.machines.some(machine => machine.machineId === id && machine.availableAlertIds.includes(alert.id))) } : alert) }));
      appliedScope.current = scopeKey;
    }
    if (step === 3) { void save(); return; }
    setStep(previous => previous + 1); window.scrollTo({ top: 0 });
  };
  const finishSetup = () => { setDraft(preferencesFrom(base)); setStep(0); setError(''); setSearch({}, { replace: true }); };
  const row = (alert: EmailAlertSubscription, scopeOnly = false) => {
    const definition = alertDefinitions[alert.id]; const Icon = alertIcons[alert.id]; const selected = machinesForAlert(alert, base.machines);
    return <article key={alert.id} className="border-b last:border-b-0"><div className="flex items-start gap-3 p-5"><span className="rounded-md bg-muted/60 p-2 text-muted-foreground"><Icon className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{definition.name}</h3>{!scopeOnly && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{definition.description}</p>}<p className="mt-3 text-xs leading-relaxed text-muted-foreground">{!alert.available ? alert.unavailableReason || 'This update is not available yet.' : alert.enabled ? `${selected.length} ${selected.length === 1 ? 'machine' : 'machines'} · ${alertSchedule(alert.id, draft.settings)}` : 'Off'}</p></div>{!scopeOnly && <label className="flex min-h-11 min-w-11 items-start justify-center pt-1"><Checkbox aria-label={`Receive ${definition.name}`} checked={alert.enabled} disabled={(!alert.available && !alert.enabled) || saving} onCheckedChange={checked => { updateAlert({ ...alert, enabled: checked === true }); if (checked && !selected.length && !expanded.includes(alert.id)) toggleExpanded(alert.id); }}/></label>}</div>
      {alert.authorized && <div className="px-5 pb-3 sm:pl-[4.5rem]"><Button variant="link" className="h-auto min-h-11 whitespace-normal p-0 text-sm" aria-expanded={expanded.includes(alert.id)} onClick={() => toggleExpanded(alert.id)}>{expanded.includes(alert.id) ? 'Close settings' : scopeOnly ? 'Edit machines' : 'Choose machines & delivery'}</Button></div>}
      {expanded.includes(alert.id) && alert.authorized && <div className="space-y-5 border-t bg-muted/20 p-5"><AlertMachineChoices alert={alert} context={base} onChange={updateAlert}/>{!scopeOnly && <DigestTimeFields id={alert.id} settings={draft.settings} onChange={updateSettings}/>}</div>}
    </article>;
  };
  const feedback = error && <Alert variant="destructive" role="alert" className="mt-5"><AlertDescription>{error}{/another session/.test(error) && <Button variant="outline" className="mt-3 block" onClick={() => guard(() => { void cache.invalidateQueries({ queryKey: emailAlertsQueryKey(user?.id) }).then(() => window.location.reload()); })}>Reload saved preferences</Button>}</AlertDescription></Alert>;
  return <section className="container-page py-7 sm:py-9"><div className="mx-auto max-w-6xl">
    <p className="mb-5 text-xs text-muted-foreground">Personal settings / Email alerts{step > 0 ? ' / Setup' : ''}</p>
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-3 font-display text-3xl font-bold"><Bell className="h-7 w-7 text-primary"/>{step ? 'Get updates from your machines' : success ? 'Your preferences are saved' : 'Email alerts'}</h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{step ? 'Choose updates, machines, and delivery times.' : 'Choose updates for your machines and when they reach your inbox.'}</p></div>{step > 0 ? <Button variant="ghost" disabled={saving} onClick={() => guard(finishSetup)}>Not now</Button> : <Button variant="outline" onClick={() => guard(startSetup)}>Set up from suggestions</Button>}</header>
    <fieldset disabled={saving} className="min-w-0">
    {step > 0 ? <div className="mx-auto max-w-4xl"><ol className="mb-8 flex gap-3 border-b pb-5">{['Choose updates', 'Choose machines', 'Review & save'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`flex flex-1 items-center gap-2 text-xs ${step === index + 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border">{step > index + 1 ? <Check className="h-4 w-4"/> : index + 1}</span>{label}</li>)}</ol>
      {step === 1 && <><h2 className="text-xl font-semibold">What would you like to receive?</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{flowSource === 'digests' ? 'Your report’s machines will be used for the digests you choose. Other alerts keep their saved choices.' : 'Your current choices are selected. Suggestions are optional and stay a draft until you save.'}</p>{flowSource === 'all' && <div className="my-5 flex flex-wrap gap-2"><Button variant="outline" onClick={() => preset(base.machines.some(machine => machine.isManager) ? 'manager' : 'technician')}>{base.machines.some(machine => machine.isManager) ? 'Manager' : 'Technician'} suggestions</Button><Button variant="ghost" onClick={() => preset('none')}>Choose myself</Button></div>}<div className="mt-4 divide-y border-y">{affected(draft).map(alert => <label key={alert.id} className="flex cursor-pointer items-start gap-3 py-5"><Checkbox className="mt-1" disabled={!alert.available && !alert.enabled} checked={alert.enabled} onCheckedChange={value => updateAlert({ ...alert, enabled: value === true })}/><span><span className="block text-sm font-semibold">{alertDefinitions[alert.id].name}</span><span className="mt-2 block text-sm leading-relaxed text-muted-foreground">{alert.available ? alertDefinitions[alert.id].description : alert.unavailableReason}</span></span></label>)}</div></>}
      {step === 2 && <><h2 className="text-xl font-semibold">Which machines should we include?</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">This starting selection applies to {affected(draft).filter(alert => alert.enabled).length} chosen updates. You can tailor each update’s machines on the review step.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{base.machines.map(machine => <label key={machine.machineId} className="flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border bg-card p-4"><Checkbox className="mt-1" checked={flowMachines.includes(machine.machineId)} onCheckedChange={checked => setFlowMachines(previous => checked ? [...previous.filter(id => id !== machine.machineId), machine.machineId] : previous.filter(id => id !== machine.machineId))}/><span><span className="block text-sm font-semibold">{machine.machineLabel}</span><span className="mt-1 block text-xs text-muted-foreground">{machine.locationName || machine.machineId}</span></span></label>)}</div><p className="mt-4 text-xs text-muted-foreground">Only the machines you select will be included. Newly assigned machines are not added to this selection.</p></>}
      {step === 3 && <><h2 className="mb-5 text-xl font-semibold">A final look before you save</h2><div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]"><div className="space-y-5"><DeliveryFields settings={draft.settings} onChange={updateSettings} showOffline={active.some(alert => alert.id === 'device-offline')}/>{active.filter(alert => ['daily', 'weekly'].includes(alert.id)).map(alert => <DigestTimeFields key={alert.id} id={alert.id} settings={draft.settings} onChange={updateSettings}/>)}<div className="overflow-hidden rounded-lg border bg-card">{active.map(alert => row(alert, true))}</div><ManagerAlertNotice context={base}/></div><InboxSummary preferences={draft} context={base} detailed/></div></>}
      {feedback}<div className="mt-8 flex justify-between gap-3 border-t pt-5"><Button variant="outline" onClick={() => { if (step === 1) guard(finishSetup); else { setStep(previous => previous - 1); setError(''); } }}>{step === 1 ? 'Cancel' : 'Back'}</Button><Button onClick={next}>{saving ? 'Saving…' : step === 3 ? 'Save preferences' : 'Continue'}</Button></div>
    </div> : <><div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_300px]"><div><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">Optional updates</h2><p className="text-xs text-muted-foreground">{base.machines.length} machines available</p></div><div className="overflow-hidden rounded-lg border bg-card">{optional.map(alert => row(alert))}</div><ManagerAlertNotice context={base}/></div><aside className="space-y-6"><InboxSummary preferences={draft} context={base}/><section className="border-t pt-5"><h2 className="mb-5 text-base font-semibold">Delivery preferences</h2><DeliveryFields settings={draft.settings} onChange={updateSettings} showOffline={active.some(alert => alert.id === 'device-offline')}/></section></aside></div>{feedback}<div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-5 py-4 shadow-sm"><div><p className="text-sm font-semibold">{dirty ? 'Unsaved changes' : 'Preferences saved'}</p><p className="mt-1 text-xs text-muted-foreground">{dirty ? 'Review your choices, then save.' : 'Changes apply after saving.'}</p></div><div className="flex gap-3"><Button variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(preferencesFrom(base)); setError(''); }}>Cancel</Button><Button disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save preferences'}</Button></div></div></>}
    </fieldset>
    <AlertDialog open={Boolean(leave)} onOpenChange={open => { if (!open) setLeave(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave without saving?</AlertDialogTitle><AlertDialogDescription>Your saved email preferences will stay as they are.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { const action = leave; setDraft(preferencesFrom(base)); setLeave(null); action?.(); }}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div></section>;
}
