import { assertEquals } from "jsr:@std/assert@1";
import {
  getSnapcaseProvisionalNotice,
  SNAPCASE_PROVISIONAL_NOTICE,
} from "./snapcase-report-scope.ts";

const dimensions = [
  { machine_id: "sunze-1", machine_type: "commercial" },
  { machine_id: "snapcase-1", machine_type: "snapcase" },
];

Deno.test("marks all-machine and mixed authorized scopes provisional", () => {
  assertEquals(
    getSnapcaseProvisionalNotice(dimensions, []),
    SNAPCASE_PROVISIONAL_NOTICE,
  );
});

Deno.test("marks a selected SnapCase machine provisional", () => {
  assertEquals(
    getSnapcaseProvisionalNotice(dimensions, ["snapcase-1"]),
    SNAPCASE_PROVISIONAL_NOTICE,
  );
});

Deno.test("does not mark a selected Sunze-only machine provisional", () => {
  assertEquals(
    getSnapcaseProvisionalNotice(dimensions, ["sunze-1"]),
    undefined,
  );
});
