"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";

export default function DocumentsPage() {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<"all" | "restricted">("all");
  const [password, setPassword] = useState("");
  const [dragging, setDragging] = useState(false);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-surface-900">{t.nav.documents}</h1>
        <p className="text-sm text-surface-500 mt-0.5">Upload and manage shared documents</p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer ${
          dragging
            ? "border-primary-400 bg-primary-50"
            : "border-surface-200 bg-white hover:border-surface-300"
        }`}
      >
        <svg className="w-8 h-8 text-surface-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-sm text-surface-600 font-medium">{t.documents.dragDrop}</p>
        <p className="text-xs text-surface-400 mt-1">PDF, DOCX, XLSX up to 50MB</p>
      </div>

      <div className="mt-6 max-w-md space-y-4 bg-white rounded-xl border border-surface-200 p-5">
        <h2 className="text-sm font-medium text-surface-700">Upload Settings</h2>

        <div>
          <label className="block text-xs font-medium text-surface-500 mb-1.5">
            {t.documents.visibility}
          </label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "all" | "restricted")}
            className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
          >
            <option value="all">{t.documents.all}</option>
            <option value="restricted">{t.documents.restricted}</option>
          </select>
        </div>

        {visibility === "restricted" && (
          <div>
            <label className="block text-xs font-medium text-surface-500 mb-1.5">
              {t.documents.password}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
            />
          </div>
        )}
      </div>
    </div>
  );
}