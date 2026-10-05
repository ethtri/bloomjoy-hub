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
