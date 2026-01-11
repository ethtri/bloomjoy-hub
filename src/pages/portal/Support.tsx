import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Wrench, Package, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { toast } from 'sonner';

type SupportType = 'concierge' | 'parts' | 'wechat' | null;

export default function SupportPage() {
  const [activeForm, setActiveForm] = useState<SupportType>(null);
  const [formData, setFormData] = useState({ subject: '', message: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (type: 'concierge' | 'parts') => {
    setLoading(true);
    trackEvent(`submit_support_request_${type}`, { subject: formData.subject });

    // Mock submission
    await new Promise((resolve) => setTimeout(resolve, 1000));

    toast.success('Support request submitted! We\'ll get back to you soon.');
    setActiveForm(null);
    setFormData({ subject: '', message: '' });
    setLoading(false);
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/portal" className="hover:text-foreground">Portal</Link>
            <span>/</span>
            <span className="text-foreground">Support</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <h1 className="font-display text-3xl font-bold text-foreground">Support</h1>
          <p className="mt-2 text-muted-foreground">
            Choose the type of support you need.
          </p>

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {/* WeChat Setup */}
            <div className="card-elevated p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sage-light">
                <MessageSquare className="h-6 w-6 text-sage" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                Get Manufacturer Support
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                24/7 technical support directly from Sunze via WeChat.
              </p>
              <Button
                variant="outline"
                className="mt-4 w-full"
                onClick={() => setActiveForm('wechat')}
              >
                View Setup Guide
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>

            {/* Concierge */}
            <div className="card-elevated p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Wrench className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                Request Concierge Help
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Guidance, best practices, and escalation support.
              </p>
              <Button className="mt-4 w-full" onClick={() => setActiveForm('concierge')}>
                Submit Request
              </Button>
            </div>

            {/* Parts */}
            <div className="card-elevated p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber/10">
                <Package className="h-6 w-6 text-amber" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                Parts Assistance
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Help sourcing replacement parts for your machine.
              </p>
              <Button variant="outline" className="mt-4 w-full" onClick={() => setActiveForm('parts')}>
                Request Parts Help
              </Button>
            </div>
          </div>

          {/* WeChat Guide */}
          {activeForm === 'wechat' && (
            <div className="mt-8 card-elevated p-6">
              <h2 className="font-display text-xl font-semibold text-foreground">
                WeChat Setup Guide
              </h2>
              <div className="mt-4 prose prose-sm max-w-none text-muted-foreground">
                <ol className="space-y-4">
                  <li>
                    <strong className="text-foreground">Download WeChat</strong> — Available on iOS and Android app stores.
                  </li>
                  <li>
                    <strong className="text-foreground">Create an account</strong> — Sign up using your phone number.
                  </li>
                  <li>
                    <strong className="text-foreground">Add Sunze Support</strong> — Scan the QR code provided with your machine, or search for the support ID.
                  </li>
                  <li>
                    <strong className="text-foreground">Send your machine serial</strong> — Include your machine serial number in your first message for faster support.
                  </li>
                </ol>
                <p className="mt-4 rounded-lg bg-sage-light p-4 text-sage">
                  Sunze provides 24/7 first-line technical support. They can help with machine diagnostics, troubleshooting, and warranty issues.
                </p>
              </div>
              <Button variant="outline" className="mt-6" onClick={() => setActiveForm(null)}>
                Close
              </Button>
            </div>
          )}

          {/* Concierge Form */}
          {activeForm === 'concierge' && (
            <div className="mt-8 card-elevated p-6">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Request Concierge Help
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Our team will respond during US business hours (Mon–Fri, 9am–5pm EST).
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit('concierge');
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-foreground">Subject</label>
                  <Input
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="Brief description of your request"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Message</label>
                  <Textarea
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Provide details about what you need help with..."
                    rows={4}
                    required
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-3">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit Request'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setActiveForm(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Parts Form */}
          {activeForm === 'parts' && (
            <div className="mt-8 card-elevated p-6">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Parts Assistance Request
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Describe the part you need. We'll help source it for you.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit('parts');
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-foreground">Part Name/Description</label>
                  <Input
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder="e.g., Heating element, Sugar bowl, etc."
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground">Additional Details</label>
                  <Textarea
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Machine serial number, urgency, any other details..."
                    rows={4}
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-3">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit Request'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setActiveForm(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </section>
    </Layout>
  );
}
