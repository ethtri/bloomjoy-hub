type ObjectRow = Record<string, unknown>;

// Optional historical diagnostic only. Current source sync does not depend on
// changeLogs permissions or infer effective dates from an empty history result.
export function taxChangeEvidence(payload: unknown): ObjectRow[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.filter(row => row && typeof row === 'object' && /tax|vat|extra.?charge|surcharge|convenience.?fee/i.test(String(row.ChangedItem)))
    .slice(0,100).map(row => ({fieldName:String(row.ChangedItem).slice(0,120),
      from:/^[\d.,%+\- ]{1,32}$/.test(String(row.ChangedFrom)) ? row.ChangedFrom : null,
      to:/^[\d.,%+\- ]{1,32}$/.test(String(row.ChangedTo)) ? row.ChangedTo : null,
      changedAt:typeof row.UpdatedDt==='string' && Number.isFinite(Date.parse(row.UpdatedDt)) ? row.UpdatedDt : null}));
}
