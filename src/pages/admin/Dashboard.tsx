import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { getVisibleAdminDestinations } from '@/components/layout/authenticatedNavigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';

export default function AdminDashboardPage() {
  const { t } = useLanguage();
  const { adminAccess, isSuperAdmin } = useAuth();
  const adminModules = getVisibleAdminDestinations({ adminAccess, isSuperAdmin }).filter(
    (destination) => destination.href !== '/admin'
  );

  return (
    <AppLayout>
      <section className="border-b border-border bg-muted/20">
        <div className="container-page py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {t('admin.dashboardEyebrow')}
            </p>
            <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
              {t('admin.home')}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('admin.dashboardDescription')}
            </p>
          </div>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-page">
          <div className="rounded-xl border border-sage/30 bg-sage-light px-4 py-3 text-sm text-sage">
            {t('admin.dashboardWorkspaceNote')}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {adminModules.map((module) => (
              <div key={module.href} className="card-elevated p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <module.icon className="h-5 w-5 text-primary" />
                </div>
                <h2 className="mt-4 font-semibold text-foreground">{t(module.shortLabelKey)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t(module.descriptionKey)}</p>
                <Button asChild variant="outline" size="sm" className="mt-4">
                  <Link to={module.href}>{t('admin.openModule')}</Link>
                </Button>
              </div>
            ))}
            {adminModules.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
                No Admin Console modules are available for this account yet.
              </div>
            )}
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-sage" />
            {t('admin.dashboardAuditNote')}
          </div>
        </div>
      </section>
    </AppLayout>
  );
}
