"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

export default function StaffDirectoryPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.get<Employee[]>(`/users/search?q=${encodeURIComponent(query)}`)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
  }, [query]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-surface-900">{t.nav.staffDirectory}</h1>
        <p className="text-sm text-surface-500 mt-0.5">Find colleagues and team members</p>
      </div>

      <div className="relative max-w-md mb-6">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.staff.search}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
        />
      </div>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-white border border-surface-200 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && query && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-surface-500">{t.staff.noResults}</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((e) => (
            <div key={e.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-surface-200 hover:border-primary-200 transition-colors">
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold shrink-0">
                {e.name?.charAt(0) || "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-surface-900 truncate">{e.name}</p>
                <p className="text-xs text-surface-500 truncate">{e.email || e.phone}</p>
              </div>
              {e.role && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-surface-100 text-surface-600 shrink-0 capitalize">
                  {e.role}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && !query && (
        <div className="text-center py-12 bg-white rounded-xl border border-surface-200">
          <svg className="w-10 h-10 text-surface-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          <p className="text-sm text-surface-500">Search for colleagues by name</p>
        </div>
      )}
    </div>
  );
}