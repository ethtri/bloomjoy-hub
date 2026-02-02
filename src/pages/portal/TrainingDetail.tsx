import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Clock, ChevronLeft, CheckCircle2, FileText, HelpCircle } from 'lucide-react';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trackEvent } from '@/lib/analytics';
import { useTrainingLibrary } from '@/lib/trainingRepository';

export default function TrainingDetailPage() {
  const { id } = useParams();
  const { data: library = [] } = useTrainingLibrary();
  const trainingItem = id ? library.find((item) => item.id === id) : undefined;

  useEffect(() => {
    if (trainingItem) {
      trackEvent('view_training_detail', { id: trainingItem.id });
    }
  }, [trainingItem]);

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
                Head back to the training library to choose another module.
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

  const related = library
    .filter((item) => item.id !== trainingItem.id)
    .slice(0, 3);

  return (
    <PortalLayout>
      <section className="section-padding">
        <div className="container-page">
          <Link
            to="/portal/training"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to library
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

              <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-background">
                {trainingItem.embed.url ? (
                  <iframe
                    title={trainingItem.embed.title}
                    className="aspect-video w-full"
                    src={trainingItem.embed.url}
                    allow="autoplay; fullscreen; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  <iframe
                    title={trainingItem.embed.title}
                    className="aspect-video w-full"
                    srcDoc={trainingItem.embed.srcDoc}
                    sandbox="allow-same-origin"
                  />
                )}
              </div>

              <div className="mt-8 grid gap-6 md:grid-cols-2">
                <div className="card-elevated p-6">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    What you will learn
                  </h2>
                  <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                    {trainingItem.learningPoints.map((point) => (
                      <li key={point} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="card-elevated p-6">
                  <h2 className="font-display text-lg font-semibold text-foreground">
                    Checklist
                  </h2>
                  <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                    {trainingItem.checklist.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 text-sage" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-8 card-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Resources
                </h2>
                {trainingItem.resources.length === 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Resources will be added as this module expands.
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
                        <p className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          {resource.status === 'available' ? 'Available' : 'Coming soon'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-6">
              <div className="card-elevated p-6">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Module summary
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">{trainingItem.summary}</p>
                <Button className="mt-6 w-full" disabled>
                  Mark complete (coming soon)
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
                  Related modules
                </h3>
                <div className="mt-4 space-y-3">
                  {related.map((item) => (
                    <Link
                      key={item.id}
                      to={`/portal/training/${item.id}`}
                      className="block rounded-lg border border-border p-3 text-sm text-foreground transition hover:border-primary/30 hover:bg-muted/40"
                    >
                      <div className="font-semibold">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.duration}</div>
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
