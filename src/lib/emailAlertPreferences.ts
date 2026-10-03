import { z } from 'zod';

export const emailAlertIds = ['daily', 'weekly', 'new-refund', 'decision-ready', 'sales-quiet', 'device-offline'] as const;
export type EmailAlertId = typeof emailAlertIds[number];
const alertId = z.enum(emailAlertIds);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const settingsSchema = z.object({
  timezone: z.string(), dailyTime: clock, weeklyDay: z.number().int().min(1).max(7), weeklyTime: clock,
  quietEnabled: z.boolean(), quietStart: clock, quietEnd: clock,
  offlineBypass: z.boolean().default(false), newRefundDelivery: z.enum(['immediate', 'daily']).default('immediate'),
});
const subscriptionSchema = z.object({
  id: alertId, enabled: z.boolean(), scopeMode: z.enum(['all_assigned', 'selected']), machineIds: z.array(z.string()),
  available: z.boolean(), unavailableReason: z.string().nullable(), isDefault: z.boolean(),
  authorized: z.boolean().default(false), sourceAvailable: z.boolean().default(false),
});
export const emailAlertContextSchema = z.object({
  schemaVersion: z.literal('email_alert_preferences_v1'), revision: z.number().int(), email: z.string(), eligible: z.boolean(),
  machines: z.array(z.object({
    machineId: z.string(), machineLabel: z.string(), locationName: z.string().nullable(), timezone: z.string().nullable(),
    isManager: z.boolean(), isTechnician: z.boolean(), canViewSales: z.boolean(), availableAlertIds: z.array(alertId),
    authorizedAlertIds: z.array(alertId).default([]),
  })), settings: settingsSchema, alerts: z.array(subscriptionSchema),
});
export type EmailAlertContext = z.infer<typeof emailAlertContextSchema>;
export type EmailAlertSettings = EmailAlertContext['settings'];
export type EmailAlertSubscription = EmailAlertContext['alerts'][number];
export type EmailAlertMachine = EmailAlertContext['machines'][number];
export type EmailAlertPreferences = Pick<EmailAlertContext, 'settings' | 'alerts'>;

export const alertDefinitions: Record<EmailAlertId, { name: string; short: string; description: string }> = {
  daily: { name: 'Daily operations brief', short: 'Daily brief', description: 'Yesterday’s performance and refund requests, grouped by machine.' },
  weekly: { name: 'Weekly performance review', short: 'Weekly review', description: 'Last week’s performance, comparisons, and refund requests.' },
  'new-refund': { name: 'New refund request', short: 'New refund requests', description: 'The reported problem and customer comment when a request arrives.' },
  'decision-ready': { name: 'Refund decision ready', short: 'Refund decisions', description: 'An optional email when a case for a machine you manage is ready for your decision. Ready decisions also appear in your daily brief.' },
  'sales-quiet': { name: 'Cash sales unexpectedly quiet', short: 'Quiet cash-sales alerts', description: 'When verified cash activity for a complete reporting day is much lower than usual. Card activity is not included.' },
  'device-offline': { name: 'Device reports offline', short: 'Device-offline alerts', description: 'When the payment device reports a sustained offline status.' },
};
export function preferencesFrom(context: EmailAlertContext): EmailAlertPreferences {
  return { settings: { ...context.settings }, alerts: context.alerts.map(alert => ({ ...alert, machineIds: [...alert.machineIds] })) };
}
export function machinesForAlert(alert: EmailAlertSubscription, machines: EmailAlertMachine[]) {
  return machines.filter(machine => machine.authorizedAlertIds.includes(alert.id) &&
    (alert.scopeMode === 'all_assigned' || alert.machineIds.includes(machine.machineId)));
}
/** Any manual machine edit becomes explicit and cannot silently enroll a future assignment. */
export function changeAlertMachine(alert: EmailAlertSubscription, machines: EmailAlertMachine[], machineId: string, selected: boolean): EmailAlertSubscription {
  const ids = machinesForAlert(alert, machines).map(machine => machine.machineId).filter(id => id !== machineId);
  if (selected && machines.some(machine => machine.machineId === machineId && machine.availableAlertIds.includes(alert.id))) ids.push(machineId);
  return { ...alert, scopeMode: 'selected', machineIds: ids, isDefault: false };
}
/** A machine panel only changes that machine; an inactive category cannot revive its old scopes. */
export function changeMachineSubscriptions(preferences: EmailAlertPreferences, machines: EmailAlertMachine[], machineId: string, selected: EmailAlertId[]): EmailAlertPreferences {
  return { ...preferences, alerts: preferences.alerts.map(alert => {
    const machine = machines.find(item => item.machineId === machineId && item.authorizedAlertIds.includes(alert.id));
    if (!machine) return alert;
    const wasSelected = alert.enabled && machinesForAlert(alert, machines).some(machine => machine.machineId === machineId);
    if (wasSelected === selected.includes(alert.id)) return alert;
    if (selected.includes(alert.id) && (!alert.available || !machine.availableAlertIds.includes(alert.id))) return alert;
    const next = changeAlertMachine(alert.enabled ? alert : { ...alert, scopeMode: 'selected', machineIds: [] }, machines, machineId, selected.includes(alert.id));
    return { ...next, enabled: next.machineIds.length > 0 };
  }) };
}
export function validateEmailAlertPreferences(preferences: EmailAlertPreferences, machines: EmailAlertMachine[]) {
  for (const alert of preferences.alerts) {
    if (alert.enabled && alert.available && !machinesForAlert(alert, machines).length) return `Choose at least one machine for ${alertDefinitions[alert.id].name.toLowerCase()}.`;
  }
  if (!settingsSchema.safeParse(preferences.settings).success) return 'Choose a valid delivery time for each digest and quiet-hours setting.';
  if (preferences.settings.quietEnabled && preferences.settings.quietStart === preferences.settings.quietEnd) return 'Set different start and end times for quiet hours.';
  try { new Intl.DateTimeFormat('en-US', { timeZone: preferences.settings.timezone }).format(); } catch { return 'Choose a valid delivery time zone.'; }
  return null;
}
export const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function formatAlertTime(value: string) {
  if (!clock.safeParse(value).success) return 'Choose a time';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}
export function alertSchedule(id: EmailAlertId, settings: EmailAlertSettings) {
  if (id === 'new-refund') return settings.newRefundDelivery === 'daily' ? `Daily at ${formatAlertTime(settings.dailyTime)}` : 'When a request arrives';
  if (id === 'sales-quiet') return 'After a complete reporting day';
  if (id === 'device-offline') return 'When sustained offline is confirmed';
  if (id === 'decision-ready') return 'When your decision is ready';
  const time = id === 'daily' ? settings.dailyTime : settings.weeklyTime;
  const base = id === 'daily' ? `Every day · ${formatAlertTime(time)}` : `${weekdays[settings.weeklyDay - 1]} · ${formatAlertTime(time)}`;
  if (!settings.quietEnabled || !clock.safeParse(time).success) return base;
  const inside = settings.quietStart > settings.quietEnd ? time >= settings.quietStart || time < settings.quietEnd : time >= settings.quietStart && time < settings.quietEnd;
  return inside ? `${base}; delivered at ${formatAlertTime(settings.quietEnd)} after quiet hours${id === 'weekly' && settings.quietEnd < time ? ' on the following day' : ''}` : base;
}
