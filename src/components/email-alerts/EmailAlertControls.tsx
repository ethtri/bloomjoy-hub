import { Bell } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { alertDefinitions, alertSchedule, changeAlertMachine, formatAlertTime, machinesForAlert, weekdays, type EmailAlertContext, type EmailAlertId, type EmailAlertPreferences, type EmailAlertSettings, type EmailAlertSubscription } from '@/lib/emailAlerts';

import { alertIcons } from './alertIcons';
const selectClass = 'flex min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const timezoneNames = (() => {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return supported ? supported('timeZone') : ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Pacific/Honolulu', 'UTC'];
})();

export function DigestTimeFields({ id, settings, onChange }: { id: EmailAlertId; settings: EmailAlertSettings; onChange: (value: EmailAlertSettings) => void }) {
  if (id !== 'daily' && id !== 'weekly') return null;
  return <div className="grid gap-4 sm:grid-cols-2">
    {id === 'weekly' && <div className="space-y-2"><Label htmlFor="weekly-day">Weekly delivery day</Label><select id="weekly-day" className={selectClass} value={settings.weeklyDay} onChange={event => onChange({ ...settings, weeklyDay: Number(event.target.value) })}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></div>}
    <div className="space-y-2"><Label htmlFor={`${id}-time`}>{id === 'daily' ? 'Daily' : 'Weekly'} delivery time</Label><Input id={`${id}-time`} className="min-h-11" type="time" value={id === 'daily' ? settings.dailyTime : settings.weeklyTime} onChange={event => onChange({ ...settings, [id === 'daily' ? 'dailyTime' : 'weeklyTime']: event.target.value })}/></div>
  </div>;
}

export function DeliveryFields({ settings, onChange, showOffline }: { settings: EmailAlertSettings; onChange: (value: EmailAlertSettings) => void; showOffline: boolean }) {
  const zones = [...new Set([settings.timezone, ...timezoneNames])];
  return <div className="space-y-5"><div className="space-y-2"><Label htmlFor="alert-timezone">Delivery time zone</Label><select id="alert-timezone" className={selectClass} value={settings.timezone} onChange={event => onChange({ ...settings, timezone: event.target.value })}>{zones.map(zone => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}</select></div>
    <div className="flex min-h-11 items-center justify-between gap-3"><Label htmlFor="alert-quiet">Quiet hours</Label><Checkbox id="alert-quiet" checked={settings.quietEnabled} onCheckedChange={value => onChange({ ...settings, quietEnabled: value === true })}/></div>
    {settings.quietEnabled && <><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="quiet-start">From</Label><Input id="quiet-start" type="time" className="min-h-11" value={settings.quietStart} onChange={event => onChange({ ...settings, quietStart: event.target.value })}/></div><div className="space-y-2"><Label htmlFor="quiet-end">Until</Label><Input id="quiet-end" type="time" className="min-h-11" value={settings.quietEnd} onChange={event => onChange({ ...settings, quietEnd: event.target.value })}/></div></div><p className="text-xs leading-relaxed text-muted-foreground">Immediate optional alerts wait until quiet hours end. Digest times inside this window move to the next allowed time.</p>
      {showOffline && <label className="flex min-h-11 items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={settings.offlineBypass} onCheckedChange={value => onChange({ ...settings, offlineBypass: value === true })}/><span>Allow device-offline alerts during quiet hours</span></label>}</>}
    <p className="text-xs leading-relaxed text-muted-foreground">Delivery times use your time zone. Report dates follow each machine’s location.</p>
  </div>;
}

export function AlertMachineChoices({ alert, context, onChange }: { alert: EmailAlertSubscription; context: EmailAlertContext; onChange: (value: EmailAlertSubscription) => void }) {
  const choices = context.machines.filter(machine => machine.authorizedAlertIds.includes(alert.id));
  const selected = machinesForAlert(alert, context.machines);
  return <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Machines for this alert</h3><Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...alert, scopeMode: 'selected', machineIds: choices.filter(machine => machine.availableAlertIds.includes(alert.id) || selected.includes(machine)).map(machine => machine.machineId), isDefault: false })}>Select all available machines</Button></div>
    {alert.scopeMode === 'all_assigned' && <p className="text-xs leading-relaxed text-muted-foreground">The default daily brief follows your eligible assignments, including new ones. Changing this selection will include only the machines you choose.</p>}
    <div className="grid gap-2 sm:grid-cols-2">{choices.map(machine => <label key={machine.machineId} className="flex min-h-11 cursor-pointer items-center gap-3"><Checkbox disabled={!machine.availableAlertIds.includes(alert.id) && !selected.includes(machine)} checked={selected.includes(machine)} onCheckedChange={checked => onChange(changeAlertMachine(alert, context.machines, machine.machineId, checked === true))}/><span className="min-w-0 text-sm">{machine.machineLabel}<span className="block text-xs text-muted-foreground">{machine.locationName || machine.machineId}{!machine.availableAlertIds.includes(alert.id) && ' · Waiting for verified data'}</span></span></label>)}</div>
    {alert.scopeMode === 'selected' && <p className="text-xs text-muted-foreground">Newly assigned machines aren’t added automatically.</p>}
    {alert.id === 'daily' && context.machines.some(machine => machine.isManager) && <p className="text-xs leading-relaxed text-muted-foreground">This selection controls performance and new-request totals. The daily brief also includes open refund work for every machine you manage, in a separate section.</p>}
    {!choices.length && <p className="text-sm text-muted-foreground">No machines currently support this update.</p>}
  </div>;
}

export function InboxSummary({ preferences, context, detailed = false }: { preferences: EmailAlertPreferences; context: EmailAlertContext; detailed?: boolean }) {
  const active = preferences.alerts.filter(alert => alert.enabled && alert.available);
  const both = ['daily', 'weekly'].every(id => active.some(alert => alert.id === id));
  return <section className="rounded-lg border bg-card p-5"><h2 className="text-base font-semibold">{detailed ? 'Review your choices' : 'Your inbox at a glance'}</h2><div className="my-4 border-b pb-4"><p className="text-xs text-muted-foreground">Deliver to your account email</p><p className="mt-1 break-all text-sm">{context.email}</p></div><div className="space-y-5">{active.map(alert => { const Icon = alertIcons[alert.id]; const selected = machinesForAlert(alert, context.machines); return <div key={alert.id} className="flex items-start gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><div className="min-w-0"><h3 className="text-sm font-medium">{alertDefinitions[alert.id].short} · {selected.length} {selected.length === 1 ? 'machine' : 'machines'}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alertSchedule(alert.id, preferences.settings)}</p>{detailed && <p className="mt-2 text-xs leading-relaxed">{selected.map(machine => machine.machineLabel).join(', ')}</p>}</div></div>; })}</div>
    {!active.length && <p className="text-sm text-muted-foreground">Optional alerts are off.</p>}
    <p className="mt-5 break-words text-xs leading-relaxed text-muted-foreground">{preferences.settings.timezone.replace(/_/g, ' ')}{preferences.settings.quietEnabled && ` · Quiet ${formatAlertTime(preferences.settings.quietStart)}–${formatAlertTime(preferences.settings.quietEnd)}`}</p>
    {both && <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Daily and weekly arrive as separate emails. Each has totals, then a section for every selected machine.</p>}
  </section>;
}

export function ManagerAlertNotice({ context }: { context: EmailAlertContext }) {
  if (!context.machines.some(machine => machine.isManager)) return null;
  return <section className="mt-6 flex gap-3 border-t pt-5"><Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"/><div><h2 className="text-sm font-semibold">Refund decisions</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">When your daily brief is on, it also includes open refund work for every machine you manage, including machines outside its performance selection. Turn on Refund decision ready for a separate email. Your manager assignments determine which cases you can decide.</p></div></section>;
}
