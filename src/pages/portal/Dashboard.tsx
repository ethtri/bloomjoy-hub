import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  BookOpen, 
  ShoppingBag, 
  HeadphonesIcon, 
  Settings, 
  CheckCircle2,
  ArrowRight,
  Package
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Layout } from '@/components/layout/Layout';
import { useAuth } from '@/contexts/AuthContext';
import { trackEvent } from '@/lib/analytics';

const quickActions = [
  {
    title: 'Reorder Sugar',
    description: 'Quick reorder for premium cotton candy sugar',
    icon: Package,
    href: '/supplies',
    action: 'reorder',
  },
  {
    title: 'Training Library',
    description: 'Video tutorials and operational guides',
    icon: BookOpen,
    href: '/portal/training',
    action: 'training',
  },
  {
    title: 'Concierge Support',
    description: 'Submit a support request',
    icon: HeadphonesIcon,
    href: '/portal/support',
    action: 'support',
  },
  {
    title: 'Order History',
    description: 'View past orders and invoices',
    icon: ShoppingBag,
    href: '/portal/orders',
    action: 'orders',
  },
];

export default function PortalDashboard() {
  const { user, isAuthenticated, isMember, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    trackEvent('view_dashboard');
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  const handleReorderSugar = () => {
    trackEvent('reorder_sugar_click');
  };

  if (!user) return null;

  return (
    <Layout>
      <section className="bg-gradient-to-b from-cream to-background section-padding">
        <div className="container-page">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold text-foreground">
                Welcome back
              </h1>
              <p className="mt-1 text-muted-foreground">{user.email}</p>
            </div>
            <div className="flex items-center gap-3">
              {isMember && (
                <span className="flex items-center gap-2 rounded-full bg-sage-light px-4 py-2 text-sm font-semibold text-sage">
                  <CheckCircle2 className="h-4 w-4" />
                  Plus Basic Active
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => signOut()}>
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          {/* Quick Actions */}
          <h2 className="font-display text-xl font-semibold text-foreground">Quick Actions</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {quickActions.map((action) => (
              <Link
                key={action.title}
                to={action.href}
                onClick={action.action === 'reorder' ? handleReorderSugar : undefined}
                className="group card-elevated p-5 transition-all hover:-translate-y-0.5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <action.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-4 font-semibold text-foreground group-hover:text-primary">
                  {action.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{action.description}</p>
              </Link>
            ))}
          </div>

          {/* Onboarding Progress */}
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Onboarding Progress
              </h2>
              <Link
                to="/portal/onboarding"
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View all
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-4 card-elevated p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sage-light">
                  <span className="font-display text-lg font-bold text-sage">2/5</span>
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-foreground">40% Complete</p>
                  <p className="text-sm text-muted-foreground">
                    Complete your onboarding to get the most out of your machine.
                  </p>
                </div>
                <Link to="/portal/onboarding">
                  <Button>Continue Setup</Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Recent Training */}
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-foreground">
                Recent Training
              </h2>
              <Link
                to="/portal/training"
                className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View library
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { title: 'Machine Setup Basics', duration: '12 min' },
                { title: 'Sugar Loading Best Practices', duration: '8 min' },
                { title: 'Troubleshooting Common Issues', duration: '15 min' },
              ].map((video) => (
                <div key={video.title} className="card-elevated p-4">
                  <div className="aspect-video rounded-lg bg-muted" />
                  <h4 className="mt-3 font-medium text-foreground">{video.title}</h4>
                  <p className="text-sm text-muted-foreground">{video.duration}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
