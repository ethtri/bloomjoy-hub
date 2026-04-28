import { createHash } from 'node:crypto';

export const AUTO_APPLY_STATUSES = new Set(['closed']);

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

const canonicalReportingMachineIdKeys = [
  'source_reporting_machine_id',
  'reporting_machine_id',
  'canonical_reporting_machine_id',
  'bloomjoy_reporting_machine_id',
  'canonical_machine_id',
  'bloomjoy_machine_id',
  'machine_id',
];

const normalizeUuid = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : '';
};

const pickCanonicalReportingMachineId = (row) => {
  const rawValue = pickText(row, canonicalReportingMachineIdKeys);
  return {
    rawPresent: Boolean(rawValue),
    value: normalizeUuid(rawValue),
  };
};

const parseCentAmount = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const cents = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null;
};

const parseUsdAmount = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const usd = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(usd) && usd >= 0 ? Math.round(usd * 100) : null;
};

const canUseRequestAmountFallback = (sourceStatus, sourceDecision) =>
  AUTO_APPLY_STATUSES.has(normalizeStatus(sourceStatus)) &&
  AUTO_APPLY_DECISIONS.has(normalizeStatus(sourceDecision));

export const resolveAmountCents = (row, { sourceStatus = '', sourceDecision = '' } = {}) => {
  const centsValue = pickNumberValue(row, ['amount_cents', 'refund_amount_cents']);
  const cents = parseCentAmount(centsValue);
  if (cents !== null) return { amountCents: cents, amountSource: 'refund_amount_cents' };

  const usdValue = pickNumberValue(row, [
    'amount_usd',
    'refund_amount_usd',
    'amount',
    'refund_amount',
    'refund',
  ]);
  const usd = parseUsdAmount(usdValue);
  if (usd !== null) return { amountCents: usd, amountSource: 'refund_amount' };

  if (canUseRequestAmountFallback(sourceStatus, sourceDecision)) {
    const requestCentsValue = pickNumberValue(row, ['request_amount_cents', 'requested_amount_cents']);
    const requestCents = parseCentAmount(requestCentsValue);
    if (requestCents !== null) {
      return { amountCents: requestCents, amountSource: 'request_amount_cents' };
    }

    const requestUsdValue = pickNumberValue(row, [
      'request_amount',
      'request_amount_usd',
      'requested_amount',
      'requested_amount_usd',
    ]);
    const requestUsd = parseUsdAmount(requestUsdValue);
    if (requestUsd !== null) return { amountCents: requestUsd, amountSource: 'request_amount' };
  }

  return { amountCents: 0, amountSource: null };
};

export const parseCents = (row, options = {}) => resolveAmountCents(row, options).amountCents;

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
  return 'refund';
};

export const extractRefundInput = (row, fallbackRowReference) => {
  const canonicalMachineId = pickCanonicalReportingMachineId(row);
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
  const amount = resolveAmountCents(row, { sourceStatus, sourceDecision });
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
    sourceReportingMachineId: canonicalMachineId.value,
    hasSourceReportingMachineId: canonicalMachineId.rawPresent,
    sourceLocation,
    normalizedLocation: normalizeMatchText(sourceLocation),
    refundDate,
    originalOrderDate,
    amountCents: amount.amountCents,
    amountSource: amount.amountSource,
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

export const makeSourceRowHash = (input) => {
  const hashPayload = {
    sourceRowReference: input.sourceRowReference,
    sourceLocation: input.normalizedLocation,
    refundDate: input.refundDate,
    originalOrderDate: input.originalOrderDate,
    amountCents: input.amountCents,
    sourceStatus: input.normalizedSourceStatus,
    sourceDecision: input.normalizedSourceDecision,
    adjustmentType: input.adjustmentType,
  };

  if (input.hasSourceReportingMachineId) {
    hashPayload.sourceReportingMachineId = input.sourceReportingMachineId || null;
  }

  return createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex');
};

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
  source_reporting_machine_id: input.sourceReportingMachineId || null,
  source_reporting_machine_id_present: Boolean(input.hasSourceReportingMachineId),
  source_location: input.sourceLocation || null,
  refund_date: input.refundDate || null,
  original_order_date: input.originalOrderDate || null,
  amount_cents: input.amountCents,
  amount_source: input.amountSource || null,
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
      {
        kind: 'external_machine_id',
        text:
          machine.external_machine_id ??
          machine.externalMachineId ??
          machine.sunze_machine_id ??
          machine.sunzeMachineId ??
          '',
      },
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

const isActiveStatus = (value) => !value || value === 'active';

const getMachineLocationName = (machine) =>
  machine.location_name ??
  machine.reporting_locations?.name ??
  machine.locationName ??
  '';

export const buildGlobalUniqueRefundScopeLabelMap = ({ machines, aliases = [] }) => {
  const activeMachineIds = new Set(
    machines.filter((machine) => isActiveStatus(machine.status)).map((machine) => machine.id)
  );
  const labelsByNormalized = new Map();
  const addLabel = (normalizedLabel, machineId) => {
    if (!normalizedLabel || !machineId || !activeMachineIds.has(machineId)) return;
    const current = labelsByNormalized.get(normalizedLabel) ?? new Set();
    current.add(machineId);
    labelsByNormalized.set(normalizedLabel, current);
  };

  machines.forEach((machine) => {
    if (!activeMachineIds.has(machine.id)) return;
    addLabel(normalizeMatchText(machine.machine_label ?? machine.machineLabel), machine.id);
    if (isActiveStatus(machine.location_status ?? machine.locationStatus)) {
      addLabel(normalizeMatchText(getMachineLocationName(machine)), machine.id);
    }
  });

  aliases.forEach((alias) => {
    if (!isActiveStatus(alias.status)) return;
    addLabel(normalizeMatchText(alias.alias), alias.reporting_machine_id ?? alias.reportingMachineId);
  });

  const uniqueLabels = new Map();
  labelsByNormalized.forEach((machineIds, normalizedLabel) => {
    if (machineIds.size === 1) {
      uniqueLabels.set(normalizedLabel, [...machineIds][0]);
    }
  });

  return uniqueLabels;
};

const assignmentMachineId = (assignment) => assignment.machine_id ?? assignment.machineId;
const assignmentPartnershipId = (assignment) =>
  assignment.partnership_id ?? assignment.partnershipId;

const isAssignmentActiveForRefundDate = ({ assignment, partnershipId, machineId, refundDate }) => {
  if (assignmentMachineId(assignment) !== machineId) return false;
  if (assignmentPartnershipId(assignment) !== partnershipId) return false;
  if ((assignment.assignment_role ?? assignment.assignmentRole ?? 'primary_reporting') !== 'primary_reporting') {
    return false;
  }
  if ((assignment.status ?? 'active') !== 'active') return false;

  const start = assignment.effective_start_date ?? assignment.effectiveStartDate ?? '0001-01-01';
  const end = assignment.effective_end_date ?? assignment.effectiveEndDate ?? null;
  return start <= refundDate && (!end || end >= refundDate);
};

const parseCandidateMachineIds = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    return value
      .replace(/[{}]/g, '')
      .split(',')
      .map((candidate) => candidate.trim())
      .filter(Boolean);
  }
  return [];
};

const reviewMatchStatus = (row) => row.match_status ?? row.matchStatus ?? '';
const reviewResolutionStatus = (row) => row.resolution_status ?? row.resolutionStatus ?? '';

const warningReviewStatuses = new Set([
  'needs_review',
  'matched',
  'ambiguous',
  'unmatched',
  'invalid',
  'duplicate',
]);

export const refundReviewRowAppliesToPartnerScope = ({
  row,
  partnershipId,
  dateFrom,
  dateTo,
  assignments,
  uniqueLabelMap,
}) => {
  const refundDate = normalizeDate(row.refund_date ?? row.refundDate);
  if (!refundDate || refundDate < dateFrom || refundDate > dateTo) return false;
  if (reviewResolutionStatus(row) !== 'unresolved') return false;
  if (!warningReviewStatuses.has(reviewMatchStatus(row))) return false;

  const isAssignedForRefundDate = (machineId) =>
    assignments.some((assignment) =>
      isAssignmentActiveForRefundDate({ assignment, partnershipId, machineId, refundDate })
    );

  const matchedMachineId = row.matched_machine_id ?? row.matchedMachineId ?? null;
  if (matchedMachineId && isAssignedForRefundDate(matchedMachineId)) return true;

  const candidateMachineIds = parseCandidateMachineIds(
    row.candidate_machine_ids ?? row.candidateMachineIds
  );
  if (candidateMachineIds.length === 1 && isAssignedForRefundDate(candidateMachineIds[0])) {
    return true;
  }

  const normalizedLocation =
    row.normalized_source_location ??
    row.normalizedSourceLocation ??
    normalizeMatchText(row.source_location ?? row.sourceLocation);
  const uniqueLabelMachineId = uniqueLabelMap.get(normalizedLocation);
  return Boolean(uniqueLabelMachineId && isAssignedForRefundDate(uniqueLabelMachineId));
};

export const countPartnerScopedRefundReviewRows = ({
  rows,
  partnershipId,
  dateFrom,
  dateTo,
  assignments,
  machines,
  aliases,
}) => {
  const uniqueLabelMap = buildGlobalUniqueRefundScopeLabelMap({ machines, aliases });
  return rows.filter((row) =>
    refundReviewRowAppliesToPartnerScope({
      row,
      partnershipId,
      dateFrom,
      dateTo,
      assignments,
      uniqueLabelMap,
    })
  ).length;
};

export const matchRefundToMachine = (input, machineProfiles) => {
  const hasCanonicalMachineId = Boolean(input.hasSourceReportingMachineId);

  if (!input.refundDate || input.amountCents <= 0 || (!input.normalizedLocation && !hasCanonicalMachineId)) {
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

  if (!AUTO_APPLY_DECISIONS.has(input.normalizedSourceDecision)) {
    return {
      matchStatus: 'needs_review',
      matchConfidence: 0,
      matchReason: input.normalizedSourceDecision
        ? 'source_decision_requires_review'
        : 'missing_source_decision',
      candidateMachineIds: [],
      matchedMachine: null,
    };
  }

  if (hasCanonicalMachineId) {
    if (!input.sourceReportingMachineId) {
      return {
        matchStatus: 'needs_review',
        matchConfidence: 0,
        matchReason: 'invalid_canonical_reporting_machine_id',
        candidateMachineIds: [],
        matchedMachine: null,
      };
    }

    const matchedMachine =
      machineProfiles.find((machine) => machine.id === input.sourceReportingMachineId) ?? null;

    if (!matchedMachine) {
      return {
        matchStatus: 'needs_review',
        matchConfidence: 0,
        matchReason: 'canonical_reporting_machine_id_not_found',
        candidateMachineIds: [],
        matchedMachine: null,
      };
    }

    return {
      matchStatus: 'matched',
      matchConfidence: 1,
      matchReason: 'canonical_reporting_machine_id_match',
      candidateMachineIds: [matchedMachine.id],
      matchedMachine,
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
