import { validDate, type WorkspaceState } from './reportingWorkspace.ts';
type Dimension = { locationId: string; machineId: string };
/** Invalid links must never become an unfiltered analytics request. */
export function laborReportSelectionError(params: URLSearchParams, state: WorkspaceState, choices: Dimension[]): 'dates' | 'scope' | null {
  const from = params.get('from'); const to = params.get('to');
  if (((params.has('from') || params.has('to')) && (!validDate(from) || !validDate(to) || from > to)) || (Date.parse(state.dateTo) - Date.parse(state.dateFrom)) / 86400000 > 366) return 'dates';
  const machines = choices.filter(item => state.locationId === 'all' || item.locationId === state.locationId);
  if ((state.locationId !== 'all' && !choices.some(item => item.locationId === state.locationId)) || (state.machineId !== 'all' && !machines.some(item => item.machineId === state.machineId))) return 'scope';
  return null;
}
