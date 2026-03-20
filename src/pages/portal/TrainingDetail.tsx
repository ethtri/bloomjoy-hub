import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
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
import {
  useSaveTrainingProgress,
  useTrainingLibrary,
  useTrainingProgress,
} from '@/lib/trainingRepository';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function TrainingDetailPage() {
  const { id } = useParams();
  const { user, isMember } = useAuth();
  const { data: library = [] } = useTrainingLibrary();
  const { data: progress = [] } = useTrainingProgress(Boolean(user?.id && isMember));
  const saveProgressMutation = useSaveTrainingProgress();
  const trainingItem = id ? library.find((item) => item.id === id) : undefined;
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoLoadStartedAt, setVideoLoadStartedAt] = useState<number | null>(null);
  const hasTrackedStart = useRef(false);

  const progressRecord = trainingItem
    ? progress.find((entry) => entry.trainingId === trainingItem.id)
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
    if (!trainingItem || !isMember || hasTrackedStart.current) {
      return;
    }

    hasTrackedStart.current = true;
    void saveProgressMutation.mutateAsync({
      trainingId: trainingItem.id,
      markComplete: false,
      completionSource: 'detail_view',
    });
  }, [isMember, saveProgressMutation, trainingItem]);

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
  const related = library
    .filter((item) => item.id !== trainingItem.id)
    .sort((left, right) => {
      if (left.taskCategory === trainingItem.taskCategory && right.taskCategory !== trainingItem.taskCategory) {
        return -1;
      }

      if (right.taskCategory === trainingItem.taskCategory && left.taskCategory !== trainingItem.taskCategory) {
        return 1;
      }

      return left.title.localeCompare(right.title);
    })
    .slice(0, 3);

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
    try {
      await saveProgressMutation.mutateAsync({
        trainingId: trainingItem.id,
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

  return (
    <PortalLayout>
      <section className="section-padding">
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
                {trainingItem.tags.map((tag) => (
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
                <div className="relative mt-6 overflow-hidden rounded-2xl border border-border bg-background">
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
                        Document guide
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

              <div className="mt-8 grid gap-6 md:grid-cols-2">
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

              {trainingItem.document && (
                <div className="mt-8 card-elevated p-6" data-guide-details="true">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-semibold text-foreground">
                        Guide details
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
                      </section>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-8 card-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">Job aids and links</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open these references when you need the next procedure, a companion guide, or support escalation.
                </p>
                {trainingItem.resources.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No job aids are attached yet. Resources will be added as this module expands.
                  </p>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {trainingItem.resources.map((resource) => (
                      <div key={resource.title} className="rounded-xl border border-border p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <FileText className="h-4 w-4 text-primary" />
                          {resource.title}
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {resource.description}
                        </p>
                        <div className="mt-4">
                          {resource.linkedTrainingId ? (
                            <Button asChild size="sm" variant="outline">
                              <Link
                                to={`/portal/training/${resource.linkedTrainingId}`}
                                onClick={() => handleResourceOpen(resource.title)}
                              >
                                {resource.actionLabel ?? 'Open guide'}
                              </Link>
                            </Button>
                          ) : resource.href?.startsWith('/') ? (
                            <Button asChild size="sm" variant="outline">
                              <Link to={resource.href} onClick={() => handleResourceOpen(resource.title)}>
                                {resource.actionLabel ?? 'Open'}
                              </Link>
                            </Button>
                          ) : resource.href ? (
                            <Button asChild size="sm" variant="outline">
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
                          ) : trainingItem.document ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                document
                                  .querySelector('[data-guide-details="true"]')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                handleResourceOpen(resource.title);
                              }}
                            >
                              {resource.actionLabel ?? 'Open guide'}
                            </Button>
                          ) : (
                            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                              {resource.status === 'available' ? 'Available' : 'Coming soon'}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-6">
              <div className="card-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Training status
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">{trainingItem.summary}</p>
                <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
                  {isCompleted ? (
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
