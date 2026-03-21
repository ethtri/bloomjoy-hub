import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  FileText,
  HelpCircle,
  Loader2,
  PlayCircle,
} from 'lucide-react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { getTrainingDisplayTags } from '@/lib/trainingCatalog';
import {
  buildTrainingExperience,
  getTrainingProgressWriteIds,
  mapTrainingProgressToCanonical,
  resolveTrainingExperienceItem,
  useSaveTrainingProgress,
  useTrainingLibrary,
  useTrainingProgress,
} from '@/lib/trainingRepository';
import { useAuth } from '@/contexts/AuthContext';
import type { TrainingExperienceItem, TrainingResource } from '@/lib/trainingTypes';
import { toast } from 'sonner';

const getResourceIcon = (resource: TrainingResource) => {
  if (resource.kind === 'video') {
    return PlayCircle;
  }

  if (resource.kind === 'support') {
    return HelpCircle;
  }

  return FileText;
};

const getResourceLabel = (resource: TrainingResource) => {
  if (resource.formatBadge) {
    return resource.formatBadge;
  }

  if (resource.kind === 'video') {
    return 'Video';
  }

  if (resource.kind === 'support') {
    return 'Support';
  }

  if (resource.kind === 'download') {
    return 'PDF';
  }

  return 'Guide';
};

const getCompanionLabel = (item: TrainingExperienceItem) => {
  if (item.surface === 'manual') {
    return 'Reference manual';
  }

  if (item.surface === 'quick-aid') {
    return 'Quick aid';
  }

  if (item.format === 'mixed') {
    return 'Task + guide';
  }

  return 'Task';
};

export default function TrainingDetailPage() {
  const { id } = useParams();
  const { user, isMember } = useAuth();
  const { data: library = [] } = useTrainingLibrary();
  const { data: progress = [] } = useTrainingProgress(user?.id, isMember);
  const saveProgressMutation = useSaveTrainingProgress();
  const trainingExperience = useMemo(() => buildTrainingExperience(library), [library]);
  const canonicalProgress = useMemo(
    () => mapTrainingProgressToCanonical(progress, trainingExperience),
    [progress, trainingExperience]
  );
  const resolution = useMemo(
    () => resolveTrainingExperienceItem(trainingExperience, library, id),
    [trainingExperience, library, id]
  );
  const trainingItem = resolution.item;
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoLoadStartedAt, setVideoLoadStartedAt] = useState<number | null>(null);
  const hasTrackedStart = useRef(false);

  const progressRecord = trainingItem
    ? canonicalProgress.find((entry) => entry.trainingId === trainingItem.id)
    : undefined;
  const isCompleted = Boolean(progressRecord?.completedAt);

  useEffect(() => {
    hasTrackedStart.current = false;
  }, [trainingItem?.id]);

  useEffect(() => {
    if (trainingItem) {
      trackEvent('view_training_detail', { id: trainingItem.id, title: trainingItem.title });
    }
  }, [trainingItem]);

  useEffect(() => {
    if (!trainingItem?.embed.url) {
      setVideoLoaded(true);
      setVideoLoadStartedAt(null);
      return;
    }

    setVideoLoaded(false);
    setVideoLoadStartedAt(typeof performance !== 'undefined' ? performance.now() : Date.now());
  }, [trainingItem?.id, trainingItem?.embed.url]);

  useEffect(() => {
    if (!trainingItem || trainingItem.surface !== 'task' || !isMember || hasTrackedStart.current) {
      return;
    }

    hasTrackedStart.current = true;
    void saveProgressMutation.mutateAsync({
      trainingId: trainingItem.id,
      trainingIds: getTrainingProgressWriteIds(trainingItem),
      markComplete: false,
      completionSource: 'detail_view',
    });
  }, [isMember, saveProgressMutation, trainingItem]);

  if (resolution.redirectToId && resolution.redirectToId !== id) {
    const redirectHash = resolution.redirectAnchor ? `#${resolution.redirectAnchor}` : '';
    return <Navigate to={`/portal/training/${resolution.redirectToId}${redirectHash}`} replace />;
  }

  if (!trainingItem) {
    return (
      <PortalLayout>
        <section className="section-padding">
          <div className="container-page">
            <div className="card-elevated p-8 text-center">
              <h1 className="font-display text-2xl font-semibold text-foreground">
                Training item not found
              </h1>
              <p className="mt-2 text-muted-foreground">
                Head back to the training hub to choose another guide or module.
              </p>
              <Button asChild className="mt-6">
                <Link to="/portal/training">Back to training</Link>
              </Button>
            </div>
          </div>
        </section>
      </PortalLayout>
    );
  }

  const learningPoints = trainingItem.learningPoints.filter((point) => point.trim().length > 0);
  const checklistItems = trainingItem.checklist.filter((item) => item.trim().length > 0);
  const detailTags = getTrainingDisplayTags(trainingItem, 6);
  const related = trainingExperience.tasks
    .filter((item) => item.id !== trainingItem.id)
    .sort((left, right) => {
      if (left.taskCategory === trainingItem.taskCategory && right.taskCategory !== trainingItem.taskCategory) {
        return -1;
      }

      if (right.taskCategory === trainingItem.taskCategory && left.taskCategory !== trainingItem.taskCategory) {
        return 1;
      }

      const leftPriority = left.operatorPriority ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = right.operatorPriority ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, 3);
  const companionItems = [
    ...trainingItem.quickAidIds
      .map((companionId) => trainingExperience.byId.get(companionId))
      .filter((item): item is TrainingExperienceItem => Boolean(item)),
    ...trainingItem.manualIds
      .map((companionId) => trainingExperience.byId.get(companionId))
      .filter((item): item is TrainingExperienceItem => Boolean(item)),
  ];
  const [primaryCompanion, ...secondaryCompanions] = companionItems;
  const [primaryResource, ...secondaryResources] = trainingItem.resources;
  const detailSectionTitle =
    trainingItem.surface === 'manual'
      ? 'Reference details'
      : trainingItem.surface === 'quick-aid'
        ? 'Quick aid details'
        : 'Written essentials';

  const handleVideoLoad = () => {
    setVideoLoaded(true);

    if (!videoLoadStartedAt) {
      return;
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const startupMs = Math.max(0, Math.round(now - videoLoadStartedAt));
    trackEvent('training_video_iframe_loaded', {
      id: trainingItem.id,
      startup_ms: startupMs,
    });
  };

  const handleMarkComplete = async () => {
    if (trainingItem.surface !== 'task') {
      return;
    }

    try {
      await saveProgressMutation.mutateAsync({
        trainingId: trainingItem.id,
        trainingIds: getTrainingProgressWriteIds(trainingItem),
        markComplete: true,
        completionSource: 'detail_complete',
      });
      toast.success('Training marked complete.');
      trackEvent('training_mark_completed', { id: trainingItem.id, title: trainingItem.title });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save training progress.';
      toast.error(message);
    }
  };

  const handleResourceOpen = (resourceTitle: string) => {
    trackEvent('training_resource_opened', {
      id: trainingItem.id,
      title: trainingItem.title,
      resource_title: resourceTitle,
    });
  };

  const renderResourceAction = (
    resource: TrainingResource,
    options?: { emphasize?: boolean }
  ) => {
    const className = options?.emphasize ? 'w-full sm:w-auto' : undefined;

    if (resource.linkedTrainingId) {
      return (
        <Button asChild size={options?.emphasize ? 'default' : 'sm'} variant="outline" className={className}>
          <Link
            to={`/portal/training/${resource.linkedTrainingId}`}
            onClick={() => handleResourceOpen(resource.title)}
          >
            {resource.actionLabel ?? 'Open guide'}
          </Link>
        </Button>
      );
    }

    if (resource.href?.startsWith('/')) {
      return (
        <Button asChild size={options?.emphasize ? 'default' : 'sm'} variant="outline" className={className}>
          <Link to={resource.href} onClick={() => handleResourceOpen(resource.title)}>
            {resource.actionLabel ?? 'Open'}
          </Link>
        </Button>
      );
    }

    if (resource.href) {
      return (
        <Button asChild size={options?.emphasize ? 'default' : 'sm'} variant="outline" className={className}>
          <a
            href={resource.href}
            target={resource.external ? '_blank' : undefined}
            rel={resource.external ? 'noreferrer' : undefined}
            onClick={() => handleResourceOpen(resource.title)}
          >
            {resource.actionLabel ?? 'Open'}
            {resource.external && <ExternalLink className="ml-2 h-4 w-4" />}
          </a>
        </Button>
      );
    }

    if (resource.kind === 'guide' && trainingItem.document) {
      return (
        <Button
          size={options?.emphasize ? 'default' : 'sm'}
          variant="outline"
          className={className}
          onClick={() => {
            document
              .querySelector('[data-guide-details="true"]')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            handleResourceOpen(resource.title);
          }}
        >
          {resource.actionLabel ?? 'Open guide'}
        </Button>
      );
    }

    return (
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {resource.status === 'available' ? 'Available' : 'Coming soon'}
      </p>
    );
  };

  const renderResourceCard = (resource: TrainingResource) => {
    const ResourceIcon = getResourceIcon(resource);

    return (
      <div key={resource.title} className="rounded-2xl border border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ResourceIcon className="h-4 w-4" />
            </div>
            <span>{resource.title}</span>
          </div>
          <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {getResourceLabel(resource)}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{resource.description}</p>
        <div className="mt-4">{renderResourceAction(resource)}</div>
      </div>
    );
  };

  const renderCompanionCard = (item: TrainingExperienceItem) => (
    <Link
      key={item.id}
      to={`/portal/training/${item.id}`}
      className="block rounded-2xl border border-border p-4 transition hover:border-primary/30 hover:bg-muted/30"
      onClick={() => handleResourceOpen(item.title)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            {getCompanionLabel(item)}
          </p>
          <h3 className="mt-2 font-semibold text-foreground">{item.title}</h3>
        </div>
        <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {item.duration}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary">
        {item.surface === 'manual' ? 'Open manual' : 'Open'}
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );

  return (
    <PortalLayout>
      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <Link
            to="/portal/training"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to training
          </Link>

          <div className="mt-6 grid gap-8 lg:grid-cols-[2fr,1fr]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{trainingItem.taskCategory}</Badge>
                {trainingItem.moduleLabel && <Badge variant="secondary">{trainingItem.moduleLabel}</Badge>}
                {detailTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
                <Badge variant="outline">{trainingItem.level}</Badge>
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {trainingItem.duration}
                </span>
              </div>

              <h1 className="mt-4 font-display text-3xl font-bold text-foreground">
                {trainingItem.title}
              </h1>
              <p className="mt-2 text-muted-foreground">{trainingItem.description}</p>

              {trainingItem.embed.url ? (
                <div
                  id="walkthrough"
                  className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-background"
                >
                  {!videoLoaded && (
                    <div className="absolute inset-0 z-10 flex aspect-video items-center justify-center bg-muted/70">
                      <div
                        className="rounded-xl border border-border bg-background/95 px-4 py-3 text-center"
                        role="status"
                        aria-live="polite"
                      >
                        <div className="flex items-center justify-center gap-2 text-sm font-medium text-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading training video
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Player startup can take a few seconds.
                        </p>
                      </div>
                    </div>
                  )}
                  <iframe
                    title={trainingItem.embed.title}
                    className={`aspect-video w-full transition-opacity duration-300 ${
                      videoLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                    src={trainingItem.embed.url}
                    allow="autoplay; fullscreen; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    loading="eager"
                    onLoad={handleVideoLoad}
                  />
                </div>
              ) : trainingItem.document ? (
                <div className="mt-6 rounded-2xl border border-border bg-background p-6">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                        {trainingItem.surface === 'manual'
                          ? 'Reference manual'
                          : trainingItem.surface === 'quick-aid'
                            ? 'Quick aid'
                            : 'Task guide'}
                      </p>
                      <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
                        {trainingItem.document.title}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {trainingItem.document.intro}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <iframe
                  title={trainingItem.embed.title}
                  className="mt-6 aspect-video w-full rounded-2xl border border-border"
                  srcDoc={trainingItem.embed.srcDoc}
                  sandbox="allow-same-origin"
                />
              )}

              {trainingItem.document && (
                <div
                  id="written-essentials"
                  className="mt-6 card-elevated p-5 sm:p-6"
                  data-guide-details="true"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-semibold text-foreground">
                        {detailSectionTitle}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Source: {trainingItem.document.sourceLabel ?? 'Bloomjoy training guide'}
                        {trainingItem.document.estimatedReadMinutes
                          ? ` | ${trainingItem.document.estimatedReadMinutes} min read`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 space-y-6">
                    {trainingItem.document.sections.map((section) => (
                      <section key={section.heading}>
                        <h3 className="font-semibold text-foreground">{section.heading}</h3>
                        {section.paragraphs?.map((paragraph) => (
                          <p key={paragraph} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {paragraph}
                          </p>
                        ))}
                        {section.bullets && (
                          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                            {section.bullets.map((bullet) => (
                              <li key={bullet} className="flex items-start gap-2">
                                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {section.visual && (
                          <figure className="mt-4 overflow-hidden rounded-2xl border border-border bg-muted/20 p-3">
                            <img
                              src={section.visual.src}
                              alt={section.visual.alt}
                              loading="lazy"
                              className="w-full rounded-xl object-contain"
                            />
                            {section.visual.caption && (
                              <figcaption className="mt-3 text-xs leading-5 text-muted-foreground">
                                {section.visual.caption}
                              </figcaption>
                            )}
                          </figure>
                        )}
                      </section>
                    ))}
                  </div>
                </div>
              )}

              {(primaryCompanion || (!primaryCompanion && primaryResource)) && (
                <div className="mt-6 rounded-[28px] border border-primary/10 bg-primary/5 p-5 sm:p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    Use this next
                  </p>
                  {primaryCompanion ? (
                    <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {getCompanionLabel(primaryCompanion)}
                          </span>
                          <span className="rounded-full bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            Supporting reference
                          </span>
                        </div>
                        <h2 className="mt-3 font-display text-2xl font-semibold text-foreground">
                          {primaryCompanion.title}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {primaryCompanion.description}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <Button asChild className="w-full sm:w-auto">
                          <Link
                            to={`/portal/training/${primaryCompanion.id}`}
                            onClick={() => handleResourceOpen(primaryCompanion.title)}
                          >
                            {primaryCompanion.surface === 'manual' ? 'Open manual' : 'Open quick aid'}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ) : primaryResource ? (
                    <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                            {getResourceLabel(primaryResource)}
                          </span>
                        </div>
                        <h2 className="mt-3 font-display text-2xl font-semibold text-foreground">
                          {primaryResource.title}
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {primaryResource.description}
                        </p>
                      </div>
                      <div className="shrink-0">{renderResourceAction(primaryResource, { emphasize: true })}</div>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <div className="card-elevated p-6">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    After this training, you should be able to
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Use these outcomes to confirm the key concepts are clear.
                  </p>
                  {learningPoints.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      Learning outcomes will be added with the next content update.
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                      {learningPoints.map((point) => (
                        <li key={point} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="card-elevated p-6">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    Do this after reviewing
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Complete these action items to apply the procedure on your machine.
                  </p>
                  {checklistItems.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      Checklist steps will be added as this module is finalized.
                    </p>
                  ) : (
                    <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                      {checklistItems.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-sage" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {(secondaryCompanions.length > 0 || secondaryResources.length > 0 || (primaryCompanion && primaryResource)) && (
                <div className="mt-6 card-elevated p-5 sm:p-6">
                  <h2 className="font-display text-lg font-semibold text-foreground">Keep these nearby</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Use these quick aids, manuals, and follow-up links when you need the next step.
                  </p>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {secondaryCompanions.map((item) => renderCompanionCard(item))}
                    {primaryCompanion && primaryResource && renderResourceCard(primaryResource)}
                    {secondaryResources.map((resource) => renderResourceCard(resource))}
                  </div>
                </div>
              )}

              {companionItems.length === 0 && trainingItem.resources.length === 0 && (
                <div className="mt-6 card-elevated p-5 sm:p-6">
                  <h2 className="font-display text-lg font-semibold text-foreground">Job aids and links</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Open these references when you need the next procedure, a companion guide, or support escalation.
                  </p>
                  <p className="mt-3 text-sm text-muted-foreground">
                    No job aids are attached yet. Resources will be added as this module expands.
                  </p>
                </div>
              )}
            </div>

            <aside className="space-y-6">
              <div className="card-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  {trainingItem.surface === 'task' ? 'Training status' : 'Reference status'}
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">{trainingItem.summary}</p>
                <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
                  {trainingItem.surface !== 'task' ? (
                    <span className="text-muted-foreground">Supporting reference</span>
                  ) : isCompleted ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-sage">
                      <CheckCircle2 className="h-4 w-4" />
                      Completed
                    </span>
                  ) : progressRecord?.startedAt ? (
                    <span className="inline-flex items-center gap-2 font-semibold text-primary">
                      <PlayCircle className="h-4 w-4" />
                      In progress
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not started</span>
                  )}
                </div>
                {trainingItem.surface === 'task' ? (
                  <Button
                    className="mt-6 w-full"
                    onClick={handleMarkComplete}
                    disabled={isCompleted || saveProgressMutation.isPending}
                  >
                    {isCompleted
                      ? 'Completed'
                      : saveProgressMutation.isPending
                        ? 'Saving...'
                        : 'Mark complete'}
                  </Button>
                ) : null}
              </div>

              <div className="card-elevated p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sage-light">
                    <HelpCircle className="h-5 w-5 text-sage" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-semibold text-foreground">
                      Need help?
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Reach the concierge team or manufacturer support if you get stuck.
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" className="mt-4 w-full">
                  <Link to="/portal/support">Go to support</Link>
                </Button>
              </div>

              <div className="card-elevated p-6">
                <h3 className="font-display text-base font-semibold text-foreground">
                  Related training
                </h3>
                <div className="mt-4 space-y-3">
                  {related.map((item) => (
                    <Link
                      key={item.id}
                      to={`/portal/training/${item.id}`}
                      className="block rounded-lg border border-border p-3 text-sm text-foreground transition hover:border-primary/30 hover:bg-muted/40"
                    >
                      <div className="font-semibold">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {item.taskCategory} | {item.duration}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
