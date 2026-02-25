import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Mail, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const RESEND_COOLDOWN_SECONDS = 60;
type AuthMethod = 'password' | 'magic_link';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [createAccountMode, setCreateAccountMode] = useState(false);
  const {
    signIn,
    signInWithPassword,
    signUpWithPassword,
    signInWithGoogle,
    isAuthenticated,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fromPath =
    (location.state as { from?: { pathname?: string } })?.from?.pathname || '/portal';

  useEffect(() => {
    if (isAuthenticated) {
      navigate(fromPath, { replace: true });
    }
  }, [fromPath, isAuthenticated, navigate]);

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

  const handleSwitchMethod = (method: AuthMethod) => {
    setAuthMethod(method);
    setSent(false);
  };

  return (
    <Layout>
      <section className="section-padding">
        <div className="container-page">
          <div className="mx-auto max-w-md">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary">
                <Mail className="h-7 w-7 text-primary-foreground" />
              </div>
              <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
                Sign in to your account
              </h1>
              <p className="mt-2 text-muted-foreground">
                Choose password, Google, or email link sign-in.
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-12 w-full rounded-full border border-[#d2d2d2] bg-white px-4 text-base font-medium text-[#1f1f1f] shadow-none hover:bg-[#f8f9fa] hover:text-[#1f1f1f]"
                onClick={handleGoogleSignIn}
                disabled={loading || oauthLoading}
              >
                {oauthLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Redirecting to Google...
                  </>
                ) : (
                  <span className="inline-flex items-center gap-3">
                    <svg
                      aria-hidden="true"
                      className="h-5 w-5"
                      viewBox="0 0 48 48"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.72 1.22 9.22 3.6l6.9-6.9C35.93 2.28 30.36 0 24 0 14.62 0 6.51 5.38 2.56 13.22l8.03 6.24C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.14-3.09-.4-4.55H24v9.02h12.94c-.58 2.96-2.25 5.47-4.8 7.16l7.73 6c4.51-4.18 7.11-10.36 7.11-17.63z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.59 28.54c-.48-1.45-.75-2.99-.75-4.54s.27-3.09.75-4.54l-8.03-6.24A23.96 23.96 0 0 0 0 24c0 3.77.9 7.34 2.56 10.78l8.03-6.24z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.46-9.96l-8.03 6.24C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                    Continue with Google
                  </span>
                )}
              </Button>

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
                    <h2 className="font-display text-lg font-semibold text-sage">Check your email</h2>
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
                        Email sends are temporarily limited. Please wait before requesting another
                        link.
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
                    If your account was created with email link only, use the Email Link tab to
                    sign in first.
                  </p>
                </form>
              )}

              <p className="text-center text-sm text-muted-foreground">
                Need premium training, onboarding, and support?{' '}
                <a href="/plus" className="font-medium text-primary hover:underline">
                  Learn about Plus
                </a>
              </p>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
