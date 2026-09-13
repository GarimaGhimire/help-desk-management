"use client";

import { useI18n } from "@/lib/i18n";

export default function LocaleToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <button
      onClick={() => setLocale(locale === "en" ? "ne" : "en")}
      className="px-3 py-1.5 text-xs font-medium rounded-md border border-surface-200 text-surface-600 hover:bg-surface-50 transition-colors"
    >
      {locale === "en" ? "नेपाली" : "English"}
    </button>
  );
}