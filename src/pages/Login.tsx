import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Mail, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email);

    if (error) {
      toast.error('Failed to send magic link');
      setLoading(false);
      return;
    }

    // For demo, immediately redirect
    toast.success('Welcome to Bloomjoy Plus!');
    const fromPath =
      (location.state as { from?: { pathname?: string } })?.from?.pathname || '/portal';
    navigate(fromPath, { replace: true });
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
                    We sent a magic link to <strong>{email}</strong>. Click the link to sign in.
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
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        Continue with Email
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </form>
              )}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                Don't have a membership?{' '}
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
