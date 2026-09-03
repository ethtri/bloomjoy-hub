import { parseNayaxRefundExecutionContext } from './nayax-refund-context.ts';
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
const expected={caseId:'a',caseVersion:3,attemptGeneration:0,transactionId:'12345678',siteId:6,
  amountCents:700,accountScope:'ACCOUNT',providerMachineId:'MACHINE'};
const context={...expected,contextHash:'a'.repeat(64),originalAmountCents:700,currencyCode:'USD',
  machineAuthorizationTime:'2026-08-26T13:17:08.123',machineAuthorizationTimeSource:'MachineAuthorizationTime'};
Deno.test('automatic execution context preserves the raw provider clock without a balance field',()=>{
 const result=parseNayaxRefundExecutionContext(context,expected);
 assertEquals(result?.machineAuthorizationTime,'2026-08-26T13:17:08.123');
 assertEquals(result?.originalAmountCents,700);
 assertEquals('remainingRefundableAmountCents' in (result??{}),false);
});
Deno.test('wrong original, amount, scope, site, generation and clock source cannot reach execution',()=>{
 for(const patch of [{transactionId:'other'},{originalAmountCents:701},{accountScope:'OTHER'},{providerMachineId:'OTHER'},
   {siteId:4},{caseVersion:4},{attemptGeneration:1},{machineAuthorizationTimeSource:'AuthorizationTimeGMT'},
   {machineAuthorizationTime:'2026-02-30T12:00:00'},{contextHash:'forged'}]){
   assertEquals(parseNayaxRefundExecutionContext({...context,...patch},expected),null);
 }
});
