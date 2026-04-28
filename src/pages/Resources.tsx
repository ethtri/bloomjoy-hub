import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, Download, Lock } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import { resourcesFaqs } from '@/lib/seoRoutes';

const plusTeasers = [
  {
    title: 'Operator Guides',
    description:
      'Task-first setup, pricing, timer, and payment guides so operators can find answers fast.',
  },
  {
    title: 'Maintenance Checklists',
    description:
      'Cleaning, hygiene, and function-check references pulled from Bloomjoy training materials.',
  },
  {
    title: 'Operator Certificate',
    description:
      'Plus members can complete the Operator Essentials path and unlock a lightweight completion certificate.',
  },
];

const resourceGroups = [
  {
    title: 'Machine Buyers',
    description:
      'Compare the Commercial, Mini, and Micro machines by venue fit, footprint, pattern capability, and quote expectations.',
    href: '/machines',
  },
  {
    title: 'Supplies Planning',
    description:
      'Review sugar, Bloomjoy branded paper sticks, custom sticks, pricing, and order paths before launch.',
    href: '/supplies',
  },
  {
    title: 'Support Boundaries',
    description:
      'Understand manufacturer first-line support, Bloomjoy concierge guidance, and Plus training resources.',
    href: '#support-boundaries',
  },
];

export default function ResourcesPage() {
  const location = useLocation();
  const currentLocation = typeof window === 'undefined' ? undefined : window.location;
  const operatorLoginUrl = getCanonicalUrlForSurface('app', '/login', '', '', currentLocation);

  useEffect(() => {
    if (!location.hash) {
      return;
    }

    const targetId = decodeURIComponent(location.hash.slice(1));
    if (!targetId) {
      return;
    }

    const scrollToTarget = () => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
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
      <section className="bg-gradient-to-b from-cream to-background py-12 sm:py-14 lg:py-16">
        <div className="container-page text-center">
          <h1 className="font-display text-4xl font-bold text-foreground">Resources</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Practical FAQs for robotic cotton candy machine buyers, venue operators, supplies,
            maintenance, support, and Bloomjoy Plus.
          </p>
        </div>
      </section>
      <section className="border-b border-border bg-background py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="grid gap-4 md:grid-cols-3">
            {resourceGroups.map((group) => (
              <Link
                key={group.title}
                to={group.href}
                className="rounded-lg border border-border bg-muted/10 p-5 transition-colors hover:border-primary/60"
              >
                <h2 className="font-display text-xl font-semibold text-foreground">
                  {group.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {group.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary">
                  Open resource
                  <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <section id="faq" className="scroll-mt-24 py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl">
            <h2 className="font-display text-2xl font-bold text-foreground">
              Robotic cotton candy machine FAQs
            </h2>
            <Accordion
              type="multiple"
              defaultValue={resourcesFaqs.map((_, index) => `faq-${index}`)}
              className="mt-6"
            >
              {resourcesFaqs.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
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
                Plus includes task-based operator guides, maintenance checklists, troubleshooting references,
                and the Bloomjoy Operator Essentials certificate path.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {plusTeasers.map((item) => (
                <div key={item.title} className="rounded-xl border border-border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-lg font-semibold text-foreground">{item.title}</h3>
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
      <section id="support-boundaries" className="pb-16 scroll-mt-24">
        <div className="container-page">
          <div className="mx-auto max-w-2xl rounded-lg border border-border bg-muted/30 p-6">
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
