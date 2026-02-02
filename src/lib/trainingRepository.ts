import { useQuery } from '@tanstack/react-query';
import { supabaseClient } from '@/lib/supabaseClient';
import {
  TrainingContent,
  trainingContent as fallbackTrainingContent,
} from '@/data/trainingContent';

const TRAINING_QUERY_KEY = ['training-library'];

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

const buildVimeoUrl = (videoId?: string | null, hash?: string | null) => {
  if (!videoId) {
    return undefined;
  }
  if (!hash) {
    return `https://player.vimeo.com/video/${videoId}?dnt=1`;
  }
  return `https://player.vimeo.com/video/${videoId}?h=${hash}&dnt=1`;
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) {
    return undefined;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
};

const toTrainingContent = (record: TrainingRecord): TrainingContent => {
  const localMatch = fallbackTrainingContent.find(
    (item) => item.title.toLowerCase() === record.title.toLowerCase()
  );
  const videoAsset = record.training_assets?.find((asset) => asset.asset_type === 'video');
  const embedUrl =
    videoAsset?.embed_url ??
    (videoAsset?.provider === 'vimeo'
      ? buildVimeoUrl(videoAsset.provider_video_id, videoAsset.provider_hash)
      : undefined);

  const resources =
    record.training_assets
      ?.filter((asset) => asset.asset_type !== 'video')
      .map((asset, index) => {
        const meta = asset.meta ?? {};
        const title =
          (meta.title as string | undefined) ??
          `${asset.asset_type === 'pdf' ? 'PDF' : 'Resource'} ${index + 1}`;
        const description =
          (meta.description as string | undefined) ??
          'Resource attached to this training module.';
        const hasLink = Boolean(asset.download_url || asset.embed_url);
        return {
          title,
          description,
          status: hasLink ? 'available' : 'coming_soon',
        };
      }) ?? [];

  return {
    id: record.id,
    title: record.title,
    description: record.description ?? localMatch?.description ?? '',
    duration:
      formatDuration(record.duration_seconds) ?? localMatch?.duration ?? '—',
    tags: record.tags && record.tags.length > 0 ? record.tags : localMatch?.tags ?? [],
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
    embed: {
      title: videoAsset?.meta?.title
        ? String(videoAsset.meta?.title)
        : localMatch?.embed.title ?? 'Training module',
      srcDoc: localMatch?.embed.srcDoc ?? '',
      url: embedUrl,
    },
    resources: resources.length > 0 ? resources : localMatch?.resources ?? [],
  };
};

export const fetchTrainingLibrary = async (): Promise<TrainingContent[]> => {
  if (!supabaseClient) {
    return fallbackTrainingContent;
  }

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
    .order('sort_order', { ascending: true });

  if (error || !data) {
    return fallbackTrainingContent;
  }

  const records = data as TrainingRecord[];
  return records.map(toTrainingContent);
};

export const useTrainingLibrary = () =>
  useQuery({
    queryKey: TRAINING_QUERY_KEY,
    queryFn: fetchTrainingLibrary,
    initialData: fallbackTrainingContent,
    staleTime: 1000 * 60 * 5,
  });

export const useTrainingSourceStatus = () =>
  useQuery({
    queryKey: [...TRAINING_QUERY_KEY, 'source'],
    queryFn: async () => {
      if (!supabaseClient) {
        return 'local';
      }
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
