import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, CheckCircle2, Clock, FileText, Play, Search, Wrench } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { useAuth } from '@/contexts/AuthContext';
import { downloadTrainingCertificateSvg } from '@/lib/trainingCertificate';
import { trackEvent } from '@/lib/analytics';
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
import { getTrainingTags } from '@/data/trainingContent';
import { toast } from 'sonner';

const MODULE_TAG_PATTERN = /^module\s+(\d+)$/i;
const TASK_PREFIX = 'Task: ';
const FORMAT_PREFIX = 'Format: ';
const AUDIENCE_PREFIX = 'Audience: ';

const normalizeModuleTag = (tag: string) => {
  const trimmed = tag.trim();
  const match = trimmed.match(MODULE_TAG_PATTERN);
  if (!match) {
    return trimmed;
  }

  return `Module ${match[1]}`;
};

const getModuleNumber = (tag: string) => {
  const match = tag.match(MODULE_TAG_PATTERN);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Number.parseInt(match[1], 10);
};

const extractModuleTag = (tags: string[]) => {
  const moduleTag = tags.find((tag) => MODULE_TAG_PATTERN.test(tag.trim()));
  return moduleTag ? normalizeModuleTag(moduleTag) : undefined;
};

const extractPrefixedTags = (tags: string[], prefix: string) =>
  tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length).trim())
    .filter((tag) => tag.length > 0);

const getTaskCategories = (item: TrainingContent) => {
  const taskTags = extractPrefixedTags(item.tags, TASK_PREFIX);
  return taskTags.length > 0 ? taskTags : [item.taskCategory];
};

const getFormatLabel = (item: TrainingContent) => {
  const formatTag = extractPrefixedTags(item.tags, FORMAT_PREFIX)[0];
  if (formatTag) {
    return formatTag;
  }

  switch (item.format) {
    case 'video':
      return 'Video';
    case 'checklist':
      return 'Checklist';
    case 'reference':
      return 'Reference';
    default:
      return 'Guide';
  }
};

const getTopicTags = (items: TrainingContent[]) =>
  getTrainingTags(items)
    .filter(
      (tag) =>
        !MODULE_TAG_PATTERN.test(tag.trim()) &&
        !tag.startsWith(TASK_PREFIX) &&
        !tag.startsWith(FORMAT_PREFIX) &&
        !tag.startsWith(AUDIENCE_PREFIX)
    )
    .sort((left, right) => left.localeCompare(right));

const getCardActionLabel = (item: TrainingContent) =>
  item.format === 'video' ? 'Watch video' : item.format === 'reference' ? 'Open manual' : 'Open guide';

const getCardIcon = (item: TrainingContent) => {
  if (item.format === 'video') {
    return Play;
  }

  if (item.format === 'checklist') {
    return CheckCircle2;
  }

  if (item.format === 'reference') {
    return Wrench;
  }

  return FileText;
};

export default function TrainingPage() {
  const { user, isMember } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedTopicTags, setSelectedTopicTags] = useState<string[]>([]);
  const [selectedModule, setSelectedModule] = useState<string>('All modules');
  const [selectedTask, setSelectedTask] = useState<string>('All tasks');
  const [selectedFormat, setSelectedFormat] = useState<string>('All formats');
  const [finalAcknowledgement, setFinalAcknowledgement] = useState(false);
  const { data: library = [], isLoading } = useTrainingLibrary();
  const { data: trackDefinitions = [] } = useTrainingTracks();
  const { data: progress = [] } = useTrainingProgress(Boolean(user?.id && isMember));
  const { data: certificates = [] } = useTrainingCertificates(Boolean(user?.id && isMember));
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
  const startHereItems = library.filter((item) => item.taskCategory === 'Start Here').slice(0, 3);

  const moduleFilters = [...new Set(library.map((item) => extractModuleTag(item.tags)).filter(Boolean))]
    .map((tag) => String(tag))
    .sort((left, right) => getModuleNumber(left) - getModuleNumber(right));
  const taskFilters = [...new Set(library.flatMap(getTaskCategories))].sort((left, right) =>
    left.localeCompare(right)
  );
  const formatFilters = [...new Set(library.map(getFormatLabel))].sort((left, right) =>
    left.localeCompare(right)
  );
  const topicTags = getTopicTags(library);

  const filteredContent = library.filter((content) => {
    const haystack = [
      content.title,
      content.description,
      content.summary,
      ...content.tags,
      ...content.searchTerms,
      ...content.resources.map((resource) => resource.title),
      ...content.resources.map((resource) => resource.description),
    ]
      .join(' ')
      .toLowerCase();
    const matchesSearch = haystack.includes(search.trim().toLowerCase());
    const contentModuleTag = extractModuleTag(content.tags);
    const matchesModule = selectedModule === 'All modules' || contentModuleTag === selectedModule;
    const matchesTask =
      selectedTask === 'All tasks' || getTaskCategories(content).includes(selectedTask);
    const matchesFormat = selectedFormat === 'All formats' || getFormatLabel(content) === selectedFormat;
    const matchesTags =
      selectedTopicTags.length === 0 ||
      selectedTopicTags.some((tag) => content.tags.includes(tag));

    return matchesSearch && matchesModule && matchesTask && matchesFormat && matchesTags;
  });

  const showStartHereSection =
    search.trim().length === 0 &&
    selectedModule === 'All modules' &&
    selectedTask === 'All tasks' &&
    selectedFormat === 'All formats' &&
    selectedTopicTags.length === 0;

  const groupedContent = filteredContent
    .filter((item) => !showStartHereSection || item.taskCategory !== 'Start Here')
    .reduce<Record<string, TrainingContent[]>>((accumulator, item) => {
      const key = item.taskCategory;
      if (!accumulator[key]) {
        accumulator[key] = [];
      }

      accumulator[key].push(item);
      return accumulator;
    }, {});

  const groupedEntries = Object.entries(groupedContent).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  const handleOpenItem = (content: TrainingContent) => {
    trackEvent('open_training_item', { id: content.id, title: content.title, format: content.format });
  };

  const toggleTopicTag = (tag: string) => {
    setSelectedTopicTags((current) =>
      current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]
    );
  };

  const handleUnlockCertificate = async () => {
    if (!operatorTrack) {
      return;
    }

    if (!finalAcknowledgement) {
      toast.error('Confirm the final safety acknowledgement before unlocking the certificate.');
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

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground">Training Hub</h1>
              <p className="mt-1 max-w-3xl text-muted-foreground">
                Find the exact video, checklist, or reference guide you need for setup, daily
                operation, cleaning, and troubleshooting.
              </p>
            </div>
            {continueLearningItem && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Continue learning
                </p>
                <p className="mt-1 font-semibold text-foreground">{continueLearningItem.title}</p>
                <Link
                  to={`/portal/training/${continueLearningItem.id}`}
                  className="mt-3 inline-flex items-center text-sm font-medium text-primary hover:underline"
                >
                  Resume module
                </Link>
              </div>
            )}
          </div>

          {operatorTrack && (
            <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr,1fr]">
              <div className="card-elevated p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                      Start Here
                    </p>
                    <h2 className="mt-2 font-display text-2xl font-semibold text-foreground">
                      {operatorTrack.title}
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                      {operatorTrack.description}
                    </p>
                  </div>
                  <div className="rounded-full bg-sage-light px-4 py-2 text-sm font-semibold text-sage">
                    {completedRequiredCount}/{requiredTrackItems.length} required complete
                  </div>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${operatorTrackProgressPercent}%` }}
                  />
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {operatorTrack.items.slice(0, 4).map((item) =>
                    item.training ? (
                      <Link
                        key={item.trainingId}
                        to={`/portal/training/${item.training.id}`}
                        className="rounded-xl border border-border p-4 transition hover:border-primary/30 hover:bg-muted/30"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-foreground">{item.training.title}</span>
                          {progressByTrainingId.get(item.trainingId)?.completedAt ? (
                            <span className="rounded-full bg-sage-light px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sage">
                              Complete
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">{item.training.description}</p>
                      </Link>
                    ) : null
                  )}
                </div>
              </div>

              <div className="card-elevated p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber/15">
                    <Award className="h-5 w-5 text-amber" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      Operator Certificate
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Unlock the lightweight completion certificate after every required Operator
                      Essentials item is complete.
                    </p>
                  </div>
                </div>

                {issuedCertificate ? (
                  <div className="mt-6 rounded-xl border border-sage/30 bg-sage-light/50 p-4">
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
                    <Button className="mt-4 w-full" onClick={handleDownloadCertificate}>
                      Download certificate
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm font-semibold text-foreground">
                        Ready to unlock: {completedRequiredCount === requiredTrackItems.length ? 'Yes' : 'Not yet'}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Complete all required Operator Essentials items, then confirm the final
                        acknowledgement below.
                      </p>
                    </div>
                    <label className="mt-5 flex items-start gap-3 rounded-xl border border-border p-4">
                      <Checkbox
                        checked={finalAcknowledgement}
                        onCheckedChange={(checked) => setFinalAcknowledgement(Boolean(checked))}
                        className="mt-1"
                      />
                      <span className="text-sm text-muted-foreground">
                        I confirm that I reviewed the safety, startup, cleaning, and troubleshooting
                        guidance and will use the documented shutdown and escalation steps.
                      </span>
                    </label>
                    <Button
                      className="mt-4 w-full"
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
            </div>
          )}

          {showStartHereSection && startHereItems.length > 0 && (
            <section className="mt-10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-foreground">Start Here</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Quick entry points for the most common first-week operator tasks.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {startHereItems.map((item) => {
                  const Icon = getCardIcon(item);
                  return (
                    <Link
                      key={item.id}
                      to={`/portal/training/${item.id}`}
                      onClick={() => handleOpenItem(item)}
                      className="rounded-2xl border border-border bg-background p-5 transition hover:-translate-y-0.5 hover:border-primary/30"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <h3 className="mt-4 font-semibold text-foreground">{item.title}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                      <div className="mt-4 inline-flex items-center text-sm font-medium text-primary">
                        {getCardActionLabel(item)}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <div className="mt-10 flex flex-col gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search training by task, symptom, or setting..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Filter by task
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => setSelectedTask('All tasks')}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    selectedTask === 'All tasks'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  All tasks
                </button>
                {taskFilters.map((taskLabel) => (
                  <button
                    key={taskLabel}
                    onClick={() => setSelectedTask(taskLabel)}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      selectedTask === taskLabel
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {taskLabel}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Filter by format
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
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
                Filter by module
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
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
                {moduleFilters.map((moduleTag) => (
                  <button
                    key={moduleTag}
                    onClick={() => setSelectedModule(moduleTag)}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                      selectedModule === moduleTag
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {moduleTag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Topics
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {topicTags.map((tag) => (
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

          {isLoading && (
            <div className="mt-8 text-sm text-muted-foreground">Loading training content...</div>
          )}

          {!isLoading && import.meta.env.DEV && (
            <div className="mt-8 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Data source: {source === 'supabase' ? 'Supabase' : 'Local fallback'}
            </div>
          )}

          {!isLoading &&
            groupedEntries.map(([groupName, items]) => (
              <section key={groupName} className="mt-8">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-foreground">
                      {groupName}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {items.length} {items.length === 1 ? 'resource' : 'resources'} matched.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((content) => {
                    const Icon = getCardIcon(content);
                    const progressRecord = progressByTrainingId.get(content.id);

                    return (
                      <Link
                        key={content.id}
                        to={`/portal/training/${content.id}`}
                        onClick={() => handleOpenItem(content)}
                        className="group card-elevated overflow-hidden transition-all hover:-translate-y-0.5"
                      >
                        <div className="relative aspect-video overflow-hidden bg-muted">
                          {content.thumbnailUrl && (
                            <img
                              src={content.thumbnailUrl}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                              referrerPolicy="no-referrer"
                            />
                          )}
                          <div
                            className={`absolute inset-0 flex items-center justify-center transition-colors ${
                              content.thumbnailUrl ? 'bg-black/20 group-hover:bg-black/10' : ''
                            }`}
                          >
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/90 text-primary-foreground transition-transform group-hover:scale-110">
                              <Icon className="h-5 w-5" />
                            </div>
                          </div>
                        </div>
                        <div className="p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              {getFormatLabel(content)}
                            </span>
                            {progressRecord?.completedAt ? (
                              <span className="rounded-full bg-sage-light px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-sage">
                                Completed
                              </span>
                            ) : progressRecord?.startedAt ? (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                                In progress
                              </span>
                            ) : null}
                          </div>
                          <h3 className="mt-3 font-semibold text-foreground group-hover:text-primary">
                            {content.title}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {content.description}
                          </p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {content.duration}
                            </div>
                            <span className="text-sm font-medium text-primary">
                              {getCardActionLabel(content)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}

          {filteredContent.length === 0 && !isLoading && (
            <div className="mt-12 rounded-2xl border border-border bg-muted/20 px-6 py-10 text-center">
              <p className="text-foreground">No training content matches your current filters.</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Try searching for a module name, a symptom like burner or timer, or remove one of
                the active filters.
              </p>
            </div>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
