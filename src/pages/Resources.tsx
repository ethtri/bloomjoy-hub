import { Link } from 'react-router-dom';
import { ArrowRight, Download, Lock } from 'lucide-react';
import { Layout } from '@/components/layout/Layout';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { MACHINE_NAMES } from '@/lib/machineNames';

const faqs = [
  { q: 'What support is included with machine purchase?', a: 'The manufacturer support team provides 24/7 technical support via WeChat. Bloomjoy offers concierge guidance during US business hours for Plus members.' },
  { q: 'How do I get replacement parts?', a: 'Plus members can request parts assistance through the member portal. We help source parts from the manufacturer.' },
  {
    q: 'What\'s the difference between the machines?',
    a: `${MACHINE_NAMES.commercial} is full-size with auto stick dispensing. ${MACHINE_NAMES.mini} is portable at 1/5 size with manual stick feeding. ${MACHINE_NAMES.micro} is entry-level for basic shapes only.`,
  },
];

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

export default function ResourcesPage() {
  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page text-center">
          <h1 className="font-display text-4xl font-bold text-foreground">Resources</h1>
          <p className="mt-4 text-lg text-muted-foreground">FAQs, guides, and what to expect.</p>
        </div>
      </section>
      <section id="faq" className="section-padding scroll-mt-24">
        <div className="container-page">
          <div className="mx-auto max-w-2xl">
            <h2 className="font-display text-2xl font-bold text-foreground">Frequently Asked Questions</h2>
            <Accordion type="single" collapsible className="mt-6">
              {faqs.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-left font-medium">{faq.q}</AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>
      <section className="section-padding border-y border-border bg-muted/20">
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
                <Link to="/login">Member Login</Link>
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
