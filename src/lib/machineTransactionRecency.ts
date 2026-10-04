export function transactionAge(value: string | null, now = Date.now()) {
  if (!value) return null;
  const date = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isFinite(date) ? Math.max(0, Math.floor((now - date) / 86400000)) : null;
}
export function transactionAgeLabel(value: string | null, now = Date.now()) {
  const days = transactionAge(value, now);
  return days === null ? 'No transactions recorded' : days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`;
}
export function importFreshnessLabel(value: string | null, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Import freshness unknown';
  return now - Date.parse(value) > 30 * 3600000 ? 'Import data is stale' : 'Recent import';
}
export function transactionSourceLabel(value: string | null) {
  return ({ sunze_browser: 'Sunze', nayax_scheduled_report: 'Nayax', card_authority_daily: 'Reconciled card sales', manual_csv: 'CSV import', sample_seed: 'Sample data' } as Record<string, string>)[value ?? ''] ?? 'Source unknown';
}
