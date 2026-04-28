import { Languages } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';

type LanguagePreferenceControlProps = {
  className?: string;
  showText?: boolean;
  fullWidth?: boolean;
};

export function LanguagePreferenceControl({
  className,
  showText = false,
  fullWidth = false,
}: LanguagePreferenceControlProps) {
  const { language, setLanguage, supportedLanguages, t } = useLanguage();

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-3',
        fullWidth && 'w-full justify-between',
        className
      )}
    >
      {showText && (
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t('language.selectorLabel')}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t('language.savedLocally')}
          </p>
        </div>
      )}
      <div
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background p-1 shadow-[var(--shadow-sm)]',
          fullWidth && !showText && 'w-full'
        )}
        role="group"
        aria-label={t('language.selectorLabel')}
      >
        <Languages className="ml-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {supportedLanguages.map((supportedLanguage) => {
          const isActive = supportedLanguage.code === language;

          return (
            <button
              key={supportedLanguage.code}
              type="button"
              aria-pressed={isActive}
              title={t('language.current', { language: supportedLanguage.label })}
              className={cn(
                'min-h-8 rounded-full px-2.5 text-xs font-semibold transition-colors sm:px-3',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                fullWidth && !showText && 'flex-1'
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
