import { Button } from '@/components/ui/button';
import type { RefundCustomerLocale } from '@/lib/refundCustomerCopy';

export function RefundCustomerLanguageToggle({ locale, onChange }: {
  locale: RefundCustomerLocale; onChange: (locale: RefundCustomerLocale) => void;
}) {
  return <div className="mx-auto mb-4 flex max-w-3xl justify-end" role="group" aria-label={locale === 'es' ? 'Idioma del formulario' : 'Form language'}>
    <div className="inline-flex rounded-lg border border-pink-200 bg-white p-1">
      {(['en', 'es'] as const).map((language) => <Button key={language} type="button" size="sm"
        lang={language} aria-pressed={locale === language} variant="ghost"
        className={`min-h-11 px-3 ${locale === language ? 'bg-pink-100 text-pink-950 ring-1 ring-pink-300' : 'text-muted-foreground'}`}
        onClick={() => onChange(language)}>{language === 'en' ? 'English' : 'Español'}</Button>)}
    </div>
  </div>;
}
