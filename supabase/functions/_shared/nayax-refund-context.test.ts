import { parseNayaxRefundExecutionContext } from './nayax-refund-context.ts';
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
const expected={caseId:'a',caseVersion:3,attemptGeneration:0,transactionId:'12345678',siteId:6,
  amountCents:700,accountScope:'ACCOUNT',providerMachineId:'MACHINE',
  machineAuthorizationInstant:'2026-08-26T17:17:08.123Z'};
const context={...expected,contextHash:'a'.repeat(64),originalAmountCents:700,currencyCode:'USD',
  machineAuthorizationTime:'2026-08-26T13:17:08.123',machineAuthorizationTimeSource:'MachineAuthorizationTime',
  machineAuthorizationTimeInstant:expected.machineAuthorizationInstant,
  machineAuthorizationTimeWire:'2026-08-26T13:17:08.123',
  machineAuthorizationTimeSerializationMode:'exact_source',
  machineAuthorizationTimeSerializationSource:'exact_source'};
Deno.test('automatic execution context preserves the raw provider clock without a balance field',()=>{
 const result=parseNayaxRefundExecutionContext(context,expected);
 assertEquals(result?.machineAuthorizationTime,'2026-08-26T13:17:08.123');
 assertEquals(result?.originalAmountCents,700);
 assertEquals('remainingRefundableAmountCents' in (result??{}),false);
});
Deno.test('automatic execution context accepts only the exact bound-offset wire value',()=>{
 const offset={...context,
   machineAuthorizationTimeWire:'2026-08-26T13:17:08.123-04:00',
   machineAuthorizationTimeSerializationMode:'source_with_bound_offset',
   machineAuthorizationTimeSerializationSource:'selected_normalized_instant'};
 assertEquals(
   parseNayaxRefundExecutionContext(offset,expected)?.machineAuthorizationTimeWire,
   '2026-08-26T13:17:08.123-04:00',
 );
 for(const patch of [
   {machineAuthorizationTimeWire:'2026-08-26T13:17:08.123-05:00'},
   {machineAuthorizationTimeSerializationSource:'native_machine_configuration'},
   {machineAuthorizationTimeInstant:'2026-08-26T16:17:08.123Z'},
 ]){
   assertEquals(parseNayaxRefundExecutionContext({...offset,...patch},expected),null);
 }
});
Deno.test('wrong original, amount, scope, site, generation and clock source cannot reach execution',()=>{
 for(const patch of [{transactionId:'other'},{originalAmountCents:701},{accountScope:'OTHER'},{providerMachineId:'OTHER'},
   {siteId:4},{caseVersion:4},{attemptGeneration:1},{machineAuthorizationTimeSource:'AuthorizationTimeGMT'},
   {machineAuthorizationTime:'2026-02-30T12:00:00'},{contextHash:'forged'}]){
   assertEquals(parseNayaxRefundExecutionContext({...context,...patch},expected),null);
 }
});
