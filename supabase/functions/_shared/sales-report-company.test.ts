import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSalesReportCompany, resolveSalesReportCompany, validateCompanyExportFilters } from "./sales-report-company.ts";

const companyA = "15701000-0000-4000-8000-000000000001";
const companyB = "15701000-0000-4000-8000-000000000002";
const dimensions = [
  { account_id: companyA, account_name: "Company A", machine_id: "machine-a" },
  { account_id: companyA, account_name: "Company A", machine_id: "machine-a" },
  { account_id: companyA, account_name: "Company A", machine_id: "machine-b" },
  { account_id: companyB, account_name: "Company B", machine_id: "machine-c" },
];

Deno.test('malformed company export filters never normalize into all locations or tenders', () => {
  validateCompanyExportFilters({ locationIds: [], paymentMethods: [] });
  validateCompanyExportFilters({ locationIds: [companyA], machineIds: [companyB], paymentMethods: ['credit'] });
  for (const raw of [{ locationIds: ['invalid'] }, { locationIds: [companyA, false] }, { locationIds: 'all' }, { machineIds: {} }, { paymentMethods: ['invalid'] }]) {
    assertThrows(() => validateCompanyExportFilters(raw));
  }
});

Deno.test("company identity accepts legacy all scope but never treats an invalid selection as all", () => {
  for (const value of [null, undefined, "", "all"]) assertEquals(parseSalesReportCompany(value), null);
  assertEquals(parseSalesReportCompany(` ${companyA} `), companyA);
  for (const value of ["Company A", "not-a-uuid", [], {}, false, 1]) {
    assertThrows(() => parseSalesReportCompany(value), Error, "valid company");
  }
});

Deno.test("company export scope deduplicates historical dimension rows and intersects explicit machines", () => {
  assertEquals(resolveSalesReportCompany(companyA, dimensions), {
    companyName: "Company A", machineIds: ["machine-a", "machine-b"],
  });
  assertEquals(resolveSalesReportCompany(companyA, dimensions, ["machine-b", "machine-c"]), {
    companyName: "Company A", machineIds: ["machine-b"],
  });
});

Deno.test("empty or inaccessible company export selections never fall back to all machines", () => {
  assertThrows(() => resolveSalesReportCompany(companyA, dimensions, []), Error, "No accessible machines");
  assertThrows(() => resolveSalesReportCompany(companyA, dimensions, ["machine-c"]), Error, "No accessible machines");
  assertThrows(() => resolveSalesReportCompany(companyB, dimensions.filter(row => row.account_id === companyA)), Error, "unavailable");
});
