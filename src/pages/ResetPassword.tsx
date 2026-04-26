import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, LockKeyhole } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseClient } from '@/lib/supabaseClient';
import { toast } from 'sonner';

const MIN_PASSWORD_LENGTH = 8;

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!mounted) {
        return;
      }

      setHasRecoverySession(Boolean(session?.user));
      setSessionChecked(true);
    };

    void checkSession();

    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      if (!mounted) {
        return;
      }

      setHasRecoverySession(Boolean(session?.user));
      setSessionChecked(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!hasRecoverySession) {
      toast.error('Open the password reset link from your email first.');
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
    const { error } = await updatePassword(password);

    if (error) {
      toast.error(error.message || 'Unable to update password.');
      setSubmitting(false);
      return;
    }

    await supabaseClient.auth.signOut();
    toast.success('Password updated. Sign in with your new password.');
    navigate('/login', { replace: true });
  };

  return (
    <AppLayout>
      <section className="portal-section">
        <div className="container-page">
          <div className="mx-auto max-w-md">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary">
                <LockKeyhole className="h-7 w-7 text-primary-foreground" />
              </div>
              <h1 className="mt-6 font-display text-3xl font-bold text-foreground">
                Set a new password
              </h1>
              <p className="mt-2 text-muted-foreground">
                Use the reset link from your email, then choose a new password.
              </p>
            </div>

            <div className="mt-8 rounded-xl border border-border bg-card p-6">
              {!sessionChecked ? (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking recovery session...
                </div>
              ) : hasRecoverySession ? (
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
                      required
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="block text-sm font-medium text-foreground"
                    >
                      Confirm password
                    </label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      placeholder="Re-enter your new password"
                      required
                      className="mt-1"
                    />
                  </div>

                  <Button type="submit" variant="hero" size="lg" className="w-full" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Updating...
                      </>
                    ) : (
                      'Update password'
                    )}
                  </Button>
                </form>
              ) : (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>No active password reset session was found.</p>
                  <p>
                    Return to{' '}
                    <Link to="/login" className="font-medium text-primary hover:underline">
                      login
                    </Link>{' '}
                    and request a new password reset email.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
