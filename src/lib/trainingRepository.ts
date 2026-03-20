import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabaseClient } from '@/lib/supabaseClient';
import {
  TrainingCertificate,
  TrainingContent,
  TrainingProgressRecord,
  TrainingResource,
  TrainingTrack,
} from '@/lib/trainingTypes';
import {
  trainingContent as fallbackTrainingContent,
  trainingTracks as fallbackTrainingTracks,
} from '@/data/trainingContent';

const TRAINING_QUERY_KEY = ['training-library'];
const TRAINING_TRACKS_QUERY_KEY = ['training-tracks'];
const TRAINING_SOURCE_QUERY_KEY = [...TRAINING_QUERY_KEY, 'source'];
const TRAINING_DOCUMENTS_BUCKET = 'training-documents';

type TrainingAssetRecord = {
  asset_type: 'video' | 'pdf' | 'link';
  provider: 'vimeo' | 'wistia' | 'aws' | 'youtube' | 'loom' | null;
  provider_video_id: string | null;
  provider_hash: string | null;
  embed_url: string | null;
  download_url: string | null;
  meta: Record<string, unknown> | null;
};

type TrainingRecord = {
  id: string;
  title: string;
  description: string | null;
  tags: string[] | null;
  duration_seconds: number | null;
  visibility: 'members_only' | 'public' | 'draft';
  training_assets?: TrainingAssetRecord[];
};

type TrainingTrackItemRecord = {
  training_id: string;
  required: boolean;
  sort_order: number;
};

type TrainingTrackRecord = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  audience: string | null;
  certificate_title: string | null;
  training_track_items?: TrainingTrackItemRecord[];
};

type TrainingProgressDbRecord = {
  training_id: string;
  started_at: string | null;
  completed_at: string | null;
  completion_source: string | null;
};

type TrainingCertificateDbRecord = {
  id: string;
  track_id: string;
  issued_at: string;
  certificate_title: string | null;
};

const DEFAULT_TRAINING_THUMBNAIL_URL = '/placeholder.svg';
const FALLBACK_BY_TITLE = new Map(
  fallbackTrainingContent.map((item) => [item.title.toLowerCase(), item])
);
const FALLBACK_BY_ID = new Map(fallbackTrainingContent.map((item) => [item.id, item]));

const buildVimeoUrl = (videoId?: string | null, hash?: string | null) => {
  if (!videoId) {
    return undefined;
  }

  if (!hash) {
    return `https://player.vimeo.com/video/${videoId}?dnt=1`;
  }

  return `https://player.vimeo.com/video/${videoId}?h=${hash}&dnt=1`;
};

const resolvePublicStorageUrl = (bucket: string, rawValue?: string | null) => {
  if (!rawValue) {
    return undefined;
  }

  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
    return value;
  }

  return supabaseClient.storage.from(bucket).getPublicUrl(value).data.publicUrl;
};

const createSignedDocumentUrl = async (storagePath?: string | null) => {
  if (!storagePath) {
    return undefined;
  }

  const path = storagePath.trim();
  if (!path) {
    return undefined;
  }

  const { data, error } = await supabaseClient.storage
    .from(TRAINING_DOCUMENTS_BUCKET)
    .createSignedUrl(path, 60 * 15);

  if (error) {
    return undefined;
  }

  return data.signedUrl;
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) {
    return undefined;
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
};

const normalizeTags = (tags: string[] | null | undefined, localTags: string[]) => {
  const merged = [...(tags ?? []), ...localTags].filter((tag) => tag.trim().length > 0);
  return [...new Set(merged)];
};

const extractStringMeta = (meta: Record<string, unknown> | null | undefined, key: string) => {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const resolveTrainingResourceUrl = async (asset: TrainingAssetRecord) => {
  if (asset.download_url?.trim()) {
    return asset.download_url.trim();
  }

  const storagePath = extractStringMeta(asset.meta, 'storage_path');
  return createSignedDocumentUrl(storagePath);
};

const toDbResource = async (asset: TrainingAssetRecord, index: number): Promise<TrainingResource> => {
  const title =
    extractStringMeta(asset.meta, 'title') ??
    `${asset.asset_type === 'pdf' ? 'PDF' : 'Resource'} ${index + 1}`;
  const description =
    extractStringMeta(asset.meta, 'description') ?? 'Resource attached to this training module.';
  const formatBadge = extractStringMeta(asset.meta, 'format_badge');
  const actionLabel = extractStringMeta(asset.meta, 'action_label');
  const href = await resolveTrainingResourceUrl(asset);
  const kind =
    asset.asset_type === 'pdf'
      ? href
        ? 'download'
        : 'guide'
      : asset.asset_type === 'link'
        ? 'link'
        : 'guide';

  return {
    title,
    description,
    status: href || kind === 'guide' ? 'available' : 'coming_soon',
    kind,
    actionLabel:
      actionLabel ??
      (kind === 'download'
        ? 'Download PDF'
        : kind === 'link'
          ? 'Open link'
          : 'Open guide'),
    href,
    external: Boolean(href),
    formatBadge,
  };
};

const mergeResources = (localResources: TrainingResource[], dbResources: TrainingResource[]) => {
  if (localResources.length === 0) {
    return dbResources;
  }

  const merged = localResources.map((localResource) => {
    const dbMatch = dbResources.find(
      (dbResource) => dbResource.title.toLowerCase() === localResource.title.toLowerCase()
    );

    return {
      ...dbMatch,
      ...localResource,
      href: localResource.href ?? dbMatch?.href,
      external: localResource.external ?? dbMatch?.external,
      status: localResource.status ?? dbMatch?.status ?? 'available',
      formatBadge: localResource.formatBadge ?? dbMatch?.formatBadge,
    };
  });

  const localTitles = new Set(localResources.map((resource) => resource.title.toLowerCase()));
  const extras = dbResources.filter((resource) => !localTitles.has(resource.title.toLowerCase()));
  return [...merged, ...extras];
};

const rehydrateLinkedTrainingIds = (content: TrainingContent[]) => {
  const titleToId = new Map(content.map((item) => [item.title.toLowerCase(), item.id]));

  return content.map((item) => ({
    ...item,
    resources: item.resources.map((resource) => {
      if (!resource.linkedTrainingId) {
        return resource;
      }

      const fallbackLinkedItem = FALLBACK_BY_ID.get(resource.linkedTrainingId);
      const resolvedId = fallbackLinkedItem
        ? titleToId.get(fallbackLinkedItem.title.toLowerCase())
        : resource.linkedTrainingId;

      return {
        ...resource,
        linkedTrainingId: resolvedId ?? resource.linkedTrainingId,
      };
    }),
  }));
};

const toTrainingContent = async (record: TrainingRecord): Promise<TrainingContent> => {
  const localMatch = FALLBACK_BY_TITLE.get(record.title.toLowerCase());
  const videoAsset = record.training_assets?.find((asset) => asset.asset_type === 'video');
  const resourceAssets = record.training_assets?.filter((asset) => asset.asset_type !== 'video') ?? [];
  const dbResources = await Promise.all(resourceAssets.map(toDbResource));
  const embedUrl =
    videoAsset?.embed_url ??
    (videoAsset?.provider === 'vimeo'
      ? buildVimeoUrl(videoAsset.provider_video_id, videoAsset.provider_hash)
      : undefined);
  const thumbnailFromMeta = resolvePublicStorageUrl(
    'training-thumbnails',
    extractStringMeta(videoAsset?.meta ?? null, 'thumbnail_url')
  );

  return {
    id: record.id,
    title: record.title,
    description: record.description ?? localMatch?.description ?? '',
    thumbnailUrl: thumbnailFromMeta ?? localMatch?.thumbnailUrl ?? DEFAULT_TRAINING_THUMBNAIL_URL,
    duration: formatDuration(record.duration_seconds) ?? localMatch?.duration ?? '--',
    tags: normalizeTags(record.tags, localMatch?.tags ?? []),
    level: localMatch?.level ?? 'Beginner',
    summary: localMatch?.summary ?? 'Training content for Bloomjoy operators.',
    learningPoints:
      localMatch?.learningPoints?.length
        ? localMatch.learningPoints
        : ['Key takeaways will appear here once this module is finalized.'],
    checklist:
      localMatch?.checklist?.length
        ? localMatch.checklist
        : ['Checklist items will be added after the next training update.'],
    searchTerms: localMatch?.searchTerms ?? [],
    taskCategory: localMatch?.taskCategory ?? 'Unassigned',
    audience: localMatch?.audience ?? 'Operator',
    format: localMatch?.format ?? (embedUrl ? 'video' : 'guide'),
    embed: {
      title:
        extractStringMeta(videoAsset?.meta ?? null, 'title') ??
        localMatch?.embed.title ??
        'Training module',
      srcDoc: localMatch?.embed.srcDoc ?? '',
      url: embedUrl,
    },
    document: localMatch?.document,
    resources: mergeResources(localMatch?.resources ?? [], dbResources),
  };
};

export const fetchTrainingLibrary = async (): Promise<TrainingContent[]> => {
  const { data, error } = await supabaseClient
    .from('trainings')
    .select(
      `
        id,
        title,
        description,
        tags,
        duration_seconds,
        visibility,
        training_assets (
          asset_type,
          provider,
          provider_video_id,
          provider_hash,
          embed_url,
          download_url,
          meta
        )
      `
    )
    .neq('visibility', 'draft')
    .order('sort_order', { ascending: true });

  if (error || !data || data.length === 0) {
    return fallbackTrainingContent;
  }

  const records = data as TrainingRecord[];
  const content = await Promise.all(records.map(toTrainingContent));
  return rehydrateLinkedTrainingIds(content);
};

export const fetchTrainingTracks = async (): Promise<TrainingTrack[]> => {
  const { data, error } = await supabaseClient
    .from('training_tracks')
    .select(
      `
        id,
        slug,
        title,
        description,
        audience,
        certificate_title,
        training_track_items (
          training_id,
          required,
          sort_order
        )
      `
    )
    .order('sort_order', { ascending: true });

  if (error || !data || data.length === 0) {
    return fallbackTrainingTracks;
  }

  const records = data as TrainingTrackRecord[];
  return records.map((record) => ({
    id: record.id,
    slug: record.slug,
    title: record.title,
    description: record.description ?? '',
    audience: record.audience ?? 'Operator',
    certificateTitle: record.certificate_title ?? undefined,
    items: (record.training_track_items ?? [])
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((item) => ({
        trainingId: item.training_id,
        required: item.required,
        sortOrder: item.sort_order,
      })),
  }));
};

export const bindTracksToLibrary = (
  tracks: TrainingTrack[],
  library: TrainingContent[]
): TrainingTrack[] => {
  const trainingById = new Map(library.map((item) => [item.id, item]));
  const fallbackTitleById = new Map(
    fallbackTrainingContent.map((item) => [item.id, item.title.toLowerCase()])
  );

  return tracks.map((track) => ({
    ...track,
    items: track.items
      .map((item) => {
        const directMatch = trainingById.get(item.trainingId);
        const fallbackTitle = fallbackTitleById.get(item.trainingId);
        const fallbackMatch = fallbackTitle
          ? library.find((trainingItem) => trainingItem.title.toLowerCase() === fallbackTitle)
          : undefined;

        return {
          ...item,
          trainingId: directMatch?.id ?? fallbackMatch?.id ?? item.trainingId,
          training: directMatch ?? fallbackMatch,
        };
      })
      .filter((item) => Boolean(item.training)),
  }));
};

export const fetchTrainingProgress = async (): Promise<TrainingProgressRecord[]> => {
  const { data, error } = await supabaseClient
    .from('training_progress')
    .select('training_id,started_at,completed_at,completion_source');

  if (error || !data) {
    return [];
  }

  const records = data as TrainingProgressDbRecord[];
  return records.map((record) => ({
    trainingId: record.training_id,
    startedAt: record.started_at,
    completedAt: record.completed_at,
    completionSource: record.completion_source,
  }));
};

export const fetchTrainingCertificates = async (): Promise<TrainingCertificate[]> => {
  const { data, error } = await supabaseClient
    .from('training_certifications')
    .select('id,track_id,issued_at,certificate_title');

  if (error || !data) {
    return [];
  }

  const records = data as TrainingCertificateDbRecord[];
  return records.map((record) => ({
    id: record.id,
    trackId: record.track_id,
    issuedAt: record.issued_at,
    certificateTitle: record.certificate_title ?? 'Bloomjoy Operator Essentials',
  }));
};

export const useTrainingLibrary = (enabled = true) =>
  useQuery({
    queryKey: TRAINING_QUERY_KEY,
    queryFn: fetchTrainingLibrary,
    enabled,
    placeholderData: fallbackTrainingContent,
    refetchOnMount: 'always',
    staleTime: 1000 * 60 * 5,
  });

export const useTrainingTracks = (enabled = true) =>
  useQuery({
    queryKey: TRAINING_TRACKS_QUERY_KEY,
    queryFn: fetchTrainingTracks,
    enabled,
    placeholderData: fallbackTrainingTracks,
    staleTime: 1000 * 60 * 5,
  });

export const useTrainingProgress = (enabled: boolean) =>
  useQuery({
    queryKey: ['training-progress'],
    queryFn: fetchTrainingProgress,
    enabled,
    initialData: [] as TrainingProgressRecord[],
    staleTime: 1000 * 30,
  });

export const useTrainingCertificates = (enabled: boolean) =>
  useQuery({
    queryKey: ['training-certifications'],
    queryFn: fetchTrainingCertificates,
    enabled,
    initialData: [] as TrainingCertificate[],
    staleTime: 1000 * 30,
  });

export const useTrainingSourceStatus = () =>
  useQuery({
    queryKey: TRAINING_SOURCE_QUERY_KEY,
    queryFn: async () => {
      const { count, error } = await supabaseClient
        .from('trainings')
        .select('*', { count: 'exact', head: true });

      if (error) {
        return 'local';
      }

      return count && count > 0 ? 'supabase' : 'local';
    },
    staleTime: 1000 * 60 * 2,
  });

export const useSaveTrainingProgress = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      trainingId,
      markComplete,
      completionSource,
    }: {
      trainingId: string;
      markComplete: boolean;
      completionSource: string;
    }) => {
      const { error } = await supabaseClient.rpc('save_training_progress', {
        training_id_input: trainingId,
        mark_complete_input: markComplete,
        completion_source_input: completionSource,
      });

      if (error) {
        throw error;
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['training-progress'] }),
        queryClient.invalidateQueries({ queryKey: TRAINING_QUERY_KEY }),
      ]);
    },
  });
};

export const useIssueTrainingCertificate = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      trackSlug,
      finalAcknowledgement,
    }: {
      trackSlug: string;
      finalAcknowledgement: boolean;
    }) => {
      const { data, error } = await supabaseClient.rpc('issue_training_certificate', {
        track_slug_input: trackSlug,
        final_acknowledgement_input: finalAcknowledgement,
      });

      if (error) {
        throw error;
      }

      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['training-certifications'] });
    },
  });
};
