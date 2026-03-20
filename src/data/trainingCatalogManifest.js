const MODULE_TAG_PATTERN = /^module\s+\d+$/i;
const TASK_PREFIX = 'Task: ';
const FORMAT_PREFIX = 'Format: ';
const AUDIENCE_PREFIX = 'Audience: ';

export const trainingCatalogTrackDefinitions = [
  {
    id: 'start-here',
    label: 'Start Here',
    description: 'The shortest path for a new operator to get oriented and ready.',
    order: 1,
  },
  {
    id: 'daily-operation',
    label: 'Daily Operation',
    description: 'Opening, closing, consumables, and routine machine operation.',
    order: 2,
  },
  {
    id: 'cleaning-maintenance',
    label: 'Cleaning & Maintenance',
    description: 'Daily cleaning, preventative care, and recurring upkeep.',
    order: 3,
  },
  {
    id: 'software-payments',
    label: 'Software & Payments',
    description: 'Admin access, pricing, payment settings, and machine configuration.',
    order: 4,
  },
  {
    id: 'troubleshooting-repair',
    label: 'Troubleshooting & Repair',
    description: 'Symptoms, diagnostics, and recovery paths for operator issues.',
    order: 5,
  },
  {
    id: 'build-assembly',
    label: 'Build / Assembly',
    description: 'Assembly, installs, removals, and hardware replacement walkthroughs.',
    order: 6,
  },
  {
    id: 'reference',
    label: 'Reference',
    description: 'Long-form manuals and reference material for deeper lookup.',
    order: 7,
  },
];

export const trainingCatalogManifest = [
  {
    match: { id: 'software-setup-quickstart' },
    trackId: 'start-here',
    featuredOrder: 1,
    isStartHere: true,
    operatorPriority: 10,
    fallbackId: 'software-setup-quickstart',
  },
  {
    match: { id: 'pricing-passwords-payment-settings' },
    trackId: 'software-payments',
    featuredOrder: 2,
    isStartHere: true,
    operatorPriority: 10,
    fallbackId: 'pricing-passwords-payment-settings',
  },
  {
    match: { id: 'alarm-and-power-timer-setup' },
    trackId: 'daily-operation',
    featuredOrder: 3,
    operatorPriority: 15,
    fallbackId: 'alarm-and-power-timer-setup',
  },
  {
    match: { id: 'module-map-and-reference-manual' },
    trackId: 'reference',
    featuredOrder: 4,
    isStartHere: true,
    operatorPriority: 10,
    fallbackId: 'module-map-and-reference-manual',
  },
  {
    match: { id: 'cleaning-and-hygiene-checklist' },
    trackId: 'cleaning-maintenance',
    featuredOrder: 5,
    operatorPriority: 10,
    fallbackId: 'cleaning-and-hygiene-checklist',
  },
  {
    match: { id: 'module-function-check-guide' },
    trackId: 'troubleshooting-repair',
    featuredOrder: 6,
    operatorPriority: 10,
    fallbackId: 'module-function-check-guide',
  },
  {
    match: { id: 'consumables-loading-and-stick-handling' },
    trackId: 'daily-operation',
    featuredOrder: 7,
    operatorPriority: 20,
    fallbackId: 'consumables-loading-and-stick-handling',
  },
  {
    match: { id: 'start-up-shutdown-procedure' },
    trackId: 'daily-operation',
    featuredOrder: 8,
    isStartHere: true,
    operatorPriority: 5,
    fallbackId: 'start-up-shutdown-procedure',
  },
  {
    match: { id: 'sugar-loading-best-practices' },
    trackId: 'daily-operation',
    operatorPriority: 25,
    fallbackId: 'sugar-loading-best-practices',
  },
  {
    match: { id: 'troubleshooting-common-issues' },
    trackId: 'troubleshooting-repair',
    featuredOrder: 9,
    operatorPriority: 15,
    fallbackId: 'troubleshooting-common-issues',
  },
  {
    match: { id: 'daily-maintenance-routine' },
    trackId: 'cleaning-maintenance',
    featuredOrder: 10,
    operatorPriority: 5,
    fallbackId: 'daily-maintenance-routine',
  },
  {
    match: { id: 'configure-coin-acceptor' },
    trackId: 'software-payments',
    operatorPriority: 20,
    fallbackId: 'configure-coin-acceptor',
  },
  {
    match: { providerVideoId: '1167976486' },
    trackId: 'software-payments',
    featuredOrder: 11,
    isStartHere: true,
    operatorPriority: 12,
  },
  {
    match: { providerVideoId: '1167976439' },
    trackId: 'daily-operation',
    featuredOrder: 12,
    isStartHere: true,
    operatorPriority: 6,
    fallbackId: 'start-up-shutdown-procedure',
  },
  {
    match: { providerVideoId: '1167976252' },
    trackId: 'software-payments',
    operatorPriority: 18,
    fallbackId: 'configure-coin-acceptor',
  },
  {
    match: { providerVideoId: '1167976115' },
    trackId: 'software-payments',
    operatorPriority: 40,
  },
  {
    match: { providerVideoId: '1167976086' },
    trackId: 'cleaning-maintenance',
    featuredOrder: 13,
    operatorPriority: 6,
    fallbackId: 'daily-maintenance-routine',
  },
  {
    match: { providerVideoId: '1167975956' },
    trackId: 'software-payments',
    operatorPriority: 35,
  },
  {
    match: { providerVideoId: '1167975905' },
    trackId: 'troubleshooting-repair',
    operatorPriority: 25,
  },
  {
    match: { providerVideoId: '1167975854' },
    trackId: 'troubleshooting-repair',
    operatorPriority: 26,
  },
  {
    match: { providerVideoId: '1167975824' },
    trackId: 'cleaning-maintenance',
    operatorPriority: 22,
  },
  {
    match: { providerVideoId: '1167975716' },
    trackId: 'software-payments',
    operatorPriority: 30,
  },
  {
    match: { providerVideoId: '1167975670' },
    trackId: 'build-assembly',
    operatorPriority: 24,
  },
  {
    match: { providerVideoId: '1167975492' },
    trackId: 'build-assembly',
    featuredOrder: 14,
    operatorPriority: 5,
  },
  {
    match: { providerVideoId: '1167975481' },
    trackId: 'troubleshooting-repair',
    operatorPriority: 28,
  },
  {
    match: { providerVideoId: '1167975465' },
    trackId: 'cleaning-maintenance',
    operatorPriority: 24,
  },
  {
    match: { providerVideoId: '1167975334' },
    trackId: 'cleaning-maintenance',
    operatorPriority: 25,
  },
  {
    match: { providerVideoId: '1167975282' },
    trackId: 'build-assembly',
    operatorPriority: 26,
  },
  {
    match: { providerVideoId: '1167975174' },
    trackId: 'troubleshooting-repair',
    operatorPriority: 29,
  },
];

const keywordGroups = {
  'build-assembly': [
    'assembly',
    'reassembly',
    'disassembly',
    'install',
    'remove',
    'replace',
    'reinstall',
    'module',
    'validator',
    'cash dispenser',
    'remote module',
    'wire rope',
    'door assembly',
    'motor',
    'plc',
    'driver',
    'touchscreen',
    'power supply',
  ],
  'troubleshooting-repair': [
    'troubleshoot',
    'troubleshooting',
    'diagnostic',
    'diagnostics',
    'alarm',
    'sensor',
    'multimeter',
    'error',
    'not rotating',
    'not heating',
    'open circuit',
    'server communication',
    'network check',
    'air pressure',
    'ground',
    'earth',
  ],
  'cleaning-maintenance': [
    'clean',
    'cleaning',
    'maintenance',
    'hygiene',
    'brush',
    'filter',
    'coolant',
    'burner',
    'daily maintenance',
    'ceramic filter',
    'humidification',
    'dehumidification',
    'circulation fan',
    'cooling fan',
  ],
  'software-payments': [
    'software',
    'payment',
    'payments',
    'pricing',
    'password',
    'nayax',
    'coin',
    'bill validator',
    'admin',
    'wifi',
    'wi-fi',
    'time zone',
    'timer',
    'promo video',
    'advertising',
    'remote module',
  ],
  'daily-operation': [
    'daily operation',
    'startup',
    'start-up',
    'shutdown',
    'power cycle',
    'sugar',
    'sticks',
    'consumables',
    'operator checklist',
    'opening',
    'closing',
    'safe power',
  ],
  reference: ['reference', 'manual', 'guide', 'checklist', 'job aid'],
};

function normalizeValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeTag(tag) {
  return typeof tag === 'string' ? tag.trim() : '';
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

export function extractModuleTagFromTags(tags = []) {
  const moduleTag = tags.find((tag) => MODULE_TAG_PATTERN.test(normalizeTag(tag)));
  return moduleTag ? moduleTag.trim().replace(/\s+/g, ' ') : undefined;
}

export function stripInternalTrainingTags(tags = []) {
  return tags.filter((tag) => {
    const normalizedTag = normalizeTag(tag);
    return (
      normalizedTag.length > 0 &&
      !MODULE_TAG_PATTERN.test(normalizedTag) &&
      !normalizedTag.startsWith(TASK_PREFIX) &&
      !normalizedTag.startsWith(FORMAT_PREFIX) &&
      !normalizedTag.startsWith(AUDIENCE_PREFIX)
    );
  });
}

export function getTrainingTrackDefinitions() {
  return trainingCatalogTrackDefinitions.map((track) => ({ ...track }));
}

export function getTrainingTrackDefinition(trackId) {
  return trainingCatalogTrackDefinitions.find((track) => track.id === trackId);
}

function findManifestEntry({ id, providerVideoId, title }) {
  const normalizedId = normalizeValue(id);
  const normalizedProviderVideoId = normalizeValue(providerVideoId);
  const normalizedTitle = normalizeValue(title);

  return trainingCatalogManifest.find((entry) => {
    if (entry.match.id && normalizeValue(entry.match.id) === normalizedId) {
      return true;
    }

    if (
      entry.match.providerVideoId &&
      normalizeValue(entry.match.providerVideoId) === normalizedProviderVideoId
    ) {
      return true;
    }

    if (entry.match.title && normalizeValue(entry.match.title) === normalizedTitle) {
      return true;
    }

    return false;
  });
}

function getDerivedTrackId({ title, tags, format, hasDocument }) {
  const searchableText = uniqueValues([title, ...tags]).join(' ').toLowerCase();

  if (hasDocument || format === 'reference') {
    return 'reference';
  }

  if (
    searchableText.includes('start here') ||
    searchableText.includes('quickstart') ||
    searchableText.includes('quick start')
  ) {
    return 'start-here';
  }

  const orderedTrackIds = [
    'build-assembly',
    'troubleshooting-repair',
    'cleaning-maintenance',
    'software-payments',
    'daily-operation',
    'reference',
  ];

  for (const trackId of orderedTrackIds) {
    const keywords = keywordGroups[trackId] ?? [];
    if (keywords.some((keyword) => searchableText.includes(keyword))) {
      return trackId;
    }
  }

  if (format === 'guide' || format === 'checklist') {
    return 'reference';
  }

  return 'troubleshooting-repair';
}

function getDerivedOperatorPriority({ trackId, title }) {
  const normalizedTitle = normalizeValue(title);

  if (trackId === 'daily-operation' && normalizedTitle.includes('start-up')) {
    return 5;
  }

  if (trackId === 'cleaning-maintenance' && normalizedTitle.includes('daily')) {
    return 5;
  }

  if (trackId === 'software-payments' && normalizedTitle.includes('setup')) {
    return 10;
  }

  if (trackId === 'build-assembly' && normalizedTitle.includes('assembly')) {
    return 10;
  }

  if (trackId === 'troubleshooting-repair' && normalizedTitle.includes('diagnostics')) {
    return 15;
  }

  return 50;
}

export function resolveTrainingCatalogMetadata({
  id,
  title,
  tags = [],
  format = 'video',
  providerVideoId,
  hasDocument = false,
} = {}) {
  const manifestEntry = findManifestEntry({ id, providerVideoId, title });
  const resolvedModule = manifestEntry?.module ?? extractModuleTagFromTags(tags);
  const resolvedTrackId =
    manifestEntry?.trackId ??
    getDerivedTrackId({
      title,
      tags,
      format,
      hasDocument,
    });
  const trackDefinition = getTrainingTrackDefinition(resolvedTrackId) ?? trainingCatalogTrackDefinitions[0];

  return {
    trackId: resolvedTrackId,
    trackLabel: trackDefinition.label,
    moduleLabel: resolvedModule,
    featuredOrder: manifestEntry?.featuredOrder,
    isStartHere: Boolean(manifestEntry?.isStartHere),
    operatorPriority:
      manifestEntry?.operatorPriority ??
      getDerivedOperatorPriority({ trackId: resolvedTrackId, title }),
    source: manifestEntry ? 'manifest' : 'derived',
    fallbackId: manifestEntry?.fallbackId,
  };
}
