import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Layout } from '@/components/layout/Layout';
import { toast } from 'sonner';
import {
  getNormalizedBusinessPlaybookSourcePage,
  getNormalizedInternalSourcePage,
  trackBuyerFlowPlaybookLinkClick,
  trackContactSubmitFromPlaybook,
} from '@/lib/businessPlaybookAnalytics';
import { createLeadSubmission } from '@/lib/leadSubmissions';
import { MACHINE_INTEREST_OPTIONS, normalizeMachineInterest } from '@/lib/machineNames';

const validInquiryTypes = new Set(['quote', 'demo', 'procurement', 'general']);

const machineInterestOptions = [
  ...MACHINE_INTEREST_OPTIONS,
  'Not sure yet',
];

const getPostSubmitPlaybookLinks = (interest: string) => {
  if (interest === 'Commercial Machine') {
    return [
      {
        label: 'Read the Commercial location guide',
        href: '/resources/business-playbook/best-locations-for-cotton-candy-vending-machines',
      },
      {
        label: 'Prep your location-owner pitch',
        href: '/resources/business-playbook/how-to-pitch-location-owners',
      },
    ];
  }

  if (interest === 'Mini Machine' || interest === 'Micro Machine') {
    return [
      {
        label: 'Read the event business guide',
        href: '/resources/business-playbook/mini-micro-event-catering-business-guide',
      },
      {
        label: 'Compare vending vs. events',
        href: '/resources/business-playbook/commercial-vending-vs-event-catering',
      },
    ];
  }

  return [
    {
      label: 'Start with the business launch guide',
      href: '/resources/business-playbook/how-to-start-cotton-candy-vending-business',
    },
    {
      label: 'Review the startup budget checklist',
      href: '/resources/business-playbook/startup-budget-checklist-cotton-candy-machine-business',
    },
  ];
};

export default function ContactPage() {
  const [searchParams] = useSearchParams();
  const queryType = searchParams.get('type');
  const querySource = searchParams.get('source');
  const initialType = queryType && validInquiryTypes.has(queryType) ? queryType : 'quote';
  const initialInterest = normalizeMachineInterest(searchParams.get('interest'));
  const sourcePage = getNormalizedInternalSourcePage(querySource) ?? '/contact';
  const playbookSourcePage = getNormalizedBusinessPlaybookSourcePage(querySource);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    type: initialType,
    interest: initialInterest,
    message: '',
    website: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmittedInterest, setLastSubmittedInterest] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.website.trim()) {
      toast.success('Message sent! We\'ll be in touch soon.');
      setFormData({
        name: '',
        email: '',
        type: initialType,
        interest: initialInterest,
        message: '',
        website: '',
      });
      return;
    }

    setSubmitting(true);
    try {
      const cleanedMessage = formData.message.trim();
      const submittedMachineInterest =
        formData.type === 'quote' ? formData.interest.trim() : '';

      await createLeadSubmission({
        submissionType: formData.type as 'quote' | 'demo' | 'procurement' | 'general',
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        message: cleanedMessage,
        machineInterest: submittedMachineInterest || undefined,
        sourcePage,
      });
      if (playbookSourcePage) {
        trackContactSubmitFromPlaybook({
          sourcePage: playbookSourcePage,
          inquiryType: formData.type,
          machineInterest: submittedMachineInterest || undefined,
        });
      }
      setLastSubmittedInterest(submittedMachineInterest || 'Not sure yet');
      toast.success('Message sent! We\'ll be in touch soon.');
      setFormData({
        name: '',
        email: '',
        type: initialType,
        interest: initialInterest,
        message: '',
        website: '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send message.';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const postSubmitPlaybookLinks = lastSubmittedInterest
    ? getPostSubmitPlaybookLinks(lastSubmittedInterest)
    : [];

  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background py-12 sm:py-14 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-display text-4xl font-bold text-foreground">Contact Us</h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Questions about our machines, supplies, or membership? We're here to help.
            </p>
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-12 lg:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl">
            {postSubmitPlaybookLinks.length > 0 && (
              <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-5">
                <div className="flex items-start gap-3">
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <h2 className="font-display text-xl font-bold text-foreground">
                      While we review your request
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      These playbook guides can help you tighten your launch plan before the
                      quote conversation.
                    </p>
                    <div className="mt-4 grid gap-2">
                      {postSubmitPlaybookLinks.map((link) => (
                        <Link
                          key={link.href}
                          to={link.href}
                          onClick={() =>
                            trackBuyerFlowPlaybookLinkClick({
                              surface: 'contact_success',
                              cta: link.label,
                              href: link.href,
                              machine: lastSubmittedInterest,
                            })
                          }
                          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                        >
                          {link.label}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="card-elevated p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="hidden" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <Input
                    id="website"
                    name="website"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="contact-name"
                      className="block text-sm font-medium text-foreground"
                    >
                      Name
                    </label>
                    <Input
                      id="contact-name"
                      name="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      autoComplete="name"
                      required
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="contact-email"
                      className="block text-sm font-medium text-foreground"
                    >
                      Email
                    </label>
                    <Input
                      id="contact-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      autoComplete="email"
                      spellCheck={false}
                      required
                      className="mt-1"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="contact-type"
                    className="block text-sm font-medium text-foreground"
                  >
                    Inquiry Type
                  </label>
                  <select
                    id="contact-type"
                    name="type"
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="quote">Request a Quote</option>
                    <option value="demo">Demo Request</option>
                    <option value="procurement">Procurement Questions</option>
                    <option value="general">General Inquiry</option>
                  </select>
                </div>
                {formData.type === 'quote' && (
                  <div>
                    <label
                      htmlFor="contact-interest"
                      className="block text-sm font-medium text-foreground"
                    >
                      Machine of Interest
                    </label>
                    <select
                      id="contact-interest"
                      name="interest"
                      value={formData.interest}
                      onChange={(e) => setFormData({ ...formData, interest: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select a machine (optional)</option>
                      {machineInterestOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label
                    htmlFor="contact-message"
                    className="block text-sm font-medium text-foreground"
                  >
                    Message
                  </label>
                  <Textarea
                    id="contact-message"
                    name="message"
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    rows={5}
                    required
                    className="mt-1"
                  />
                </div>
                <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? 'Sending...' : 'Send Message'}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
