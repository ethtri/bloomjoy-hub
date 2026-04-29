import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, ClipboardCheck, MapPinned, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout/Layout";
import {
  businessPlaybookArticles,
  featuredBusinessPlaybookArticles,
  getPlaybookCategory,
  playbookCategories,
} from "@/data/businessPlaybook";

const categoryIcons = {
  start: BookOpen,
  locations: MapPinned,
  budget: ClipboardCheck,
  events: Sparkles,
  setup: ClipboardCheck,
};

export default function BusinessPlaybookIndexPage() {
  return (
    <Layout>
      <section className="border-b border-border bg-gradient-to-b from-cream to-background py-10 sm:py-12">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                Bloomjoy Business Playbook
              </p>
              <h1 className="mt-4 max-w-3xl font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
                Practical startup guides for cotton candy operators
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                Useful, visual, operator-minded articles for planning a vending placement,
                pitching locations, budgeting launch costs, and deciding whether commercial
                vending or event service is the better path.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/resources/business-playbook/how-to-start-cotton-candy-vending-business">
                    Start with the launch guide
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="/machines">Compare machines</Link>
                </Button>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-elevated">
              <div className="grid grid-cols-2 gap-0">
                {featuredBusinessPlaybookArticles.map((article, index) => (
                  <Link
                    key={article.slug}
                    to={`/resources/business-playbook/${article.slug}`}
                    className={
                      index === 0
                        ? "group col-span-2 grid min-h-[16rem] overflow-hidden sm:grid-cols-[1fr_0.9fr]"
                        : "group min-h-[10rem] border-t border-border odd:border-r"
                    }
                  >
                    <div className="relative h-full min-h-[11rem] overflow-hidden bg-muted">
                      <img
                        src={article.heroImage}
                        alt={article.heroImageAlt}
                        loading={index === 0 ? "eager" : "lazy"}
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    </div>
                    <div className="flex h-full flex-col justify-between p-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">
                          {article.visualLabel}
                        </p>
                        <h2 className="mt-2 font-display text-xl font-bold leading-tight text-foreground group-hover:text-primary">
                          {article.shortTitle}
                        </h2>
                      </div>
                      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                        {article.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-4 md:grid-cols-5">
            {playbookCategories.map((category) => {
              const Icon = categoryIcons[category.id];
              return (
                <a
                  key={category.id}
                  href={`#${category.id}`}
                  className="rounded-lg border border-border bg-muted/10 p-4 transition-colors hover:border-primary/60"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${category.colorClass}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-4 font-display text-lg font-semibold text-foreground">
                    {category.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {category.description}
                  </p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-10">
            {playbookCategories.map((category) => {
              const articles = businessPlaybookArticles.filter(
                (article) => article.category === category.id
              );
              const Icon = categoryIcons[category.id];

              return (
                <section key={category.id} id={category.id} className="scroll-mt-24">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-lg ${category.colorClass}`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <h2 className="font-display text-2xl font-bold text-foreground">
                          {category.title}
                        </h2>
                      </div>
                      <p className="mt-2 max-w-2xl text-muted-foreground">
                        {category.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                    {articles.map((article) => {
                      const articleCategory = getPlaybookCategory(article.category);
                      return (
                        <Link
                          key={article.slug}
                          to={`/resources/business-playbook/${article.slug}`}
                          className="group overflow-hidden rounded-xl border border-border bg-background transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-elevated"
                        >
                          <div className="aspect-[16/10] overflow-hidden bg-muted">
                            <img
                              src={article.heroImage}
                              alt={article.heroImageAlt}
                              width={640}
                              height={400}
                              loading="lazy"
                              decoding="async"
                              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          </div>
                          <div className="p-5">
                            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                              {articleCategory && (
                                <span
                                  className={`rounded-full px-2.5 py-1 ${articleCategory.colorClass}`}
                                >
                                  {articleCategory.title}
                                </span>
                              )}
                              <span className="text-muted-foreground">{article.readingTime}</span>
                            </div>
                            <h3 className="mt-3 font-display text-xl font-bold leading-tight text-foreground group-hover:text-primary">
                              {article.title}
                            </h3>
                            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                              {article.description}
                            </p>
                            <div className="mt-4 flex items-center text-sm font-semibold text-primary">
                              Read guide
                              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </section>
    </Layout>
  );
}
