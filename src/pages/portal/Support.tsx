import { useState } from 'react';
import { MessageSquare, Wrench, Package, ArrowRight, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { trackEvent } from '@/lib/analytics';
import { createSupportRequest } from '@/lib/supportRequests';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type SupportType = 'concierge' | 'parts' | 'wechat' | 'wechat_onboarding' | null;
type WeChatDeviceType = 'iphone' | 'android' | 'desktop' | 'other';
type WeChatBlockedStep =
  | 'account_creation'
  | 'sms_verification'
  | 'login_authentication'
  | 'friend_referral'
  | 'other';

const deviceLabelMap: Record<WeChatDeviceType, string> = {
  iphone: 'iPhone',
  android: 'Android',
  desktop: 'Desktop',
  other: 'Other',
};

const blockedStepLabelMap: Record<WeChatBlockedStep, string> = {
  account_creation: 'Account creation',
  sms_verification: 'SMS/phone verification',
  login_authentication: 'Login/authentication step',
  friend_referral: 'Friend referral needed',
  other: 'Other',
};

export default function SupportPage() {
  const { user } = useAuth();
  const [activeForm, setActiveForm] = useState<SupportType>(null);
  const [formData, setFormData] = useState({ subject: '', message: '' });
  const [wechatOnboardingData, setWechatOnboardingData] = useState({
    subject: 'Need help onboarding to WeChat',
    phoneRegion: '+1',
    phoneNumber: '',
    deviceType: 'iphone' as WeChatDeviceType,
    blockedStep: 'sms_verification' as WeChatBlockedStep,
    referralNeeded: 'unsure' as 'yes' | 'no' | 'unsure',
    wechatId: '',
    details: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (type: 'concierge' | 'parts' | 'wechat_onboarding') => {
    if (!user?.id || !user?.email) {
      toast.error('Log in to submit a support request.');
      return;
    }

    setLoading(true);
    try {
      await createSupportRequest({
        requestType: type,
        subject: formData.subject.trim(),
        message: formData.message.trim(),
      });

      trackEvent(`submit_support_request_${type}`, { subject: formData.subject });
      toast.success('Support request submitted! We\'ll get back to you soon.');
      setActiveForm(null);
      setFormData({ subject: '', message: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit support request.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleWeChatOnboardingSubmit = async () => {
    if (!user?.id || !user?.email) {
      toast.error('Log in to submit a support request.');
      return;
    }

    const normalizedPhoneRegion = wechatOnboardingData.phoneRegion.trim();
    const normalizedPhoneNumber = wechatOnboardingData.phoneNumber.trim();
    const normalizedSubject = wechatOnboardingData.subject.trim();
    const normalizedDetails = wechatOnboardingData.details.trim();
    const normalizedWeChatId = wechatOnboardingData.wechatId.trim();

    if (!normalizedSubject || !normalizedPhoneRegion || !normalizedPhoneNumber) {
      toast.error('Please provide subject, phone region, and phone number.');
      return;
    }

    const referralNeeded =
      wechatOnboardingData.referralNeeded === 'yes'
        ? true
        : wechatOnboardingData.referralNeeded === 'no'
          ? false
          : null;

    const message = [
      'WeChat onboarding help request',
      '',
      `Blocked Step: ${blockedStepLabelMap[wechatOnboardingData.blockedStep]}`,
      `Device: ${deviceLabelMap[wechatOnboardingData.deviceType]}`,
      `Phone: ${normalizedPhoneRegion} ${normalizedPhoneNumber}`,
      `Referral help needed: ${
        referralNeeded === null ? 'Not sure yet' : referralNeeded ? 'Yes' : 'No'
      }`,
      `WeChat ID: ${normalizedWeChatId || 'Not provided'}`,
      '',
      'Details:',
      normalizedDetails || 'No additional details provided.',
    ].join('\n');

    setLoading(true);
    try {
      await createSupportRequest({
        requestType: 'wechat_onboarding',
        subject: normalizedSubject,
        message,
        intakeMeta: {
          phone_region: normalizedPhoneRegion,
          phone_number: normalizedPhoneNumber,
          device_type: wechatOnboardingData.deviceType,
          blocked_step: wechatOnboardingData.blockedStep,
          referral_needed: referralNeeded ?? undefined,
          wechat_id: normalizedWeChatId || undefined,
        },
      });

      trackEvent('submit_support_request_wechat_onboarding', {
        blocked_step: wechatOnboardingData.blockedStep,
        device_type: wechatOnboardingData.deviceType,
      });
      toast.success('WeChat onboarding request submitted. Ops will reach out soon.');
      setActiveForm(null);
      setWechatOnboardingData((prev) => ({
        ...prev,
        phoneNumber: '',
        wechatId: '',
        details: '',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit support request.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalLayout>
      <section className="portal-section">
        <div className="container-page">
          <PortalPageIntro
            title="Support"
            description="Get to the right support path faster, whether you need manufacturer help, guided WeChat onboarding, concierge guidance, or replacement parts assistance."
            badges={[
              { label: 'Plus member support', tone: 'success' },
              { label: 'Choose the right lane first', tone: 'muted' },
            ]}
          />

          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {/* WeChat Setup */}
            <div className="card-elevated p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sage-light">
                <MessageSquare className="h-6 w-6 text-sage" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                Get Manufacturer Support
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                24/7 technical support directly from the manufacturer via WeChat.
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

            {/* WeChat Onboarding */}
            <div className="card-elevated p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-100">
                <UserCheck className="h-6 w-6 text-sky-700" />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                WeChat Onboarding Help
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Stuck on signup, verification, or friend-referral steps? Request guided setup.
              </p>
              <Button className="mt-4 w-full" onClick={() => setActiveForm('wechat_onboarding')}>
                Request Onboarding Help
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
                    <strong className="text-foreground">Add Manufacturer Support</strong> — Scan the QR code provided with your machine, or search for the support ID.
                  </li>
                  <li>
                    <strong className="text-foreground">Send your machine serial</strong> — Include your machine serial number in your first message for faster support.
                  </li>
                </ol>
                <p className="mt-4 rounded-lg bg-sage-light p-4 text-sage">
                  The manufacturer support team provides 24/7 first-line technical support. They can help with machine diagnostics, troubleshooting, and warranty issues.
                </p>
              </div>
              <Button variant="outline" className="mt-6" onClick={() => setActiveForm(null)}>
                Close
              </Button>
              <Button className="mt-3" onClick={() => setActiveForm('wechat_onboarding')}>
                Need onboarding help
              </Button>
            </div>
          )}

          {/* WeChat Onboarding Form */}
          {activeForm === 'wechat_onboarding' && (
            <div className="mt-8 card-elevated p-6">
              <h2 className="font-display text-xl font-semibold text-foreground">
                WeChat Onboarding Concierge
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Share your blocker and ops will help you get unblocked, including referral help if
                needed.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleWeChatOnboardingSubmit();
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-foreground">Subject</label>
                  <Input
                    value={wechatOnboardingData.subject}
                    onChange={(e) =>
                      setWechatOnboardingData({ ...wechatOnboardingData, subject: e.target.value })
                    }
                    placeholder="Short summary of your WeChat onboarding issue"
                    required
                    className="mt-1"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Phone Region</label>
                    <Input
                      value={wechatOnboardingData.phoneRegion}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          phoneRegion: e.target.value,
                        })
                      }
                      placeholder="+1"
                      required
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Phone Number</label>
                    <Input
                      value={wechatOnboardingData.phoneNumber}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          phoneNumber: e.target.value,
                        })
                      }
                      placeholder="Number used for WeChat signup"
                      required
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground">Device</label>
                    <select
                      value={wechatOnboardingData.deviceType}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          deviceType: e.target.value as WeChatDeviceType,
                        })
                      }
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {Object.entries(deviceLabelMap).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">Blocked Step</label>
                    <select
                      value={wechatOnboardingData.blockedStep}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          blockedStep: e.target.value as WeChatBlockedStep,
                        })
                      }
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {Object.entries(blockedStepLabelMap).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground">
                      Referral Needed
                    </label>
                    <select
                      value={wechatOnboardingData.referralNeeded}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          referralNeeded: e.target.value as 'yes' | 'no' | 'unsure',
                        })
                      }
                      className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                      <option value="unsure">Not sure</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground">
                    WeChat ID (optional)
                  </label>
                  <Input
                    value={wechatOnboardingData.wechatId}
                    onChange={(e) =>
                      setWechatOnboardingData({
                        ...wechatOnboardingData,
                        wechatId: e.target.value,
                      })
                    }
                    placeholder="If you already have a WeChat ID"
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground">Details</label>
                  <Textarea
                    value={wechatOnboardingData.details}
                    onChange={(e) =>
                      setWechatOnboardingData({
                        ...wechatOnboardingData,
                        details: e.target.value,
                      })
                    }
                    placeholder="Paste error text, describe where you are blocked, and mention if a referral prompt appears."
                    rows={5}
                    className="mt-1"
                  />
                </div>

                <div className="flex gap-3">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Submitting...' : 'Submit Onboarding Request'}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setActiveForm(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
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
    </PortalLayout>
  );
}
