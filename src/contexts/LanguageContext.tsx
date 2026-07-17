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
import { useAuth } from '@/contexts/auth-context';
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
  languageSyncStatus: LanguageSyncStatus;
  setLanguage: (language: LanguageCode) => void;
  supportedLanguages: typeof supportedLanguages;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export type LanguageSyncStatus =
  | 'device-only'
  | 'syncing'
  | 'synced'
  | 'sync-unavailable';

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
  const [languageSyncStatus, setLanguageSyncStatus] =
    useState<LanguageSyncStatus>('device-only');
  const languageRef = useRef(language);
  const manualChangeCounterRef = useRef(0);
  const syncGenerationRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(user?.id ?? null);

  useEffect(() => {
    languageRef.current = language;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }

  }, [language]);

  useEffect(() => {
    const requestUserId = user?.id ?? null;
    const requestGeneration = syncGenerationRef.current + 1;
    syncGenerationRef.current = requestGeneration;
    activeUserIdRef.current = requestUserId;

    const isCurrentAuthRequest = () =>
      syncGenerationRef.current === requestGeneration &&
      activeUserIdRef.current === requestUserId;
    const invalidateAuthRequest = () => {
      if (syncGenerationRef.current === requestGeneration) {
        syncGenerationRef.current += 1;
        activeUserIdRef.current = null;
      }
    };

    if (!requestUserId) {
      setLanguageSyncStatus('device-only');
      return invalidateAuthRequest;
    }

    let active = true;
    const requestCounter = manualChangeCounterRef.current;
    setLanguageSyncStatus('syncing');

    const syncProfilePreference = async () => {
      try {
        const profileLanguage = await fetchPortalLanguagePreference(requestUserId);

        if (
          !active ||
          !isCurrentAuthRequest() ||
          manualChangeCounterRef.current !== requestCounter
        ) {
          return;
        }

        if (profileLanguage) {
          setLanguageState(profileLanguage);
          setLanguageSyncStatus('synced');
          return;
        }

        await savePortalLanguagePreference(requestUserId, languageRef.current);

        if (
          active &&
          isCurrentAuthRequest() &&
          manualChangeCounterRef.current === requestCounter
        ) {
          setLanguageSyncStatus('synced');
        }
      } catch {
        if (
          active &&
          isCurrentAuthRequest() &&
          manualChangeCounterRef.current === requestCounter
        ) {
          setLanguageSyncStatus('sync-unavailable');
        }
      }
    };

    void syncProfilePreference();

    return () => {
      active = false;
      invalidateAuthRequest();
    };
  }, [user?.id]);

  const setLanguage = useCallback(
    (nextLanguage: LanguageCode) => {
      manualChangeCounterRef.current += 1;
      const requestCounter = manualChangeCounterRef.current;
      setLanguageState(nextLanguage);

      if (user?.id) {
        const requestUserId = user.id;
        const requestGeneration = syncGenerationRef.current;
        const isCurrentManualRequest = () =>
          manualChangeCounterRef.current === requestCounter &&
          syncGenerationRef.current === requestGeneration &&
          activeUserIdRef.current === requestUserId;
        setLanguageSyncStatus('syncing');
        void savePortalLanguagePreference(requestUserId, nextLanguage)
          .then(() => {
            if (isCurrentManualRequest()) {
              setLanguageSyncStatus('synced');
            }
          })
          .catch(() => {
            if (isCurrentManualRequest()) {
              setLanguageSyncStatus('sync-unavailable');
            }
          });
      } else {
        setLanguageSyncStatus('device-only');
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
      languageSyncStatus,
      setLanguage,
      supportedLanguages,
      t,
    }),
    [language, languageSyncStatus, setLanguage, t]
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
