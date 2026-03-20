export interface TrainingDocumentSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
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
  formatBadge?: string;
}

export type TrainingFormat = 'video' | 'guide' | 'checklist' | 'reference' | 'mixed';

export interface TrainingContent {
  id: string;
  title: string;
  description: string;
  thumbnailUrl?: string;
  duration: string;
  tags: string[];
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  summary: string;
  learningPoints: string[];
  checklist: string[];
  searchTerms: string[];
  taskCategory: string;
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
