import { taxAttributeEvidence,taxChangeEvidence } from './nayax-tax-attributes.ts';
function same(actual: unknown,expected: unknown) {
  if(JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error(JSON.stringify(actual));
}
Deno.test('returns numeric tax candidates without unrelated identifiers or text',()=>{
  same(taxAttributeEvidence({Data:[{AttributeName:'Credit Card Extra Charge',AttributeValue:'7.00'},
    {AttributeName:'Reader ID',AttributeValue:'4434330125144394'},
    {AttributeName:'Tax notes',AttributeValue:'private free text'}]}),[
      {fieldName:'Credit Card Extra Charge',value:'7.00'}, {fieldName:'Tax notes',value:null}]);
});
Deno.test('object-shaped settings retain only scalar tax fields',()=>{
  same(taxAttributeEvidence({Settings:{VAT:0,SurchargePercent:7,Token:'secret'}}),[
    {fieldName:'VAT',value:0},{fieldName:'SurchargePercent',value:7}]);
});
Deno.test('documented Lynx device attribute shape is recognized',()=>{
  same(taxAttributeEvidence([{DeviceAttributeName:'Credit Card Extra Charge',DeviceAttributeValue:'7.00',MachineID:545814962}]),
    [{fieldName:'Credit Card Extra Charge',value:'7.00'}]);
});
Deno.test('unknown payload is empty and bounded',()=>{
  same(taxAttributeEvidence(null),[]);
  if(taxAttributeEvidence(Array.from({length:100},()=>({Name:'Tax',Value:7}))).length!==20) throw new Error('unbounded');
});
Deno.test('dated history returns only safe tax changes and omits actor identities',()=>{
  same(taxChangeEvidence([{ChangedItem:'Credit Card Extra Charge',ChangedFrom:'7',ChangedTo:'8',
    UpdatedDt:'2026-09-10T00:00:00Z',ChangedBy:'private actor'},
    {ChangedItem:'MachineName',ChangedFrom:'private',ChangedTo:'private'}]),[
    {fieldName:'Credit Card Extra Charge',from:'7',to:'8',changedAt:'2026-09-10T00:00:00Z'}]);
});
