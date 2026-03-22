import type {
  TrainingContent,
  TrainingDocument,
  TrainingThumbnailMetadata,
  TrainingThumbnailSourceKind,
} from '@/lib/trainingTypes';

type TrainingThumbnailLookupFields = Pick<
  TrainingContent,
  | 'id'
  | 'fallbackContentId'
  | 'document'
  | 'providerVideoId'
  | 'thumbnailAlt'
  | 'thumbnailSourceKind'
  | 'thumbnailUrl'
>;

const PLACEHOLDER_THUMBNAIL_URL = '/placeholder.svg';

const trainingCardThumbnailManifest: Record<string, TrainingThumbnailMetadata> = {
  'software-setup-quickstart': {
    cardThumbnailUrl: '/training-guides/software-admin-access.jpg',
    cardThumbnailAlt:
      'Software setup manual page showing the hidden admin-access gesture and Android menu reveal.',
    sourceKind: 'manual-crop',
  },
  'pricing-passwords-payment-settings': {
    cardThumbnailUrl: '/training-guides/software-payment-settings.jpg',
    cardThumbnailAlt:
      'Software setup manual page showing payment, password, and contact-setting screens.',
    sourceKind: 'manual-crop',
  },
  'alarm-and-power-timer-setup': {
    cardThumbnailUrl: '/training-guides/power-timer-setting.jpg',
    cardThumbnailAlt:
      'Software setup guide page showing the approved power-timer schedule screen.',
    sourceKind: 'manual-crop',
  },
  'timer-control-reference': {
    cardThumbnailUrl: '/training-guides/timer-control-reference.jpg',
    cardThumbnailAlt:
      'Annotated timer controller reference showing the labeled buttons used during schedule setup.',
    sourceKind: 'manual-crop',
  },
  'module-map-and-reference-manual': {
    cardThumbnailUrl: '/training-guides/module-function-debug-page.jpg',
    cardThumbnailAlt:
      'Maintenance guide page showing the machine debugging screen used for structured module checks.',
    sourceKind: 'manual-crop',
  },
  'safe-power-off-and-cooldown': {
    cardThumbnailUrl: '/training-guides/shutdown-cooldown-reference.jpg',
    cardThumbnailAlt:
      'Maintenance guide page showing the shutdown state and 60 C cooldown rule before unplugging.',
    sourceKind: 'manual-crop',
  },
  'cleaning-and-hygiene-checklist': {
    cardThumbnailUrl: '/training-guides/daily-cleaning-burner-base.jpg',
    cardThumbnailAlt:
      'Maintenance guide page showing the burner-base cleaning area and sink placement reference.',
    sourceKind: 'manual-crop',
  },
  'daily-cleaning-hotspots': {
    cardThumbnailUrl: '/training-guides/daily-cleaning-output-sensor.jpg',
    cardThumbnailAlt:
      'Maintenance guide page highlighting the output path and sugar-pickup sensor cleanup hotspots.',
    sourceKind: 'manual-crop',
  },
  'module-function-check-guide': {
    cardThumbnailUrl: '/training-guides/module-function-debug-page.jpg',
    cardThumbnailAlt:
      'Maintenance guide page showing the debug-page controls used for guided function checks.',
    sourceKind: 'manual-crop',
  },
  'consumables-loading-and-stick-handling': {
    cardThumbnailUrl: '/training-guides/consumables-sugar-fill-line.jpg',
    cardThumbnailAlt:
      'Maintenance guide image showing the sugar bin maximum fill line operators should not exceed.',
    sourceKind: 'manual-crop',
  },
  'consumables-loading-reference': {
    cardThumbnailUrl: '/training-guides/consumables-pipe-checks.jpg',
    cardThumbnailAlt:
      'Maintenance guide page showing consumables pipe routing and the connection point that commonly loosens.',
    sourceKind: 'manual-crop',
  },
};

const getTrainingThumbnailLookupKeys = (content: Pick<TrainingContent, 'id' | 'fallbackContentId'>) =>
  [...new Set([content.id, content.fallbackContentId].filter((value): value is string => Boolean(value)))];

const resolveDocumentThumbnail = (
  document?: TrainingDocument
): TrainingThumbnailMetadata | undefined => {
  const firstVisual = document?.sections.find((section) => section.visual)?.visual;
  if (!firstVisual) {
    return undefined;
  }

  return {
    cardThumbnailUrl: firstVisual.src,
    cardThumbnailAlt: firstVisual.alt,
    sourceKind: 'manual-crop',
  };
};

const resolveExistingThumbnailSourceKind = (
  content: Pick<TrainingContent, 'providerVideoId' | 'thumbnailSourceKind'>
): TrainingThumbnailSourceKind | undefined => {
  if (content.thumbnailSourceKind) {
    return content.thumbnailSourceKind;
  }

  if (content.providerVideoId) {
    return 'vimeo';
  }

  return undefined;
};

export const resolveTrainingCardThumbnailMetadata = (
  content: TrainingThumbnailLookupFields
): TrainingThumbnailMetadata | undefined => {
  for (const key of getTrainingThumbnailLookupKeys(content)) {
    const manifestEntry = trainingCardThumbnailManifest[key];
    if (manifestEntry) {
      return manifestEntry;
    }
  }

  if (content.thumbnailUrl && content.thumbnailUrl !== PLACEHOLDER_THUMBNAIL_URL) {
    return {
      cardThumbnailUrl: content.thumbnailUrl,
      cardThumbnailAlt: content.thumbnailAlt,
      sourceKind: resolveExistingThumbnailSourceKind(content) ?? 'licensed-photo',
    };
  }

  return resolveDocumentThumbnail(content.document);
};

export const applyTrainingCardThumbnailMetadata = <T extends TrainingThumbnailLookupFields>(
  content: T
): T => {
  const metadata = resolveTrainingCardThumbnailMetadata(content);

  if (!metadata) {
    return content;
  }

  return {
    ...content,
    thumbnailUrl: metadata.cardThumbnailUrl,
    thumbnailAlt: metadata.cardThumbnailAlt ?? content.thumbnailAlt,
    thumbnailSourceKind: metadata.sourceKind,
  };
};
