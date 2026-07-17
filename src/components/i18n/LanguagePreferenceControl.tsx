import { Languages } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type LanguagePreferenceControlProps = {
  className?: string;
  compact?: boolean;
  showText?: boolean;
  fullWidth?: boolean;
};

export function LanguagePreferenceControl({
  className,
  compact = false,
  showText = false,
  fullWidth = false,
}: LanguagePreferenceControlProps) {
  const {
    language,
    languageSyncStatus,
    setLanguage,
    supportedLanguages,
    t,
  } = useLanguage();
  const statusKey =
    languageSyncStatus === 'syncing'
      ? 'language.syncing'
      : languageSyncStatus === 'synced'
        ? 'language.synced'
        : languageSyncStatus === 'sync-unavailable'
          ? 'language.syncUnavailable'
          : 'language.deviceOnly';

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        fullWidth && 'w-full justify-between',
        fullWidth && showText && 'flex-col items-stretch',
        className
      )}
    >
      {showText && (
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('language.selectorLabel')}</p>
          <p
            className="mt-1 text-xs leading-5 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {t(statusKey)}
          </p>
        </div>
      )}
      <div
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background p-1 shadow-[var(--shadow-sm)]',
          compact && 'gap-0 p-0.5',
          fullWidth && 'w-full'
        )}
        role="group"
        aria-label={t('language.selectorLabel')}
        data-language-preference-control
      >
        {!compact && (
          <Languages className="ml-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
        {supportedLanguages.map((supportedLanguage) => {
          const isActive = supportedLanguage.code === language;

          return (
            <button
              key={supportedLanguage.code}
              type="button"
              aria-pressed={isActive}
              aria-label={supportedLanguage.label}
              title={supportedLanguage.label}
              className={cn(
                'min-h-11 rounded-full border border-transparent px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-3',
                compact && 'min-h-11 min-w-11 px-2 text-[11px]',
                isActive
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                fullWidth && 'min-h-11 flex-1'
              )}
              onClick={() => setLanguage(supportedLanguage.code)}
            >
              {showText ? supportedLanguage.label : supportedLanguage.shortLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
