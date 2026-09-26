/// <reference lib="deno.ns" />

import { assertEquals } from "jsr:@std/assert@1";
import { hasProvisionalSnapcaseSales } from "./snapcaseReportNotice.ts";

const dimensions = [
  { machineId: "sunze-1", machineType: "commercial" as const },
  { machineId: "snapcase-1", machineType: "snapcase" as const },
];

Deno.test("warns for all-machine and selected SnapCase scopes", () => {
  assertEquals(hasProvisionalSnapcaseSales(dimensions), true);
  assertEquals(hasProvisionalSnapcaseSales(dimensions, ["snapcase-1"]), true);
});

Deno.test("leaves a selected Sunze-only scope unchanged", () => {
  assertEquals(hasProvisionalSnapcaseSales(dimensions, ["sunze-1"]), false);
});
