import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Mail, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const RESEND_COOLDOWN_SECONDS = 60;

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

const getRedirectErrorMessage = (errorCode?: string | null, errorDescription?: string | null) => {
  const description = decodeURIComponent(errorDescription ?? '').toLowerCase();

  if (
    errorCode === 'otp_expired' ||
    description.includes('expired') ||
    description.includes('invalid')
  ) {
    return 'This sign-in link is invalid or expired. Please request a fresh link.';
  }

  if (errorCode === 'over_email_send_rate_limit') {
    return 'Too many email attempts. Please wait about a minute before retrying.';
  }

  if (errorCode || errorDescription) {
    return 'Sign-in link could not be completed. Please request a new link.';
  }

  return undefined;
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const { signIn, isAuthenticated } = useAuth();
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

  const handleSubmit = async (e: React.FormEvent) => {
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

    setSent(true);
    setEmail(normalizedEmail);
    setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    toast.success(
      'Email sent. First-time sign-ins may require confirming signup first, then requesting a fresh link.'
    );
    setLoading(false);
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
                Enter your email to receive a magic link
              </p>
            </div>

            <div className="mt-8">
              {sent ? (
                <div className="rounded-xl border border-sage bg-sage-light p-6 text-center">
                  <h2 className="font-display text-lg font-semibold text-sage">
                    Check your email
                  </h2>
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
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-foreground">
                      Email address
                    </label>
                    <Input
                      id="email"
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
                    disabled={loading || cooldownSeconds > 0}
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
                        Continue with Email
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
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
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
