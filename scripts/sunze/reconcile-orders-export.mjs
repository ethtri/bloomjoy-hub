const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const parseInteger = (value) => {
  const match = String(value ?? '').match(/([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,6})/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const parseRevenueCandidateCents = (value) => {
  const text = normalizeText(value);
  const patterns = [
    /(?:\$|USD)\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{1,2})?|[0-9]+(?:\.\d{1,2})?)/gi,
    /\b([0-9]{1,3}(?:,[0-9]{3})+\.\d{1,2}|[0-9]+\.\d{1,2})\b/g,
  ];
  const values = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(amount)) values.push(Math.round(amount * 100));
    }
  }

  return values;
};

export const extractRevenueCandidatesCents = (lines) => {
  const candidates = new Set();

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^Revenue\b/i.test(lines[index])) continue;

    for (let offset = 0; offset <= 24; offset += 1) {
      for (const parsed of parseRevenueCandidateCents(lines[index + offset] ?? '')) {
        candidates.add(parsed);
      }
    }
  }

  return [...candidates].sort((left, right) => left - right);
};

const recordPatterns = [
  /\bshowing\s+[0-9,]+\s*(?:-|\u2013)\s*[0-9,]+\s+of\s+([0-9,]+)\b/i,
  /\btotal\s*([0-9,]+)\s*(?:items?|records?|orders?)\b/i,
  /\b([0-9,]+)\s*(?:items?|records?|orders?)\b/i,
];

const extractRecordCountCandidates = (texts) => {
  const sources = (Array.isArray(texts) ? texts : String(texts ?? '').split(/\r?\n/))
    .map(normalizeText)
    .filter(Boolean);
  const candidates = [];

  for (let index = 0; index < sources.length - 2; index += 1) {
    if (/^total$/i.test(sources[index]) && /^[0-9,]+$/.test(sources[index + 1])) {
      const unit = sources[index + 2];
      if (/^(?:items?|records?|orders?)$/i.test(unit)) {
        const parsed = parseInteger(sources[index + 1]);
        if (parsed !== null) candidates.push({ count: parsed, sourceText: sources.slice(index, index + 3).join(' ') });
      }
    }
  }

  for (const source of sources) {
    if (/\d+\.\d+/.test(source)) continue;

    for (const pattern of recordPatterns) {
      const match = source.match(pattern);
      if (!match) continue;

      const parsed = parseInteger(match[1]);
      if (parsed !== null) candidates.push({ count: parsed, sourceText: source });
    }
  }

  return candidates;
};

const summarizeCountCandidates = (candidates) => {
  if (candidates.length === 0) return null;
  const maxCount = Math.max(...candidates.map((candidate) => candidate.count));
  const source = candidates.find((candidate) => candidate.count === maxCount)?.sourceText ?? null;
  return {
    count: maxCount,
    source,
    candidates: [...new Set(candidates.map((candidate) => candidate.count))].sort((left, right) => left - right),
  };
};

export const extractUiRecordCount = ({ trustedTexts = [], fallbackTexts = [] } = {}) => {
  const trusted = summarizeCountCandidates(extractRecordCountCandidates(trustedTexts));
  if (trusted) {
    return {
      uiRecordCount: trusted.count,
      uiRecordCountTrusted: true,
      uiRecordCountSource: 'trusted_orders_pagination',
      uiRecordCountReason: 'Read from orders pagination total.',
      uiRecordCountCandidates: trusted.candidates,
      uiRecordCountSourceText: trusted.source,
    };
  }

  const weak = summarizeCountCandidates(extractRecordCountCandidates(fallbackTexts));
  return {
    uiRecordCount: weak?.count ?? null,
    uiRecordCountTrusted: false,
    uiRecordCountSource: weak ? 'weak_page_text' : 'missing',
    uiRecordCountReason: weak
      ? 'Only generic page text exposed a record-like count; revenue and date-window checks remain authoritative.'
      : 'No orders pagination count was visible; revenue and date-window checks remain authoritative.',
    uiRecordCountCandidates: weak?.candidates ?? [],
    uiRecordCountSourceText: weak?.source ?? null,
  };
};

const revenueMatches = (summary, uiSummary) =>
  summary.orderAmountCents === uiSummary.uiRevenueCents ||
  uiSummary.uiRevenueCandidatesCents?.includes(summary.orderAmountCents);

const rowCountMatches = (summary, uiSummary) =>
  Number.isSafeInteger(uiSummary.uiRecordCount) && summary.rowCount === uiSummary.uiRecordCount;

const windowMatches = (summary, uiSummary) =>
  (!summary.windowStart ||
    (summary.windowStart >= uiSummary.uiWindowStart && summary.windowStart <= uiSummary.uiWindowEnd)) &&
  (!summary.windowEnd ||
    (summary.windowEnd >= uiSummary.uiWindowStart && summary.windowEnd <= uiSummary.uiWindowEnd));

const describeUiSummary = (uiSummary, index) =>
  `snapshot ${index + 1}: ${uiSummary.uiRecordCount ?? 'unknown'} rows/${
    uiSummary.uiRevenueCents
  } cents/${uiSummary.uiWindowStart} to ${uiSummary.uiWindowEnd}; revenue candidates ${
    uiSummary.uiRevenueCandidatesCents?.join(',') || 'none'
  }; revenue trusted ${uiSummary.uiRevenueTrusted === true ? 'yes' : 'no'} (${
    uiSummary.uiRevenueSource ?? 'unknown'
  }); row count trusted ${uiSummary.uiRecordCountTrusted === true ? 'yes' : 'no'} (${
    uiSummary.uiRecordCountSource ?? 'unknown'
  })`;

const buildMatch = (summary, uiSummary, { revenueMatched, mode }) => ({
  ...uiSummary,
  uiRevenueMatched: revenueMatched,
  uiRecordCountMatched: rowCountMatches(summary, uiSummary),
  uiReconciliationMode: mode,
});

export const assertExportMatchesUi = (summary, uiSummaries) => {
  const windowSummaries = uiSummaries.filter((uiSummary) => windowMatches(summary, uiSummary));

  const trustedRevenueMismatch = windowSummaries.find(
    (uiSummary) => uiSummary.uiRevenueTrusted === true && !revenueMatches(summary, uiSummary)
  );
  if (trustedRevenueMismatch) {
    throw new Error(
      `Provider export mismatch: workbook parsed ${summary.rowCount} rows/${summary.orderAmountCents} cents/${summary.windowStart} to ${summary.windowEnd}; trusted UI revenue ${trustedRevenueMismatch.uiRevenueCents} did not match.`
    );
  }

  const trustedRowCountMismatch = windowSummaries.find(
    (uiSummary) =>
      uiSummary.uiRecordCountTrusted === true &&
      Number.isSafeInteger(uiSummary.uiRecordCount) &&
      !rowCountMatches(summary, uiSummary)
  );
  if (trustedRowCountMismatch) {
    throw new Error(
      `Provider export mismatch: workbook parsed ${summary.rowCount} rows/${summary.orderAmountCents} cents/${summary.windowStart} to ${summary.windowEnd}; trusted UI row count ${trustedRowCountMismatch.uiRecordCount} did not match.`
    );
  }

  const revenueMatchSummaries = windowSummaries.filter((uiSummary) =>
    revenueMatches(summary, uiSummary)
  );

  const trustedRevenueAndRowMatch = revenueMatchSummaries.find(
    (uiSummary) => uiSummary.uiRevenueTrusted === true && rowCountMatches(summary, uiSummary)
  );
  if (trustedRevenueAndRowMatch) {
    return buildMatch(summary, trustedRevenueAndRowMatch, {
      revenueMatched: true,
      mode: 'trusted_revenue_and_row_count',
    });
  }

  const trustedRevenueMatch = revenueMatchSummaries.find(
    (uiSummary) => uiSummary.uiRevenueTrusted === true
  );
  if (trustedRevenueMatch) {
    return buildMatch(summary, trustedRevenueMatch, {
      revenueMatched: true,
      mode: 'trusted_revenue',
    });
  }

  const weakRevenueAndRowMatch = revenueMatchSummaries.find((uiSummary) =>
    rowCountMatches(summary, uiSummary)
  );
  if (weakRevenueAndRowMatch) {
    return buildMatch(summary, weakRevenueAndRowMatch, {
      revenueMatched: true,
      mode: 'weak_revenue_and_row_count',
    });
  }

  const weakRevenueMatch = revenueMatchSummaries.find(
    (uiSummary) => uiSummary.uiRevenueTrusted !== true
  );
  if (weakRevenueMatch) {
    return buildMatch(summary, weakRevenueMatch, {
      revenueMatched: true,
      mode: 'weak_revenue',
    });
  }

  const trustedRowCountMatch = windowSummaries.find(
    (uiSummary) => uiSummary.uiRecordCountTrusted === true && rowCountMatches(summary, uiSummary)
  );
  if (trustedRowCountMatch) {
    return buildMatch(summary, trustedRowCountMatch, {
      revenueMatched: false,
      mode: 'trusted_row_count',
    });
  }

  const weakRowCountMatch = windowSummaries.find((uiSummary) =>
    rowCountMatches(summary, uiSummary)
  );
  if (weakRowCountMatch) {
    return buildMatch(summary, weakRowCountMatch, {
      revenueMatched: false,
      mode: 'weak_row_count',
    });
  }

  const uiDiagnostic = uiSummaries.map(describeUiSummary).join('; ');
  throw new Error(
    `Provider export mismatch: workbook parsed ${summary.rowCount} rows/${summary.orderAmountCents} cents/${summary.windowStart} to ${summary.windowEnd}; UI ${uiDiagnostic}.`
  );
};
