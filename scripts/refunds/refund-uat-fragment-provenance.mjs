import { createHmac, timingSafeEqual } from 'node:crypto';

export const RUN_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export const EVIDENCE_PRODUCERS_BY_FILENAME = Object.freeze({
  'refund-portal-assertions.json': 'refund-portal-uat',
  'refund-database-counts.json': 'refund-database-validation',
  'refund-gmail-mime-roles.json': 'refund-gmail-mime-evidence',
  'refund-gmail-kill-fragment.json': 'refund-gmail-kill-evidence',
  'refund-manager-aging-kill-fragment.json': 'refund-manager-aging-evidence',
  'refund-provider-outcomes.json': 'refund-provider-uat',
});

const ENVELOPE_KEYS = [
  'schemaVersion',
  'producer',
  'generatedAt',
  'evidence',
  'hmacSha256',
];

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (value, expectedKeys, label) => {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
};

export function requireEvidenceRunToken(runToken) {
  if (typeof runToken !== 'string' || !RUN_TOKEN_PATTERN.test(runToken)) {
    throw new Error('Evidence run token must be exactly 32 random bytes encoded as lowercase hex.');
  }
  return runToken;
}

const buildHmacPreimage = ({ schemaVersion, filename, producer, generatedAt, evidence }) =>
  JSON.stringify({ schemaVersion, filename, producer, generatedAt, evidence });

const deriveProducerKey = ({ filename, producer, runToken }) =>
  createHmac('sha256', requireEvidenceRunToken(runToken))
    .update(`refund-uat-producer-key\0${filename}\0${producer}`)
    .digest('hex');

const calculateHmac = ({ filename, producer, preimage, runToken }) =>
  createHmac('sha256', deriveProducerKey({ filename, producer, runToken }))
    .update(preimage)
    .digest('hex');

const hexToBytes = (value) =>
  Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));

export function createAuthenticatedEvidenceFragment({
  filename,
  evidence,
  runToken,
  generatedAt = new Date().toISOString(),
}) {
  requireEvidenceRunToken(runToken);
  const producer = EVIDENCE_PRODUCERS_BY_FILENAME[filename];
  if (!producer) throw new Error('Evidence filename is not in the reviewed producer registry.');
  if (!isPlainObject(evidence)) throw new Error('Evidence payload must be an object.');
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Evidence generatedAt must be a valid ISO timestamp.');
  }
  const authenticated = { schemaVersion: 1, producer, generatedAt, evidence };
  return {
    ...authenticated,
    hmacSha256: calculateHmac({
      filename,
      producer,
      preimage: buildHmacPreimage({ filename, ...authenticated }),
      runToken,
    }),
  };
}

export function verifyAuthenticatedEvidenceFragment({
  filename,
  fragment,
  runToken,
  freshAfter,
  nowMs = Date.now(),
}) {
  requireEvidenceRunToken(runToken);
  assertExactKeys(fragment, ENVELOPE_KEYS, `${filename} authenticated envelope`);
  if (fragment.schemaVersion !== 1) {
    throw new Error(`${filename} authenticated envelope schemaVersion is invalid.`);
  }
  const expectedProducer = EVIDENCE_PRODUCERS_BY_FILENAME[filename];
  if (!expectedProducer || fragment.producer !== expectedProducer) {
    throw new Error(`${filename} authenticated envelope producer is invalid.`);
  }
  if (!isPlainObject(fragment.evidence)) {
    throw new Error(`${filename} authenticated evidence must be an object.`);
  }
  const generatedAtMs = Date.parse(fragment.generatedAt);
  const freshAfterMs = Date.parse(freshAfter);
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(freshAfterMs)) {
    throw new Error(`${filename} authenticated timestamps are invalid.`);
  }
  if (generatedAtMs < freshAfterMs) {
    throw new Error(`${filename} authenticated evidence predates this evidence run.`);
  }
  if (generatedAtMs > nowMs + 5 * 60 * 1000) {
    throw new Error(`${filename} authenticated evidence timestamp is implausibly in the future.`);
  }
  if (typeof fragment.hmacSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(fragment.hmacSha256)) {
    throw new Error(`${filename} authenticated evidence HMAC is invalid.`);
  }
  const authenticated = {
    schemaVersion: fragment.schemaVersion,
    producer: fragment.producer,
    generatedAt: fragment.generatedAt,
    evidence: fragment.evidence,
  };
  const expectedHmac = calculateHmac({
    filename,
    producer: fragment.producer,
    preimage: buildHmacPreimage({ filename, ...authenticated }),
    runToken,
  });
  if (!timingSafeEqual(hexToBytes(fragment.hmacSha256), hexToBytes(expectedHmac))) {
    throw new Error(`${filename} authenticated evidence HMAC does not match the current run.`);
  }
  return fragment.evidence;
}
