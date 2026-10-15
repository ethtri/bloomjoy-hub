import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, LifeBuoy, Wrench } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { PlusToolsPreview } from "@/components/resources/PlusToolsPreview";
import { MobileOperatorEntry } from "@/components/resources/MobileOperatorEntry";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { trackResourcesPlaybookCardClick } from "@/lib/businessPlaybookAnalytics";
import { getCanonicalUrlForSurface } from "@/lib/appSurface";
import { resourcesFaqs } from "@/lib/seoRoutes";
import { featuredBusinessPlaybookArticles, playbookCategories } from "@/data/businessPlaybook";

// Keep the three guide groups open during this browsing session so Back can
// restore the content the customer left as well as their scroll position.
const expandedGuideGroups = new Set<string>();

function ResourceGuideGroup({ id, title, className, children }: {
  id: string;
  title: string;
  className: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => expandedGuideGroups.has(id));
  return (
    <details className={className} open={open} onToggle={(event) => {
      const expanded = event.currentTarget.open;
      if (expanded) expandedGuideGroups.add(id);
      else expandedGuideGroups.delete(id);
      setOpen(expanded);
    }}>
      <summary className="cursor-pointer py-2 font-semibold">{title}</summary>
      {children}
    </details>
  );
}

export default function ResourcesPage() {
  const currentLocation = typeof window === "undefined" ? undefined : window.location;
  const operatorLoginUrl = getCanonicalUrlForSurface("app", "/login", "", "", currentLocation);

  return (
    <Layout>
      <section className="border-b border-border bg-cream py-8 sm:py-12">
        <div className="container-page">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary">Resources</p>
          <h1 className="mt-3 font-display text-3xl font-bold sm:text-5xl">What can we help you do?</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">Practical guides for choosing a machine, running your business, and getting support.</p>
          <nav aria-label="Resource topics" className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              { href: "#choose", icon: BookOpen, title: "Choose a machine", detail: "Compare fit, costs, and locations" },
              { href: "#operate", icon: Wrench, title: "Run your machine", detail: "Setup, training, and operator tools" },
              { href: "#help", icon: LifeBuoy, title: "Get help", detail: "Purchase help, support, and FAQs" },
            ].map(({ href, icon: Icon, title, detail }) => (
              <Link key={href} to={href} className="flex items-center gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary">
                <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
                <span><span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted-foreground">{detail}</span></span>
                <ArrowRight aria-hidden="true" className="ml-auto h-4 w-4 shrink-0" />
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section id="help" className="scroll-mt-24 border-b border-border py-8 sm:py-10">
        <div className="container-page">
          <h2 className="font-display text-2xl font-bold">Get help</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="font-display text-xl font-semibold">A problem with a purchase?</h3>
              <p className="mt-2 text-sm text-muted-foreground">Bought cotton candy from a machine? Tell us what happened so we can review your purchase.</p>
              <Button asChild className="mt-4"><Link to="/refunds/request">Help with a purchase <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link></Button>
            </div>
            <div id="support-boundaries" className="scroll-mt-24 rounded-xl border border-border bg-card p-5">
              <h3 className="font-display text-xl font-semibold">Machine support</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">The manufacturer provides 24/7 first-line technical support via WeChat. Bloomjoy helps with onboarding, best practices, and escalation Monday–Friday, 9am–5pm EST. Response times may vary.</p>
              <Link to="/contact" className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-primary">Contact Bloomjoy <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
              <Link to="#faq" className="ml-4 inline-flex min-h-11 items-center font-semibold text-primary">Read FAQs</Link>
            </div>
          </div>
        </div>
      </section>

      <section id="choose" className="scroll-mt-24 border-b border-border py-8 sm:py-12">
        <div className="container-page">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="font-display text-2xl font-bold">Choose a machine</h2><p className="mt-2 text-muted-foreground">Start with fit, then plan the costs and location.</p></div>
            <Button asChild variant="outline"><Link to="/machines">Compare machines</Link></Button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {[
              { href: "/resources/business-playbook/planner", title: "Find your machine fit", detail: "Explore a path and startup budget for your plans.", cta: "try_startup_planner" },
              { href: "/resources/business-playbook/payback-planner", title: "Plan payback scenarios", detail: "Explore costs and sales assumptions. Results are estimates, not earnings promises.", cta: "open_payback_planner" },
            ].map(({ href, title, detail, cta }) => (
              <Link key={href} to={href} onClick={() => trackResourcesPlaybookCardClick({ surface: "resources_planner_promo", cta, href })} className="rounded-xl border border-primary/20 bg-primary/5 p-5 hover:border-primary">
                <h3 className="flex items-center justify-between gap-3 font-display text-lg font-bold">{title}<ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" /></h3><p className="mt-2 text-sm text-muted-foreground">{detail}</p>
              </Link>
            ))}
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            {featuredBusinessPlaybookArticles.map((article) => (
              <Link key={article.slug} to={`/resources/business-playbook/${article.slug}`} onClick={() => trackResourcesPlaybookCardClick({ surface: "resources_featured_article", cta: article.shortTitle, href: `/resources/business-playbook/${article.slug}`, slug: article.slug, category: article.category })} className="group flex gap-4 rounded-xl border border-border bg-background p-4 hover:border-primary">
                <img src={article.heroImage} alt="" width={80} height={80} loading="lazy" decoding="async" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                <div><p className="text-xs text-muted-foreground">{article.readingTime}</p><h3 className="mt-1 font-display font-semibold group-hover:text-primary">{article.shortTitle}</h3></div>
              </Link>
            ))}
          </div>
          <ResourceGuideGroup id="topics" title="Browse all Business Playbook topics" className="mt-5 rounded-xl border border-border p-4">
            <div className="mt-3 flex flex-wrap gap-2">
              {playbookCategories.map((category) => <Link key={category.id} to={`/resources/business-playbook#${category.id}`} onClick={() => trackResourcesPlaybookCardClick({ surface: "resources_category", cta: category.title, href: `/resources/business-playbook#${category.id}`, category: category.id })} className="inline-flex min-h-11 items-center rounded-lg bg-muted px-4 text-sm font-medium hover:text-primary">{category.title}</Link>)}
              <Link to="/resources/business-playbook" className="inline-flex min-h-11 items-center px-4 text-sm font-semibold text-primary">View all guides <ArrowRight aria-hidden="true" className="ml-2 h-4 w-4" /></Link>
            </div>
          </ResourceGuideGroup>
        </div>
      </section>

      <section id="operate" className="scroll-mt-24 border-b border-border py-8 sm:py-12">
        <div className="container-page">
          <h2 className="font-display text-2xl font-bold">Run your machine</h2>
          <p className="mt-2 text-muted-foreground">Setup guidance for mobile operators, plus a look inside Bloomjoy Plus.</p>
          <ResourceGuideGroup id="mobile" title="Food trucks and mobile setup guides" className="mt-5 rounded-xl border border-border p-4">
            <div className="mt-4"><MobileOperatorEntry surface="resources_category" /></div>
          </ResourceGuideGroup>
          <ResourceGuideGroup id="plus" title="Preview Plus training and operator tools" className="mt-3 rounded-xl border border-border p-4">
            <div className="mt-4"><PlusToolsPreview surface="resources_plus_preview" operatorLoginUrl={operatorLoginUrl} /></div>
          </ResourceGuideGroup>
        </div>
      </section>
      <section id="faq" className="scroll-mt-24 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-3xl">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Robotic cotton candy machine FAQs
            </h2>
            <p className="mt-2 text-muted-foreground">
              Answers about machine fit, supplies, quotes, and support.
            </p>
            <Accordion
              type="multiple"
              defaultValue={["faq-0"]}
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

    </Layout>
  );
}
