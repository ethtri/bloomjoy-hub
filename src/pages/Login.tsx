import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  ClipboardCheck,
  GraduationCap,
  Headset,
  KeyRound,
  Loader2,
  Mail,
  Package,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useAuth } from '@/contexts/AuthContext';
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

type OperatorHighlight = {
  title: string;
  description: string;
  icon: LucideIcon;
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

const operatorHighlights: OperatorHighlight[] = [
  {
    title: 'Training library',
    description: 'Start Operator Essentials, module-based lessons, and progress checkpoints.',
    icon: GraduationCap,
  },
  {
    title: 'Onboarding checklists',
    description: 'Pick up setup and launch steps without jumping through sales content first.',
    icon: ClipboardCheck,
  },
  {
    title: 'Support requests',
    description: 'Send blockers to Bloomjoy support with the right machine and workflow context.',
    icon: Headset,
  },
  {
    title: 'Orders and account',
    description: 'Review supply orders, shipping details, and account information from one portal.',
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
  const isOperatorLogin = location.pathname === '/login/operator';
  const fromPath =
    (location.state as { from?: { pathname?: string } })?.from?.pathname || '/portal';
  const headingAlignmentClass = isOperatorLogin ? 'text-left' : 'text-center';
  const badgeWrapperClass = isOperatorLogin ? '' : 'mx-auto';
  const authHeading = isOperatorLogin
    ? 'Sign in with your Bloomjoy account'
    : 'Sign in to your account';
  const authDescription = isOperatorLogin
    ? 'Operators can use password, Google, or email-link sign-in to reach training, onboarding, and support tools.'
    : 'Choose password, Google, or email link sign-in.';

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

  const authPanel = (
    <div className="space-y-4">
      <div className={headingAlignmentClass}>
        <div
          className={`${badgeWrapperClass} flex h-14 w-14 items-center justify-center rounded-xl ${
            isOperatorLogin ? 'bg-primary/10 text-primary' : 'bg-primary text-primary-foreground'
          }`}
        >
          {isOperatorLogin ? (
            <ShieldCheck className="h-7 w-7" />
          ) : (
            <Mail className="h-7 w-7" />
          )}
        </div>
        {isOperatorLogin ? (
          <h2 className="mt-6 font-display text-3xl font-bold text-foreground">{authHeading}</h2>
        ) : (
          <h1 className="mt-6 font-display text-3xl font-bold text-foreground">{authHeading}</h1>
        )}
        <p className="mt-2 text-muted-foreground">{authDescription}</p>
      </div>

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
              <p className="text-center text-xs text-muted-foreground">Loading Google sign-in...</p>
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
                    Redirecting...
                    <Loader2 className="h-4 w-4 animate-spin text-[#5f6368]" />
                  </>
                ) : (
                  'Continue with Google'
                )}
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#dadce0] bg-white px-4 font-sans text-base font-medium text-[#3c4043] transition hover:bg-[#f8f9fa] disabled:cursor-not-allowed disabled:opacity-70"
            onClick={handleGoogleSignIn}
            disabled={loading || oauthLoading}
          >
            <GoogleMark />
            {oauthLoading ? (
              <>
                Redirecting to Google...
                <Loader2 className="h-4 w-4 animate-spin text-[#5f6368]" />
              </>
            ) : (
              'Continue with Google'
            )}
          </button>
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
            Password
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
            Email Link
          </button>
        </div>
      </div>

      {authMethod === 'magic_link' ? (
        sent ? (
          <div className="rounded-xl border border-sage bg-sage-light p-6 text-center">
            <h3 className="font-display text-lg font-semibold text-sage">Check your email</h3>
            <p className="mt-2 text-sm text-sage/80">
              We sent a sign-in email to <strong>{email}</strong>. Click the newest link to
              continue.
            </p>
            <p className="mt-2 text-xs text-sage/80">
              First-time users may see a signup confirmation email first. After confirming,
              request a new sign-in link.
            </p>
          </div>
        ) : (
          <form onSubmit={handleMagicLinkSubmit} className="space-y-4">
            <div>
              <label htmlFor="email-link" className="block text-sm font-medium text-foreground">
                Email address
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
                  Sending...
                </>
              ) : cooldownSeconds > 0 ? (
                <>Try again in {cooldownSeconds}s</>
              ) : (
                <>
                  Continue with Email Link
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            {cooldownSeconds > 0 && (
              <p className="text-center text-xs text-muted-foreground">
                Email sends are temporarily limited. Please wait before requesting another link.
              </p>
            )}
          </form>
        )
      ) : (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <label htmlFor="email-password" className="block text-sm font-medium text-foreground">
              Email address
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
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
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
            Forgot password? Send reset email
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
                Working...
              </>
            ) : createAccountMode ? (
              <>
                Create Account with Password
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            ) : (
              <>
                Sign in with Password
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
              ? 'Already have an account? Sign in instead'
              : 'Need an account? Create one with password'}
          </button>
          <p className="text-center text-xs text-muted-foreground">
            If your account was created with email link only, use the Email Link tab to sign in
            first.
          </p>
        </form>
      )}

      <div className="space-y-2 text-center text-sm text-muted-foreground">
        <p>
          Need premium training, onboarding, and support?{' '}
          <Link to="/plus" className="font-medium text-primary hover:underline">
            Learn about Plus
          </Link>
        </p>
        {isOperatorLogin ? (
          <p>
            Not an operator?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Use the standard member login page
            </Link>
            .
          </p>
        ) : (
          <p>
            Operators can use the{' '}
            <Link to="/login/operator" className="font-medium text-primary hover:underline">
              dedicated operator login page
            </Link>{' '}
            for task-first access.
          </p>
        )}
      </div>
    </div>
  );

  if (isOperatorLogin) {
    return (
      <Layout>
        <section className="relative overflow-hidden bg-muted/30">
          <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-br from-primary/10 via-background to-sage-light/70" />
          <div className="container-page relative py-12 md:py-16">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,28rem)] lg:items-start">
              <div className="space-y-8">
                <div className="space-y-4">
                  <span className="inline-flex items-center rounded-full bg-background/90 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-primary shadow-sm">
                    Operator Access
                  </span>
                  <h1 className="max-w-2xl font-display text-4xl font-bold tracking-tight text-foreground md:text-5xl">
                    Give operators a faster path into training, support, and daily machine work.
                  </h1>
                  <p className="max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
                    This login path is built for floor staff and field operators who need quick
                    entry to onboarding checklists, troubleshooting help, order history, and the
                    Bloomjoy training library.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {operatorHighlights.map((item) => {
                    const Icon = item.icon;

                    return (
                      <div
                        key={item.title}
                        className="rounded-3xl border border-border/70 bg-background/90 p-5 shadow-sm"
                      >
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <Icon className="h-5 w-5" />
                        </div>
                        <h2 className="mt-4 text-lg font-semibold text-foreground">{item.title}</h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-3xl border border-border/70 bg-background/90 p-6 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/80">
                        Start Here
                      </p>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                        After sign-in, operators can move straight into the portal dashboard for
                        training progress, onboarding steps, support intake, and order history.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <Button asChild variant="outline" size="sm">
                        <Link to="/resources">View Resources</Link>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link to="/plus">Compare Plus Access</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[2rem] border border-border/70 bg-background/95 p-6 shadow-lg md:p-8">
                {authPanel}
              </div>
            </div>
          </div>
        </section>
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-md">{authPanel}</div>
        </div>
      </section>
    </Layout>
  );
}
