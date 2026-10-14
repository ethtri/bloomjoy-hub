import { useLanguage } from '@/contexts/LanguageContext';

export function usePayStubFormat() {
  const { language, t } = useLanguage();
  const locale = language === 'zh-Hans' ? 'zh-CN' : 'en-US';
  return {
    t,
    money: (cents: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(cents / 100),
    date: (value: string) => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)),
    duration: (minutes: number) => {
      const seconds = Math.round(minutes * 60);
      const value = t('workday.duration', { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds % 3600 / 60) });
      return seconds % 60 ? `${value} ${t('payStub.seconds', { seconds: seconds % 60 })}` : value;
    },
    percent: (value: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 20, useGrouping: false }).format(value)}%`,
  };
}

