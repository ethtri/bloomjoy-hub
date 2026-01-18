import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Layout } from '@/components/layout/Layout';
import { trackEvent } from '@/lib/analytics';
import { toast } from 'sonner';
import machineMini from '@/assets/machine-mini.jpg';

export default function MiniPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    trackEvent('view_product_mini');
  }, []);

  const handleWaitlist = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock submission
    console.log('Waitlist signup:', email);
    setSubmitted(true);
    toast.success('You\'ve been added to the Mini waitlist!');
  };

  return (
    <Layout>
      {/* Breadcrumb */}
      <div className="border-b border-border bg-muted/30">
        <div className="container-page py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/machines" className="hover:text-foreground">Machines</Link>
            <span>/</span>
            <span className="text-foreground">Mini</span>
          </nav>
        </div>
      </div>

      <section className="section-padding">
        <div className="container-page">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Image */}
            <div>
              <div className="aspect-square overflow-hidden rounded-2xl bg-muted shadow-elevated-lg">
                <img
                  src={machineMini}
                  alt="Bloomjoy Sweets Mini"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>

            {/* Details */}
            <div>
              <span className="rounded-full bg-amber/10 px-3 py-1 text-sm font-semibold text-amber">
                Coming Soon
              </span>
              <h1 className="mt-4 font-display text-3xl font-bold text-foreground sm:text-4xl">
                Bloomjoy Sweets Mini
              </h1>
              <p className="mt-2 font-display text-3xl font-bold text-primary">
                $4,000
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Price target</p>

              <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                Portable robotic cotton candy machine at 1/5 the size of our commercial unit. Capable of most complex patterns while fitting in smaller spaces. Perfect for mobile operators.
              </p>

              {/* Waitlist Form */}
              <div className="mt-8 rounded-xl border border-border bg-muted/50 p-6">
                <h3 className="font-display text-lg font-semibold text-foreground">
                  Join the Mini Waitlist
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Be the first to know when Mini becomes available.
                </p>
                {submitted ? (
                  <div className="mt-4 flex items-center gap-2 text-sage">
                    <Check className="h-5 w-5" />
                    <span className="font-medium">You're on the list!</span>
                  </div>
                ) : (
                  <form onSubmit={handleWaitlist} className="mt-4 flex gap-3">
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="flex-1"
                    />
                    <Button type="submit">Join Waitlist</Button>
                  </form>
                )}
              </div>

              {/* Features */}
              <div className="mt-8">
                <h3 className="font-display text-lg font-semibold text-foreground">Features</h3>
                <ul className="mt-4 space-y-3">
                  {[
                    'Portable design (1/5 size of commercial)',
                    'Most complex pattern capabilities',
                    'Ideal for mobile operators',
                    'Compact footprint for small venues',
                  ].map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sage-light">
                        <Check className="h-3 w-3 text-sage" />
                      </div>
                      <span className="text-sm text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Limitations */}
              <div className="mt-8">
                <h3 className="font-display text-lg font-semibold text-foreground">Limitations</h3>
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber/20 bg-amber/5 p-4">
                  <AlertCircle className="h-5 w-5 shrink-0 text-amber" />
                  <span className="text-sm text-muted-foreground">
                    No automatic stick dispenser—operator manually feeds stick each order.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
