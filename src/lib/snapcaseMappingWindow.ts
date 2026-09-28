type ExistingSourceMappingWindow = {
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  firstSeenAt: string | null;
};

type PartnershipWindow = {
  effective_start_date: string;
  effective_end_date: string | null;
};

export const getSnapCaseMappingEffectiveWindow = (
  machine: ExistingSourceMappingWindow,
  partnership: PartnershipWindow | undefined,
  fallbackDate: string
) => {
  if (machine.effectiveStartDate) {
    return {
      effectiveStartDate: machine.effectiveStartDate,
      effectiveEndDate: machine.effectiveEndDate,
    };
  }

  return {
    effectiveStartDate:
      partnership?.effective_start_date ?? machine.firstSeenAt?.slice(0, 10) ?? fallbackDate,
    effectiveEndDate: partnership?.effective_end_date ?? null,
  };
};
