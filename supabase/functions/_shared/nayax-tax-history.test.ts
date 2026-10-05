import { taxChangeEvidence } from './nayax-tax-history.ts';
Deno.test('dated history returns only safe tax changes and omits actor identities',()=>{
  const result=taxChangeEvidence([{ChangedItem:'Credit Card Extra Charge',ChangedFrom:'7',ChangedTo:'8',
    UpdatedDt:'2026-09-10T00:00:00Z',ChangedBy:'private actor'},
    {ChangedItem:'MachineName',ChangedFrom:'private',ChangedTo:'private'}]);
  if(JSON.stringify(result)!==JSON.stringify([
    {fieldName:'Credit Card Extra Charge',from:'7',to:'8',changedAt:'2026-09-10T00:00:00Z'}])) throw new Error('Invalid safe evidence');
});
