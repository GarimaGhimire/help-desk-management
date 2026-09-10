"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import en from "@/locales/en.json";
import ne from "@/locales/ne.json";

type Locale = "en" | "ne";
type Translations = typeof en;

const translations: Record<Locale, Translations> = { en, ne };

interface I18nContextType {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  t: en,
  setLocale: () => {},
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = document.cookie.match(/lang=([^;]+)/);
    if (saved && (saved[1] === "en" || saved[1] === "ne")) {
      setLocaleState(saved[1] as Locale);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `lang=${l}; path=/; max-age=31536000`;
  }, []);

  return (
    <I18nContext.Provider value={{ locale, t: translations[locale], setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}