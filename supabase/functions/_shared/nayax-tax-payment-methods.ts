type SafeTaxSetting = {
  classification: 'verified_tax' | 'unclassified_extra_charge' | 'missing';
  ratePercent: number | null;
  fieldName: string;
  provenance: string;
};

// MachinePaymentResponse also contains provider usernames/passwords. Inspect
// only these documented fields; never return, spread, store, or log a raw row.
export function paymentMethodTaxObservation(
  accountKey: string,
  machineId: string,
  payload: unknown,
): SafeTaxSetting {
  const fieldName = 'paymentMethods.PaymentMethodID=1.ConvenienceFeeValue';
  const missing = (reason: string): SafeTaxSetting => ({classification:'missing',ratePercent:null,fieldName,
    provenance:`Nayax payment methods observed; ${reason}`});
  if(!Array.isArray(payload)) return missing('documented response array absent');
  const matches = payload.filter(row => row && typeof row==='object' && row.PaymentMethodID===1);
  if(matches.length!==1) return missing('credit card payment method absent or ambiguous');
  const row = matches[0] as Record<string,unknown>;
  if(String(row.MachineID)!==machineId) return missing('provider machine identity mismatch');
  const value = row.ConvenienceFeeValue;
  if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>100) {
    return missing('configured value is not a valid percentage');
  }
  if(accountKey!=='TGPACI_USA_DB' || (value!==0 && row.ConvenienceFeePercentageBit!==true)) {
    return {classification:'unclassified_extra_charge',ratePercent:null,fieldName,
      provenance:'Nayax payment method observed; fixed nonzero fee or account tax semantics not verified'};
  }
  return {classification:'verified_tax',ratePercent:value,fieldName,
    provenance:'Nayax GET machine paymentMethods; PaymentMethodID=1 ConvenienceFeeValue matches Credit Card Extra Charge for all 40 configured US-account portal readers; percentage flag verified (zero fee valid in fixed mode); Finance/owner tax semantics verified; #1763'};
}
