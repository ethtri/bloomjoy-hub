// These refund harnesses do not model personal alert assignments. Return the
// actual no-assignment contract instead of the generic unknown-RPC response.
export const ineligibleEmailAlertPreferences = (email) => ({
  schemaVersion: 'email_alert_preferences_v1',
  revision: 0,
  email,
  eligible: false,
  machines: [],
  settings: {
    timezone: 'America/Los_Angeles',
    dailyTime: '08:00',
    weeklyDay: 1,
    weeklyTime: '08:00',
    quietEnabled: true,
    quietStart: '20:00',
    quietEnd: '07:00',
    offlineBypass: false,
    newRefundDelivery: 'immediate',
  },
  alerts: ['daily', 'weekly', 'new-refund', 'decision-ready', 'sales-quiet', 'device-offline'].map((id) => ({
    id,
    enabled: false,
    scopeMode: id === 'daily' ? 'all_assigned' : 'selected',
    machineIds: [],
    authorized: false,
    sourceAvailable: !['sales-quiet', 'device-offline'].includes(id),
    available: false,
    unavailableReason: 'No eligible assigned machines',
    isDefault: true,
  })),
});
