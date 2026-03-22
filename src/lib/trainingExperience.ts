import type {
  TrainingContent,
  TrainingExperience,
  TrainingExperienceItem,
  TrainingExperienceResolution,
  TrainingProgressRecord,
  TrainingResource,
  TrainingTrack,
} from '@/lib/trainingTypes';

type TrainingTaskGroupDefinition = {
  canonicalId: string;
  primaryVideoId?: string;
  writtenGuideId?: string;
  quickAidIds?: string[];
  manualIds?: string[];
  absorbedIds?: string[];
  aliasAnchors?: Record<string, string>;
};

const QUICK_AID_IDS = new Set([
  'timer-control-reference',
  'daily-cleaning-hotspots',
  'consumables-loading-reference',
]);

const MANUAL_IDS = new Set(['module-map-and-reference-manual']);

const TRAINING_TASK_GROUPS: TrainingTaskGroupDefinition[] = [
  {
    canonicalId: 'start-up-shutdown-procedure',
    writtenGuideId: 'safe-power-off-and-cooldown',
    manualIds: ['module-map-and-reference-manual'],
    absorbedIds: ['safe-power-off-and-cooldown'],
    aliasAnchors: {
      'safe-power-off-and-cooldown': 'written-essentials',
    },
  },
  {
    canonicalId: 'daily-maintenance-routine',
    writtenGuideId: 'cleaning-and-hygiene-checklist',
    quickAidIds: ['daily-cleaning-hotspots'],
    manualIds: ['module-map-and-reference-manual'],
    absorbedIds: ['cleaning-and-hygiene-checklist'],
    aliasAnchors: {
      'cleaning-and-hygiene-checklist': 'written-essentials',
    },
  },
  {
    canonicalId: 'troubleshooting-common-issues',
    writtenGuideId: 'module-function-check-guide',
    manualIds: ['module-map-and-reference-manual'],
    absorbedIds: ['module-function-check-guide'],
    aliasAnchors: {
      'module-function-check-guide': 'written-essentials',
    },
  },
  {
    canonicalId: 'consumables-loading-and-stick-handling',
    primaryVideoId: 'sugar-loading-best-practices',
    quickAidIds: ['consumables-loading-reference'],
    manualIds: ['module-map-and-reference-manual'],
    absorbedIds: ['sugar-loading-best-practices'],
    aliasAnchors: {
      'sugar-loading-best-practices': 'walkthrough',
    },
  },
  {
    canonicalId: 'alarm-and-power-timer-setup',
    quickAidIds: ['timer-control-reference'],
  },
];

const ABSORBED_TRAINING_IDS = new Set(
  TRAINING_TASK_GROUPS.flatMap((group) => group.absorbedIds ?? [])
);

const getTrainingLookupKeys = (
  item?: Pick<TrainingContent, 'id' | 'fallbackContentId'>
) =>
  [...new Set([item?.id, item?.fallbackContentId].filter((value): value is string => Boolean(value)))];

const getStableTrainingId = (item: Pick<TrainingContent, 'id' | 'fallbackContentId'>) =>
  item.fallbackContentId ?? item.id;

const buildTrainingLookup = (library: TrainingContent[]) => {
  const lookup = new Map<string, TrainingContent>();

  for (const item of library) {
    for (const key of getTrainingLookupKeys(item)) {
      lookup.set(key, item);
    }
  }

  return lookup;
};

const resolveTrainingItem = (
  lookup: Map<string, TrainingContent>,
  id?: string
) => (id ? lookup.get(id) : undefined);

const resolveTrainingItems = (
  lookup: Map<string, TrainingContent>,
  ids?: string[]
) =>
  (ids ?? [])
    .map((id) => resolveTrainingItem(lookup, id))
    .filter((item): item is TrainingContent => Boolean(item));

const mergeUniqueStrings = (...lists: Array<string[] | undefined>) => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const list of lists) {
    for (const value of list ?? []) {
      const normalizedValue = value.trim();
      if (!normalizedValue) {
        continue;
      }

      const key = normalizedValue.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(normalizedValue);
    }
  }

  return merged;
};

const uniqueResources = (resources: TrainingResource[]) => {
  const seen = new Set<string>();
  const merged: TrainingResource[] = [];

  for (const resource of resources) {
    const linkedKey = resource.linkedTrainingId ? `training:${resource.linkedTrainingId}` : undefined;
    const hrefKey = resource.href ? `href:${resource.href}` : undefined;
    const titleKey = `title:${resource.title.toLowerCase()}`;
    const key = linkedKey ?? hrefKey ?? titleKey;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(resource);
  }

  return merged;
};

const buildCompositeDescription = (
  canonicalItem: TrainingContent,
  writtenGuide?: TrainingContent,
  primaryVideo?: TrainingContent
) => {
  if (!writtenGuide?.document) {
    return canonicalItem.description;
  }

  if (primaryVideo && primaryVideo.id !== canonicalItem.id) {
    return `${canonicalItem.description} Includes the walkthrough video plus written essentials pulled from the ${writtenGuide.document.sourceLabel ?? 'source guide'}.`;
  }

  if (writtenGuide.id !== canonicalItem.id) {
    return `${canonicalItem.description} Includes written essentials pulled from the ${writtenGuide.document.sourceLabel ?? 'source guide'}.`;
  }

  return canonicalItem.description;
};

const buildStandaloneItem = (
  item: TrainingContent,
  surface: TrainingExperienceItem['surface']
): TrainingExperienceItem => ({
  ...item,
  surface,
  canonicalId: item.id,
  legacyAliasIds: [],
  primaryVideo: item.embed.url ? item : undefined,
  writtenGuide: item.document ? item : undefined,
  quickAidIds: [],
  manualIds: [],
  sourceTrainingIds: [item.id],
  taskCategory: surface === 'manual' ? 'Reference' : item.taskCategory,
  catalogTrackId: surface === 'manual' ? 'reference' : item.catalogTrackId,
  isStartHere: surface === 'task' ? item.isStartHere : false,
});

const buildCompositeTaskItem = (
  group: TrainingTaskGroupDefinition,
  trainingLookup: Map<string, TrainingContent>
): TrainingExperienceItem | undefined => {
  const canonicalItem = resolveTrainingItem(trainingLookup, group.canonicalId);
  if (!canonicalItem) {
    return undefined;
  }

  const primaryVideo =
    resolveTrainingItem(trainingLookup, group.primaryVideoId) ??
    (canonicalItem.embed.url ? canonicalItem : undefined);
  const writtenGuide =
    resolveTrainingItem(trainingLookup, group.writtenGuideId) ??
    (canonicalItem.document ? canonicalItem : undefined);
  const quickAidItems = resolveTrainingItems(trainingLookup, group.quickAidIds);
  const manualItems = resolveTrainingItems(trainingLookup, group.manualIds);
  const absorbedItems = resolveTrainingItems(trainingLookup, group.absorbedIds);
  const sourceItems = [
    canonicalItem,
    primaryVideo,
    writtenGuide,
    ...quickAidItems,
    ...manualItems,
  ].filter((item): item is TrainingContent => Boolean(item));
  const searchableItems = [
    canonicalItem,
    primaryVideo,
    writtenGuide,
    ...quickAidItems,
  ].filter((item): item is TrainingContent => Boolean(item));
  const resourceItems = [canonicalItem, primaryVideo, writtenGuide].filter(
    (item): item is TrainingContent => Boolean(item)
  );
  const mergedResources = uniqueResources(resourceItems.flatMap((item) => item.resources));
  const hasPrimaryVideo = Boolean(primaryVideo?.embed.url);
  const hasWrittenGuide = Boolean(writtenGuide?.document);

  return {
    ...canonicalItem,
    description: buildCompositeDescription(canonicalItem, writtenGuide, primaryVideo),
    summary: writtenGuide?.summary ?? canonicalItem.summary,
    learningPoints: mergeUniqueStrings(
      writtenGuide?.learningPoints,
      canonicalItem.learningPoints,
      primaryVideo?.learningPoints
    ),
    checklist: mergeUniqueStrings(
      writtenGuide?.checklist,
      canonicalItem.checklist,
      primaryVideo?.checklist
    ),
    searchTerms: mergeUniqueStrings(...searchableItems.map((item) => item.searchTerms)),
    tags: mergeUniqueStrings(...searchableItems.map((item) => item.tags)),
    duration: primaryVideo?.duration ?? canonicalItem.duration,
    thumbnailUrl: primaryVideo?.thumbnailUrl ?? canonicalItem.thumbnailUrl,
    format: hasPrimaryVideo && hasWrittenGuide ? 'mixed' : canonicalItem.format,
    embed: primaryVideo?.embed ?? canonicalItem.embed,
    document: writtenGuide?.document ?? canonicalItem.document,
    resources: mergedResources,
    surface: 'task',
    canonicalId: canonicalItem.id,
    legacyAliasIds: [...new Set(absorbedItems.map((item) => item.id))],
    primaryVideo,
    writtenGuide,
    quickAidIds: quickAidItems.map((item) => item.id),
    manualIds: manualItems.map((item) => item.id),
    sourceTrainingIds: [...new Set(sourceItems.map((item) => item.id))],
  };
};

const canonicalizeItemResources = (
  item: TrainingExperienceItem,
  routeIdByTrainingId: Map<string, string>
) => {
  const hiddenRouteIds = new Set([
    item.id,
    ...item.quickAidIds,
    ...item.manualIds,
  ]);

  const resources = uniqueResources(
    item.resources
      .map((resource) => {
        const linkedTrainingId = resource.linkedTrainingId
          ? routeIdByTrainingId.get(resource.linkedTrainingId) ?? resource.linkedTrainingId
          : undefined;

        return {
          ...resource,
          linkedTrainingId,
        };
      })
      .filter((resource) => {
        if (!resource.linkedTrainingId) {
          return true;
        }

        return !hiddenRouteIds.has(resource.linkedTrainingId);
      })
  );

  return {
    ...item,
    resources,
  };
};

export const buildTrainingExperience = (library: TrainingContent[]): TrainingExperience => {
  const trainingLookup = buildTrainingLookup(library);
  const items: TrainingExperienceItem[] = [];
  const handledLookupKeys = new Set<string>();
  const routeIdByTrainingId = new Map<string, string>();
  const aliasAnchorByTrainingId = new Map<string, string>();

  for (const item of library) {
    routeIdByTrainingId.set(item.id, item.id);
    if (item.fallbackContentId) {
      routeIdByTrainingId.set(item.fallbackContentId, item.id);
    }
  }

  for (const group of TRAINING_TASK_GROUPS) {
    const experienceItem = buildCompositeTaskItem(group, trainingLookup);
    if (!experienceItem) {
      continue;
    }

    items.push(experienceItem);
    for (const key of getTrainingLookupKeys(experienceItem)) {
      handledLookupKeys.add(key);
      routeIdByTrainingId.set(key, experienceItem.id);
    }
    routeIdByTrainingId.set(group.canonicalId, experienceItem.id);

    for (const absorbedId of group.absorbedIds ?? []) {
      const absorbedItem = resolveTrainingItem(trainingLookup, absorbedId);
      const absorbedKeys = absorbedItem ? getTrainingLookupKeys(absorbedItem) : [absorbedId];

      for (const key of absorbedKeys) {
        handledLookupKeys.add(key);
        routeIdByTrainingId.set(key, experienceItem.id);
      }

      const anchor = group.aliasAnchors?.[absorbedId];
      if (anchor) {
        aliasAnchorByTrainingId.set(absorbedId, anchor);
        for (const key of absorbedItem ? getTrainingLookupKeys(absorbedItem) : []) {
          aliasAnchorByTrainingId.set(key, anchor);
        }
      }
    }
  }

  for (const item of library) {
    if (
      getTrainingLookupKeys(item).some((key) => handledLookupKeys.has(key)) ||
      ABSORBED_TRAINING_IDS.has(getStableTrainingId(item))
    ) {
      continue;
    }

    const stableTrainingId = getStableTrainingId(item);
    const surface: TrainingExperienceItem['surface'] = MANUAL_IDS.has(stableTrainingId)
      ? 'manual'
      : QUICK_AID_IDS.has(stableTrainingId)
        ? 'quick-aid'
        : 'task';

    items.push(buildStandaloneItem(item, surface));
    for (const key of getTrainingLookupKeys(item)) {
      handledLookupKeys.add(key);
    }
  }

  const canonicalizedItems = items.map((item) => canonicalizeItemResources(item, routeIdByTrainingId));
  const byId = new Map(canonicalizedItems.map((item) => [item.id, item]));

  return {
    tasks: canonicalizedItems.filter((item) => item.surface === 'task'),
    quickAids: canonicalizedItems.filter((item) => item.surface === 'quick-aid'),
    manuals: canonicalizedItems.filter((item) => item.surface === 'manual'),
    allItems: canonicalizedItems,
    byId,
    routeIdByTrainingId,
    aliasAnchorByTrainingId,
  };
};

export const bindTracksToTrainingExperience = (
  tracks: TrainingTrack[],
  experience: TrainingExperience
): TrainingTrack[] =>
  tracks.map((track) => {
    const dedupedItems = new Map<
      string,
      TrainingTrack['items'][number]
    >();

    for (const item of track.items) {
      const canonicalTrainingId =
        experience.routeIdByTrainingId.get(item.trainingId) ?? item.trainingId;
      const training = experience.byId.get(canonicalTrainingId);
      if (!training || training.surface !== 'task') {
        continue;
      }

      const existingItem = dedupedItems.get(canonicalTrainingId);
      if (!existingItem) {
        dedupedItems.set(canonicalTrainingId, {
          ...item,
          trainingId: canonicalTrainingId,
          training,
        });
        continue;
      }

      dedupedItems.set(canonicalTrainingId, {
        ...existingItem,
        required: existingItem.required || item.required,
        sortOrder: Math.min(existingItem.sortOrder, item.sortOrder),
        training,
      });
    }

    return {
      ...track,
      items: [...dedupedItems.values()].sort((left, right) => left.sortOrder - right.sortOrder),
    };
  });

export const mapTrainingProgressToCanonical = (
  progress: TrainingProgressRecord[],
  experience: TrainingExperience
) => {
  const aggregated = new Map<string, TrainingProgressRecord>();

  for (const record of progress) {
    const canonicalTrainingId =
      experience.routeIdByTrainingId.get(record.trainingId) ?? record.trainingId;
    const existingRecord = aggregated.get(canonicalTrainingId);

    if (!existingRecord) {
      aggregated.set(canonicalTrainingId, {
        ...record,
        trainingId: canonicalTrainingId,
      });
      continue;
    }

    aggregated.set(canonicalTrainingId, {
      trainingId: canonicalTrainingId,
      startedAt:
        existingRecord.startedAt && record.startedAt
          ? existingRecord.startedAt < record.startedAt
            ? existingRecord.startedAt
            : record.startedAt
          : existingRecord.startedAt ?? record.startedAt,
      completedAt:
        existingRecord.completedAt && record.completedAt
          ? existingRecord.completedAt < record.completedAt
            ? existingRecord.completedAt
            : record.completedAt
          : existingRecord.completedAt ?? record.completedAt,
      completionSource: existingRecord.completionSource ?? record.completionSource,
    });
  }

  return [...aggregated.values()];
};

export const getTrainingProgressWriteIds = (item: TrainingExperienceItem) =>
  item.surface === 'task' ? [...new Set([item.id, ...item.legacyAliasIds])] : [item.id];

export const getTrainingRouteId = (experience: TrainingExperience, trainingId?: string) =>
  trainingId ? experience.routeIdByTrainingId.get(trainingId) ?? trainingId : undefined;

export const resolveTrainingExperienceItem = (
  experience: TrainingExperience,
  library: TrainingContent[],
  routeId?: string
): TrainingExperienceResolution => {
  if (!routeId) {
    return {};
  }

  const directItem =
    experience.byId.get(routeId) ??
    experience.allItems.find((item) => item.fallbackContentId === routeId);
  if (directItem) {
    return { item: directItem };
  }

  const rawItem = library.find((item) => item.id === routeId || item.fallbackContentId === routeId);
  if (!rawItem) {
    return {};
  }

  const canonicalRouteId = experience.routeIdByTrainingId.get(rawItem.id) ?? rawItem.id;
  const item = experience.byId.get(canonicalRouteId);
  if (!item) {
    return {};
  }

  return {
    item,
    redirectToId: canonicalRouteId !== routeId ? canonicalRouteId : undefined,
    redirectAnchor:
      experience.aliasAnchorByTrainingId.get(routeId) ??
      experience.aliasAnchorByTrainingId.get(rawItem.id),
  };
};
