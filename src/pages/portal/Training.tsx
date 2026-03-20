import { useEffect, useRef, useState } from 'react';
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
import { downloadTrainingCertificateSvg } from '@/lib/trainingCertificate';
import { trackEvent } from '@/lib/analytics';
import {
  getTrainingDisplayTags,
  getTrainingTrackDefinition,
  getTrainingTrackDefinitions,
  stripInternalTrainingTags,
} from '@/lib/trainingCatalog';
import {
  bindTracksToLibrary,
  useIssueTrainingCertificate,
  useTrainingCertificates,
  useTrainingLibrary,
  useTrainingProgress,
  useTrainingSourceStatus,
  useTrainingTracks,
} from '@/lib/trainingRepository';
import type { TrainingContent } from '@/lib/trainingTypes';
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

const getFormatLabel = (item: TrainingContent) => {
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

const getActionLabel = (item: TrainingContent) => {
  if (item.format === 'video') {
    return 'Watch video';
  }

  if (item.format === 'reference') {
    return 'Open manual';
  }

  if (item.format === 'checklist') {
    return 'Open checklist';
  }

  return 'Open guide';
};

const getSearchableText = (content: TrainingContent) =>
  [
    content.title,
    content.description,
    content.summary,
    content.taskCategory,
    content.moduleLabel,
    ...content.tags,
    ...content.searchTerms,
    ...content.resources.map((resource) => resource.title),
    ...content.resources.map((resource) => resource.description),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const sortTrainingItems = (left: TrainingContent, right: TrainingContent) => {
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
  const { user, isMember } = useAuth();
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
  const { data: progress = [] } = useTrainingProgress(user?.id, isMember);
  const { data: certificates = [] } = useTrainingCertificates(user?.id, isMember);
  const { data: source = 'local' } = useTrainingSourceStatus();
  const issueCertificateMutation = useIssueTrainingCertificate();

  useEffect(() => {
    trackEvent('view_training_catalog');
  }, []);

  const hydratedTracks = bindTracksToLibrary(trackDefinitions, library);
  const operatorTrack = hydratedTracks.find((track) => track.slug === 'operator-essentials');
  const progressByTrainingId = new Map(progress.map((item) => [item.trainingId, item]));
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
  const continueLearningItem =
    operatorTrack?.items.find(
      (item) =>
        item.training &&
        progressByTrainingId.get(item.trainingId)?.startedAt &&
        !progressByTrainingId.get(item.trainingId)?.completedAt
    )?.training ??
    operatorTrack?.items.find((item) => item.training && !progressByTrainingId.get(item.trainingId)?.completedAt)
      ?.training;
  const startHereSequence =
    operatorTrack?.items
      .map((item) => item.training)
      .filter((item): item is TrainingContent => Boolean(item))
      .slice(0, 4) ??
    [...library]
      .filter((item) => item.isStartHere)
      .sort(sortTrainingItems)
      .slice(0, 4);
  const recommendedStartingItem = continueLearningItem ?? startHereSequence[0];
  const trackDefinitionsForNavigation = getTrainingTrackDefinitions().filter(
    (track) => track.id !== 'start-here'
  );
  const moduleFilters = [...new Set(library.map((item) => item.moduleLabel).filter(Boolean))]
    .map((item) => String(item))
    .sort((left, right) => getModuleNumber(left) - getModuleNumber(right));
  const supportsModuleFilter =
    moduleFilters.length > 1 && library.every((item) => Boolean(item.moduleLabel));
  const formatFilters = [...new Set(library.map(getFormatLabel))].sort((left, right) =>
    left.localeCompare(right)
  );
  const topicTags = [...new Set(library.flatMap((item) => stripInternalTrainingTags(item.tags)))].sort(
    (left, right) => left.localeCompare(right)
  );
  const visibleTopicFilters = [
    ...topicTags.slice(0, 16),
    ...selectedTopicTags.filter((tag) => !topicTags.slice(0, 16).includes(tag)),
  ];
  const activeFilterCount =
    (selectedModule === 'All modules' ? 0 : 1) +
    (selectedFormat === 'All formats' ? 0 : 1) +
    selectedTopicTags.length;
  const filteredContent = library.filter((content) => {
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
  const libraryResults = filteredContent.filter(
    (item) => !(showCuratedSections && startHereIds.has(item.id))
  );
  const highlightedItems = [...filteredContent]
    .filter((item) => !item.isStartHere && item.featuredOrder !== undefined)
    .sort(sortTrainingItems)
    .slice(0, 4);
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
  const missingModuleCount = library.filter((item) => !item.moduleLabel).length;
  const derivedMappingCount = library.filter((item) => item.catalogSource === 'derived').length;

  useEffect(() => {
    if (!supportsModuleFilter && selectedModule !== 'All modules') {
      setSelectedModule('All modules');
    }
  }, [selectedModule, supportsModuleFilter]);

  const handleOpenItem = (content: TrainingContent) => {
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

  const focusLibraryExplorer = () => {
    setSearch('');
    setSelectedTrack('all');
    resetFilters();
    setAdvancedFiltersOpen(false);

    window.requestAnimationFrame(() => {
      libraryExplorerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => librarySearchRef.current?.focus(), 250);
    });
  };

  const handleUnlockCertificate = async () => {
    if (!operatorTrack) {
      return;
    }

    if (!finalAcknowledgement) {
      toast.error('Confirm the safety acknowledgement before unlocking the certificate.');
      return;
    }

    try {
      await issueCertificateMutation.mutateAsync({
        trackSlug: operatorTrack.slug,
        finalAcknowledgement: true,
      });
      toast.success('Certificate unlocked.');
      trackEvent('training_certificate_unlocked', { track: operatorTrack.slug });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to unlock the certificate.';
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

  const renderTrainingCard = (content: TrainingContent, options?: { showStep?: number }) => {
    const CardIcon =
      content.format === 'video'
        ? Play
        : content.format === 'reference'
          ? BookOpen
          : content.format === 'checklist'
            ? CheckCircle2
            : Wrench;
    const progressRecord = progressByTrainingId.get(content.id);
    const displayTags = getTrainingDisplayTags(content, 2);
    const hasVisualThumbnail =
      content.format === 'video' &&
      Boolean(content.thumbnailUrl) &&
      content.thumbnailUrl !== PLACEHOLDER_THUMBNAIL_URL;

    return (
      <Link
        key={content.id}
        to={`/portal/training/${content.id}`}
        onClick={() => handleOpenItem(content)}
        className="group overflow-hidden rounded-3xl border border-border bg-background transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-sm"
      >
        <div
          className={`relative ${
            options?.showStep ? 'aspect-[1.1/1]' : 'aspect-video'
          } overflow-hidden border-b border-border ${
            hasVisualThumbnail
              ? 'bg-muted'
              : 'bg-gradient-to-br from-cream via-background to-primary/5'
          }`}
        >
          {hasVisualThumbnail && (
            <img
              src={content.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              referrerPolicy="no-referrer"
            />
          )}
          <div
            className={`absolute inset-0 ${
              hasVisualThumbnail
                ? 'bg-gradient-to-t from-black/55 via-black/10 to-black/10'
                : 'bg-gradient-to-br from-transparent via-transparent to-primary/10'
            }`}
          />
          <div className="relative flex h-full flex-col justify-between p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {options?.showStep ? (
                  <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                    Step {options.showStep}
                  </span>
                ) : (
                  <span className="rounded-full bg-background/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                    {getFormatLabel(content)}
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
                  Complete
                </span>
              ) : progressRecord?.startedAt ? (
                <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                  In progress
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

        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
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
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">
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
            {getActionLabel(content)}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>
      </Link>
    );
  };

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="rounded-[32px] border border-primary/10 bg-gradient-to-br from-cream via-background to-primary/5 p-6 sm:p-8">
            <div className="grid gap-8 lg:grid-cols-[1.4fr,0.9fr] lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                  Training Hub
                </p>
                <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-foreground">
                  Find the right training fast.
                </h1>
                <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
                  This hub is organized for operators first. Start with the essentials if you are
                  new, or jump straight to the task you need if you are solving something in the
                  moment.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-full border border-primary/15 bg-background/80 px-4 py-2 text-sm font-medium text-foreground">
                    {library.length} training resources
                  </span>
                  <span className="rounded-full border border-primary/15 bg-background/80 px-4 py-2 text-sm font-medium text-foreground">
                    {library.filter((item) => item.format === 'video').length} videos
                  </span>
                  <span className="rounded-full border border-primary/15 bg-background/80 px-4 py-2 text-sm font-medium text-foreground">
                    {trackDefinitionsForNavigation.length} task paths
                  </span>
                </div>
              </div>

              <div className="rounded-3xl border border-primary/10 bg-background/85 p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Recommended first move
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                  {continueLearningItem ? 'Continue where you left off' : 'Start with operator essentials'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {continueLearningItem
                    ? continueLearningItem.title
                    : 'Follow the essential setup, daily operation, and cleaning steps before digging into repairs.'}
                </p>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${operatorTrackProgressPercent}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {completedRequiredCount}/{requiredTrackItems.length} required essentials complete
                </p>
                {recommendedStartingItem && (
                  <Button asChild className="mt-5 w-full sm:w-auto">
                    <Link to={`/portal/training/${recommendedStartingItem.id}`}>
                      {continueLearningItem ? 'Resume learning' : 'Open start path'}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>

          {startHereSequence.length > 0 && (
            <section className="mt-10">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    Start Here
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">
                    The quickest path for a new operator
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Complete these first to understand setup, safe operation, and the most common
                    recovery steps.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  className="w-fit px-0 text-primary hover:bg-transparent"
                  onClick={focusLibraryExplorer}
                >
                  Explore the full library
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {startHereSequence.map((item, index) => renderTrainingCard(item, { showStep: index + 1 }))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Jump By Task
                </p>
                <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">
                  Go straight to the type of help you need
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Use task paths for the fastest wayfinding. Search is always available when you
                  know the symptom or topic.
                </p>
              </div>
              <Button
                variant={selectedTrack === 'all' ? 'default' : 'outline'}
                onClick={focusLibraryExplorer}
              >
                View all resources
              </Button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {trackDefinitionsForNavigation.map((trackDefinition) => {
                const TrackIcon = trackIconMap[trackDefinition.id] ?? BookOpen;
                const trackItems = library.filter((item) => item.catalogTrackId === trackDefinition.id);
                const isActive = selectedTrack === trackDefinition.id;

                return (
                  <button
                    key={trackDefinition.id}
                    type="button"
                    onClick={() => setSelectedTrack(trackDefinition.id)}
                    className={`rounded-3xl border p-5 text-left transition-all ${
                      isActive
                        ? 'border-primary/30 bg-primary/5 shadow-sm'
                        : 'border-border bg-background hover:border-primary/20 hover:bg-muted/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <TrackIcon className="h-6 w-6" />
                      </div>
                      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {trackItems.length} {trackItems.length === 1 ? 'resource' : 'resources'}
                      </span>
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-foreground">{trackDefinition.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {trackDefinition.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          <section id="training-library-explorer" ref={libraryExplorerRef} className="mt-12">
            <div className="flex flex-col gap-4 rounded-3xl border border-border bg-background p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={librarySearchRef}
                    placeholder="Search by topic, symptom, part, or setting..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="pl-10"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Collapsible open={advancedFiltersOpen} onOpenChange={setAdvancedFiltersOpen}>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline">
                        More filters
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
                              Module
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
                                All modules
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
                            Format
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
                              All formats
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
                                {formatLabel}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            Topics
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
                          Reset filters
                        </Button>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>

              {!isLoading && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    Showing <span className="font-semibold text-foreground">{filteredContent.length}</span>{' '}
                    {filteredContent.length === 1 ? 'result' : 'results'}
                  </span>
                  {selectedTrackDefinition && (
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      {selectedTrackDefinition.label}
                    </span>
                  )}
                  {search.trim().length > 0 && (
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                      Search: {search.trim()}
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>

          {!isLoading && import.meta.env.DEV && (
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

          {showCuratedSections && highlightedItems.length > 0 && (
            <section className="mt-12">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    Featured Tasks
                  </p>
                  <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">
                    Common operator jobs
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    These are the tasks most likely to unblock day-to-day operation quickly.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                {highlightedItems.map((item) => renderTrainingCard(item))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Full Library
                </p>
                <h2 className="mt-2 font-display text-3xl font-semibold text-foreground">
                  {selectedTrackDefinition ? selectedTrackDefinition.label : 'Browse every training resource'}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                  {selectedTrackDefinition
                    ? selectedTrackDefinition.description
                    : 'Everything below is grouped by task so operators can scan quickly without getting lost.'}
                </p>
              </div>
            </div>

            {isLoading && (
              <div className="mt-8 text-sm text-muted-foreground">Loading training content...</div>
            )}

            {!isLoading &&
              groupedContent.map((trackGroup) => (
                <section key={trackGroup.id} className="mt-8">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display text-2xl font-semibold text-foreground">
                        {trackGroup.label}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {trackGroup.description}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {trackGroup.items.length} {trackGroup.items.length === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {trackGroup.items.map((item) => renderTrainingCard(item))}
                  </div>
                </section>
              ))}

            {!isLoading && filteredContent.length === 0 && (
              <div className="mt-8 rounded-3xl border border-border bg-muted/20 px-6 py-10 text-center">
                <p className="text-lg font-semibold text-foreground">No training matches this view.</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Try a simpler search, switch task paths, or clear the advanced filters to broaden
                  the results.
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
                  Reset search and filters
                </Button>
              </div>
            )}
          </section>

          {operatorTrack && (
            <section className="mt-12 grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
              <div className="rounded-3xl border border-border bg-background p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber/15">
                    <Award className="h-6 w-6 text-amber" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber">
                      Optional certificate
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                      Operator Essentials completion
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Certification stays secondary to learning. Use it only after the required
                      essentials are complete and the safety acknowledgement has been reviewed.
                    </p>
                  </div>
                </div>

                {issuedCertificate ? (
                  <div className="mt-6 rounded-2xl border border-sage/30 bg-sage-light/40 p-5">
                    <p className="font-semibold text-foreground">{issuedCertificate.certificateTitle}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Issued on{' '}
                      {new Date(issuedCertificate.issuedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                      .
                    </p>
                    <Button className="mt-4" onClick={handleDownloadCertificate}>
                      Download certificate
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mt-6 rounded-2xl border border-border bg-muted/30 p-5">
                      <p className="font-semibold text-foreground">
                        Progress: {completedRequiredCount}/{requiredTrackItems.length} required complete
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Finish the required essentials first, then confirm the acknowledgement to unlock the certificate.
                      </p>
                    </div>
                    <label className="mt-5 flex items-start gap-3 rounded-2xl border border-border p-4">
                      <Checkbox
                        checked={finalAcknowledgement}
                        onCheckedChange={(checked) => setFinalAcknowledgement(Boolean(checked))}
                        className="mt-1"
                      />
                      <span className="text-sm leading-6 text-muted-foreground">
                        I reviewed the safety, startup, cleaning, and escalation guidance and will
                        use the documented shutdown and support steps.
                      </span>
                    </label>
                    <Button
                      className="mt-4"
                      onClick={handleUnlockCertificate}
                      disabled={
                        completedRequiredCount !== requiredTrackItems.length ||
                        issueCertificateMutation.isPending
                      }
                    >
                      {issueCertificateMutation.isPending ? 'Unlocking...' : 'Unlock certificate'}
                    </Button>
                  </>
                )}
              </div>

              <div className="rounded-3xl border border-border bg-background p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Need something specific?
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                  Support and next steps
                </h2>
                <div className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
                  <p>
                    If you know the symptom, use search with terms like burner, sensor, payment,
                    timer, or stick.
                  </p>
                  <p>
                    If the resource still is not obvious, go straight to support so the team can
                    point operators to the right module or guide.
                  </p>
                </div>
                <Button asChild variant="outline" className="mt-6">
                  <Link to="/portal/support">Go to support</Link>
                </Button>
              </div>
            </section>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
