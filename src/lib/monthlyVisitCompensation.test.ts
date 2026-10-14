/// <reference lib="deno.ns" />
import { monthlyAgreementMoney, monthlyVisitTotals, type MonthlyVisitLine } from './monthlyVisitCompensation.ts';
import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

Deno.test('monthly money keeps exact cents and rejects unsupported or ambiguous inputs', () => {
  assertEquals(monthlyAgreementMoney('180.25'), 18025);
  assertEquals(monthlyAgreementMoney('0'), 0);
  for (const input of ['-1', '1.001', 'NaN', '1e2', '21474836.48', '']) assertThrows(() => monthlyAgreementMoney(input));
});

Deno.test('machine selection keeps the monthly base in its one agreement scope', () => {
  const line = { machineId: 'machine-a', evaluation: { baseEarningsCents: 18000, extraEarningsCents: 2400, visitUnits: 3, blockers: [] } } as MonthlyVisitLine;
  assertEquals(monthlyVisitTotals([line]), { monthlyBaseEarningsCents: 18000, extraTimeEarningsCents: 2400, visitUnits: 3 });
  assertEquals(monthlyVisitTotals([line].filter(item => item.machineId === 'machine-b')), { monthlyBaseEarningsCents: 0, extraTimeEarningsCents: 0, visitUnits: 0 });
  line.evaluation.blockers = [{ code: 'unresolved', message: 'Confirm missing visits.' }];
  assertEquals(monthlyVisitTotals([line]), { monthlyBaseEarningsCents: null, extraTimeEarningsCents: null, visitUnits: 3 });
});
