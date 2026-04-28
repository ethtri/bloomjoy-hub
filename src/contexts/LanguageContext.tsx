/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isSupportedLanguage,
  supportedLanguages,
  translate,
  type LanguageCode,
  type TranslationKey,
  type TranslationParams,
} from '@/lib/i18n';
import {
  fetchPortalLanguagePreference,
  savePortalLanguagePreference,
} from '@/lib/accountProfile';

type LanguageContextValue = {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  supportedLanguages: typeof supportedLanguages;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const readStoredLanguage = (): LanguageCode => {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLanguage(storedLanguage) ? storedLanguage : DEFAULT_LANGUAGE;
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [language, setLanguageState] = useState<LanguageCode>(readStoredLanguage);
  const languageRef = useRef(language);
  const manualChangeCounterRef = useRef(0);

  useEffect(() => {
    languageRef.current = language;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }

    if (typeof document !== 'undefined') {
      const htmlLanguage =
        supportedLanguages.find((supportedLanguage) => supportedLanguage.code === language)
          ?.htmlLang ?? 'en';
      document.documentElement.lang = htmlLanguage;
    }
  }, [language]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let active = true;
    const requestCounter = manualChangeCounterRef.current;

    const syncProfilePreference = async () => {
      const profileLanguage = await fetchPortalLanguagePreference(user.id);

      if (!active) {
        return;
      }

      if (profileLanguage) {
        if (manualChangeCounterRef.current === requestCounter) {
          setLanguageState(profileLanguage);
        }
        return;
      }

      await savePortalLanguagePreference(user.id, languageRef.current).catch(() => undefined);
    };

    void syncProfilePreference().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [user?.id]);

  const setLanguage = useCallback(
    (nextLanguage: LanguageCode) => {
      manualChangeCounterRef.current += 1;
      setLanguageState(nextLanguage);

      if (user?.id) {
        void savePortalLanguagePreference(user.id, nextLanguage).catch(() => undefined);
      }
    },
    [user?.id]
  );

  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) => translate(language, key, params),
    [language]
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      supportedLanguages,
      t,
    }),
    [language, setLanguage, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }

  return context;
}
