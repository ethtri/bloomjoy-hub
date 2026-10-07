type AssignmentWindow = {
  machine_id: string;
  assignment_role: string;
  status: string;
  effective_start_date: string;
  effective_end_date: string | null;
};

// New assignments are ongoing. Future windows and inclusive end dates also overlap.
export function overlappingMachinePartnerships<T extends AssignmentWindow>(assignments: T[], machineId: string, startDate: string): T[] {
  return assignments.filter((assignment) => assignment.machine_id === machineId &&
    assignment.status === 'active' && assignment.assignment_role === 'primary_reporting' &&
    (!assignment.effective_end_date || assignment.effective_end_date >= startDate));
}

export function validAssignmentDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
