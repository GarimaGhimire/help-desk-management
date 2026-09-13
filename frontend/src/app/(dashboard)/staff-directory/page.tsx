/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { api, getAuthUser } from "@/lib/api";

interface Employee {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

export default function StaffDirectoryPage() {
  const { t } = useI18n();
  const authUser = getAuthUser();
  const canCreateStaff =
    authUser?.role === "org_admin" || authUser?.role === "superadmin";

  const [query, setQuery] = useState("");
  const [allStaff, setAllStaff] = useState<Employee[]>([]);
  const [results, setResults] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [createStaffOpen, setCreateStaffOpen] = useState(false);
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffError, setStaffError] = useState("");
  const [staffSuccess, setStaffSuccess] = useState(false);
  // form state
  const [staffName, setStaffName] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [staffPassword, setStaffPassword] = useState("");

  // Load full staff list on mount
  useEffect(() => {
    setLoading(true);
    api
      .get<Employee[]>("/users")
      .then((data) => {
        setAllStaff(data);
        setResults(data);
      })
      .catch(() => setSearchError("Failed to load staff directory."))
      .finally(() => setLoading(false));
  }, []);

  // Filter / search when query changes
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(allStaff);
      setSearchError("");
      return;
    }
    setLoading(true);
    setSearchError("");
    const timeoutId = setTimeout(() => {
      api
        .get<Employee[]>(`/users/search?q=${encodeURIComponent(trimmed)}`)
        .then(setResults)
        .catch(() => {
          setSearchError("Search failed. Please try again.");
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [query, allStaff]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingStaff(true);
    setStaffError("");
    if (!staffName.trim() || !staffEmail.trim()) {
      setStaffError("Name and email are required");
      setCreatingStaff(false);
      return;
    }
    try {
      const body: Record<string, unknown> = {
        name: staffName.trim(),
        email: staffEmail.trim(),
        role: "org_member",
      };
      if (staffPassword) body.password = staffPassword;
      const created = await api.post<Employee>("/users", body);
      setStaffSuccess(true);
      setStaffName("");
      setStaffEmail("");
      setStaffPassword("");
      setCreateStaffOpen(false);
      setStaffError("");
      setCreatingStaff(false);
      // Add to the full staff list so it shows up immediately
      setAllStaff((prev) => [created, ...prev]);
    } catch (err) {
      setStaffError(
        err instanceof Error ? err.message : "Failed to create staff account"
      );
      setCreatingStaff(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-surface-900">
          {t.nav.staffDirectory}
        </h1>
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500 mt-0.5">
            Find colleagues and team members
          </p>
          {canCreateStaff && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCreateStaffOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
              >
                {t.staff.createStaff}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="relative max-w-md mb-6">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
          />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.staff.search}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
        />
      </div>

      {searchError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          {searchError}
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 rounded-xl bg-white border border-surface-200 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && query && results.length === 0 && !searchError && (
        <div className="text-center py-12">
          <p className="text-sm text-surface-500">{t.staff.noResults}</p>
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-4 p-4 bg-white rounded-xl border border-surface-200 hover:border-primary-200 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold shrink-0">
                {e.name?.charAt(0)?.toUpperCase() || "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-surface-900 truncate">
                  {e.name}
                </p>
                <p className="text-xs text-surface-500 truncate">
                  {e.email || e.phone}
                </p>
              </div>
              {e.role && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-surface-100 text-surface-600 shrink-0 capitalize">
                  {e.role.replace("_", " ")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && !query && results.length === 0 && !searchError && (
        <div className="text-center py-12 bg-white rounded-xl border border-surface-200">
          <svg
            className="w-10 h-10 text-surface-300 mx-auto mb-3"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
            />
          </svg>
          <p className="text-sm text-surface-500">No staff members yet.</p>
        </div>
      )}

      {staffSuccess && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 animate-fade-in">
          Staff account created successfully
        </div>
      )}

      {createStaffOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 animate-fade-in"
            onClick={() => !creatingStaff && setCreateStaffOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-pop-in">
            <div className="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center mb-4">
              <svg
                className="w-5 h-5 text-primary-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.8}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-surface-900">
              Create staff account
            </h3>
            <p className="text-sm text-surface-500 mt-1">
              Fill in the details below to create a new staff account.
            </p>
            <form onSubmit={handleCreateStaff}>
              <div className="grid grid-cols-2 gap-4 mb-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1.5">
                    Name
                  </label>
                  <input
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1.5">
                    Email
                  </label>
                  <input
                    value={staffEmail}
                    onChange={(e) => setStaffEmail(e.target.value)}
                    placeholder="john@company.com"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-surface-500 mb-1.5">
                    Password
                  </label>
                  <input
                    value={staffPassword}
                    onChange={(e) => setStaffPassword(e.target.value)}
                    type="password"
                    placeholder="TestPass#2026"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition"
                  />
                  <p className="text-[11px] text-surface-400 mt-1">
                    10+ chars, upper/lower/digit/special. Leave blank to
                    auto-generate and email.
                  </p>
                </div>
              </div>

              {staffError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {staffError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={creatingStaff}
                  className="flex-1 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 active:scale-[0.985] disabled:opacity-50 transition-all"
                >
                  {creatingStaff ? "Creating…" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreateStaffOpen(false)}
                  disabled={creatingStaff}
                  className="px-4 py-2.5 rounded-lg border border-surface-200 text-sm text-surface-600 hover:bg-surface-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}