import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type PortalPageIntroBadgeTone = 'default' | 'accent' | 'success' | 'muted' | 'warning';

export interface PortalPageIntroBadge {
  label: string;
  tone?: PortalPageIntroBadgeTone;
  icon?: LucideIcon;
}

export interface PortalPageIntroProps {
  eyebrow?: string;
  title: string;
  description: string;
  badges?: PortalPageIntroBadge[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

const badgeToneClasses: Record<PortalPageIntroBadgeTone, string> = {
  default: 'border-border bg-background text-foreground',
  accent: 'border-primary/20 bg-primary/10 text-primary',
  success: 'border-sage/20 bg-sage-light text-sage',
  muted: 'border-border bg-muted/60 text-muted-foreground',
  warning: 'border-amber/20 bg-amber/10 text-amber',
};

export function PortalPageIntro({
  eyebrow,
  title,
  description,
  badges = [],
  actions,
  children,
  className,
}: PortalPageIntroProps) {
  const { t } = useLanguage();

  return (
    <div
      className={cn(
        'rounded-[28px] border border-border bg-gradient-to-br from-background via-background to-muted/40 p-5 shadow-[var(--shadow-md)] sm:p-7',
        className
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {eyebrow ?? t('portal.memberPortal')}
      </p>
      <div className="mt-3 flex flex-col gap-4 sm:gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[2rem] font-bold leading-none text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
          {badges.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {badges.map((badge) => {
                const Icon = badge.icon;

                return (
                  <span
                    key={badge.label}
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium',
                      badgeToneClasses[badge.tone ?? 'default']
                    )}
                  >
                    {Icon && <Icon className="h-4 w-4" />}
                    {badge.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex w-full shrink-0 flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
            {actions}
          </div>
        )}
      </div>
      {children && <div className="mt-4 sm:mt-5">{children}</div>}
    </div>
  );
}
