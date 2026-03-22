export interface TrainingDocumentSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  visual?: {
    src: string;
    alt: string;
    caption?: string;
  };
}

export interface TrainingDocument {
  title: string;
  intro: string;
  estimatedReadMinutes?: number;
  sourceLabel?: string;
  sections: TrainingDocumentSection[];
}

export type TrainingResourceKind = 'guide' | 'download' | 'link' | 'video' | 'support';

export interface TrainingResource {
  title: string;
  description: string;
  status: 'available' | 'coming_soon';
  kind: TrainingResourceKind;
  actionLabel?: string;
  href?: string;
  external?: boolean;
  linkedTrainingId?: string;
  linkedTrainingAnchor?: string;
  formatBadge?: string;
}

export type TrainingFormat = 'video' | 'guide' | 'checklist' | 'reference' | 'mixed';

export type TrainingThumbnailSourceKind =
  | 'vimeo'
  | 'manual-crop'
  | 'licensed-photo'
  | 'generated-cover';

export interface TrainingThumbnailMetadata {
  cardThumbnailUrl: string;
  cardThumbnailAlt?: string;
  sourceKind: TrainingThumbnailSourceKind;
}

export interface TrainingContent {
  id: string;
  fallbackContentId?: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  thumbnailAlt?: string;
  thumbnailSourceKind?: TrainingThumbnailSourceKind;
  providerVideoId?: string;
  duration: string;
  tags: string[];
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  learningPoints: string[];
  checklist: string[];
  searchTerms: string[];
  taskCategory: string;
  catalogTrackId?: string;
  moduleLabel?: string;
  featuredOrder?: number;
  isStartHere?: boolean;
  operatorPriority?: number;
  catalogSource?: 'manifest' | 'derived';
  audience: string;
  format: TrainingFormat;
  embed: {
    title: string;
    srcDoc: string;
    url?: string;
  };
  document?: TrainingDocument;
  resources: TrainingResource[];
}

export interface TrainingTrack {
  id: string;
  slug: string;
  title: string;
  description: string;
  audience: string;
  certificateTitle?: string;
  items: Array<{
    trainingId: string;
    required: boolean;
    sortOrder: number;
    training?: TrainingContent;
  }>;
}

export interface TrainingProgressRecord {
  trainingId: string;
  startedAt: string | null;
  completedAt: string | null;
  completionSource: string | null;
}

export interface TrainingCertificate {
  id: string;
  trackId: string;
  issuedAt: string;
  certificateTitle: string;
}

export type TrainingExperienceSurface = 'task' | 'quick-aid' | 'manual';

export interface TrainingExperienceItem extends TrainingContent {
  surface: TrainingExperienceSurface;
  canonicalId: string;
  legacyAliasIds: string[];
  primaryVideo?: TrainingContent;
  writtenGuide?: TrainingContent;
  quickAidIds: string[];
  manualIds: string[];
  sourceTrainingIds: string[];
}

export interface TrainingExperience {
  tasks: TrainingExperienceItem[];
  quickAids: TrainingExperienceItem[];
  manuals: TrainingExperienceItem[];
  allItems: TrainingExperienceItem[];
  byId: Map<string, TrainingExperienceItem>;
  routeIdByTrainingId: Map<string, string>;
  aliasAnchorByTrainingId: Map<string, string>;
}

export interface TrainingExperienceResolution {
  item?: TrainingExperienceItem;
  redirectToId?: string;
  redirectAnchor?: string;
}
