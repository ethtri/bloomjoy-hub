import type { TrainingContent, TrainingFormat } from '@/lib/trainingTypes';
import {
  extractModuleTagFromTags as extractModuleTagFromTagsInternal,
  getTrainingTrackDefinition as getTrainingTrackDefinitionInternal,
  getTrainingTrackDefinitions as getTrainingTrackDefinitionsInternal,
  resolveTrainingCatalogMetadata as resolveTrainingCatalogMetadataInternal,
  stripInternalTrainingTags as stripInternalTrainingTagsInternal,
} from '@/data/trainingCatalogManifest.js';

export type TrainingCatalogTrackId =
  | 'start-here'
  | 'daily-operation'
  | 'cleaning-maintenance'
  | 'software-payments'
  | 'troubleshooting-repair'
  | 'build-assembly'
  | 'reference';

export type TrainingCatalogSource = 'manifest' | 'derived';

export interface TrainingCatalogTrackDefinition {
  id: TrainingCatalogTrackId;
  label: string;
  description: string;
  order: number;
}

export interface TrainingCatalogMetadata {
  trackId: TrainingCatalogTrackId;
  trackLabel: string;
  moduleLabel?: string;
  featuredOrder?: number;
  isStartHere: boolean;
  operatorPriority: number;
  source: TrainingCatalogSource;
  fallbackId?: string;
}

export const getTrainingTrackDefinitions = (): TrainingCatalogTrackDefinition[] =>
  getTrainingTrackDefinitionsInternal() as TrainingCatalogTrackDefinition[];

export const getTrainingTrackDefinition = (trackId?: string) =>
  getTrainingTrackDefinitionInternal(trackId) as TrainingCatalogTrackDefinition | undefined;

export const extractModuleTagFromTags = (tags: string[] = []) =>
  extractModuleTagFromTagsInternal(tags) as string | undefined;

export const stripInternalTrainingTags = (tags: string[] = []) =>
  stripInternalTrainingTagsInternal(tags) as string[];

export const resolveTrainingCatalogMetadata = ({
  id,
  title,
  tags,
  format,
  providerVideoId,
  hasDocument,
}: {
  id?: string;
  title: string;
  tags?: string[];
  format?: TrainingFormat;
  providerVideoId?: string;
  hasDocument?: boolean;
}) =>
  resolveTrainingCatalogMetadataInternal({
    id,
    title,
    tags,
    format,
    providerVideoId,
    hasDocument,
  }) as TrainingCatalogMetadata;

export const getTrainingDisplayTags = (
  item: Pick<TrainingContent, 'tags' | 'moduleLabel' | 'taskCategory'>,
  maxTags = 3
) => {
  const topicTags = stripInternalTrainingTags(item.tags);
  return topicTags.slice(0, maxTags);
};
