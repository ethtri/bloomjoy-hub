type ObjectRow = Record<string, unknown>;

// Return only tax/extra-charge attribute labels and scalar values. Never return
// the provider body, auth headers, payment identifiers, or unrelated settings.
export function taxAttributeEvidence(payload: unknown): ObjectRow[] {
  const result: ObjectRow[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || result.length >= 20 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.slice(0,500).forEach(row => visit(row,depth+1)); return; }
    const row = value as ObjectRow;
    const name = String(row.DeviceAttributeName ?? row.AttributeName ?? row.Name ?? row.name ?? row.attributeName ?? '');
    if (/tax|vat|extra.?charge|surcharge/i.test(name)) {
      const scalar = row.DeviceAttributeValue ?? row.AttributeValue ?? row.Value ?? row.value ?? row.attributeValue;
      result.push({ fieldName:name.slice(0,120), value: typeof scalar === 'number' || typeof scalar === 'boolean'
        ? scalar : typeof scalar === 'string' && /^[\d.,%+\- ]{1,32}$/.test(scalar) ? scalar : null });
    }
    for (const [key,child] of Object.entries(row)) {
      if (/tax|vat|extra.?charge|surcharge/i.test(key) && (typeof child === 'number' || typeof child === 'boolean'
        || (typeof child === 'string' && /^[\d.,%+\- ]{1,32}$/.test(child)))) {
        result.push({fieldName:key.slice(0,120),value:child});
      } else if (child && typeof child === 'object') visit(child,depth+1);
    }
  };
  visit(payload,0);
  return result.slice(0,20);
}

export function taxChangeEvidence(payload: unknown): ObjectRow[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.filter(row => row && typeof row === 'object' && /tax|vat|extra.?charge|surcharge/i.test(String(row.ChangedItem)))
    .slice(0,100).map(row => ({fieldName:String(row.ChangedItem).slice(0,120),
      from:/^[\d.,%+\- ]{1,32}$/.test(String(row.ChangedFrom)) ? row.ChangedFrom : null,
      to:/^[\d.,%+\- ]{1,32}$/.test(String(row.ChangedTo)) ? row.ChangedTo : null,
      changedAt:typeof row.UpdatedDt==='string' && Number.isFinite(Date.parse(row.UpdatedDt)) ? row.UpdatedDt : null}));
}

export function taxSettingObservation(accountKey: string,payload: unknown) {
  const attributes = taxAttributeEvidence(payload);
  // Finance + exact portal reader evidence establish this field for the
  // configured US account; this is not a generic surcharge-to-tax conversion.
  const matches = attributes.filter(row => accountKey==='TGPACI_USA_DB'
    && String(row.fieldName).replace(/\s+/g,' ').trim().toLowerCase()==='credit card extra charge');
  if(matches.length===1) {
    const value=String(matches[0].value ?? '').trim().replace(/%$/,'');
    const rate= /^\d+(\.\d+)?$/.test(value) ? Number(value):NaN;
    if(Number.isFinite(rate) && rate>=0 && rate<=100) return {classification:'verified_tax',ratePercent:rate,
      fieldName:matches[0].fieldName,provenance:'Nayax Credit Card Extra Charge; configured US account tax semantics verified by owner-provided Finance and matched portal evidence; #1763'};
  }
  const candidate=attributes.find(row=>/extra.?charge|surcharge/i.test(String(row.fieldName)));
  return {classification:candidate ? 'unclassified_extra_charge':'missing',ratePercent:null,
    fieldName:candidate?.fieldName ?? null,provenance:'Nayax attributes observed; expected verified tax field absent or ambiguous'};
}
