import { supabaseClient } from '@/lib/supabaseClient';
import { emailAlertContextSchema, type EmailAlertPreferences } from './emailAlertPreferences';
export * from './emailAlertPreferences';

export async function fetchEmailAlertPreferences() {
  const { data, error } = await supabaseClient.rpc('get_my_email_alert_preferences');
  if (error) throw new Error('Email preferences could not be loaded. Please try again.');
  return emailAlertContextSchema.parse(data);
}
export async function saveEmailAlertPreferences(preferences: EmailAlertPreferences, revision: number) {
  const { data, error } = await supabaseClient.rpc('save_my_email_alert_preferences', {
    p_preferences: { settings: preferences.settings, alerts: preferences.alerts.map(({ id, enabled, scopeMode, machineIds }) => ({ id, enabled, scopeMode, machineIds })) },
    p_expected_revision: revision,
  });
  if (error) {
    if (/revision|conflict|changed/i.test(error.message)) throw new Error('Your preferences changed in another session. Reload the saved preferences before editing again.');
    throw new Error('Your changes were not saved. Your choices are still here. Please try again.');
  }
  return emailAlertContextSchema.parse(data);
}
