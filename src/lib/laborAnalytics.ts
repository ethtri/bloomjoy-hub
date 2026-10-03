import { supabaseClient } from '@/lib/supabaseClient';

import type { LaborAnalyticsScope, LaborAnalyticsAccess, LaborAnalyticsReport } from './laborAnalyticsModel';
export type { LaborAnalyticsScope, LaborAnalyticsAccess, LaborAnalyticsReport, LaborAnalyticsRow } from './laborAnalyticsModel';

export async function fetchLaborAnalyticsAccess(): Promise<LaborAnalyticsAccess> {
  const { data, error } = await supabaseClient.rpc('get_labor_analytics_access');
  if (error) throw error;
  return data as LaborAnalyticsAccess;
}

export async function fetchLaborAnalytics(scope: LaborAnalyticsScope): Promise<LaborAnalyticsReport> {
  const { data, error } = await supabaseClient.rpc('get_labor_analytics_report', {
    p_date_from: scope.dateFrom, p_date_to: scope.dateTo,
    p_machine_ids: scope.machineIds ?? null, p_location_ids: scope.locationIds ?? null,
  });
  if (error) throw error;
  return data as LaborAnalyticsReport;
}

export { laborAnalyticsTotals, laborAnalyticsCsv } from './laborAnalyticsModel';


