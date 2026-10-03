/// <reference lib="deno.ns" />
import fixture from '../../scripts/fixtures/email-alert-preferences.json' with { type: 'json' };
import { alertSchedule, changeAlertMachine, changeMachineSubscriptions, emailAlertContextSchema, machinesForAlert, preferencesFrom, validateEmailAlertPreferences } from './emailAlertPreferences.ts';

const context = () => emailAlertContextSchema.parse(structuredClone(fixture));
const equal = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };

Deno.test('contract and defaults preserve daily assignment following and explicit opt-out', () => {
  const data = context(); const draft = preferencesFrom(data);
  equal(draft.alerts.filter(item => item.enabled).map(item => item.id), ['daily']);
  data.machines.push({ ...data.machines[0], machineId: 'new-assignment' });
  equal(machinesForAlert(draft.alerts[0], data.machines).length, 3);
  draft.alerts[0].enabled = false;
  equal(preferencesFrom({ ...data, ...draft }).alerts[0].enabled, false);
  equal(data.alerts[0].enabled, true);
});

Deno.test('manual scope edit freezes the current authorized selection', () => {
  const data = context(); const edited = changeAlertMachine(data.alerts[0], data.machines, 'operator-machine-garden', false);
  equal(edited.scopeMode, 'selected'); equal(edited.machineIds, ['operator-machine-north']);
  data.machines.push({ ...data.machines[0], machineId: 'new-assignment' });
  equal(machinesForAlert(edited, data.machines).map(item => item.machineId), ['operator-machine-north']);
});

Deno.test('editing one machine preserves another authorized scope whose source is unavailable', () => {
  const data = context(); const alert = data.alerts.find(item => item.id === 'device-offline')!;
  Object.assign(alert, { enabled: true, available: true, scopeMode: 'selected', machineIds: data.machines.map(item => item.machineId) });
  data.machines[1].availableAlertIds.push('device-offline');
  const edited = changeAlertMachine(alert, data.machines, 'operator-machine-garden', false);
  equal(edited.machineIds, ['operator-machine-north']);
  const changed = changeMachineSubscriptions(preferencesFrom(data), data.machines, 'operator-machine-garden', ['daily']);
  equal(changed.alerts.find(item => item.id === 'device-offline')?.machineIds, ['operator-machine-north']);
  equal(changed.alerts.find(item => item.id === 'device-offline')?.enabled, true);
});

Deno.test('machine panel can opt out during source outage and cannot activate an unavailable source', () => {
  const data = context(); const alert = data.alerts.find(item => item.id === 'device-offline')!;
  Object.assign(alert, { enabled: true, scopeMode: 'selected', machineIds: ['operator-machine-north'] });
  const disabled = changeMachineSubscriptions(preferencesFrom(data), data.machines, 'operator-machine-north', ['daily']);
  equal(disabled.alerts.find(item => item.id === 'device-offline')?.enabled, false);
  const unavailable = changeMachineSubscriptions(preferencesFrom(data), data.machines, 'operator-machine-garden', ['daily', 'device-offline']);
  equal(unavailable.alerts.find(item => item.id === 'device-offline')?.machineIds, ['operator-machine-north']);
});

Deno.test('machine panel does not revive inactive saved machine scopes', () => {
  const data = context(); data.alerts[1].machineIds = ['operator-machine-garden'];
  const edited = changeMachineSubscriptions(preferencesFrom(data), data.machines, 'operator-machine-north', ['daily', 'weekly']);
  equal(edited.alerts[1].machineIds, ['operator-machine-north']);
  equal(edited.alerts[0].scopeMode, 'all_assigned');
});

Deno.test('delivery validation rejects empty scope, equal quiet boundaries and invalid time zone', () => {
  const data = context(); const draft = preferencesFrom(data);
  draft.alerts[1].enabled = true;
  equal(validateEmailAlertPreferences(draft, data.machines), 'Choose at least one machine for weekly performance review.');
  draft.alerts[1].enabled = false; draft.settings.quietEnd = draft.settings.quietStart;
  equal(validateEmailAlertPreferences(draft, data.machines), 'Set different start and end times for quiet hours.');
  draft.settings.quietEnd = '07:00'; draft.settings.timezone = 'invalid';
  equal(validateEmailAlertPreferences(draft, data.machines), 'Choose a valid delivery time zone.');
});

Deno.test('quiet-hours preview shows deferred weekly delivery on the following day', () => {
  const data = context(); data.settings.weeklyTime = '21:00';
  equal(alertSchedule('weekly', data.settings), 'Monday · 9:00 PM; delivered at 7:00 AM after quiet hours on the following day');
  equal(alertSchedule('daily', data.settings), 'Every day · 8:00 AM');
});
