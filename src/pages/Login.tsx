import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  GraduationCap,
  Headset,
  KeyRound,
  Loader2,
  Mail,
  Package,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppLayout } from '@/components/layout/AppLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCanonicalUrlForSurface } from '@/lib/appSurface';
import type { TranslationKey } from '@/lib/i18n';
import { toast } from 'sonner';

const RESEND_COOLDOWN_SECONDS = 60;
type AuthMethod = 'password' | 'magic_link';
const GOOGLE_GSI_SCRIPT_ID = 'google-gsi-script';
const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleRenderButtonOptions = {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
};

type GoogleAccountsIdApi = {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    ux_mode?: 'popup' | 'redirect';
  }) => void;
  renderButton: (element: HTMLElement, options: GoogleRenderButtonOptions) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsIdApi;
      };
    };
  }
}

type OperatorHighlight = {
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
};

const operatorHighlights: OperatorHighlight[] = [
  {
    titleKey: 'login.highlight.trainingTitle',
    descriptionKey: 'login.highlight.trainingDescription',
    icon: GraduationCap,
  },
  {
    titleKey: 'login.highlight.onboardingTitle',
    descriptionKey: 'login.highlight.onboardingDescription',
    icon: ClipboardCheck,
  },
  {
    titleKey: 'login.highlight.supportTitle',
    descriptionKey: 'login.highlight.supportDescription',
    icon: Headset,
  },
  {
    titleKey: 'login.highlight.ordersTitle',
    descriptionKey: 'login.highlight.ordersDescription',
    icon: Package,
  },
];

const GoogleMark = () => (
  <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
    <path
      d="M21.35 11.1H12v2.96h5.35c-.23 1.51-1.9 4.42-5.35 4.42-3.22 0-5.84-2.67-5.84-5.97s2.62-5.97 5.84-5.97c1.84 0 3.07.78 3.78 1.45l2.58-2.49C16.71 3.98 14.58 3 12 3 6.98 3 2.91 7.1 2.91 12.12s4.07 9.12 9.09 9.12c5.25 0 8.73-3.69 8.73-8.9 0-.6-.06-1.06-.14-1.24Z"
      fill="#4285F4"
    />
    <path
      d="M6.03 14.6 5.1 15.31l-3.3 2.57A9.11 9.11 0 0 0 12 21.24c2.58 0 4.74-.85 6.33-2.3l-3.1-2.4c-.84.59-1.95 1-3.23 1-2.58 0-4.76-1.74-5.54-4.1Z"
      fill="#34A853"
    />
    <path
      d="M1.8 6.12A9.11 9.11 0 0 0 2.9 12c0 1.96.63 3.78 1.7 5.28l4.23-3.29A5.97 5.97 0 0 1 8.16 12c0-.69.12-1.35.34-1.96L4.27 6.76 1.8 6.12Z"
      fill="#FBBC05"
    />
    <path
      d="M12 6.54c1.4 0 2.65.48 3.64 1.42l2.73-2.67C16.74 3.77 14.58 3 12 3a9.1 9.1 0 0 0-8.2 5.12l4.7 3.64c.78-2.36 2.96-4.22 5.5-4.22Z"
      fill="#EA4335"
    />
  </svg>
);

const safeDecode = (value?: string | null) => {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const getSendLinkErrorMessage = (error: { status?: number; code?: string; message?: string }) => {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
    return 'Too many email attempts. Please wait about a minute before trying again.';
  }

  if (error.code === 'otp_expired') {
    return 'This sign-in link has expired. Please request a new one.';
  }

  if (error.message && error.message.trim().length > 0) {
    return `Unable to send sign-in email: ${error.message}`;
  }

  return 'Failed to send magic link.';
};

const getPasswordErrorMessage = (
  error: { status?: number; code?: string; message?: string },
  isCreateMode: boolean
) => {
  if (error.status === 429) {
    return 'Too many attempts right now. Please wait and try again.';
  }

  if (!isCreateMode && error.code === 'invalid_credentials') {
    return 'Incorrect email or password.';
  }

  if (!isCreateMode && error.code === 'email_not_confirmed') {
    return 'Please confirm your email before signing in with password.';
  }

  if (isCreateMode && error.code === 'user_already_exists') {
    return 'This email already has an account. Try signing in with password instead.';
  }

  if (error.message && error.message.trim().length > 0) {
    return error.message;
  }

  return isCreateMode
    ? 'Unable to create account with password.'
    : 'Unable to sign in with password.';
};

const getGoogleErrorMessage = (error: { status?: number; code?: string; message?: string }) => {
  if (error.status === 429) {
    return 'Too many sign-in attempts right now. Please wait and try again.';
  }

  if (error.message && error.message.trim().length > 0) {
    return `Google sign-in failed: ${error.message}`;
  }

  return 'Unable to continue with Google sign-in.';
};

const getPasswordResetErrorMessage = (error: {
  status?: number;
  code?: string;
  message?: string;
}) => {
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
    return 'Too many reset attempts. Please wait about a minute before trying again.';
  }

  if (error.message && error.message.trim().length > 0) {
    return `Unable to send password reset email: ${error.message}`;
  }

  return 'Unable to send password reset email.';
};

const getRedirectErrorMessage = (errorCode?: string | null, errorDescription?: string | null) => {
  const description = safeDecode(errorDescription).toLowerCase();

  if (
    errorCode === 'otp_expired' ||
    description.includes('expired') ||
    description.includes('invalid')
  ) {
    return 'This sign-in link is invalid or expired. Please request a fresh link.';
  }

  if (errorCode === 'over_email_send_rate_limit' || description.includes('rate limit')) {
    return 'Too many email attempts. Please wait about a minute before retrying.';
  }

  if (errorCode === 'access_denied') {
    return 'Google sign-in was canceled or denied. Please try again.';
  }

  if (errorCode || errorDescription) {
    return 'Sign-in could not be completed. Please try again.';
  }

  return undefined;
};

export default function LoginPage() {
  const { t } = useLanguage();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  const useGisRenderedButton =
    import.meta.env.DEV && import.meta.env.VITE_USE_GIS_BUTTON === 'true' && Boolean(googleClientId);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [googleButtonReady, setGoogleButtonReady] = useState(false);
  const [googleButtonFailed, setGoogleButtonFailed] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [createAccountMode, setCreateAccountMode] = useState(false);
  const googleButtonContainerRef = useRef<HTMLDivElement | null>(null);
  const signInWithGoogleIdTokenRef = useRef<
    ((idToken: string) => Promise<{ error: { status?: number; code?: string; message?: string } | null }>) | null
  >(null);
  const {
    signIn,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    signInWithGoogleIdToken,
    requestPasswordReset,
    isAuthenticated,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath =
    (location.state as { from?: { pathname?: string } })?.from?.pathname || '/portal';
  const mainSiteUrl = getCanonicalUrlForSurface('marketing', '/', '', '', window.location);
  const plusUrl = getCanonicalUrlForSurface('marketing', '/plus', '', '', window.location);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(fromPath, { replace: true });
    }
  }, [fromPath, isAuthenticated, navigate]);

  useEffect(() => {
    signInWithGoogleIdTokenRef.current = signInWithGoogleIdToken;
  }, [signInWithGoogleIdToken]);

  useEffect(() => {
    if (!useGisRenderedButton || !googleClientId) {
      setGoogleButtonReady(false);
      return;
    }

    let mounted = true;
    let scriptElement = document.getElementById(GOOGLE_GSI_SCRIPT_ID) as HTMLScriptElement | null;

    const renderGoogleButton = () => {
      if (!mounted) {
        return;
      }

      const api = window.google?.accounts?.id;
      const container = googleButtonContainerRef.current;

      if (!api || !container) {
        return;
      }

      api.initialize({
        client_id: googleClientId,
        ux_mode: 'popup',
        callback: async (response) => {
          if (!response.credential) {
            toast.error('Google sign-in did not return a valid credential.');
            return;
          }

          setOauthLoading(true);

          const signInFn = signInWithGoogleIdTokenRef.current;
          if (!signInFn) {
            toast.error('Google sign-in is not ready yet. Please try again.');
            setOauthLoading(false);
            return;
          }

          const { error } = await signInFn(response.credential);
          if (error) {
            toast.error(getGoogleErrorMessage(error));
          } else {
            toast.success('Signed in with Google. Redirecting...');
          }

          setOauthLoading(false);
        },
      });

      container.innerHTML = '';
      api.renderButton(container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: Math.max(240, Math.floor(container.clientWidth)),
      });

      setGoogleButtonReady(true);
      setGoogleButtonFailed(false);
    };

    const handleLoad = () => renderGoogleButton();
    const handleError = () => {
      if (!mounted) {
        return;
      }

      setGoogleButtonReady(false);
      setGoogleButtonFailed(true);
    };

    if (window.google?.accounts?.id) {
      renderGoogleButton();
    } else {
      if (!scriptElement) {
        scriptElement = document.createElement('script');
        scriptElement.id = GOOGLE_GSI_SCRIPT_ID;
        scriptElement.src = GOOGLE_GSI_SCRIPT_SRC;
        scriptElement.async = true;
        scriptElement.defer = true;
        document.head.appendChild(scriptElement);
      }

      scriptElement.addEventListener('load', handleLoad);
      scriptElement.addEventListener('error', handleError);
    }

    return () => {
      mounted = false;
      scriptElement?.removeEventListener('load', handleLoad);
      scriptElement?.removeEventListener('error', handleError);
    };
  }, [googleClientId, useGisRenderedButton]);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setCooldownSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cooldownSeconds]);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(hash);
    const errorCode = queryParams.get('error_code') ?? hashParams.get('error_code');
    const errorDescription =
      queryParams.get('error_description') ?? hashParams.get('error_description');
    const message = getRedirectErrorMessage(errorCode, errorDescription);

    if (!message) {
      return;
    }

    toast.error(message);
    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  const handleMagicLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownSeconds > 0) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return;
    }

    setLoading(true);

    const { error } = await signIn(normalizedEmail);

    if (error) {
      const errorMessage = getSendLinkErrorMessage(error);
      toast.error(errorMessage);

      if (error.status === 429 || error.code === 'over_email_send_rate_limit') {
        setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      }

      setLoading(false);
      return;
    }

    setEmail(normalizedEmail);
    setSent(true);
    setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    toast.success(
      'Email sent. First-time sign-ins may require confirming signup first, then requesting a fresh link.'
    );
    setLoading(false);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();

    if (!normalizedEmail || !normalizedPassword) {
      toast.error('Email and password are required.');
      return;
    }

    setLoading(true);

    const { error } = createAccountMode
      ? await signUpWithPassword(normalizedEmail, normalizedPassword)
      : await signInWithPassword(normalizedEmail, normalizedPassword);

    if (error) {
      toast.error(getPasswordErrorMessage(error, createAccountMode));
      setLoading(false);
      return;
    }

    setEmail(normalizedEmail);

    if (createAccountMode) {
      toast.success('Account created. Check your email to confirm, then sign in.');
      setCreateAccountMode(false);
    } else {
      toast.success('Signed in. Redirecting...');
    }

    setLoading(false);
  };

  const handleGoogleSignIn = async () => {
    setOauthLoading(true);

    const { error } = await signInWithGoogle();

    if (error) {
      toast.error(getGoogleErrorMessage(error));
      setOauthLoading(false);
      return;
    }

    setOauthLoading(false);
  };

  const handlePasswordResetRequest = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error('Enter your email first, then click Forgot password.');
      return;
    }

    setLoading(true);
    const { error } = await requestPasswordReset(normalizedEmail);

    if (error) {
      toast.error(getPasswordResetErrorMessage(error));
      setLoading(false);
      return;
    }

    toast.success('Password reset email sent. Use the newest email link to set a new password.');
    setLoading(false);
  };

  const handleSwitchMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    setSent(false);
  };

  return (
    <AppLayout>
      <section className="portal-section">
        <div className="container-page">
          <div className="grid gap-5 xl:grid-cols-[0.95fr,1.05fr]">
            <div className="order-2 rounded-[28px] border border-border bg-gradient-to-br from-background via-background to-muted/40 p-5 shadow-[var(--shadow-md)] sm:p-7 xl:order-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground sm:h-14 sm:w-14">
                <Mail className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                {t('login.operatorAccess')}
              </p>
              <h1 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-4xl">
                {t('login.heroTitle')}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {t('login.heroDescription')}
              </p>

              <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/5 p-4 shadow-[var(--shadow-sm)]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background text-primary">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {t('login.reportingTitle')}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {t('login.reportingDescription')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2.5 sm:space-y-3">
                {operatorHighlights.map((highlight) => {
                  const HighlightIcon = highlight.icon;

                  return (
                    <div
                      key={highlight.title}
                      className="rounded-[22px] border border-border bg-background/90 p-4 shadow-[var(--shadow-sm)]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <HighlightIcon className="h-5 w-5" />
                        </div>
                        <div>
                          <h2 className="font-semibold text-foreground">
                            {t(highlight.titleKey)}
                          </h2>
                          <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            {t(highlight.descriptionKey)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 rounded-[22px] border border-border bg-background/90 p-4 shadow-[var(--shadow-sm)]">
                <p className="text-sm text-muted-foreground">
                  {t('login.productDetailsPrompt')}{' '}
                  <a href={mainSiteUrl} className="font-medium text-primary hover:underline">
                    {t('login.visitPublicSite')}
                  </a>
                </p>
              </div>
            </div>

            <div className="order-1 rounded-[28px] border border-border bg-background p-5 shadow-[var(--shadow-md)] sm:p-7 xl:order-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('login.signInEyebrow')}
                </p>
                <h2 className="mt-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                  {t('login.chooseFastest')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t('login.methodDescription')}
                </p>
              </div>

              <div className="mt-6 space-y-4">
              <div className="space-y-2">
                {useGisRenderedButton ? (
                  <>
                    <div className="relative min-h-12">
                      <div
                        ref={googleButtonContainerRef}
                        className={`flex min-h-11 w-full items-center justify-center ${
                          oauthLoading ? 'pointer-events-none opacity-80' : ''
                        }`}
                      />
                      {oauthLoading && (
                        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/60">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    {!googleButtonReady && !googleButtonFailed && (
                      <p className="text-center text-xs text-muted-foreground">
                        {t('login.loadingGoogle')}
                      </p>
                    )}
                    {googleButtonFailed && (
                      <button
                        type="button"
                        className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#dadce0] bg-white px-4 font-sans text-base font-medium text-[#3c4043] transition hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:opacity-70"
                        onClick={handleGoogleSignIn}
                        disabled={loading || oauthLoading}
                      >
                        <GoogleMark />
                        {oauthLoading ? (
                          <>
                            {t('login.redirecting')}
                            <Loader2 className="h-4 w-4 animate-spin text-[#5f6368]" />
                          </>
                        ) : (
                          t('login.continueGoogle')
                        )}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#dadce0] bg-white px-4 font-sans text-base font-medium text-[#3c4043] transition hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:opacity-70"
                      onClick={handleGoogleSignIn}
                      disabled={loading || oauthLoading}
                    >
                      <GoogleMark />
                      {oauthLoading ? (
                        <>
                          {t('login.redirectingGoogle')}
                          <Loader2 className="h-4 w-4 animate-spin text-[#5f6368]" />
                        </>
                      ) : (
                        t('login.continueGoogle')
                      )}
                    </button>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-border bg-background p-1">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      authMethod === 'password'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    onClick={() => handleSwitchMethod('password')}
                  >
                    {t('login.password')}
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      authMethod === 'magic_link'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted'
                    }`}
                    onClick={() => handleSwitchMethod('magic_link')}
                  >
                    {t('login.emailLink')}
                  </button>
                </div>
              </div>

              {authMethod === 'magic_link' ? (
                sent ? (
                  <div className="rounded-xl border border-sage bg-sage-light p-6 text-center">
                    <h2 className="font-display text-lg font-semibold text-sage">
                      {t('login.checkEmail')}
                    </h2>
                    <p className="mt-2 text-sm text-sage/80">
                      {t('login.sentEmail', { email })}
                    </p>
                    <p className="mt-2 text-xs text-sage/80">
                      {t('login.firstTimeNote')}
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="email-link" className="block text-sm font-medium text-foreground">
                        {t('login.emailAddress')}
                      </label>
                      <Input
                        id="email-link"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="mt-1"
                      />
                    </div>
                    <Button
                      type="submit"
                      variant="hero"
                      size="lg"
                      className="w-full"
                      disabled={loading || cooldownSeconds > 0 || oauthLoading}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('login.sending')}
                        </>
                      ) : cooldownSeconds > 0 ? (
                        <>{t('login.tryAgain', { seconds: cooldownSeconds })}</>
                      ) : (
                        <>
                          {t('login.continueEmail')}
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                    {cooldownSeconds > 0 && (
                      <p className="text-center text-xs text-muted-foreground">
                        {t('login.emailLimited')}
                      </p>
                    )}
                  </form>
                )
              ) : (
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email-password" className="block text-sm font-medium text-foreground">
                      {t('login.emailAddress')}
                    </label>
                    <Input
                      id="email-password"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="password" className="block text-sm font-medium text-foreground">
                      {t('login.password')}
                    </label>
                    <Input
                      id="password"
                      type="password"
                      placeholder={t('login.passwordPlaceholder')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="mt-1"
                    />
                  </div>
                  <button
                    type="button"
                    className="w-full text-left text-sm font-medium text-primary hover:underline"
                    onClick={handlePasswordResetRequest}
                    disabled={loading || oauthLoading}
                  >
                    {t('login.forgotPassword')}
                  </button>
                  <Button
                    type="submit"
                    variant="hero"
                    size="lg"
                    className="w-full"
                    disabled={loading || oauthLoading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {t('login.working')}
                      </>
                    ) : createAccountMode ? (
                      <>
                        {t('login.createAccount')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    ) : (
                      <>
                        {t('login.signInPassword')}
                        <KeyRound className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    className="w-full text-sm font-medium text-primary hover:underline"
                    onClick={() => setCreateAccountMode((current) => !current)}
                    disabled={loading || oauthLoading}
                  >
                    {createAccountMode
                      ? t('login.alreadyHaveAccount')
                      : t('login.needAccount')}
                  </button>
                  <p className="text-center text-xs text-muted-foreground">
                    {t('login.emailLinkOnly')}
                  </p>
                </form>
              )}

              <p className="text-center text-sm text-muted-foreground">
                {t('login.plusPrompt')}{' '}
                <a href={plusUrl} className="font-medium text-primary hover:underline">
                  {t('login.learnPlus')}
                </a>
              </p>
            </div>
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
