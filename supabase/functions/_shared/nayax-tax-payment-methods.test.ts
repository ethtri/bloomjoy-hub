import { paymentMethodTaxObservation } from './nayax-tax-payment-methods.ts';
const account='TGPACI_USA_DB';
const machine='545814962';
const row = (overrides: Record<string,unknown>={}) => ({MachineID:Number(machine),PaymentMethodID:1,
  ConvenienceFeePercentageBit:true,ConvenienceFeeValue:7,...overrides});
function equal(actual:unknown,expected:unknown) {
  if(actual!==expected) throw new Error(`Expected ${expected}; got ${actual}`);
}
Deno.test('exact account card percentage maps matched machine source rate',()=>{
  const result=paymentMethodTaxObservation(account,machine,[row()]);
  equal(result.ratePercent,7); equal(result.classification,'verified_tax');
  equal(result.fieldName,'paymentMethods.PaymentMethodID=1.ConvenienceFeeValue');
});
Deno.test('zero fixed fee means zero extra charge; nonzero fixed fee stays unclassified',()=>{
  equal(paymentMethodTaxObservation(account,machine,[row({ConvenienceFeePercentageBit:false,ConvenienceFeeValue:0})]).ratePercent,0);
  equal(paymentMethodTaxObservation(account,machine,[row({ConvenienceFeePercentageBit:false,ConvenienceFeeValue:7})]).classification,'unclassified_extra_charge');
  equal(paymentMethodTaxObservation(account,machine,[row({ConvenienceFeePercentageBit:null,ConvenienceFeeValue:7})]).ratePercent,null);
});
Deno.test('wrong accounts, unrelated payment methods and mismatched machine IDs never yield tax',()=>{
  equal(paymentMethodTaxObservation('OTHER',machine,[row()]).ratePercent,null);
  equal(paymentMethodTaxObservation(account,machine,[row({PaymentMethodID:2})]).classification,'missing');
  equal(paymentMethodTaxObservation(account,machine,[row({MachineID:123})]).classification,'missing');
});
Deno.test('missing/ambiguous/invalid values invalidate coverage',()=>{
  for(const payload of [null,{},[],[row(),row()],[row({ConvenienceFeeValue:-1})],
    [row({ConvenienceFeeValue:101})],[row({ConvenienceFeeValue:'7'})],[row({ConvenienceFeeValue:NaN})]]) {
    equal(paymentMethodTaxObservation(account,machine,payload).classification,'missing');
  }
});
Deno.test('allowlist result cannot expose provider credentials or arbitrary row properties',()=>{
  const result=paymentMethodTaxObservation(account,machine,[row({ExternalPaymentProviderUsername:'private-user',
    ExternalPaymentProviderPassword:'private-password',PaymentMethodCustomData:'private-custom',LastUpdated:'private-date'})]);
  equal(Object.keys(result).sort().join(','),'classification,fieldName,provenance,ratePercent');
  if(JSON.stringify(result).includes('private-')) throw new Error('provider properties leaked');
});
