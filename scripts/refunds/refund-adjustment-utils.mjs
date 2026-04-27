import { createHash } from 'node:crypto';

export const AUTO_APPLY_STATUSES = new Set([
  'approved',
  'complete',
  'completed',
  'closed',
  'processed',
  'refund approved',
  'refund complete',
  'refund completed',
  'refund issued',
  'refund processed',
  'refunded',
  'resolved',
  'settled',
]);

export const AUTO_APPLY_DECISIONS = new Set([
  'approve',
  'approved',
  'refund approved',
  'refund approve',
]);

export const normalizeHeader = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) {
        rows.push(row);
      }
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some((cell) => cell.trim() !== '')) {
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => normalizeHeader(header.trim()));
  return rows.slice(1).map((cells, rowIndex) => ({
    rowNumber: rowIndex + 2,
    row: Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() ?? ''])),
  }));
};

export const parseSheetValues = (values) => {
  if (!Array.isArray(values) || values.length === 0) return [];

  const headers = values[0].map((header) => normalizeHeader(header));
  return values
    .slice(1)
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const row = Object.fromEntries(
        headers.map((header, cellIndex) => [
          header,
          String(cells?.[cellIndex] ?? '').trim(),
        ])
      );

      if (!row.source_sheet_row_number) {
        row.source_sheet_row_number = String(rowNumber);
      }

      return { rowNumber, row };
    })
    .filter(({ row }) =>
      Object.entries(row).some(
        ([key, value]) => key !== 'source_sheet_row_number' && String(value).trim() !== ''
      )
    );
};

export const normalizeMatchText = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pickText = (row, keys) => {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const pickNumberValue = (row, keys) => {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
};

export const parseCents = (row) => {
  const centsValue = pickNumberValue(row, ['amount_cents', 'refund_amount_cents']);
  const cents = Number(String(centsValue).replace(/[$,]/g, ''));
  if (Number.isFinite(cents) && cents >= 0 && String(centsValue).trim() !== '') {
    return Math.round(cents);
  }

  const usdValue = pickNumberValue(row, [
    'amount_usd',
    'refund_amount_usd',
    'amount',
    'refund_amount',
    'refund',
  ]);
  const usd = Number(String(usdValue).replace(/[$,]/g, ''));
  if (Number.isFinite(usd) && usd >= 0 && String(usdValue).trim() !== '') {
    return Math.round(usd * 100);
  }

  return 0;
};

export const normalizeDate = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

export const normalizeStatus = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

export const normalizeAdjustmentType = (value) => {
  const normalized = normalizeStatus(value);
  if (normalized.includes('complaint')) return 'complaint_refund';
  if (normalized.includes('manual')) return 'manual_adjustment';
  return 'refund';
};

export const extractRefundInput = (row, fallbackRowReference) => {
  const sourceLocation = pickText(row, [
    'location',
    'location_of_purchase',
    'source_location',
    'machine_location',
    'refund_location',
    'location_name',
    'venue',
    'machine_alias',
    'machine',
  ]);
  const refundDate = normalizeDate(
    pickText(row, ['refund_date', 'decision_date', 'processed_date', 'adjustment_date', 'date'])
  );
  const originalOrderDate = normalizeDate(
    pickText(row, [
      'original_order_date',
      'date_and_time_of_incident',
      'incident_date',
      'order_date',
      'sale_date',
      'transaction_date',
    ])
  );
  const sourceStatus = pickText(row, ['status', 'refund_status', 'source_status']);
  const sourceDecision = pickText(row, ['decision', 'refund_decision']);
  const normalizedSourceStatus = normalizeStatus(sourceStatus);
  const normalizedSourceDecision = normalizeStatus(sourceDecision);
  const sourceRowReference =
    pickText(row, [
      'source_row_reference',
      'request_id',
      'row_reference',
      'row_id',
      'response_id',
      'timestamp',
    ]) ||
    fallbackRowReference;

  return {
    sourceRowReference,
    sourceLocation,
    normalizedLocation: normalizeMatchText(sourceLocation),
    refundDate,
    originalOrderDate,
    amountCents: parseCents(row),
    reason: pickText(row, [
      'reason',
      'incident_description',
      'mgr_commentary',
      'commentary',
      'notes',
      'complaint_reason',
      'refund_reason',
    ]),
    sourceStatus,
    normalizedSourceStatus,
    sourceDecision,
    normalizedSourceDecision,
    adjustmentType: normalizeAdjustmentType(row.adjustment_type || row.type || row.reason),
    complaintCount: Math.max(0, Math.round(Number(row.complaint_count || row.complaints || 0))),
  };
};

export const makeSourceRowHash = (input) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        sourceLocation: input.normalizedLocation,
        refundDate: input.refundDate,
        originalOrderDate: input.originalOrderDate,
        amountCents: input.amountCents,
        reason: normalizeMatchText(input.reason),
        sourceStatus: input.normalizedSourceStatus,
        sourceDecision: input.normalizedSourceDecision,
        adjustmentType: input.adjustmentType,
      })
    )
    .digest('hex');

export const buildSanitizedRefundPayload = ({
  input,
  sourceReference,
  sourceRowHash,
  sourceRowNumber,
  match,
  appliedAdjustmentId = null,
}) => ({
  payload_schema: 'refund_adjustment.v1',
  source_reference: sourceReference || null,
  source_row_reference: input.sourceRowReference,
  source_row_hash: sourceRowHash,
  source_row_number: sourceRowNumber ? String(sourceRowNumber) : null,
  source_location: input.sourceLocation || null,
  refund_date: input.refundDate || null,
  original_order_date: input.originalOrderDate || null,
  amount_cents: input.amountCents,
  adjustment_type: input.adjustmentType,
  complaint_count: input.complaintCount,
  source_status: input.sourceStatus || null,
  source_decision: input.sourceDecision || null,
  match_status: match?.matchStatus ?? null,
  match_confidence: match?.matchConfidence ?? null,
  match_reason: match?.matchReason ?? null,
  candidate_machine_count: match?.candidateMachineIds?.length ?? 0,
  matched_machine_id: match?.matchedMachine?.id ?? null,
  applied_adjustment_id: appliedAdjustmentId,
});

export const buildMachineProfiles = ({ machines, aliases = [] }) => {
  const aliasesByMachineId = new Map();
  aliases.forEach((alias) => {
    if (!alias.reporting_machine_id || !alias.alias) return;
    const current = aliasesByMachineId.get(alias.reporting_machine_id) ?? [];
    current.push({
      alias: alias.alias,
      normalizedAlias: normalizeMatchText(alias.alias),
    });
    aliasesByMachineId.set(alias.reporting_machine_id, current);
  });

  return machines.map((machine) => {
    const locationName =
      machine.location_name ??
      machine.reporting_locations?.name ??
      machine.locationName ??
      '';
    const labels = [
      { kind: 'machine_label', text: machine.machine_label ?? machine.machineLabel ?? '' },
      { kind: 'location_name', text: locationName },
      { kind: 'external_machine_id', text: machine.sunze_machine_id ?? machine.sunzeMachineId ?? '' },
      ...(aliasesByMachineId.get(machine.id) ?? []).map((alias) => ({
        kind: 'alias',
        text: alias.alias,
      })),
    ]
      .map((entry) => ({ ...entry, normalized: normalizeMatchText(entry.text) }))
      .filter((entry) => entry.normalized);

    return {
      id: machine.id,
      locationId: machine.location_id ?? machine.locationId,
      machineLabel: machine.machine_label ?? machine.machineLabel ?? 'Unnamed machine',
      labels,
    };
  });
};

const uniqueCandidateIds = (candidates) => [...new Set(candidates.map((candidate) => candidate.id))];

export const matchRefundToMachine = (input, machineProfiles) => {
  if (!input.refundDate || input.amountCents <= 0 || !input.normalizedLocation) {
    return {
      matchStatus: 'invalid',
      matchConfidence: 0,
      matchReason: 'missing_required_refund_fields',
      candidateMachineIds: [],
      matchedMachine: null,
    };
  }

  if (!AUTO_APPLY_STATUSES.has(input.normalizedSourceStatus)) {
    return {
      matchStatus: 'needs_review',
      matchConfidence: 0,
      matchReason: input.normalizedSourceStatus
        ? 'source_status_requires_review'
        : 'missing_source_status',
      candidateMachineIds: [],
      matchedMachine: null,
    };
  }

  if (
    input.normalizedSourceDecision &&
    !AUTO_APPLY_DECISIONS.has(input.normalizedSourceDecision)
  ) {
    return {
      matchStatus: 'needs_review',
      matchConfidence: 0,
      matchReason: 'source_decision_requires_review',
      candidateMachineIds: [],
      matchedMachine: null,
    };
  }

  const exactCandidates = machineProfiles.filter((machine) =>
    machine.labels.some((label) => label.normalized === input.normalizedLocation)
  );
  const exactIds = uniqueCandidateIds(exactCandidates);

  if (exactIds.length === 1) {
    const matchedMachine = exactCandidates.find((machine) => machine.id === exactIds[0]) ?? null;
    return {
      matchStatus: 'matched',
      matchConfidence: 1,
      matchReason: 'exact_location_or_alias_match',
      candidateMachineIds: exactIds,
      matchedMachine,
    };
  }

  if (exactIds.length > 1) {
    return {
      matchStatus: 'ambiguous',
      matchConfidence: 0.5,
      matchReason: 'multiple_exact_location_or_alias_matches',
      candidateMachineIds: exactIds,
      matchedMachine: null,
    };
  }

  const fuzzyCandidates = machineProfiles.filter((machine) =>
    machine.labels.some((label) => {
      if (label.kind !== 'alias' || label.normalized.length < 5) return false;
      return (
        input.normalizedLocation.includes(label.normalized) ||
        label.normalized.includes(input.normalizedLocation)
      );
    })
  );
  const fuzzyIds = uniqueCandidateIds(fuzzyCandidates);

  if (fuzzyIds.length === 1) {
    const matchedMachine = fuzzyCandidates.find((machine) => machine.id === fuzzyIds[0]) ?? null;
    return {
      matchStatus: 'matched',
      matchConfidence: 0.86,
      matchReason: 'single_alias_containment_match',
      candidateMachineIds: fuzzyIds,
      matchedMachine,
    };
  }

  if (fuzzyIds.length > 1) {
    return {
      matchStatus: 'ambiguous',
      matchConfidence: 0.5,
      matchReason: 'multiple_alias_containment_matches',
      candidateMachineIds: fuzzyIds,
      matchedMachine: null,
    };
  }

  return {
    matchStatus: 'unmatched',
    matchConfidence: 0,
    matchReason: 'no_conservative_machine_match',
    candidateMachineIds: [],
    matchedMachine: null,
  };
};

export const calculatePartnerSettlementTotals = ({
  grossSalesCents,
  taxCents = 0,
  feeCents = 0,
  costCents = 0,
  refundAmountCents = 0,
  splitBase = 'net_sales',
  partnerShareBasisPoints = 0,
}) => {
  const gross = Math.max(0, Math.round(grossSalesCents));
  const refund = Math.max(0, Math.round(refundAmountCents));
  const preCostNetSales = Math.max(0, gross - Math.max(0, taxCents) - Math.max(0, feeCents) - refund);
  const refundedGross = Math.max(0, gross - refund);
  const splitBaseCents =
    splitBase === 'gross_sales'
      ? refundedGross
      : splitBase === 'contribution_after_costs'
        ? Math.max(0, preCostNetSales - Math.max(0, costCents))
        : preCostNetSales;

  return {
    grossSalesCents: gross,
    refundAmountCents: refund,
    netSalesCents: preCostNetSales,
    splitBaseCents,
    amountOwedCents: Math.round((splitBaseCents * Math.max(0, partnerShareBasisPoints)) / 10000),
  };
};
