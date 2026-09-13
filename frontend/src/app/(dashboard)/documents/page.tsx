"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface Document {
  id: string;
  filename: string;
  visibility: "all" | "restricted";
  uploaded_by: string;
  uploaded_by_id: string;
  created_at: string;
  size: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const iconColor =
    ext === "pdf"
      ? "#EF4444"
      : ext === "docx" || ext === "doc"
      ? "#3B82F6"
      : ext === "xlsx" || ext === "xls"
      ? "#22C55E"
      : ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp"
      ? "#A855F7"
      : "#6B7280";

  return (
    <svg
      className="w-9 h-9 shrink-0"
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="36" height="36" rx="8" fill={iconColor} fillOpacity="0.12" />
      <path
        d="M10 8h11l7 7v14a1 1 0 01-1 1H10a1 1 0 01-1-1V9a1 1 0 011-1z"
        fill={iconColor}
        fillOpacity="0.2"
        stroke={iconColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M21 8v7h7"
        stroke={iconColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <text
        x="18"
        y="26"
        textAnchor="middle"
        fontSize="7"
        fontWeight="700"
        fill={iconColor}
        fontFamily="system-ui"
      >
        {ext?.toUpperCase().slice(0, 4) ?? "FILE"}
      </text>
    </svg>
  );
}

export default function DocumentsPage() {
  const { t } = useI18n();
  const [visibility, setVisibility] = useState<"all" | "restricted">("all");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = async () => {
    try {
      const data = await api.get<Document[]>("/documents/");
      setDocs(data ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadError("");
    setUploading(true);

    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("visibility", visibility);
      try {
        await api.post("/documents/upload", form);
      } catch (e: unknown) {
        setUploadError(e instanceof Error ? e.message : "Upload failed");
      }
    }

    setUploading(false);
    loadDocs();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  function getDownloadUrl(doc: Document): string {
    // We get the file via the API with auth token
    return `${API_URL}/documents/${doc.id}/`;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-surface-900">{t.nav.documents}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          Upload and manage shared documents
        </p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all cursor-pointer select-none ${
          dragging
            ? "border-primary-400 bg-primary-50 scale-[1.01]"
            : "border-surface-200 bg-white hover:border-primary-300 hover:bg-primary-50/30"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.csv,.ppt,.pptx,.zip"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <svg
              className="w-8 h-8 text-primary-500 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
              />
            </svg>
            <p className="text-sm font-medium text-primary-600">
              Uploading...
            </p>
          </div>
        ) : (
          <>
            <div className="w-14 h-14 bg-primary-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg
                className="w-7 h-7 text-primary-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-surface-700 mb-1">
              {t.documents.dragDrop}
            </p>
            <p className="text-xs text-surface-400">
              PDF, DOCX, XLSX, PNG, JPG up to 50 MB
            </p>
          </>
        )}
      </div>

      {uploadError && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {uploadError}
        </div>
      )}

      {/* Upload settings */}
      <div className="max-w-xs">
        <label className="block text-xs font-semibold text-surface-500 uppercase tracking-wide mb-2">
          {t.documents.visibility}
        </label>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "all" | "restricted")}
          className="w-full px-3 py-2.5 rounded-xl border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition bg-white"
        >
          <option value="all">{t.documents.all}</option>
          <option value="restricted">{t.documents.restricted}</option>
        </select>
      </div>

      {/* Documents list */}
      <div>
        <h2 className="text-sm font-semibold text-surface-700 mb-4">
          Uploaded Documents{" "}
          {docs.length > 0 && (
            <span className="ml-1.5 text-xs font-medium bg-surface-100 text-surface-500 px-2 py-0.5 rounded-full">
              {docs.length}
            </span>
          )}
        </h2>

        {loading ? (
          <div className="text-sm text-surface-400">Loading...</div>
        ) : docs.length === 0 ? (
          <div className="rounded-2xl border border-surface-200 bg-white px-6 py-12 text-center">
            <svg
              className="w-10 h-10 text-surface-300 mx-auto mb-3"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
            <p className="text-sm text-surface-400">No documents uploaded yet</p>
            <p className="text-xs text-surface-300 mt-1">
              Upload your first document above
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden divide-y divide-surface-100">
            {docs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-4 px-5 py-4 hover:bg-surface-50 transition-colors group"
              >
                {fileIcon(doc.filename)}

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-surface-900 truncate">
                    {doc.filename}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-surface-500">
                      by{" "}
                      <span className="font-medium text-surface-700">
                        {doc.uploaded_by}
                      </span>
                    </span>
                    <span className="text-surface-300">·</span>
                    <span className="text-xs text-surface-400">
                      {formatDate(doc.created_at)}
                    </span>
                    <span className="text-surface-300">·</span>
                    <span className="text-xs text-surface-400">
                      {formatBytes(doc.size)}
                    </span>
                    {doc.visibility === "restricted" && (
                      <>
                        <span className="text-surface-300">·</span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                            />
                          </svg>
                          Restricted
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <a
                  href={getDownloadUrl(doc)}
                  download={doc.filename}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                  title="Download"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  Download
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}