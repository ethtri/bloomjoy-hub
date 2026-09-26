export const SNAPCASE_PROVISIONAL_NOTICE =
  "SnapCase sales are incomplete. Totals are provisional until cash and card data are reconciled.";

type ReportingDimension = {
  location_id?: unknown;
  machine_id?: unknown;
  machine_type?: unknown;
};

export const getSnapcaseProvisionalNotice = (
  dimensions: ReportingDimension[],
  selectedMachineIds: string[],
  selectedLocationIds: string[],
): string | undefined => {
  const selectedIds = new Set(selectedMachineIds);
  const selectedLocations = new Set(selectedLocationIds);
  const includesSnapcase = dimensions.some(
    (dimension) =>
      String(dimension.machine_type ?? "")
          .trim()
          .toLowerCase() === "snapcase" &&
      (selectedIds.size === 0 ||
        selectedIds.has(String(dimension.machine_id ?? ""))) &&
      (selectedLocations.size === 0 ||
        selectedLocations.has(String(dimension.location_id ?? ""))),
  );

  // Replace this conservative predicate only when reporting exposes window-aware
  // financial readiness. Import freshness alone cannot prove complete totals.
  return includesSnapcase ? SNAPCASE_PROVISIONAL_NOTICE : undefined;
};
