import { Layout } from '@/components/layout/Layout';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const faqs = [
  { q: 'What support is included with machine purchase?', a: 'Sunze provides 24/7 technical support via WeChat. Bloomjoy offers concierge guidance during US business hours for Plus members.' },
  { q: 'How do I get replacement parts?', a: 'Plus members can request parts assistance through the member portal. We help source parts from the manufacturer.' },
  { q: 'What\'s the difference between the machines?', a: 'Commercial is full-size with auto stick dispensing. Mini is portable at 1/5 size with manual stick feeding. Micro is entry-level for basic shapes only.' },
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
      <section className="section-padding">
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
    </Layout>
  );
}
