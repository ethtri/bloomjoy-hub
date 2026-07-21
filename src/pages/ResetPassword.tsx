import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, LockKeyhole, MailCheck } from 'lucide-react';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { useAuth } from '@/contexts/auth-context';
import { getSafeInternalAppPath } from '@/lib/appSurface';
import { authActivationClient } from '@/lib/authActivationClient';
import { toast } from 'sonner';

const MIN_PASSWORD_LENGTH = 8;
const RESEND_COOLDOWN_SECONDS = 60;
type SessionSource = 'activation' | null;

const getCodeErrorMessage = (error: { status?: number; code?: string; message?: string }) => {
  if (error.status === 429) {
    return 'Too many verification attempts. Wait a moment, then request a fresh code.';
  }

  if (error.code === 'otp_expired' || error.code === 'otp_disabled') {
    return 'This recovery code is invalid or expired. Request a fresh code and try again.';
  }

  return error.message?.trim() || 'Unable to verify this recovery code.';
};

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'invite' ? 'invite' : 'recovery';
  const inviteIntent = searchParams.get('intent')?.trim() ?? '';
  const isAdminInvite = searchParams.get('source') === 'admin-invite';
  const nextPath = getSafeInternalAppPath(searchParams.get('next')) ?? '/portal';
  const [email, setEmail] = useState(() => searchParams.get('email')?.trim().toLowerCase() ?? '');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [sessionSource, setSessionSource] = useState<SessionSource>(null);
  const {
    clearActivationSession,
    requestPasswordReset,
    signInWithPassword,
    updateActivationPassword,
    verifyPasswordRecoveryOtp,
  } = useAuth();
  const navigate = useNavigate();

  const inviteRecoveryPath = useMemo(() => {
    const params = new URLSearchParams();
    if (email.trim()) params.set('email', email.trim().toLowerCase());
    if (inviteIntent) params.set('intent', inviteIntent);
    else params.set('activation', 'invite-email');
    if (nextPath !== '/portal') params.set('next', nextPath);
    return `/login?${params.toString()}`;
  }, [email, inviteIntent, nextPath]);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const activationResult = await authActivationClient.auth.getSession();

      if (!mounted) return;

      if (activationResult.data.session?.user) {
        setSessionSource('activation');
      } else {
        setSessionSource(null);
      }
      setSessionChecked(true);
    };

    void checkSession();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;

    const intervalId = window.setInterval(() => {
      setCooldownSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [cooldownSeconds]);

  const handleSendFreshCode = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error('Enter the email address for your Bloomjoy account.');
      return;
    }
    if (cooldownSeconds > 0) return;

    setSendingCode(true);
    const { error } = await requestPasswordReset(normalizedEmail);
    setSendingCode(false);

    if (error) {
      toast.error(error.message || 'Unable to send a recovery code.');
      return;
    }

    setEmail(normalizedEmail);
    setRecoveryCode('');
    setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
    toast.success('Recovery code sent. Enter the newest 6-digit code from your email.');
  };

  const handleVerifyRecoveryCode = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCode = recoveryCode.replace(/\D/g, '');
    if (!normalizedEmail || normalizedCode.length !== 6) {
      toast.error('Enter your email and the complete 6-digit recovery code.');
      return;
    }

    setSubmitting(true);
    const { error } = await verifyPasswordRecoveryOtp(normalizedEmail, normalizedCode);
    setSubmitting(false);

    if (error) {
      toast.error(getCodeErrorMessage(error));
      return;
    }

    setEmail(normalizedEmail);
    setSessionSource('activation');
    toast.success('Email verified. Choose your new password.');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!sessionSource) {
      toast.error('Verify the newest email code before setting a password.');
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const { error } = await updateActivationPassword(password);

    if (error) {
      toast.error(error.message || 'Unable to update password.');
      setSubmitting(false);
      return;
    }

    await clearActivationSession();

    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail) {
      const { error: signInError } = await signInWithPassword(normalizedEmail, password);
      if (!signInError) {
        toast.success(
          mode === 'invite'
            ? 'Your Bloomjoy access is active. Signing you in...'
            : 'Password updated. Signing you in...'
        );
        navigate(nextPath, { replace: true });
        return;
      }
    }

    toast.success('Password updated. Sign in with your new password.');
    navigate(`/login${normalizedEmail ? `?email=${encodeURIComponent(normalizedEmail)}` : ''}`, {
      replace: true,
    });
  };

  const hasPasswordSession = Boolean(sessionSource);

  return (
    <AppLayout>
      <section className="portal-section">
        <div className="container-page">
          <div className="mx-auto max-w-md">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary">
                {hasPasswordSession ? (
                  <LockKeyhole className="h-7 w-7 text-primary-foreground" />
                ) : (
                  <MailCheck className="h-7 w-7 text-primary-foreground" />
                )}
              </div>
              <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
                {mode === 'invite' ? 'Finish setting up your access' : 'Reset your password'}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {hasPasswordSession
                  ? mode === 'invite'
                    ? 'Create a password to complete activation. Portal access stays closed until this step succeeds.'
                    : 'Choose a new password for your Bloomjoy account.'
                  : mode === 'invite'
                    ? 'Your temporary activation session is no longer available. Request a fresh email code to continue safely.'
                    : 'Enter the 6-digit recovery code from your newest Bloomjoy email.'}
              </p>
            </div>

            <div className="mt-8 rounded-xl border border-border bg-card p-6">
              {!sessionChecked ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking activation session...
                </div>
              ) : hasPasswordSession ? (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div>
                    <label htmlFor="new-password" className="block text-sm font-medium text-foreground">
                      New password
                    </label>
                    <Input
                      id="new-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      minLength={MIN_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      required
                      className="mt-1 h-11"
                    />
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-sm font-medium text-foreground">
                      Confirm password
                    </label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Re-enter your new password"
                      minLength={MIN_PASSWORD_LENGTH}
                      autoComplete="new-password"
                      required
                      className="mt-1 h-11"
                    />
                  </div>

                  <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Finishing setup...
                      </>
                    ) : mode === 'invite' ? (
                      'Create password and sign in'
                    ) : (
                      'Update password and sign in'
                    )}
                  </Button>
                </form>
              ) : mode === 'invite' ? (
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>No active invitation session was found. This can happen after a reload or when an older code was already used.</p>
                  <Link
                    to={inviteRecoveryPath}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Request a fresh activation code
                  </Link>
                  {isAdminInvite && (
                    <p className="text-xs">
                      Bloomjoy administrators should use the Hub Access screen for future invitations instead of the Supabase dashboard.
                    </p>
                  )}
                </div>
              ) : (
                <form className="space-y-4" onSubmit={handleVerifyRecoveryCode}>
                  <div>
                    <label htmlFor="recovery-email" className="block text-sm font-medium text-foreground">
                      Email address
                    </label>
                    <Input
                      id="recovery-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                      className="mt-1 h-11"
                      disabled={submitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="recovery-code" className="block text-sm font-medium text-foreground">
                      6-digit recovery code
                    </label>
                    <InputOTP
                      id="recovery-code"
                      maxLength={6}
                      pattern={REGEXP_ONLY_DIGITS}
                      value={recoveryCode}
                      onChange={setRecoveryCode}
                      autoComplete="one-time-code"
                      containerClassName="justify-center"
                      disabled={submitting}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <Button
                    type="submit"
                    variant="hero"
                    size="lg"
                    className="w-full"
                    disabled={submitting || recoveryCode.length !== 6}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Verify recovery code'
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full"
                    onClick={handleSendFreshCode}
                    disabled={sendingCode || cooldownSeconds > 0}
                  >
                    {sendingCode
                      ? 'Sending...'
                      : cooldownSeconds > 0
                        ? `Send another code in ${cooldownSeconds}s`
                        : 'Send a fresh recovery code'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Email security scanners can safely open this page. Your code is used only after you submit it here.
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
