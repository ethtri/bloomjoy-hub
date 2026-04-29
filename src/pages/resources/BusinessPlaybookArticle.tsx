import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/Layout";
import { trackEvent } from "@/lib/analytics";
import {
  trackBusinessPlaybookCtaClick,
  trackResourcesPlaybookCardClick,
} from "@/lib/businessPlaybookAnalytics";
import {
  type BusinessPlaybookArticle,
  type PlaybookSection,
  getBusinessPlaybookArticle,
  getPlaybookCategory,
  getRelatedBusinessPlaybookArticles,
} from "@/data/businessPlaybook";

const renderTable = (section: PlaybookSection) => {
  if (!section.table) return null;

  return (
    <div className="mt-6 overflow-hidden rounded-lg border border-border bg-background">
      {section.table.caption && (
        <p className="border-b border-border bg-muted/30 px-4 py-3 text-sm font-medium text-muted-foreground">
          {section.table.caption}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              {section.table.columns.map((column) => (
                <th key={column} className="px-4 py-3 font-semibold text-foreground">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.table.rows.map((row) => (
              <tr key={row.join("|")} className="border-t border-border">
                {row.map((cell, index) => (
                  <td
                    key={`${cell}-${index}`}
                    className={
                      index === 0
                        ? "px-4 py-3 font-semibold text-foreground"
                        : "px-4 py-3 text-muted-foreground"
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const renderSectionVisuals = (section: PlaybookSection) => (
  <>
    {section.callout && (
      <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold text-foreground">{section.callout.title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {section.callout.body}
            </p>
          </div>
        </div>
      </div>
    )}

    {section.bullets && (
      <ul className="mt-5 grid gap-3">
        {section.bullets.map((item) => (
          <li key={item} className="flex items-start gap-3 text-muted-foreground">
            <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
              <Check className="h-3 w-3 text-sage" />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    )}

    {section.checklist && (
      <div className="mt-6 rounded-lg border border-border bg-muted/20 p-5">
        <p className="font-display text-lg font-semibold text-foreground">Operator checklist</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {section.checklist.map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Check className="h-3 w-3 text-primary" />
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    )}

    {section.scorecard && (
      <div className="mt-6 rounded-lg border border-border bg-background p-5 shadow-sm">
        <p className="font-display text-lg font-semibold text-foreground">
          {section.scorecard.title}
        </p>
        <div className="mt-4 grid gap-3">
          {section.scorecard.items.map((item) => (
            <div
              key={item.label}
              className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-[10rem_4rem_1fr] sm:items-center"
            >
              <p className="font-semibold text-foreground">{item.label}</p>
              <p className="text-sm font-semibold text-primary">{item.score}</p>
              <p className="text-sm text-muted-foreground">{item.guidance}</p>
            </div>
          ))}
        </div>
      </div>
    )}

    {section.steps && (
      <ol className="mt-6 grid gap-4">
        {section.steps.map((step, index) => (
          <li key={step.title} className="flex gap-4 rounded-lg border border-border bg-background p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {index + 1}
            </span>
            <div>
              <p className="font-semibold text-foreground">{step.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    )}

    {section.script && (
      <div className="mt-6 rounded-lg border border-border bg-charcoal p-5 text-background">
        <p className="font-display text-lg font-semibold">{section.script.title}</p>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-background/80">
          {section.script.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    )}

    {renderTable(section)}
  </>
);

const ArticleBody = ({ article }: { article: BusinessPlaybookArticle }) => (
  <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <article className="min-w-0">
      <div className="rounded-2xl border border-border bg-background p-5 shadow-elevated sm:p-8">
        <h2 className="font-display text-2xl font-bold text-foreground">
          What you will take away
        </h2>
        <ul className="mt-5 grid gap-3">
          {article.keyTakeaways.map((takeaway) => (
            <li key={takeaway} className="flex items-start gap-3 text-muted-foreground">
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                <Check className="h-3 w-3 text-sage" />
              </span>
              <span>{takeaway}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-10 space-y-10">
        {article.sections.map((section) => (
          <section key={section.heading} className="scroll-mt-24">
            <h2 className="font-display text-2xl font-bold text-foreground">
              {section.heading}
            </h2>
            <div className="mt-4 space-y-4 text-base leading-8 text-muted-foreground">
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            {renderSectionVisuals(section)}
          </section>
        ))}
      </div>
    </article>

    <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
      <div className="rounded-xl border border-border bg-background p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Visual summary
        </p>
        <h2 className="mt-2 font-display text-xl font-bold text-foreground">
          {article.visualSummary.title}
        </h2>
        <div className="mt-4 grid gap-3">
          {article.visualSummary.items.map((item) => (
            <div key={item.label} className="rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {item.label}
                </span>
                <p className="font-semibold text-foreground">{item.value}</p>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <p className="font-display text-lg font-semibold text-foreground">
          Ready for machine fit help?
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Use what you learned here, then bring your venue, budget, and timeline into
          the quote conversation.
        </p>
        <div className="mt-4 grid gap-2">
          <Button asChild>
            <Link
              to={article.primaryCta.href}
              onClick={() =>
                trackBusinessPlaybookCtaClick({
                  surface: "playbook_article_sidebar",
                  cta: article.primaryCta.label,
                  href: article.primaryCta.href,
                  slug: article.slug,
                  category: article.category,
                })
              }
            >
              {article.primaryCta.label}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {article.secondaryCta && (
            <Button asChild variant="outline">
              <Link
                to={article.secondaryCta.href}
                onClick={() =>
                  trackBusinessPlaybookCtaClick({
                    surface: "playbook_article_sidebar",
                    cta: article.secondaryCta.label,
                    href: article.secondaryCta.href,
                    slug: article.slug,
                    category: article.category,
                  })
                }
              >
                {article.secondaryCta.label}
              </Link>
            </Button>
          )}
        </div>
      </div>

      {article.citations.length > 0 && (
        <div className="rounded-xl border border-border bg-background p-5">
          <p className="font-display text-lg font-semibold text-foreground">
            Sources and further reading
          </p>
          <ul className="mt-4 space-y-3">
            {article.citations.map((citation) => (
              <li key={citation.url}>
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-start gap-2 text-sm font-medium text-primary hover:underline"
                >
                  <span>
                    {citation.source}: {citation.label}
                  </span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  </div>
);

export default function BusinessPlaybookArticlePage() {
  const { slug } = useParams();
  const article = getBusinessPlaybookArticle(slug);

  useEffect(() => {
    if (!article) return;
    trackEvent("view_business_playbook_article", {
      slug: article.slug,
      category: article.category,
    });
  }, [article]);

  if (!article) {
    return (
      <Layout>
        <section className="py-16">
          <div className="container-page">
            <div className="mx-auto max-w-2xl rounded-xl border border-border bg-background p-8 text-center">
              <h1 className="font-display text-3xl font-bold text-foreground">
                Article not found
              </h1>
              <p className="mt-3 text-muted-foreground">
                The Business Playbook article you are looking for may have moved.
              </p>
              <Button asChild className="mt-6">
                <Link to="/resources/business-playbook">Open the Business Playbook</Link>
              </Button>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  const category = getPlaybookCategory(article.category);
  const relatedArticles = getRelatedBusinessPlaybookArticles(article);

  return (
    <Layout>
      <section className="border-b border-border bg-gradient-to-b from-cream to-background py-8 sm:py-10">
        <div className="container-page">
          <Link
            to="/resources/business-playbook"
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Business Playbook
          </Link>

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                {category && (
                  <span className={`rounded-full px-2.5 py-1 ${category.colorClass}`}>
                    {category.title}
                  </span>
                )}
                <span className="rounded-full bg-background px-2.5 py-1 text-muted-foreground">
                  {article.readingTime}
                </span>
                <span className="rounded-full bg-background px-2.5 py-1 text-muted-foreground">
                  Updated {article.updatedAt}
                </span>
              </div>
              <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
                {article.title}
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted-foreground">
                {article.description}
              </p>
              <div className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-background/70 p-4">
                  <p className="font-semibold text-foreground">Audience</p>
                  <p className="mt-1">{article.audience}</p>
                </div>
                <div className="rounded-lg border border-border bg-background/70 p-4">
                  <p className="font-semibold text-foreground">Machine fit</p>
                  <p className="mt-1">{article.machineFit}</p>
                </div>
              </div>
            </div>

            <figure className="overflow-hidden rounded-2xl border border-border bg-background shadow-elevated">
              <img
                src={article.heroImage}
                alt={article.heroImageAlt}
                width={720}
                height={520}
                loading="eager"
                decoding="async"
                className="aspect-[4/3] w-full object-cover"
              />
              <figcaption className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
                <BookOpen className="h-4 w-4 text-primary" />
                {article.visualLabel}
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <ArticleBody article={article} />
        </div>
      </section>

      {relatedArticles.length > 0 && (
        <section className="border-t border-border bg-muted/20 py-10 sm:py-12 lg:py-16">
          <div className="container-page">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-bold text-foreground">
                  Read next
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Keep the plan moving with the next most useful playbook guides.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link
                  to="/resources/business-playbook"
                  onClick={() =>
                    trackBusinessPlaybookCtaClick({
                      surface: "playbook_article_related",
                      cta: "view_all_guides",
                      href: "/resources/business-playbook",
                      slug: article.slug,
                      category: article.category,
                    })
                  }
                >
                  View all guides
                </Link>
              </Button>
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {relatedArticles.map((related) => (
                <Link
                  key={related.slug}
                  to={`/resources/business-playbook/${related.slug}`}
                  onClick={() =>
                    trackResourcesPlaybookCardClick({
                      surface: "playbook_article_related",
                      cta: related.shortTitle,
                      href: `/resources/business-playbook/${related.slug}`,
                      slug: related.slug,
                      category: related.category,
                    })
                  }
                  className="group overflow-hidden rounded-xl border border-border bg-background transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-elevated"
                >
                  <div className="aspect-[16/10] overflow-hidden bg-muted">
                    <img
                      src={related.heroImage}
                      alt={related.heroImageAlt}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                      {related.visualLabel}
                    </p>
                    <h3 className="mt-2 font-display text-lg font-bold leading-tight text-foreground group-hover:text-primary">
                      {related.shortTitle}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {related.description}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </Layout>
  );
}
