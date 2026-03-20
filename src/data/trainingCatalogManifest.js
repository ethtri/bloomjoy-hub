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

const baseTrainingCatalogManifest = [
  {
    match: { id: 'software-setup-quickstart', title: 'Software Setup Quickstart' },
    module: 'Module 1',
    trackId: 'start-here',
    featuredOrder: 1,
    isStartHere: true,
    operatorPriority: 10,
    fallbackId: 'software-setup-quickstart',
  },
  {
    match: {
      id: 'pricing-passwords-payment-settings',
      title: 'Pricing, Passwords, and Payment Settings',
    },
    module: 'Module 1',
    trackId: 'software-payments',
    featuredOrder: 2,
    isStartHere: true,
    operatorPriority: 10,
    fallbackId: 'pricing-passwords-payment-settings',
  },
  {
    match: { id: 'alarm-and-power-timer-setup', title: 'Alarm and Power Timer Setup' },
    module: 'Module 1',
    trackId: 'daily-operation',
    featuredOrder: 3,
    operatorPriority: 15,
    fallbackId: 'alarm-and-power-timer-setup',
  },
  {
    match: { id: 'timer-control-reference', title: 'Timer Control Reference' },
    module: 'Module 1',
    trackId: 'daily-operation',
    operatorPriority: 16,
    fallbackId: 'timer-control-reference',
  },
  {
    match: {
      id: 'module-map-and-reference-manual',
      title: 'Maintenance Guide Reference Manual',
    },
    module: 'Module 1',
    trackId: 'reference',
    featuredOrder: 4,
    isStartHere: true,
    operatorPriority: 10,
    fallbackId: 'module-map-and-reference-manual',
  },
  {
    match: {
      id: 'safe-power-off-and-cooldown',
      title: 'Safe Power Off and Cooldown',
    },
    module: 'Module 1',
    trackId: 'daily-operation',
    operatorPriority: 8,
    fallbackId: 'safe-power-off-and-cooldown',
  },
  {
    match: {
      id: 'cleaning-and-hygiene-checklist',
      title: 'Cleaning and Hygiene Checklist',
    },
    module: 'Module 1',
    trackId: 'cleaning-maintenance',
    featuredOrder: 5,
    operatorPriority: 10,
    fallbackId: 'cleaning-and-hygiene-checklist',
  },
  {
    match: {
      id: 'daily-cleaning-hotspots',
      title: 'Daily Cleaning Hotspots',
    },
    module: 'Module 1',
    trackId: 'cleaning-maintenance',
    operatorPriority: 9,
    fallbackId: 'daily-cleaning-hotspots',
  },
  {
    match: {
      id: 'module-function-check-guide',
      title: 'Module Function Check Guide',
    },
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    featuredOrder: 6,
    operatorPriority: 10,
    fallbackId: 'module-function-check-guide',
  },
  {
    match: {
      id: 'consumables-loading-and-stick-handling',
      title: 'Consumables Loading and Stick Handling',
    },
    module: 'Module 1',
    trackId: 'daily-operation',
    featuredOrder: 7,
    operatorPriority: 20,
    fallbackId: 'consumables-loading-and-stick-handling',
  },
  {
    match: {
      id: 'consumables-loading-reference',
      title: 'Consumables Loading Reference',
    },
    module: 'Module 1',
    trackId: 'daily-operation',
    operatorPriority: 21,
    fallbackId: 'consumables-loading-reference',
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
];

const mg320VimeoCatalogManifest = [
  {
    providerVideoId: '1167976486',
    module: 'Module 1',
    trackId: 'software-payments',
    featuredOrder: 11,
    isStartHere: true,
    operatorPriority: 12,
  },
  {
    providerVideoId: '1167976439',
    module: 'Module 1',
    trackId: 'daily-operation',
    featuredOrder: 12,
    isStartHere: true,
    operatorPriority: 6,
    fallbackId: 'start-up-shutdown-procedure',
  },
  {
    providerVideoId: '1167976252',
    module: 'Module 1',
    trackId: 'software-payments',
    operatorPriority: 18,
    fallbackId: 'configure-coin-acceptor',
  },
  {
    providerVideoId: '1167976115',
    module: 'Module 1',
    trackId: 'software-payments',
    operatorPriority: 40,
  },
  {
    providerVideoId: '1167976086',
    module: 'Module 1',
    trackId: 'cleaning-maintenance',
    featuredOrder: 13,
    operatorPriority: 6,
    fallbackId: 'daily-maintenance-routine',
  },
  {
    providerVideoId: '1167975956',
    module: 'Module 1',
    trackId: 'software-payments',
    operatorPriority: 35,
  },
  {
    providerVideoId: '1167975905',
    module: 'Module 1',
    trackId: 'troubleshooting-repair',
    operatorPriority: 25,
  },
  {
    providerVideoId: '1167975854',
    module: 'Module 1',
    trackId: 'troubleshooting-repair',
    operatorPriority: 26,
  },
  {
    providerVideoId: '1167975824',
    module: 'Module 1',
    trackId: 'cleaning-maintenance',
    operatorPriority: 22,
  },
  {
    providerVideoId: '1167975716',
    module: 'Module 1',
    trackId: 'software-payments',
    operatorPriority: 30,
  },
  {
    providerVideoId: '1167975670',
    module: 'Module 1',
    trackId: 'build-assembly',
    operatorPriority: 24,
  },
  {
    providerVideoId: '1167975492',
    module: 'Module 1',
    trackId: 'build-assembly',
    featuredOrder: 14,
    operatorPriority: 5,
  },
  {
    providerVideoId: '1167975481',
    module: 'Module 1',
    trackId: 'troubleshooting-repair',
    operatorPriority: 28,
  },
  {
    providerVideoId: '1167975465',
    module: 'Module 1',
    trackId: 'cleaning-maintenance',
    operatorPriority: 24,
  },
  {
    providerVideoId: '1167975334',
    module: 'Module 1',
    trackId: 'cleaning-maintenance',
    operatorPriority: 23,
  },
  {
    providerVideoId: '1167975282',
    module: 'Module 1',
    trackId: 'troubleshooting-repair',
    operatorPriority: 30,
  },
  {
    providerVideoId: '1167975174',
    module: 'Module 1',
    trackId: 'troubleshooting-repair',
    operatorPriority: 29,
  },
  {
    providerVideoId: '1175315498',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 10,
  },
  {
    providerVideoId: '1175315519',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 17,
  },
  {
    providerVideoId: '1175315551',
    module: 'Module 2',
    trackId: 'cleaning-maintenance',
    operatorPriority: 12,
  },
  {
    providerVideoId: '1175315622',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 21,
  },
  {
    providerVideoId: '1175315691',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 22,
  },
  {
    providerVideoId: '1175315929',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 11,
  },
  {
    providerVideoId: '1175316108',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 20,
  },
  {
    providerVideoId: '1175316237',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 12,
  },
  {
    providerVideoId: '1175314752',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 13,
  },
  {
    providerVideoId: '1175314839',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 14,
  },
  {
    providerVideoId: '1175314915',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 15,
  },
  {
    providerVideoId: '1175314980',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 16,
  },
  {
    providerVideoId: '1175315091',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 18,
  },
  {
    providerVideoId: '1175315143',
    module: 'Module 2',
    trackId: 'troubleshooting-repair',
    operatorPriority: 19,
  },
  {
    providerVideoId: '1175315173',
    module: 'Module 2',
    trackId: 'cleaning-maintenance',
    operatorPriority: 8,
  },
  {
    providerVideoId: '1175315261',
    module: 'Module 2',
    trackId: 'cleaning-maintenance',
    operatorPriority: 9,
  },
  {
    providerVideoId: '1175315286',
    module: 'Module 2',
    trackId: 'cleaning-maintenance',
    operatorPriority: 10,
  },
  {
    providerVideoId: '1175315359',
    module: 'Module 2',
    trackId: 'cleaning-maintenance',
    operatorPriority: 11,
  },
  {
    providerVideoId: '1175315442',
    module: 'Module 2',
    trackId: 'cleaning-maintenance',
    operatorPriority: 10,
  },
  {
    providerVideoId: '1175306907',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 15,
  },
  {
    providerVideoId: '1175306920',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 18,
  },
  {
    providerVideoId: '1175306956',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 16,
  },
  {
    providerVideoId: '1175307119',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 17,
  },
  {
    providerVideoId: '1175307300',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 14,
  },
  {
    providerVideoId: '1175303461',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 19,
  },
  {
    providerVideoId: '1175303698',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 22,
  },
  {
    providerVideoId: '1175304102',
    module: 'Module 3',
    trackId: 'cleaning-maintenance',
    operatorPriority: 14,
  },
  {
    providerVideoId: '1175304563',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 23,
  },
  {
    providerVideoId: '1175304720',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 24,
  },
  {
    providerVideoId: '1175305061',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 20,
  },
  {
    providerVideoId: '1175305157',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 21,
  },
  {
    providerVideoId: '1175305273',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 25,
  },
  {
    providerVideoId: '1175305831',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 26,
  },
  {
    providerVideoId: '1175305908',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 27,
  },
  {
    providerVideoId: '1175305961',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 28,
  },
  {
    providerVideoId: '1175306024',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 29,
  },
  {
    providerVideoId: '1175306112',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 30,
  },
  {
    providerVideoId: '1175306158',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 31,
  },
  {
    providerVideoId: '1175306226',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 32,
  },
  {
    providerVideoId: '1175306298',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 33,
  },
  {
    providerVideoId: '1175306341',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 34,
  },
  {
    providerVideoId: '1175306371',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 35,
  },
  {
    providerVideoId: '1175306403',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 36,
  },
  {
    providerVideoId: '1175306469',
    module: 'Module 3',
    trackId: 'build-assembly',
    operatorPriority: 37,
  },
].map(({ providerVideoId, ...entry }) => ({
  match: { providerVideoId },
  ...entry,
}));

export const trainingCatalogManifest = [
  ...baseTrainingCatalogManifest,
  ...mg320VimeoCatalogManifest,
];

const canonicalTrainingVideoIdSet = new Set(
  mg320VimeoCatalogManifest.map((entry) => String(entry.match.providerVideoId).trim())
);

const keywordGroups = {
  'build-assembly': [
    'assembly',
    'reassembly',
    'disassembly',
    'install',
    'remove',
    'replace',
    'reinstall',
    'service access',
    'validator',
    'cash dispenser',
    'remote module',
    'wire rope',
    'door assembly',
    'plc',
    'driver board',
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

export function isCanonicalTrainingVideoId(providerVideoId) {
  return canonicalTrainingVideoIdSet.has(String(providerVideoId ?? '').trim());
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
    'troubleshooting-repair',
    'cleaning-maintenance',
    'software-payments',
    'daily-operation',
    'build-assembly',
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
