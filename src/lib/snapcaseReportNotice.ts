import type { ReportingMachineType } from "@/lib/machineTypes";

export const SNAPCASE_PROVISIONAL_NOTICE =
  "SnapCase sales are incomplete. Totals are provisional until cash and card data are reconciled.";

type ReportScopeMachine = {
  machineId: string;
  machineType: ReportingMachineType;
};

export const hasProvisionalSnapcaseSales = (
  machines: ReportScopeMachine[],
  selectedMachineIds: string[] = [],
): boolean => {
  const selectedIds = new Set(selectedMachineIds);

  return machines.some(
    (machine) =>
      machine.machineType === "snapcase" &&
      (selectedIds.size === 0 || selectedIds.has(machine.machineId)),
  );
};
