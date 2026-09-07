type SearchableRefundCase = {
  publicReference: string;
  customerEmail: string;
  customerName?: string | null;
  machineLabel: string;
  locationName: string;
  issueSummary: string;
};

/** Search only the supplied authorized overview. The archive remains an explicit scope. */
export function searchRefundCases<T extends SearchableRefundCase>({
  customerCases, internalCases, canViewInternal, internalView, query, matchesCurrentView,
}: {
  customerCases: readonly T[];
  internalCases: readonly T[];
  canViewInternal: boolean;
  internalView: boolean;
  query: string;
  matchesCurrentView: (refundCase: T) => boolean;
}): T[] {
  const source = internalView ? (canViewInternal ? internalCases : []) : customerCases;
  const normalized = query.trim().toLowerCase();
  return source.filter((refundCase) => normalized
    ? [refundCase.publicReference, refundCase.customerEmail, refundCase.customerName ?? '',
      refundCase.machineLabel, refundCase.locationName, refundCase.issueSummary]
      .join(' ').toLowerCase().includes(normalized)
    : matchesCurrentView(refundCase));
}
