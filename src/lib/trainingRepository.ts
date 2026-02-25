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
  sort_order: number;
  training_assets?: TrainingAssetRecord[];
};

const normalizeTitle = (value: string) => value.trim().toLowerCase();

const buildVimeoUrl = (videoId?: string | null, hash?: string | null) => {
  if (!videoId) {
    return undefined;
  }

  if (!hash) {
    return `https://player.vimeo.com/video/${videoId}?dnt=1`;
  }

  return `https://player.vimeo.com/video/${videoId}?h=${hash}&dnt=1`;
};

const normalizeVimeoEmbedUrl = (url?: string | null) => {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (host === 'player.vimeo.com' && pathParts[0] === 'video' && pathParts[1]) {
      return buildVimeoUrl(pathParts[1], parsed.searchParams.get('h'));
    }

    if (host.endsWith('vimeo.com')) {
      const idIndex = pathParts.findIndex((segment) => /^\d+$/.test(segment));
      if (idIndex >= 0) {
        const videoId = pathParts[idIndex];
        const pathHashCandidate = pathParts[idIndex + 1];
        const hash =
          parsed.searchParams.get('h') ??
          (pathHashCandidate && /^[a-zA-Z0-9]+$/.test(pathHashCandidate)
            ? pathHashCandidate
            : null);

        return buildVimeoUrl(videoId, hash);
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const toSafeText = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildPlaceholderEmbedDoc = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .frame { height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; color: #475569; padding: 16px; box-sizing: border-box; }
      .card { border: 1px dashed #cbd5e1; border-radius: 16px; max-width: 460px; background: #ffffff; text-align: center; padding: 20px; }
      .title { font-size: 16px; font-weight: 600; margin-bottom: 8px; color: #1e293b; }
      .subtitle { font-size: 13px; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="card">
        <div class="title">${toSafeText(title)}</div>
        <div class="subtitle">Video is not uploaded yet. This module will unlock once Vimeo content is added.</div>
      </div>
    </div>
  </body>
</html>`;

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) {
    return undefined;
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
};

const toTrainingContent = (record: TrainingRecord): TrainingContent => {
  const localMatch = fallbackTrainingContent.find(
    (item) => normalizeTitle(item.title) === normalizeTitle(record.title)
  );

  const videoAsset = record.training_assets?.find((asset) => asset.asset_type === 'video');
  const vimeoEmbedUrl =
    buildVimeoUrl(videoAsset?.provider_video_id, videoAsset?.provider_hash) ??
    normalizeVimeoEmbedUrl(videoAsset?.embed_url);

  const embedUrl =
    videoAsset?.provider === 'vimeo' ? vimeoEmbedUrl : videoAsset?.embed_url ?? undefined;

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
    id: localMatch?.id ?? record.id,
    title: record.title,
    description: record.description ?? localMatch?.description ?? '',
    duration: formatDuration(record.duration_seconds) ?? localMatch?.duration ?? '-',
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
      srcDoc:
        localMatch?.embed.srcDoc ??
        buildPlaceholderEmbedDoc(
          videoAsset?.meta?.title ? String(videoAsset.meta?.title) : record.title
        ),
      url: embedUrl,
    },
    resources: resources.length > 0 ? resources : localMatch?.resources ?? [],
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
        sort_order,
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
  const supabaseContent = records.map(toTrainingContent);
  const supabaseTitleSet = new Set(records.map((record) => normalizeTitle(record.title)));
  const fallbackRemainder = fallbackTrainingContent.filter(
    (item) => !supabaseTitleSet.has(normalizeTitle(item.title))
  );

  return [...supabaseContent, ...fallbackRemainder];
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
