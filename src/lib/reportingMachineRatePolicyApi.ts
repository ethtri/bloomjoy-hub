import { machineRateDraftError, parseMachineRatePolicyState, parseMachineRatePreview, type MachineRateDraft, type MachineRatePolicyState, type MachineRatePreview } from './reportingMachineRatePolicy';

const invalidResponse = (): never => { throw new Error('The tax rate service returned a different machine or purchase period. Reload before trying again.'); };

const parameters = (machineId: string, draft: MachineRateDraft) => {
  const error = machineRateDraftError(draft);
  if (error) throw new Error(error);
  return { p_machine_id: machineId, p_rate_percent: Number(draft.ratePercent), p_status: draft.status, p_starts_on: draft.startsOn, p_ends_on: draft.endsOn || null, p_reason: draft.reason.trim(), p_evidence_reference: draft.evidenceReference.trim() || null };
};

export const fetchMachineRatePolicy = async (machineId: string): Promise<MachineRatePolicyState> => {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('admin_get_reporting_machine_rate_policy', { p_machine_id: machineId });
  if (error) throw new Error(error.message || 'The tax rate request could not be completed. Try again.');
  const state = parseMachineRatePolicyState(data);
  if (state.machineId !== machineId) invalidResponse();
  return state;
};

export const previewMachineRatePolicy = async (machineId: string, draft: MachineRateDraft): Promise<MachineRatePreview> => {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('admin_preview_reporting_machine_rate_policy', parameters(machineId, draft));
  if (error) throw new Error(error.message || 'The tax rate request could not be completed. Try again.');
  const preview = parseMachineRatePreview(data);
  if (preview.range.startsOn !== draft.startsOn || preview.range.endsOn !== (draft.endsOn || null)) invalidResponse();
  return preview;
};

export const saveMachineRatePolicy = async (machineId: string, draft: MachineRateDraft, token: string): Promise<MachineRatePolicyState> => {
  const { supabaseClient } = await import('@/lib/supabaseClient');
  const { data, error } = await supabaseClient.rpc('admin_save_reporting_machine_rate_policy', { ...parameters(machineId, draft), p_preview_token: token });
  if (error) throw new Error(error.message || 'The tax rate request could not be completed. Try again.');
  const state = parseMachineRatePolicyState(data);
  if (state.machineId !== machineId) invalidResponse();
  return state;
};
