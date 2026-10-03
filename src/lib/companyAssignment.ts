export type CompanyLocation = { locationId: string; locationName: string; timezone: string; status: string };
export type CompanyChoice = { accountId: string; accountName: string; status: string; locations: CompanyLocation[]; archivedAt?: string | null; updatedAt?: string; machineCount?: number };
export type CompanyChoices = { canCreateCompany: boolean; companies: CompanyChoice[] };
export type CompanyAssignmentDraft = {
  accountId: string;
  locationId: string;
  locationName: string;
  locationTimezone: string;
  addLocation: boolean;
};
export type SavedCompanyAssignment = {
  accountId: string;
  accountName: string;
  locationId: string;
  locationName: string;
  locationTimezone: string;
};

export const singleEligibleCompanyId = (companies: CompanyChoice[], activeTargetsOnly = false) => {
  const eligible = companies.filter((company) => !company.archivedAt && (!activeTargetsOnly || company.status === 'active'));
  return eligible.length === 1 ? eligible[0].accountId : '';
};

export const normalizeCompanyName = (name: string) => name.trim().toLocaleLowerCase();

export const changeCompanyAssignment = (
  draft: CompanyAssignmentDraft,
  accountId: string,
  saved?: SavedCompanyAssignment | null,
): CompanyAssignmentDraft => ({
  ...draft,
  accountId,
  locationId: accountId === saved?.accountId ? saved.locationId : '',
  addLocation: false,
  locationName: saved?.locationName ?? draft.locationName,
  locationTimezone: saved?.locationTimezone ?? draft.locationTimezone,
});

export const validateCompanyAssignment = (
  draft: CompanyAssignmentDraft,
  companies: CompanyChoice[],
  saved?: SavedCompanyAssignment | null,
  activeTargetsOnly = false,
) => {
  if (!draft.accountId) return 'Choose a company before saving.';
  // Preserve an unchanged saved assignment even if it is inactive or no longer in the choices.
  if (saved && draft.accountId === saved.accountId && draft.locationId === saved.locationId && !draft.addLocation) return null;
  const company = companies.find((item) => item.accountId === draft.accountId);
  if (!company || (company.archivedAt && company.accountId !== saved?.accountId) || (activeTargetsOnly && company.status !== 'active')) return 'Choose an available company before saving.';
  if (draft.addLocation) {
    if (!draft.locationName.trim()) return 'Enter the new location name.';
    try {
      if (!draft.locationTimezone.trim()) return 'Choose the location time zone.';
      if (draft.locationTimezone !== 'UTC' && !draft.locationTimezone.includes('/')) return 'Enter a valid IANA location time zone.';
      new Intl.DateTimeFormat('en', { timeZone: draft.locationTimezone });
    } catch { return 'Enter a valid IANA location time zone.'; }
    return null;
  }
  const location = company.locations.find((item) => item.locationId === draft.locationId);
  return location && (!activeTargetsOnly || location.status === 'active') ? null : 'Choose a location for the selected company, or add a location.';
};
