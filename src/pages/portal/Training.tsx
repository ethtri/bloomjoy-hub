import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Clock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { trackEvent } from '@/lib/analytics';
import { getTrainingTags } from '@/data/trainingContent';
import { useTrainingLibrary, useTrainingSourceStatus } from '@/lib/trainingRepository';

const MODULE_TAG_PATTERN = /^module\s+(\d+)$/i;

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

export default function TrainingPage() {
  const [search, setSearch] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedModule, setSelectedModule] = useState<string>('All modules');
  const { data: library = [], isLoading } = useTrainingLibrary();
  const { data: source = 'local' } = useTrainingSourceStatus();

  useEffect(() => {
    trackEvent('view_training_catalog');
  }, []);

  const handleOpenItem = (id: string, title: string) => {
    trackEvent('open_training_item', { id, title });
  };

  const moduleFilters = [...new Set(library.map((item) => extractModuleTag(item.tags)).filter(Boolean))]
    .map((tag) => String(tag))
    .sort((a, b) => getModuleNumber(a) - getModuleNumber(b));

  const topicTags = getTrainingTags(library)
    .filter((tag) => !MODULE_TAG_PATTERN.test(tag.trim()))
    .sort((a, b) => a.localeCompare(b));

  const filteredContent = library.filter((content) => {
    const matchesSearch =
      content.title.toLowerCase().includes(search.toLowerCase()) ||
      content.description.toLowerCase().includes(search.toLowerCase());
    const contentModuleTag = extractModuleTag(content.tags);
    const matchesModule = selectedModule === 'All modules' || contentModuleTag === selectedModule;
    const matchesTags =
      selectedTags.length === 0 || selectedTags.some((tag) => content.tags.includes(tag));
    return matchesSearch && matchesModule && matchesTags;
  });

  const groupedContent = filteredContent.reduce<Record<string, typeof filteredContent>>((acc, item) => {
    const moduleTag = extractModuleTag(item.tags) ?? 'Unassigned module';
    if (!acc[moduleTag]) {
      acc[moduleTag] = [];
    }
    acc[moduleTag].push(item);
    return acc;
  }, {});

  const groupedEntries = Object.entries(groupedContent).sort(([groupA], [groupB]) => {
    const groupAIsModule = MODULE_TAG_PATTERN.test(groupA);
    const groupBIsModule = MODULE_TAG_PATTERN.test(groupB);

    if (groupAIsModule && groupBIsModule) {
      return getModuleNumber(groupA) - getModuleNumber(groupB);
    }
    if (groupAIsModule) {
      return -1;
    }
    if (groupBIsModule) {
      return 1;
    }
    return groupA.localeCompare(groupB);
  });

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground">
                Training Library
              </h1>
              <p className="mt-1 text-muted-foreground">
                Video tutorials and operational guides for Bloomjoy operators.
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search training content..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="mt-4">
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

          <div className="mt-4 flex flex-wrap gap-2">
            {topicTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  selectedTags.includes(tag)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {tag}
              </button>
            ))}
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
                  <h2 className="font-display text-xl font-semibold text-foreground">{groupName}</h2>
                  <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {items.length} {items.length === 1 ? 'video' : 'videos'}
                  </span>
                </div>

                <div className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((content) => (
                    <Link
                      key={content.id}
                      to={`/portal/training/${content.id}`}
                      onClick={() => handleOpenItem(content.id, content.title)}
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
                            <Play className="h-5 w-5 fill-current" />
                          </div>
                        </div>
                      </div>
                      <div className="p-4">
                        <h3 className="font-semibold text-foreground group-hover:text-primary">
                          {content.title}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {content.description}
                        </p>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            {content.duration}
                          </div>
                          <div className="flex gap-1">
                            {content.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            ))}

          {filteredContent.length === 0 && !isLoading && (
            <div className="mt-12 text-center">
              <p className="text-muted-foreground">
                No training content matches your current module, tag, or search filters.
              </p>
            </div>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
