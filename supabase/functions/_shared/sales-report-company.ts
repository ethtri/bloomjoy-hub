// Input identity and scope are resolved independently of client display labels.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSalesReportCompany(value: unknown): string | null {
  if (value == null || value === "" || value === "all") return null;
  if (typeof value !== "string" || !uuidPattern.test(value.trim())) {
    throw new Error("Choose a valid company before exporting.");
  }
  return value.trim().toLowerCase();
}

type CompanyDimension = { account_id: string; account_name: string; machine_id: string };

export function resolveSalesReportCompany(
  companyId: string,
  dimensions: CompanyDimension[],
  requestedMachineIds?: string[],
): { companyName: string; machineIds: string[] } {
  const company = dimensions.filter((row) => row.account_id === companyId);
  if (!company.length) throw new Error("The selected company is unavailable for this report.");
  const machineIds = [...new Set(company.map((row) => row.machine_id))]
    .filter((id) => requestedMachineIds === undefined || requestedMachineIds.includes(id));
  if (!machineIds.length) throw new Error("No accessible machines match the selected company and filters.");
  return { companyName: company[0].account_name, machineIds };
}
