import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  CreditCard,
  Play,
  PlayCircle,
  Search,
  Sparkles,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { downloadTrainingCertificateSvg } from '@/lib/trainingCertificate';
import { trackEvent } from '@/lib/analytics';
import type { TranslationKey } from '@/lib/i18n';
import {
  getTrainingDisplayTags,
  getTrainingTrackDefinition,
  getTrainingTrackDefinitions,
  stripInternalTrainingTags,
} from '@/lib/trainingCatalog';
import {
  bindTracksToTrainingExperience,
  buildTrainingExperience,
  getTrainingProgressWriteIds,
  getTrainingRouteId,
  mapTrainingProgressToCanonical,
  useIssueTrainingCertificate,
  useSaveTrainingProgress,
  useTrainingCertificates,
  useTrainingLibrary,
  useTrainingProgress,
  useTrainingSourceStatus,
  useTrainingTracks,
} from '@/lib/trainingRepository';
import type { TrainingExperienceItem } from '@/lib/trainingTypes';
import { toast } from 'sonner';

const MODULE_TAG_PATTERN = /^module\s+(\d+)$/i;
const PLACEHOLDER_THUMBNAIL_URL = '/placeholder.svg';

const trackIconMap: Record<string, LucideIcon> = {
  'start-here': Sparkles,
  'daily-operation': PlayCircle,
  'cleaning-maintenance': CheckCircle2,
  'software-payments': CreditCard,
  'troubleshooting-repair': TriangleAlert,
  'build-assembly': Wrench,
  reference: BookOpen,
};

const getModuleNumber = (moduleLabel?: string) => {
  const match = moduleLabel?.match(MODULE_TAG_PATTERN);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
};

const getFormatLabel = (item: TrainingExperienceItem) => {
  if (item.surface === 'quick-aid') {
    return 'Quick aid';
  }

  if (item.surface === 'manual') {
    return 'Reference manual';
  }

  if (item.format === 'video') {
    return 'Video';
  }

  if (item.format === 'checklist') {
    return 'Checklist';
  }

  if (item.format === 'reference') {
    return 'Reference';
  }

  if (item.format === 'mixed') {
    return 'Mixed';
  }

  return 'Guide';
};

const getSurfaceLabel = (item: TrainingExperienceItem) => {
  if (item.surface === 'manual') {
    return 'Reference manual';
  }

  if (item.surface === 'quick-aid') {
    return 'Quick aid';
  }

  if (item.format === 'mixed') {
    return 'Task + guide';
  }

  return 'Operator task';
};

const getSearchableText = (content: TrainingExperienceItem) =>
  [
    content.title,
    content.description,
    content.summary,
    content.taskCategory,
    content.moduleLabel,
    content.document?.title,
    content.document?.intro,
    ...content.document?.sections.map((section) => section.heading) ?? [],
    ...content.document?.sections.flatMap((section) => section.paragraphs ?? []) ?? [],
    ...content.document?.sections.flatMap((section) => section.bullets ?? []) ?? [],
    ...content.tags,
    ...content.searchTerms,
    ...content.resources.map((resource) => resource.title),
    ...content.resources.map((resource) => resource.description),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const sortTrainingItems = (left: TrainingExperienceItem, right: TrainingExperienceItem) => {
  const leftFeatured = left.featuredOrder ?? Number.MAX_SAFE_INTEGER;
  const rightFeatured = right.featuredOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftFeatured !== rightFeatured) {
    return leftFeatured - rightFeatured;
  }

  const leftPriority = left.operatorPriority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.operatorPriority ?? Number.MAX_SAFE_INTEGER;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.title.localeCompare(right.title);
};

export default function TrainingPage() {
  const { user, canAccessTraining } = useAuth();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [selectedTrack, setSelectedTrack] = useState('all');
  const [selectedTopicTags, setSelectedTopicTags] = useState<string[]>([]);
  const [selectedModule, setSelectedModule] = useState('All modules');
  const [selectedFormat, setSelectedFormat] = useState('All formats');
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [finalAcknowledgement, setFinalAcknowledgement] = useState(false);
  const libraryExplorerRef = useRef<HTMLElement | null>(null);
  const librarySearchRef = useRef<HTMLInputElement | null>(null);
  const { data: library = [], isLoading } = useTrainingLibrary();
  const { data: trackDefinitions = [] } = useTrainingTracks();
  const { data: progress = [] } = useTrainingProgress(user?.id, canAccessTraining);
  const { data: certificates = [] } = useTrainingCertificates(user?.id, canAccessTraining);
  const { data: source = 'local' } = useTrainingSourceStatus();
  const issueCertificateMutation = useIssueTrainingCertificate();
  const saveProgressMutation = useSaveTrainingProgress();

  useEffect(() => {
    trackEvent('view_training_catalog');
  }, []);

  const trainingExperience = useMemo(() => buildTrainingExperience(library), [library]);
  const canonicalProgress = useMemo(
    () => mapTrainingProgressToCanonical(progress, trainingExperience),
    [progress, trainingExperience]
  );
  const hydratedTracks = useMemo(
    () => bindTracksToTrainingExperience(trackDefinitions, trainingExperience),
    [trackDefinitions, trainingExperience]
  );
  const operatorTrack = hydratedTracks.find((track) => track.slug === 'operator-essentials');
  const progressByTrainingId = new Map(
    canonicalProgress.map((item) => [item.trainingId, item])
  );
  const requiredTrackItems = operatorTrack?.items.filter((item) => item.required) ?? [];
  const completedRequiredCount = requiredTrackItems.filter((item) =>
    progressByTrainingId.get(item.trainingId)?.completedAt
  ).length;
  const operatorTrackProgressPercent =
    requiredTrackItems.length === 0
      ? 0
      : Math.round((completedRequiredCount / requiredTrackItems.length) * 100);
  const issuedCertificate = operatorTrack
    ? certificates.find((certificate) => certificate.trackId === operatorTrack.id)
    : undefined;
  const inProgressItem =
    operatorTrack?.items.find(
      (item) =>
        item.training &&
        progressByTrainingId.get(item.trainingId)?.startedAt &&
        !progressByTrainingId.get(item.trainingId)?.completedAt
    )?.training;
  const nextRequiredItem = operatorTrack?.items.find(
    (item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt
  )?.training;
  const startHereSequence =
    operatorTrack?.items
      .map((item) => item.training)
      .filter((item): item is TrainingExperienceItem => Boolean(item))
      .slice(0, 4) ??
    [...trainingExperience.tasks]
      .filter((item) => item.isStartHere)
      .sort(sortTrainingItems)
      .slice(0, 4);
  const recommendedStartingItem = inProgressItem ?? nextRequiredItem ?? startHereSequence[0];
  const trackDefinitionsForNavigation = getTrainingTrackDefinitions().filter(
    (track) => track.id !== 'start-here'
  );
  const moduleFilters = [...new Set(trainingExperience.tasks.map((item) => item.moduleLabel).filter(Boolean))]
    .map((item) => String(item))
    .sort((left, right) => getModuleNumber(left) - getModuleNumber(right));
  const supportsModuleFilter =
    moduleFilters.length > 1 && trainingExperience.tasks.every((item) => Boolean(item.moduleLabel));
  const formatFilters = [...new Set(trainingExperience.allItems.map(getFormatLabel))].sort((left, right) =>
    left.localeCompare(right)
  );
  const topicTags = [
    ...new Set(trainingExperience.allItems.flatMap((item) => stripInternalTrainingTags(item.tags))),
  ].sort((left, right) => left.localeCompare(right));
  const visibleTopicFilters = [
    ...topicTags.slice(0, 16),
    ...selectedTopicTags.filter((tag) => !topicTags.slice(0, 16).includes(tag)),
  ];
  const activeFilterCount =
    (selectedModule === 'All modules' ? 0 : 1) +
    (selectedFormat === 'All formats' ? 0 : 1) +
    selectedTopicTags.length;
  const filteredItems = trainingExperience.allItems.filter((content) => {
    const matchesSearch = getSearchableText(content).includes(search.trim().toLowerCase());
    const matchesTrack = selectedTrack === 'all' || content.catalogTrackId === selectedTrack;
    const matchesModule = selectedModule === 'All modules' || content.moduleLabel === selectedModule;
    const matchesFormat = selectedFormat === 'All formats' || getFormatLabel(content) === selectedFormat;
    const visibleTopicTagsForItem = stripInternalTrainingTags(content.tags);
    const matchesTopicTags =
      selectedTopicTags.length === 0 ||
      selectedTopicTags.some((tag) => visibleTopicTagsForItem.includes(tag));

    return matchesSearch && matchesTrack && matchesModule && matchesFormat && matchesTopicTags;
  });
  const showCuratedSections =
    search.trim().length === 0 && selectedTrack === 'all' && activeFilterCount === 0;
  const startHereIds = new Set(startHereSequence.map((item) => item.id));
  const filteredTasks = filteredItems.filter((item) => item.surface === 'task');
  const filteredReferenceItems = filteredItems.filter((item) => item.surface !== 'task');
  const libraryResults = filteredTasks.filter(
    (item) => !(showCuratedSections && startHereIds.has(item.id))
  );
  const quickAidItems = [...trainingExperience.quickAids]
    .filter((item) => !item.isStartHere)
    .sort(sortTrainingItems)
    .slice(0, 4);
  const safePowerOffRouteId = getTrainingRouteId(
    trainingExperience,
    'start-up-shutdown-procedure'
  );
  const safePowerOffTask = safePowerOffRouteId
    ? trainingExperience.byId.get(safePowerOffRouteId)
    : undefined;
  const featuredJobAidItems = [
    safePowerOffTask
      ? {
          id: 'safe-power-off-flow-aid',
          title: 'Safe Power Off and Cooldown',
          taskCategory: 'Daily Operation',
          description:
            'Use from the shutdown task before cleaning, opening panels, or unplugging power.',
          href: `/portal/training/${safePowerOffRouteId}#written-essentials`,
          label: 'In shutdown task',
        }
      : undefined,
    ...quickAidItems.map((item) => ({
      id: item.id,
      title: item.title,
      taskCategory: item.taskCategory,
      description: item.description,
      href: `/portal/training/${item.id}`,
      label: getSurfaceLabel(item),
      sourceItem: item,
    })),
  ].filter((item): item is {
    id: string;
    title: string;
    taskCategory: string;
    description: string;
    href: string;
    label: string;
    sourceItem?: TrainingExperienceItem;
  } => Boolean(item));
  const groupedContent = trackDefinitionsForNavigation
    .map((trackDefinition) => ({
      ...trackDefinition,
      items: [...libraryResults]
        .filter((item) => item.catalogTrackId === trackDefinition.id)
        .sort(sortTrainingItems),
    }))
    .filter((trackDefinition) => trackDefinition.items.length > 0);
  const selectedTrackDefinition =
    selectedTrack === 'all' ? undefined : getTrainingTrackDefinition(selectedTrack);
  const walkthroughTaskCount = trainingExperience.tasks.filter(
    (item) => item.format === 'video' || item.format === 'mixed' || Boolean(item.primaryVideo?.embed.url)
  ).length;
  const missingModuleCount = library.filter((item) => !item.moduleLabel).length;
  const derivedMappingCount = library.filter((item) => item.catalogSource === 'derived').length;
  const matchingTaskCount = filteredTasks.length;
  const matchingReferenceCount = filteredReferenceItems.length;
  const showInternalCatalogQa =
    import.meta.env.DEV &&
    (source !== 'supabase' || derivedMappingCount > 0 || missingModuleCount > 0);
  const getLocalizedFormatLabel = (label: string) => {
    switch (label) {
      case 'Quick aid':
        return t('training.formatQuickAid');
      case 'Reference manual':
        return t('training.formatReferenceManual');
      case 'Video':
        return t('training.formatVideo');
      case 'Checklist':
        return t('training.formatChecklist');
      case 'Reference':
        return t('training.formatReference');
      case 'Mixed':
        return t('training.formatMixed');
      case 'Guide':
      default:
        return t('training.formatGuide');
    }
  };
  const getLocalizedSurfaceLabel = (item: TrainingExperienceItem) => {
    if (item.surface === 'manual') {
      return t('training.formatReferenceManual');
    }

    if (item.surface === 'quick-aid') {
      return t('training.formatQuickAid');
    }

    if (item.format === 'mixed') {
      return t('training.taskGuide');
    }

    return t('training.operatorTask');
  };
  const getLocalizedActionLabel = (item: TrainingExperienceItem) => {
    if (item.surface === 'manual') {
      return t('training.openManual');
    }

    if (item.surface === 'quick-aid') {
      return t('training.openQuickAid');
    }

    return t('training.openTask');
  };
  const getCountLabel = (count: number, singularKey: TranslationKey, pluralKey: TranslationKey) =>
    t('training.countLabel', {
      count,
      label: t(count === 1 ? singularKey : pluralKey),
    });

  useEffect(() => {
    if (!supportsModuleFilter && selectedModule !== 'All modules') {
      setSelectedModule('All modules');
    }
  }, [selectedModule, supportsModuleFilter]);

  const handleOpenItem = (content: TrainingExperienceItem) => {
    trackEvent('open_training_item', { id: content.id, title: content.title, format: content.format });
  };

  const toggleTopicTag = (tag: string) => {
    setSelectedTopicTags((current) =>
      current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]
    );
  };

  const resetFilters = () => {
    setSelectedModule('All modules');
    setSelectedFormat('All formats');
    setSelectedTopicTags([]);
  };

  const focusLibraryExplorer = (nextTrack = 'all') => {
    setSearch('');
    setSelectedTrack(nextTrack);
    resetFilters();
    setAdvancedFiltersOpen(false);

    window.requestAnimationFrame(() => {
      libraryExplorerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => librarySearchRef.current?.focus(), 250);
    });
  };

  const handleSelectTrack = (trackId: string) => {
    focusLibraryExplorer(trackId);
  };

  const handleUnlockCertificate = async () => {
    if (!operatorTrack) {
      return;
    }

    if (!finalAcknowledgement) {
      toast.error(t('training.confirmSafetyAcknowledgement'));
      return;
    }

    try {
      const completedTaskIds = requiredTrackItems
        .filter((item) => progressByTrainingId.get(item.trainingId)?.completedAt)
        .flatMap((item) =>
          item.training ? getTrainingProgressWriteIds(item.training) : [item.trainingId]
        );

      if (completedTaskIds.length > 0) {
        await saveProgressMutation.mutateAsync({
          trainingId: completedTaskIds[0],
          trainingIds: completedTaskIds,
          markComplete: true,
          completionSource: 'certificate_sync',
        });
      }

      await issueCertificateMutation.mutateAsync({
        trackSlug: operatorTrack.slug,
        finalAcknowledgement: true,
      });
      toast.success(t('training.certificateUnlocked'));
      trackEvent('training_certificate_unlocked', { track: operatorTrack.slug });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('training.unableUnlockCertificate');
      toast.error(message);
    }
  };

  const handleDownloadCertificate = () => {
    if (!issuedCertificate || !user) {
      return;
    }

    downloadTrainingCertificateSvg({
      recipientName: user.email,
      trackTitle: issuedCertificate.certificateTitle,
      issuedAt: issuedCertificate.issuedAt,
    });
    trackEvent('training_certificate_downloaded', { track_id: issuedCertificate.trackId });
  };

  const renderTrainingCard = (content: TrainingExperienceItem, options?: { showStep?: number }) => {
    const CardIcon =
      content.surface === 'manual'
        ? BookOpen
        : content.surface === 'quick-aid'
          ? CheckCircle2
          : content.primaryVideo
            ? Play
            : Wrench;
    const progressRecord = content.surface === 'task' ? progressByTrainingId.get(content.id) : undefined;
    const displayTags = getTrainingDisplayTags(content, 2);
    const hasVisualThumbnail =
      Boolean(content.thumbnailUrl) &&
      content.thumbnailUrl !== PLACEHOLDER_THUMBNAIL_URL;
    const isQuickAid = content.surface === 'quick-aid';
    const surfaceLabel = getLocalizedSurfaceLabel(content);

    return (
      <Link
        key={content.id}
        to={`/portal/training/${content.id}`}
        onClick={() => handleOpenItem(content)}
        className={`group overflow-hidden rounded-3xl border bg-background transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-sm ${
          isQuickAid ? 'border-primary/15' : 'border-border'
        }`}
      >
        <div
          className={`relative ${
            options?.showStep ? 'aspect-[1.08/1]' : isQuickAid ? 'aspect-[1.1/1]' : 'aspect-video'
          } overflow-hidden border-b border-border ${
            hasVisualThumbnail
              ? 'bg-muted'
              : isQuickAid
                ? 'bg-gradient-to-br from-primary/10 via-background to-cream'
                : 'bg-gradient-to-br from-cream via-background to-primary/5'
          }`}
        >
          {hasVisualThumbnail && (
            <img
              src={content.thumbnailUrl}
              alt={content.thumbnailAlt ?? ''}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              referrerPolicy="no-referrer"
            />
          )}
          {hasVisualThumbnail && (
            <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-cream/30 mix-blend-screen" />
          )}
          <div
            className={`absolute inset-0 ${
              hasVisualThumbnail
                ? 'bg-gradient-to-t from-black/65 via-black/20 to-black/10'
                : 'bg-gradient-to-br from-transparent via-transparent to-primary/10'
            }`}
          />
          <div className="relative flex h-full flex-col justify-between p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {options?.showStep ? (
                  <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                    {t('training.stepNumber', { step: options.showStep })}
                  </span>
                ) : (
                  <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                    {surfaceLabel}
                  </span>
                )}
                {content.moduleLabel && (
                  <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {content.moduleLabel}
                  </span>
                )}
              </div>
              {progressRecord?.completedAt ? (
                <span className="rounded-full bg-sage-light px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sage">
                  {t('training.complete')}
                </span>
              ) : progressRecord?.startedAt ? (
                <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  {t('training.inProgress')}
                </span>
              ) : null}
            </div>

            {!hasVisualThumbnail && (
              <div className="flex items-end justify-between gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background/90 text-primary shadow-sm">
                  <CardIcon className="h-6 w-6" />
                </div>
                <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {content.taskCategory}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {content.taskCategory}
            </p>
            <div className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {content.duration}
            </div>
          </div>

          <h3 className="mt-3 text-lg font-semibold text-foreground group-hover:text-primary">
            {content.title}
          </h3>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground sm:line-clamp-2">
            {content.description}
          </p>

          {displayTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {displayTags.map((tag) => (
                <span
                  key={`${content.id}-${tag}`}
                  className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">
            {getLocalizedActionLabel(content)}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </Link>
    );
  };

  const renderStartHereStep = (content: TrainingExperienceItem, index: number) => {
    const progressRecord = progressByTrainingId.get(content.id);

    return (
      <Link
        key={content.id}
        to={`/portal/training/${content.id}`}
        onClick={() => handleOpenItem(content)}
        className="group flex h-full gap-3 rounded-2xl border border-border bg-background p-4 transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-sm sm:gap-4 sm:p-5"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary">
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>{content.taskCategory}</span>
            <span aria-hidden="true">/</span>
            <span>{content.duration}</span>
            {progressRecord?.completedAt && (
              <>
                <span aria-hidden="true">/</span>
                <span className="text-sage">{t('training.complete')}</span>
              </>
            )}
            {!progressRecord?.completedAt && progressRecord?.startedAt && (
              <>
                <span aria-hidden="true">/</span>
                <span className="text-primary">{t('training.inProgress')}</span>
              </>
            )}
          </div>
          <h3 className="mt-2 text-base font-semibold text-foreground group-hover:text-primary">
            {content.title}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
            {content.description}
          </p>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
      </Link>
    );
  };

  return (
    <PortalLayout>
      <section className="py-8 sm:py-10 lg:py-12">
        <div className="container-page">
          <div className="rounded-[28px] border border-primary/10 bg-gradient-to-br from-cream via-background to-primary/5 p-4 sm:p-6 lg:p-7">
            <div className="grid gap-5 lg:grid-cols-[0.95fr,1.05fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  {t('training.hub')}
                </p>
                <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                  {t('training.heroTitle')}
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                  {t('training.heroDescription')}
                </p>
                <div className="mt-5 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                  <div className="rounded-2xl border border-primary/10 bg-background/70 px-4 py-3">
                    <span className="block text-lg font-semibold text-foreground">
                      {trainingExperience.tasks.length}
                    </span>
                    {t('training.operatorTasks')}
                  </div>
                  <div className="rounded-2xl border border-primary/10 bg-background/70 px-4 py-3">
                    <span className="block text-lg font-semibold text-foreground">
                      {walkthroughTaskCount}
                    </span>
                    {t('training.walkthroughVideos')}
                  </div>
                  <div className="rounded-2xl border border-primary/10 bg-background/70 px-4 py-3">
                    <span className="block text-lg font-semibold text-foreground">
                      {trainingExperience.quickAids.length + trainingExperience.manuals.length}
                    </span>
                    {t('training.quickAidsManuals')}
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-primary/20 bg-background/95 p-5 shadow-md sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <PlayCircle className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      {t('training.primaryNextAction')}
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                      {inProgressItem ? t('training.resumeWhereLeftOff') : t('training.openStartPath')}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {recommendedStartingItem
                        ? recommendedStartingItem.title
                        : 'Follow the core setup, daily operation, cleaning, and recovery steps before digging into repairs.'}
                    </p>
                  </div>
                </div>
                {recommendedStartingItem && (
                  <p className="mt-3 rounded-2xl bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground">
                    {recommendedStartingItem.summary}
                  </p>
                )}
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${operatorTrackProgressPercent}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('training.requiredComplete', {
                    completed: completedRequiredCount,
                    total: requiredTrackItems.length,
                  })}
                </p>
                <div className="mt-5 flex flex-col gap-3">
                  {recommendedStartingItem && (
                    <Button asChild className="btn-shadow w-full justify-center">
                      <Link to={`/portal/training/${recommendedStartingItem.id}`}>
                        {inProgressItem ? t('training.resumeLearning') : t('training.openStartPath')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => focusLibraryExplorer()}
                    className="inline-flex items-center justify-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
                  >
                    {t('training.searchInstead')}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {startHereSequence.length > 0 && (
            <section className="mt-7 sm:mt-9">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {t('training.startHere')}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                    {t('training.shortestSequence')}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {t('training.shortestSequenceDescription')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="w-full justify-start px-0 text-primary hover:bg-transparent sm:w-fit"
                  onClick={() => focusLibraryExplorer()}
                >
                  {t('training.exploreFullLibrary')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                {startHereSequence.map((item, index) => renderStartHereStep(item, index))}
              </div>
            </section>
          )}

          <section className="mt-8 sm:mt-10">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  {t('training.jumpByTask')}
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                  {t('training.helpType')}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {t('training.helpTypeDescription')}
                </p>
              </div>
              <Button
                variant={selectedTrack === 'all' ? 'default' : 'outline'}
                className="w-full sm:w-auto"
                onClick={() => focusLibraryExplorer()}
              >
                {t('training.viewAllResources')}
              </Button>
            </div>

            <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {trackDefinitionsForNavigation.map((trackDefinition) => {
                const TrackIcon = trackIconMap[trackDefinition.id] ?? BookOpen;
                const trackItems = trainingExperience.tasks.filter(
                  (item) => item.catalogTrackId === trackDefinition.id
                );
                const isActive = selectedTrack === trackDefinition.id;

                return (
                  <button
                    key={trackDefinition.id}
                    type="button"
                    onClick={() => handleSelectTrack(trackDefinition.id)}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      isActive
                        ? 'border-primary/30 bg-primary/5 shadow-sm'
                        : 'border-border bg-background hover:border-primary/20 hover:bg-muted/20'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <TrackIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">
                            {trackDefinition.label}
                          </h3>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {trackItems.length}
                          </span>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {trackDefinition.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {showCuratedSections && featuredJobAidItems.length > 0 && (
            <section className="mt-8 sm:mt-10">
              <div className="rounded-[24px] border border-primary/10 bg-primary/5 p-4 sm:p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {t('training.jobAids')}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                    {t('training.fastReferences')}
                  </h2>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {t('training.fastReferencesDescription')}
                  </p>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {featuredJobAidItems.map((item) => (
                    <Link
                      key={item.id}
                      to={item.href}
                      onClick={() => {
                        if (item.sourceItem) {
                          handleOpenItem(item.sourceItem);
                        }
                      }}
                      className="rounded-2xl border border-primary/10 bg-background/90 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-sm"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                        {item.taskCategory}
                      </p>
                      <h3 className="mt-2 text-base font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
                        {item.description}
                      </p>
                      <div className="mt-4 flex flex-col items-start gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                        <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          {item.label}
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-primary">
                          {t('training.open')}
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )}

          <section id="training-library-explorer" ref={libraryExplorerRef} className="mt-8 sm:mt-10">
            <div className="flex flex-col gap-4 rounded-[24px] border border-border bg-background p-4 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {t('training.library')}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                    {selectedTrackDefinition
                      ? t('training.searchTrackLibrary', { track: selectedTrackDefinition.label })
                      : t('training.searchTaskLibrary')}
                  </h2>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {selectedTrackDefinition
                      ? t('training.searchTrackDescription', {
                          track: selectedTrackDefinition.label,
                        })
                      : t('training.searchTaskDescription')}
                  </p>
                </div>

                <div className="relative flex-1 lg:max-w-xl">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={librarySearchRef}
                    placeholder={t('training.searchPlaceholder')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-10"
                  />
                </div>

                <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto">
                  <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" className="w-full sm:w-auto">
                        {t('training.moreFilters')}
                        {activeFilterCount > 0 && (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                            {activeFilterCount}
                          </span>
                        )}
                        <ChevronDown
                          className={`ml-2 h-4 w-4 transition-transform ${
                            advancedFiltersOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-5 border-t border-border pt-5">
                      <div className="grid gap-6 lg:grid-cols-3">
                        {supportsModuleFilter && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {t('training.module')}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                onClick={() => setSelectedModule('All modules')}
                                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                                  selectedModule === 'All modules'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                }`}
                              >
                                {t('training.allModules')}
                              </button>
                              {moduleFilters.map((moduleLabel) => (
                                <button
                                  key={moduleLabel}
                                  onClick={() => setSelectedModule(moduleLabel)}
                                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                                    selectedModule === moduleLabel
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                  }`}
                                >
                                  {moduleLabel}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t('training.format')}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              onClick={() => setSelectedFormat('All formats')}
                              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                                selectedFormat === 'All formats'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
                              }`}
                            >
                              {t('training.allFormats')}
                            </button>
                            {formatFilters.map((formatLabel) => (
                              <button
                                key={formatLabel}
                                onClick={() => setSelectedFormat(formatLabel)}
                                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                                  selectedFormat === formatLabel
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                }`}
                              >
                                {getLocalizedFormatLabel(formatLabel)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t('training.topics')}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {visibleTopicFilters.map((tag) => (
                              <button
                                key={tag}
                                onClick={() => toggleTopicTag(tag)}
                                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                                  selectedTopicTags.includes(tag)
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                }`}
                              >
                                {tag}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {activeFilterCount > 0 && (
                        <Button variant="ghost" className="mt-4 px-0 text-primary" onClick={resetFilters}>
                          {t('training.resetFilters')}
                        </Button>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>

              {!isLoading && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    {t('training.showing')}{' '}
                    <span className="font-semibold text-foreground">{matchingTaskCount}</span>{' '}
                    {t(matchingTaskCount === 1 ? 'training.taskSingular' : 'training.taskPlural')}
                  </span>
                  {!showCuratedSections && matchingReferenceCount > 0 && (
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      {getCountLabel(
                        matchingReferenceCount,
                        'training.referenceSingular',
                        'training.referencePlural'
                      )}
                    </span>
                  )}
                  {selectedTrackDefinition && (
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      {selectedTrackDefinition.label}
                    </span>
                  )}
                  {search.trim().length > 0 && (
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      {t('training.searchPill', { query: search.trim() })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

            {showInternalCatalogQa && (
              <div className="mt-6 rounded-3xl border border-amber/30 bg-amber/10 p-5 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Internal catalog QA</p>
                <div className="mt-2 grid gap-2">
                  <p>Data source: {source === 'supabase' ? 'Supabase catalog' : 'Local fallback content'}</p>
                  {source !== 'supabase' && (
                    <p>
                      Supabase did not return live training rows. If Vimeo uploads already exist,
                      run <code className="rounded bg-background px-1.5 py-0.5">node scripts/sync-vimeo-training-catalog.mjs --dry-run</code>{' '}
                      to audit the catalog sync gap.
                    </p>
                  )}
                  {derivedMappingCount > 0 && (
                    <p>
                      {derivedMappingCount} items are using derived task mapping. Add explicit catalog
                      manifest entries where curation needs to be tighter.
                    </p>
                  )}
                  {missingModuleCount > 0 && (
                    <p>
                      {missingModuleCount} items are missing module labels, so module filtering stays
                      hidden until taxonomy is complete.
                    </p>
                  )}
                </div>
              </div>
            )}

          <section className="mt-8 sm:mt-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {t('training.taskLibrary')}
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-semibold text-foreground sm:text-3xl">
                    {selectedTrackDefinition
                      ? t('training.browseTrack', { track: selectedTrackDefinition.label })
                      : t('training.browseOperatorTasks')}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {selectedTrackDefinition
                      ? t('training.selectedTrackBrowseDescription')
                      : t('training.groupedLibraryDescription')}
                  </p>
                </div>
              </div>

            {isLoading && (
              <div className="mt-8 text-sm text-muted-foreground">{t('training.loadingContent')}</div>
            )}

            {!isLoading &&
              groupedContent.map((trackGroup) => (
                <section key={trackGroup.id} className="mt-6 sm:mt-7">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-display text-2xl font-semibold text-foreground">
                        {trackGroup.label}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {trackGroup.description}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {getCountLabel(
                        trackGroup.items.length,
                        'training.itemSingular',
                        'training.itemPlural'
                      )}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {trackGroup.items.map((item) => renderTrainingCard(item))}
                  </div>
                </section>
              ))}

            {!isLoading && !showCuratedSections && filteredReferenceItems.length > 0 && (
              <section className="mt-6 sm:mt-7">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-display text-2xl font-semibold text-foreground">
                      {t('training.quickAidsManuals')}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('training.supportingReferencesDescription')}
                    </p>
                  </div>
                  <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {getCountLabel(
                      filteredReferenceItems.length,
                      'training.itemSingular',
                      'training.itemPlural'
                    )}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {[...filteredReferenceItems].sort(sortTrainingItems).map((item) => renderTrainingCard(item))}
                </div>
              </section>
            )}

            {!isLoading && matchingTaskCount + matchingReferenceCount === 0 && (
              <div className="mt-8 rounded-3xl border border-border bg-muted/20 px-6 py-10 text-center">
                <p className="text-lg font-semibold text-foreground">{t('training.noMatchesTitle')}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('training.noMatchesDescription')}
                </p>
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => {
                    setSearch('');
                    setSelectedTrack('all');
                    resetFilters();
                  }}
                >
                  {t('training.resetSearchFilters')}
                </Button>
              </div>
            )}
          </section>

          {operatorTrack && (
            <section className="mt-8 grid gap-4 xl:grid-cols-[1.2fr,0.8fr] sm:mt-10">
              <div className="rounded-[24px] border border-border bg-muted/15 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-muted">
                    <Award className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {t('training.optionalCertificate')}
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                      {t('training.operatorEssentialsCompletion')}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t('training.certificateDescription')}
                    </p>
                  </div>
                </div>

                {issuedCertificate ? (
                  <div className="mt-6 rounded-2xl border border-sage/20 bg-background p-5">
                    <p className="font-semibold text-foreground">{issuedCertificate.certificateTitle}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t('training.issuedOn', {
                        date: new Date(issuedCertificate.issuedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        }),
                      })}
                    </p>
                    <Button variant="outline" className="mt-4 w-full sm:w-auto" onClick={handleDownloadCertificate}>
                      {t('training.downloadCertificate')}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mt-6 rounded-2xl border border-border bg-background p-5">
                      <p className="font-semibold text-foreground">
                        {t('training.certificateProgress', {
                          completed: completedRequiredCount,
                          total: requiredTrackItems.length,
                        })}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t('training.certificateProgressDetail')}
                      </p>
                    </div>
                    <label className="mt-5 flex items-start gap-3 rounded-2xl border border-border bg-background p-4">
                      <Checkbox
                        checked={finalAcknowledgement}
                        onCheckedChange={(checked) => setFinalAcknowledgement(Boolean(checked))}
                        className="mt-1"
                      />
                      <span className="text-sm leading-6 text-muted-foreground">
                        {t('training.certificateAcknowledgement')}
                      </span>
                    </label>
                    <Button
                      variant="outline"
                      className="mt-4 w-full sm:w-auto"
                      onClick={handleUnlockCertificate}
                      disabled={
                        completedRequiredCount !== requiredTrackItems.length ||
                        issueCertificateMutation.isPending
                      }
                    >
                      {issueCertificateMutation.isPending
                        ? t('training.unlocking')
                        : t('training.unlockCertificate')}
                    </Button>
                  </>
                )}
              </div>

              <div className="rounded-[24px] border border-border bg-background p-5 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  {t('training.needSpecific')}
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                  {t('training.supportNextSteps')}
                </h2>
                <div className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
                  <p>
                    {t('training.symptomSearchTip')}
                  </p>
                  <p>
                    {t('training.goSupportTip')}
                  </p>
                </div>
                <Button asChild variant="outline" className="mt-6 w-full sm:w-auto">
                  <Link to="/portal/support">{t('training.goToSupport')}</Link>
                </Button>
              </div>
            </section>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
