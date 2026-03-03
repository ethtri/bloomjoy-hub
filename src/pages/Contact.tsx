import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, MapPin, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Layout } from '@/components/layout/Layout';
import { toast } from 'sonner';
import { createLeadSubmission } from '@/lib/leadSubmissions';
import { MACHINE_INTEREST_OPTIONS, normalizeMachineInterest } from '@/lib/machineNames';

const validInquiryTypes = new Set(['quote', 'demo', 'procurement', 'general']);

const machineInterestOptions = [
  ...MACHINE_INTEREST_OPTIONS,
  'Not sure yet',
];

export default function ContactPage() {
  const [searchParams] = useSearchParams();
  const queryType = searchParams.get('type');
  const querySource = searchParams.get('source');
  const initialType = queryType && validInquiryTypes.has(queryType) ? queryType : 'quote';
  const initialInterest = normalizeMachineInterest(searchParams.get('interest'));

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    type: initialType,
    interest: initialInterest,
    message: '',
    website: '',
  });
  const [submitting, setSubmitting] = useState(false);

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

      await createLeadSubmission({
        submissionType: formData.type as 'quote' | 'demo' | 'procurement' | 'general',
        name: formData.name.trim(),
        email: formData.email.trim().toLowerCase(),
        message: cleanedMessage,
        machineInterest: formData.type === 'quote' ? formData.interest.trim() : undefined,
        sourcePage: querySource?.trim() || '/contact',
      });
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

  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-display text-4xl font-bold text-foreground">Contact Us</h1>
            <p className="mt-4 text-lg text-muted-foreground">
              Questions about our machines, supplies, or membership? We're here to help.
            </p>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-2xl">
            <div className="card-elevated p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="hidden" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <Input
                    id="website"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Name</label>
                    <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required className="mt-1" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Email</label>
                    <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required className="mt-1" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Inquiry Type</label>
                  <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                    <option value="quote">Request a Quote</option>
                    <option value="demo">Demo Request</option>
                    <option value="procurement">Procurement Questions</option>
                    <option value="general">General Inquiry</option>
                  </select>
                </div>
                {formData.type === 'quote' && (
                  <div>
                    <label className="block text-sm font-medium text-foreground">
                      Machine of Interest
                    </label>
                    <select
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
                  <label className="block text-sm font-medium text-foreground">Message</label>
                  <Textarea value={formData.message} onChange={(e) => setFormData({ ...formData, message: e.target.value })} rows={5} required className="mt-1" />
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
