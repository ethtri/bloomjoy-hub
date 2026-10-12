import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Wrench, Package, ArrowRight, ChevronLeft, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { trackEvent } from '@/lib/analytics';
import { createSupportRequest } from '@/lib/supportRequests';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/lib/i18n';
import { toast } from 'sonner';

type SupportType = 'concierge' | 'parts' | 'wechat' | 'wechat_onboarding' | null;
type WeChatDeviceType = 'iphone' | 'android' | 'desktop' | 'other';
type WeChatBlockedStep =
  | 'account_creation'
  | 'sms_verification'
  | 'login_authentication'
  | 'friend_referral'
  | 'other';

const deviceLabelKeyMap: Record<WeChatDeviceType, TranslationKey> = {
  iphone: 'support.deviceIphone',
  android: 'support.deviceAndroid',
  desktop: 'support.deviceDesktop',
  other: 'support.deviceOther',
};

const blockedStepLabelKeyMap: Record<WeChatBlockedStep, TranslationKey> = {
  account_creation: 'support.blockedAccountCreation',
  sms_verification: 'support.blockedSmsVerification',
  login_authentication: 'support.blockedLoginAuthentication',
  friend_referral: 'support.blockedFriendReferral',
  other: 'support.blockedOther',
};

const wechatSetupSteps = [
  {
    titleKey: 'support.wechatStep1Title',
    bulletKeys: ['support.wechatStep1Bullet1', 'support.wechatStep1Bullet2'],
  },
  {
    titleKey: 'support.wechatStep2Title',
    bulletKeys: [
      'support.wechatStep2Bullet1',
      'support.wechatStep2Bullet2',
      'support.wechatStep2Bullet3',
    ],
  },
  {
    titleKey: 'support.wechatStep3Title',
    bulletKeys: [
      'support.wechatStep3Bullet1',
      'support.wechatStep3Bullet2',
      'support.wechatStep3Bullet3',
    ],
  },
  {
    titleKey: 'support.wechatStep4Title',
    bulletKeys: [
      'support.wechatStep4Bullet1',
      'support.wechatStep4Bullet2',
      'support.wechatStep4Bullet3',
    ],
  },
] as const satisfies Array<{ titleKey: TranslationKey; bulletKeys: TranslationKey[] }>;

const wechatQuickActions = [
  {
    titleKey: 'support.quickTranslateTitle',
    descriptionKey: 'support.quickTranslateDescription',
  },
  {
    titleKey: 'support.quickMediaTitle',
    descriptionKey: 'support.quickMediaDescription',
  },
  {
    titleKey: 'support.quickCallTitle',
    descriptionKey: 'support.quickCallDescription',
  },
] as const satisfies Array<{ titleKey: TranslationKey; descriptionKey: TranslationKey }>;

const showLegacyWeChatGuide = false;

export default function SupportPage() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [activeForm, setActiveForm] = useState<SupportType>(null);
  const [drafts, setDrafts] = useState({
    concierge: { subject: '', message: '' },
    parts: { subject: '', message: '' },
  });
  const activeDraftType = activeForm === 'parts' ? 'parts' : 'concierge';
  const formData = drafts[activeDraftType];
  const setFormData = (draft: { subject: string; message: string }) =>
    setDrafts((previous) => ({ ...previous, [activeDraftType]: draft }));
  const taskRef = useRef<HTMLDivElement>(null);
  const intentRef = useRef<HTMLDivElement>(null);
  const originIntentRef = useRef<HTMLButtonElement | null>(null);
  const originTypeRef = useRef<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const selectIntent = (type: SupportType) => {
    originIntentRef.current = document.activeElement instanceof HTMLButtonElement
      ? document.activeElement : originIntentRef.current;
    originTypeRef.current = type;
    setSubmitError(null);
    setActiveForm(type);
  };
  useEffect(() => {
    if (activeForm) {
      const heading = taskRef.current?.querySelector<HTMLHeadingElement>('h2');
      heading?.focus({ preventScroll: true });
      taskRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    } else if (originIntentRef.current) {
      const target = originIntentRef.current.isConnected ? originIntentRef.current
        : intentRef.current?.querySelector<HTMLButtonElement>(`[data-support-intent="${originTypeRef.current}"]`);
      target?.focus({ preventScroll: true });
      intentRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [activeForm]);
  const [wechatOnboardingData, setWechatOnboardingData] = useState({
    subject: '',
    phoneRegion: '+1',
    phoneNumber: '',
    deviceType: 'iphone' as WeChatDeviceType,
    blockedStep: 'sms_verification' as WeChatBlockedStep,
    referralNeeded: 'unsure' as 'yes' | 'no' | 'unsure',
    wechatId: '',
    details: '',
  });
  const [loading, setLoading] = useState(false);

  const openWeChatOnboardingForm = () => {
    setWechatOnboardingData((prev) => ({
      ...prev,
      subject: prev.subject || t('support.defaultWechatSubject'),
    }));
    selectIntent('wechat_onboarding');
  };

  const handleSubmit = async (type: 'concierge' | 'parts' | 'wechat_onboarding') => {
    if (!user?.id || !user?.email) {
      toast.error(t('support.loginRequired'));
      return;
    }

    setSubmitError(null);
    setLoading(true);
    try {
      await createSupportRequest({
        requestType: type,
        subject: formData.subject.trim(),
        message: formData.message.trim(),
      });

      trackEvent(`submit_support_request_${type}`, { subject: formData.subject });
      toast.success(t('support.submitSuccess'));
      setActiveForm(null);
      setFormData({ subject: '', message: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('support.unableSubmit');
      setSubmitError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleWeChatOnboardingSubmit = async () => {
    if (!user?.id || !user?.email) {
      toast.error(t('support.loginRequired'));
      return;
    }

    const normalizedPhoneRegion = wechatOnboardingData.phoneRegion.trim();
    const normalizedPhoneNumber = wechatOnboardingData.phoneNumber.trim();
    const normalizedSubject = wechatOnboardingData.subject.trim();
    const normalizedDetails = wechatOnboardingData.details.trim();
    const normalizedWeChatId = wechatOnboardingData.wechatId.trim();

    if (!normalizedSubject || !normalizedPhoneRegion || !normalizedPhoneNumber) {
      setSubmitError(t('support.validationRequired'));
      toast.error(t('support.validationRequired'));
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
      `Blocked Step: ${t(blockedStepLabelKeyMap[wechatOnboardingData.blockedStep])}`,
      `Device: ${t(deviceLabelKeyMap[wechatOnboardingData.deviceType])}`,
      `Phone: ${normalizedPhoneRegion} ${normalizedPhoneNumber}`,
      `Referral help needed: ${
        referralNeeded === null ? 'Not sure yet' : referralNeeded ? 'Yes' : 'No'
      }`,
      `WeChat ID: ${normalizedWeChatId || 'Not provided'}`,
      '',
      'Details:',
      normalizedDetails || 'No additional details provided.',
    ].join('\n');

    setSubmitError(null);
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
      toast.success(t('support.onboardingSuccess'));
      setActiveForm(null);
      setWechatOnboardingData((prev) => ({
        ...prev,
        phoneNumber: '',
        wechatId: '',
        details: '',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('support.unableSubmit');
      setSubmitError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PortalLayout>
      <section className="py-5 sm:py-8 lg:py-10">
        <div className="container-page">
          {activeForm && <h1 className="sr-only">{t('support.title')}</h1>}
          {!activeForm && (
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{t('support.title')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t('support.chooseLane')}</p>
            </div>
          )}

          {!activeForm ? (
            <div ref={intentRef} className="mt-6 grid gap-2 sm:grid-cols-2" aria-label={t('support.chooseLane')}>
              {([
                { type: 'concierge', title: 'support.conciergeTitle', description: 'support.conciergeDescription', Icon: Wrench },
                { type: 'parts', title: 'support.partsTitle', description: 'support.partsDescription', Icon: Package },
                { type: 'wechat_onboarding', title: 'support.wechatHelpTitle', description: 'support.wechatHelpDescription', Icon: UserCheck },
                { type: 'wechat', title: 'support.manufacturerTitle', description: 'support.manufacturerDescription', Icon: MessageSquare },
              ] as const).map(({ type, title, description, Icon }) => (
                <button
                  key={type}
                  data-support-intent={type}
                  type="button"
                  onClick={() => type === 'wechat_onboarding' ? openWeChatOnboardingForm() : selectIntent(type)}
                  className="flex min-h-11 items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-foreground">{t(title)}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{t(description)}</span>
                  </span>
                  <ArrowRight aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <Button variant="ghost" className="mt-4 min-h-11 px-0" disabled={loading} onClick={() => setActiveForm(null)}>
              <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />
              {language === 'zh-Hans' ? '更换支持选项' : 'Change support option'}
            </Button>
          )}

          <div ref={taskRef} className="scroll-mt-24">
          {/* WeChat Guide */}
          {activeForm === 'wechat' && (
            <div className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-6">
              <h2 tabIndex={-1} className="text-xl font-semibold text-foreground focus:outline-none">
                {t('support.wechatSetupGuideTitle')}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {t('support.wechatSetupGuideDescription')}
              </p>

              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {wechatSetupSteps.map((section) => (
                  <section
                    key={section.titleKey}
                    className="rounded-2xl border border-border/70 bg-background/80 p-4"
                  >
                    <h3 className="font-semibold text-foreground">{t(section.titleKey)}</h3>
                    <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {section.bulletKeys.map((bulletKey) => (
                        <li key={bulletKey} className="flex gap-2">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{t(bulletKey)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-sage/20 bg-sage-light p-4">
                <p className="text-sm font-medium text-sage">{t('support.timingTip')}</p>
                <p className="mt-2 text-sm text-sage">
                  {t('support.timingTipDescription')}
                </p>
              </div>

              <div className="mt-6">
                <h3 className="font-semibold text-foreground">{t('support.quickActionsTitle')}</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  {wechatQuickActions.map((action) => (
                    <section
                      key={action.titleKey}
                      className="rounded-2xl border border-border/70 bg-muted/20 p-4"
                    >
                      <h4 className="text-sm font-semibold text-foreground">{t(action.titleKey)}</h4>
                      <p className="mt-2 text-sm text-muted-foreground">{t(action.descriptionKey)}</p>
                    </section>
                  ))}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-primary/15 bg-primary/5 p-4">
                <p className="text-sm text-muted-foreground">
                  {t('support.manufacturerTeamDescription')}
                </p>
              </div>
              {showLegacyWeChatGuide && (
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
              )}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button
                  variant="outline"
                  className="min-h-11 w-full sm:w-auto"
                  onClick={() => setActiveForm(null)}
                >
                  {t('support.close')}
                </Button>
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  onClick={openWeChatOnboardingForm}
                >
                  {t('support.needOnboardingHelp')}
                </Button>
              </div>
            </div>
          )}

          {/* WeChat Onboarding Form */}
          {activeForm === 'wechat_onboarding' && (
            <div className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-6">
              <h2 tabIndex={-1} className="text-xl font-semibold text-foreground focus:outline-none">
                {t('support.onboardingConciergeTitle')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('support.onboardingConciergeDescription')}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleWeChatOnboardingSubmit();
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label htmlFor="support-wechat-subject" className="block text-sm font-medium text-foreground">{t('support.subject')}</label>
                  <Input
                    id="support-wechat-subject"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.subject}
                    onChange={(e) =>
                      setWechatOnboardingData({ ...wechatOnboardingData, subject: e.target.value })
                    }
                    placeholder={t('support.wechatSubjectPlaceholder')}
                    required
                    className="mt-1 h-11 text-base md:text-sm"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="support-wechat-phoneRegion" className="block text-sm font-medium text-foreground">{t('support.phoneRegion')}</label>
                  <Input
                    id="support-wechat-phoneRegion"
                    disabled={loading}
                    type="tel" inputMode="tel" autoComplete="tel-country-code"
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.phoneRegion}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          phoneRegion: e.target.value,
                        })
                      }
                      placeholder="+1"
                      required
                      className="mt-1 h-11 text-base md:text-sm"
                    />
                  </div>
                  <div>
                    <label htmlFor="support-wechat-phoneNumber" className="block text-sm font-medium text-foreground">{t('support.phoneNumber')}</label>
                  <Input
                    id="support-wechat-phoneNumber"
                    disabled={loading}
                    type="tel" inputMode="tel" autoComplete="tel-national"
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.phoneNumber}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          phoneNumber: e.target.value,
                        })
                      }
                      placeholder={t('support.phoneNumberPlaceholder')}
                      required
                      className="mt-1 h-11 text-base md:text-sm"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label htmlFor="support-wechat-deviceType" className="block text-sm font-medium text-foreground">{t('support.device')}</label>
                  <select
                    id="support-wechat-deviceType"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.deviceType}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          deviceType: e.target.value as WeChatDeviceType,
                        })
                      }
                      className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
                    >
                      {(Object.keys(deviceLabelKeyMap) as WeChatDeviceType[]).map((value) => (
                        <option key={value} value={value}>
                          {t(deviceLabelKeyMap[value])}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="support-wechat-blockedStep" className="block text-sm font-medium text-foreground">{t('support.blockedStep')}</label>
                  <select
                    id="support-wechat-blockedStep"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.blockedStep}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          blockedStep: e.target.value as WeChatBlockedStep,
                        })
                      }
                      className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
                    >
                      {(Object.keys(blockedStepLabelKeyMap) as WeChatBlockedStep[]).map((value) => (
                        <option key={value} value={value}>
                          {t(blockedStepLabelKeyMap[value])}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="support-wechat-referralNeeded" className="block text-sm font-medium text-foreground">
                      {t('support.referralNeeded')}
                    </label>
                  <select
                    id="support-wechat-referralNeeded"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.referralNeeded}
                      onChange={(e) =>
                        setWechatOnboardingData({
                          ...wechatOnboardingData,
                          referralNeeded: e.target.value as 'yes' | 'no' | 'unsure',
                        })
                      }
                      className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm"
                    >
                      <option value="yes">{t('support.yes')}</option>
                      <option value="no">{t('support.no')}</option>
                      <option value="unsure">{t('support.notSure')}</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="support-wechat-wechatId" className="block text-sm font-medium text-foreground">
                    {t('support.wechatIdOptional')}
                  </label>
                  <Input
                    id="support-wechat-wechatId"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.wechatId}
                    onChange={(e) =>
                      setWechatOnboardingData({
                        ...wechatOnboardingData,
                        wechatId: e.target.value,
                      })
                    }
                    placeholder={t('support.wechatIdPlaceholder')}
                    className="mt-1 h-11 text-base md:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="support-wechat-details" className="block text-sm font-medium text-foreground">{t('support.details')}</label>
                  <Textarea
                    id="support-wechat-details"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={wechatOnboardingData.details}
                    onChange={(e) =>
                      setWechatOnboardingData({
                        ...wechatOnboardingData,
                        details: e.target.value,
                      })
                    }
                    placeholder={t('support.detailsPlaceholder')}
                    rows={5}
                    className="mt-1 text-base md:text-sm"
                  />
                </div>

                {submitError && <p id="support-submit-error" role="alert" className="text-sm text-destructive">{submitError}</p>}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={loading}>
                    {loading ? t('support.submitting') : t('support.submitOnboarding')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => setActiveForm(null)}
                    disabled={loading}
                  >
                    {t('support.cancel')}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Concierge Form */}
          {activeForm === 'concierge' && (
            <div className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-6">
              <h2 tabIndex={-1} className="text-xl font-semibold text-foreground focus:outline-none">
                {t('support.requestConciergeTitle')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('support.requestConciergeDescription')}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit('concierge');
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label htmlFor="support-subject" className="block text-sm font-medium text-foreground">{t('support.subject')}</label>
                  <Input
                    id="support-subject"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder={t('support.subjectPlaceholder')}
                    required
                    className="mt-1 h-11 text-base md:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="support-message" className="block text-sm font-medium text-foreground">{t('support.message')}</label>
                  <Textarea
                    id="support-message"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder={t('support.messagePlaceholder')}
                    rows={4}
                    required
                    className="mt-1 text-base md:text-sm"
                  />
                </div>
                {submitError && <p id="support-submit-error" role="alert" className="text-sm text-destructive">{submitError}</p>}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={loading}>
                    {loading ? t('support.submitting') : t('support.submitRequest')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => setActiveForm(null)}
                    disabled={loading}
                  >
                    {t('support.cancel')}
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Parts Form */}
          {activeForm === 'parts' && (
            <div className="mt-3 rounded-xl border border-border bg-card p-4 sm:p-6">
              <h2 tabIndex={-1} className="text-xl font-semibold text-foreground focus:outline-none">
                {t('support.partsRequestTitle')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('support.partsRequestDescription')}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSubmit('parts');
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label htmlFor="support-subject" className="block text-sm font-medium text-foreground">{t('support.partNameDescription')}</label>
                  <Input
                    id="support-subject"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={formData.subject}
                    onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                    placeholder={t('support.partNamePlaceholder')}
                    required
                    className="mt-1 h-11 text-base md:text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="support-message" className="block text-sm font-medium text-foreground">{t('support.additionalDetails')}</label>
                  <Textarea
                    id="support-message"
                    disabled={loading}
                    aria-describedby={submitError ? 'support-submit-error' : undefined}
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder={t('support.additionalDetailsPlaceholder')}
                    rows={4}
                    className="mt-1 text-base md:text-sm"
                  />
                </div>
                {submitError && <p id="support-submit-error" role="alert" className="text-sm text-destructive">{submitError}</p>}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={loading}>
                    {loading ? t('support.submitting') : t('support.submitRequest')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 w-full sm:w-auto"
                    onClick={() => setActiveForm(null)}
                    disabled={loading}
                  >
                    {t('support.cancel')}
                  </Button>
                </div>
              </form>
            </div>
          )}
          </div>
        </div>
      </section>
    </PortalLayout>
  );
}
