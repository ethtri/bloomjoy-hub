import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  ClipboardCheck,
  Download,
  Lock,
  MapPinned,
  Sparkles,
} from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { getCanonicalUrlForSurface } from "@/lib/appSurface";
import { resourcesFaqs } from "@/lib/seoRoutes";
import {
  businessPlaybookArticles,
  featuredBusinessPlaybookArticles,
  getPlaybookCategory,
  playbookCategories,
} from "@/data/businessPlaybook";
import landingHeroImage from "@/assets/real/landing-hero.jpg";

const plusTeasers = [
  {
    title: "Operator Guides",
    description:
      "Task-first setup, pricing, timer, and payment guides so operators can find answers fast.",
  },
  {
    title: "Maintenance Checklists",
    description:
      "Cleaning, hygiene, and function-check references pulled from Bloomjoy training materials.",
  },
  {
    title: "Operator Certificate",
    description:
      "Plus members can complete the Operator Essentials path and unlock a lightweight completion certificate.",
  },
];

const categoryIcons = {
  start: BookOpen,
  locations: MapPinned,
  budget: ClipboardCheck,
  events: Sparkles,
  setup: ClipboardCheck,
};

export default function ResourcesPage() {
  const location = useLocation();
  const currentLocation = typeof window === "undefined" ? undefined : window.location;
  const operatorLoginUrl = getCanonicalUrlForSurface("app", "/login", "", "", currentLocation);

  useEffect(() => {
    if (!location.hash) {
      return;
    }

    const targetId = decodeURIComponent(location.hash.slice(1));
    if (!targetId) {
      return;
    }

    const scrollToTarget = () => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    };

    const frameId = window.requestAnimationFrame(scrollToTarget);
    const timeoutIds = [100, 300].map((delay) => window.setTimeout(scrollToTarget, delay));

    return () => {
      window.cancelAnimationFrame(frameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [location.hash]);

  return (
    <Layout>
      <section className="border-b border-border bg-gradient-to-b from-cream to-background py-12 sm:py-14 lg:py-16">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.82fr)] lg:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">
                Resources
              </p>
              <h1 className="mt-4 max-w-4xl font-display text-4xl font-bold leading-tight text-foreground sm:text-5xl">
                Guides, FAQs, and operator playbooks for starting smart
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
                The Bloomjoy Business Playbook turns common buyer questions into practical,
                visual guides for vending locations, event service, budgeting, business setup,
                supplies, support, and machine fit.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link to="/resources/business-playbook">
                    Open Business Playbook
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link to="#faq">Read FAQs</Link>
                </Button>
              </div>
            </div>

            <figure className="overflow-hidden rounded-2xl border border-border bg-background shadow-elevated">
              <img
                src={landingHeroImage}
                alt="Bloomjoy robotic cotton candy machine creating a colorful product moment"
                width={720}
                height={520}
                loading="eager"
                decoding="async"
                className="aspect-[4/3] w-full object-cover"
              />
              <figcaption className="border-t border-border px-5 py-4 text-sm text-muted-foreground">
                Operator-led guidance for turning machine interest into a real launch plan.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-3xl font-bold text-foreground">
                Bloomjoy Business Playbook
              </h2>
              <p className="mt-2 max-w-3xl text-muted-foreground">
                Useful, well-researched, easy-to-read guides for people evaluating a cotton
                candy vending, event, or catering business.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link to="/resources/business-playbook">
                View all guides
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            {featuredBusinessPlaybookArticles.map((article) => {
              const category = getPlaybookCategory(article.category);
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
                      {category && (
                        <span className={`rounded-full px-2.5 py-1 ${category.colorClass}`}>
                          {category.title}
                        </span>
                      )}
                      <span className="text-muted-foreground">{article.readingTime}</span>
                    </div>
                    <h3 className="mt-3 font-display text-xl font-bold leading-tight text-foreground group-hover:text-primary">
                      {article.shortTitle}
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

          <div className="mt-8 grid gap-4 md:grid-cols-5">
            {playbookCategories.map((category) => {
              const Icon = categoryIcons[category.id];
              const count = businessPlaybookArticles.filter(
                (article) => article.category === category.id
              ).length;

              return (
                <Link
                  key={category.id}
                  to={`/resources/business-playbook#${category.id}`}
                  className="rounded-lg border border-border bg-muted/10 p-4 transition-colors hover:border-primary/60"
                >
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${category.colorClass}`}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                    {category.title}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {count} guide{count === 1 ? "" : "s"}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section id="faq" className="scroll-mt-24 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Robotic cotton candy machine FAQs
            </h2>
            <p className="mt-2 text-muted-foreground">
              Fast answers for buyers who need support boundaries, machine fit, supplies, and
              quote prep before a deeper playbook read.
            </p>
            <Accordion
              type="multiple"
              defaultValue={resourcesFaqs.map((_, index) => `faq-${index}`)}
              className="mt-6"
            >
              {resourcesFaqs.map((faq, i) => (
                <AccordionItem key={faq.q} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left font-medium">{faq.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <p>{faq.a}</p>
                    {faq.ctaHref && faq.ctaLabel && (
                      <Link
                        to={faq.ctaHref}
                        className="mt-3 inline-flex items-center gap-2 font-semibold text-primary hover:underline"
                      >
                        {faq.ctaLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-muted/20 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-4xl">
            <div className="flex flex-col gap-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Bloomjoy Plus Preview
              </p>
              <h2 className="font-display text-2xl font-bold text-foreground">
                Premium resources unlocked with Plus
              </h2>
              <p className="text-muted-foreground">
                Public playbooks help you plan. Plus adds the operator layer: task-based
                guides, maintenance checklists, troubleshooting references, and the Bloomjoy
                Operator Essentials certificate path.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {plusTeasers.map((item) => (
                <div key={item.title} className="rounded-xl border border-border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <Lock className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                  <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <Download className="h-3.5 w-3.5" />
                    Plus download
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild>
                <Link to="/plus">
                  Explore Bloomjoy Plus
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href={operatorLoginUrl}>Operator Login</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="support-boundaries" className="scroll-mt-24 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-3xl rounded-xl border border-border bg-background p-6 shadow-sm">
            <h2 className="font-display text-2xl font-bold text-foreground">Support Boundaries</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The manufacturer support team provides 24/7 first-line technical support via WeChat
              for machine issues. Bloomjoy provides concierge guidance, onboarding assistance, and
              escalation support during US business hours (Mon-Fri, 9am-5pm EST). Bloomjoy is not
              a 24/7 support provider. Response times may vary based on volume.
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
}
