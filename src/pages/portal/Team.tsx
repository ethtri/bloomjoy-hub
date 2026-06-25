import { Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TechnicianManagementPanel } from '@/components/portal/TechnicianManagementPanel';
import { PortalLayout } from '@/components/portal/PortalLayout';
import { PortalPageIntro } from '@/components/portal/PortalPageIntro';
import { canUsePortalTeamManagement } from '@/components/portal/portalNavigation';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';

export default function TeamPage() {
  const { canManageTechnicians, capabilities } = useAuth();
  const { t } = useLanguage();
  const canUseTeam = canUsePortalTeamManagement({ canManageTechnicians, capabilities });

  return (
    <PortalLayout>
      <section className="portal-section overflow-x-clip">
        <div className="container-page">
          <PortalPageIntro
            title={t('team.title')}
            description={t('team.description')}
            badges={[{ label: t('portal.access.team'), tone: 'muted', icon: Users }]}
            actions={
              <Button asChild variant="outline" className="min-h-11">
                <Link to="/portal/account">Account Settings</Link>
              </Button>
            }
          />

          {canUseTeam ? (
            <TechnicianManagementPanel />
          ) : (
            <div className="mt-8 rounded-[24px] border border-border bg-background p-6 text-sm leading-6 text-muted-foreground shadow-[var(--shadow-sm)]">
              Team management is available only to Plus account owners and eligible Corporate
              Partner managers for the machines they control.
            </div>
          )}
        </div>
      </section>
    </PortalLayout>
  );
}
