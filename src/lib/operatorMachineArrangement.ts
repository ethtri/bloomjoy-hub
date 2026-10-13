import { supabaseClient } from '@/lib/supabaseClient';

export type AddMachineArrangementInput = {
  requestId: string;
  operatorProfileId: string;
  machineId: string;
  effectiveStartDate: string;
  effectiveEndDate: string | null;
  shiftRateCents: number;
  commissionBasisPoints: number;
  commissionStartDate: string;
};

export type MachineArrangementResult = {
  requestId: string;
  operatorProfileId: string;
  accountId: string;
  machineId: string;
  assignment: { id: string };
  shiftRate: { id: string };
  commissionRate: { id: string };
  waitingRate: { id: string } | null;
};

export class ArrangementSaveError extends Error {
  constructor(message: string, readonly outcomeUnknown: boolean) { super(message); }
}

export async function addOperatorMachineArrangement(input: AddMachineArrangementInput) {
  const { data, error } = await supabaseClient.rpc('admin_add_operator_machine_arrangement', {
    p_request_id: input.requestId,
    p_operator_profile_id: input.operatorProfileId,
    p_reporting_machine_id: input.machineId,
    p_effective_start_date: input.effectiveStartDate,
    p_effective_end_date: input.effectiveEndDate,
    p_shift_rate_cents: input.shiftRateCents,
    p_commission_basis_points: input.commissionBasisPoints,
    p_commission_start_date: input.commissionStartDate,
  });
  if (error) {
    // SQL validation/constraint failures are rolled back by the single RPC.
    // Fetch/network/timeout errors must retain the exact request for recovery.
    const knownRollback = /^(P0001|22\w{3}|23\w{3}|42501|42883|PGRST202)$/.test(error.code ?? '');
    throw new ArrangementSaveError(error.message || 'Unable to save the machine arrangement.', !knownRollback);
  }
  if (data?.requestId !== input.requestId || data?.operatorProfileId !== input.operatorProfileId || data?.machineId !== input.machineId || !data?.assignment?.id || !data?.shiftRate?.id || !data?.commissionRate?.id) {
    throw new ArrangementSaveError('The save response was incomplete.', true);
  }
  return data as MachineArrangementResult;
}

export async function fetchOperatorMachineArrangementResult(requestId: string) {
  const { data, error } = await supabaseClient.rpc('get_operator_machine_arrangement_result', {
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message || 'Unable to confirm the save yet.');
  if (data !== null && (data?.requestId !== requestId || !data?.assignment?.id || !data?.shiftRate?.id || !data?.commissionRate?.id)) {
    throw new Error('The save status response was incomplete.');
  }
  return data as MachineArrangementResult | null;
}
