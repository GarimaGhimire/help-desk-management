"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { api, getAuthUser, type AuthUser } from "@/lib/api";
import { DocumentSkeleton } from "@/components/ui/skeleton";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

// Roles that can upload and download documents
const ADMIN_ROLES = ["superadmin", "org_admin", "staff_admin"];

type VisibilityType = "all" | "admins" | "restricted" | "custom";

interface CustomRole {
  id: string;
  name: string;
  description: string;
}

interface Position {
  id: string;
  name: string;
  description: string;
}

interface OrgMember {
  id: string;
  name: string;
  display_name: string;
  email: string;
  role: string;
}

interface UserAccessInfo {
  user_id: string;
  user_name: string;
  email: string;
}

interface DocumentItem {
  id: string;
  uploaded_by: string;
  uploader_name: string;
  group_id?: string;
  filename: string;
  storage_path: string;
  visibility: VisibilityType;
  allowed_roles: string[];
  allowed_users: UserAccessInfo[];
  created_at: string;
}

const BUILTIN_ROLES = [
  { key: "org_admin", label: "Org Admin" },
  { key: "staff_admin", label: "Staff Admin" },
  { key: "group_admin", label: "Group Admin" },
  { key: "org_member", label: "Member" },
];

// ─────────────────────────────────────────────────────────────
// Watermarked PDF Viewer Component (canvas-based, no download)
// ─────────────────────────────────────────────────────────────
interface PDFViewerProps {
  docId: string;
  filename: string;
  onClose: () => void;
  isAdmin: boolean;
}

function WatermarkedPDFViewer({ docId, filename, onClose, isAdmin }: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const isPDF = filename.toLowerCase().endsWith(".pdf");

  // Block all keyboard shortcuts that could allow printing/saving while viewer is open
  useEffect(() => {
    const blocked = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const key = e.key.toLowerCase();
      // Block: Print (p), Save (s), SaveAs (shift+s), Copy (c/a), Find (f), Print Preview
      if (["p", "s", "a", "c", "f", "u"].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", blocked, { capture: true });
    // Block context menu (right-click) inside viewer
    const noCtxMenu = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    window.addEventListener("contextmenu", noCtxMenu, { capture: true });
    return () => {
      window.removeEventListener("keydown", blocked, { capture: true });
      window.removeEventListener("contextmenu", noCtxMenu, { capture: true });
    };
  }, []);

  // Inject CSS to block print for the entire page while viewer open
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "no-print-viewer";
    style.textContent = `
      @media print {
        body { display: none !important; visibility: hidden !important; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById("no-print-viewer")?.remove();
    };
  }, []);

  const renderPage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (pdfDoc: any, pageNum: number) => {
      if (!canvasRef.current || !pdfDoc) return;
      try {
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }
        const pdfPage = await pdfDoc.getPage(pageNum);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const viewport = pdfPage.getViewport({ scale: 1.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const task = pdfPage.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = task;
        await task.promise;

        // Draw watermark diagonal text across the page
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = "#1e293b";
        ctx.font = `bold ${Math.round(viewport.width / 12)}px Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Rotate and tile watermark
        const step = Math.max(viewport.width, viewport.height) * 0.55;
        for (let x = -viewport.width; x < viewport.width * 2; x += step) {
          for (let y = -viewport.height; y < viewport.height * 2; y += step) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(-Math.PI / 5);
            ctx.fillText("CONFIDENTIAL", 0, 0);
            ctx.restore();
          }
        }
        ctx.restore();
      } catch (err: unknown) {
        // cancelled render — ignore
        if ((err as { name?: string })?.name === "RenderingCancelledException") return;
      }
    },
    []
  );

  // Load PDF.js from CDN and render
  useEffect(() => {
    if (!isPDF) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");

        // Dynamically import pdf.js (CDN via script tag approach)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let pdfjsLib: any = (window as any).pdfjsLib;
        if (!pdfjsLib) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Failed to load PDF.js"));
            document.head.appendChild(script);
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pdfjsLib = (window as any).pdfjsLib;
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        }

        // Fetch PDF with auth token
        const match = document.cookie.match(/token=([^;]+)/);
        const token = match ? match[1] : "";
        const res = await fetch(`${API_URL}/documents/${docId}/download`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Failed to load document");
        const arrayBuffer = await res.arrayBuffer();

        if (cancelled) return;

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        pdfDocRef.current = pdfDoc;
        setTotalPages(pdfDoc.numPages);
        setPage(1);
        setLoading(false);
        await renderPage(pdfDoc, 1);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Failed to load PDF");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, isPDF, renderPage]);

  // Re-render on page change
  useEffect(() => {
    if (pdfDocRef.current && !loading) {
      renderPage(pdfDocRef.current, page);
    }
  }, [page, loading, renderPage]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex flex-col"
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 bg-surface-900 text-white shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <svg className="w-5 h-5 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V7.414L12.586 3H4zm8 0v4h4l-4-4z" />
          </svg>
          <span className="text-sm font-semibold truncate max-w-xs">{filename}</span>
          {!isAdmin && (
            <span className="shrink-0 text-[10px] font-bold bg-amber-500 text-white px-2 py-0.5 rounded-full">
              VIEW ONLY
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Page navigation (PDF only) */}
          {isPDF && !loading && totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 disabled:opacity-40 transition text-xs"
              >
                ‹
              </button>
              <span className="text-surface-300 text-xs">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 disabled:opacity-40 transition text-xs"
              >
                ›
              </button>
            </div>
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-sm transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close
          </button>
        </div>
      </div>

      {/* Document body */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-6 bg-surface-800">
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-white">
            <svg className="w-8 h-8 animate-spin text-primary-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
            </svg>
            <span className="text-sm text-surface-300">Loading document...</span>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-red-400 text-sm font-medium">Failed to load document</p>
            <p className="text-surface-400 text-xs">{error}</p>
          </div>
        )}
        {!loading && !error && isPDF && (
          <div className="shadow-2xl rounded overflow-hidden">
            <canvas
              ref={canvasRef}
              style={{
                display: "block",
                maxWidth: "100%",
                pointerEvents: "none",
              }}
            />
          </div>
        )}
        {!loading && !error && !isPDF && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-20 h-20 bg-surface-700 rounded-2xl flex items-center justify-center text-4xl">
              📄
            </div>
            <p className="text-white font-semibold">{filename}</p>
            <p className="text-surface-400 text-sm max-w-xs">
              Preview is only available for PDF files. {isAdmin ? "Use the Download button to open this file." : "Contact an admin if you need access to this file."}
            </p>
          </div>
        )}
      </div>

      {/* Watermark overlay – extra layer on top of canvas, non-interactive */}
      {!loading && !error && isPDF && (
        <div
          aria-hidden
          className="pointer-events-none select-none fixed inset-0 z-[101] overflow-hidden"
          style={{ top: "52px" /* below toolbar */ }}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="absolute text-surface-900 font-black opacity-[0.06] whitespace-nowrap"
              style={{
                fontSize: "3.5rem",
                transform: `rotate(-30deg)`,
                top: `${(i * 14) - 5}%`,
                left: "-10%",
                right: "-10%",
                textAlign: "center",
                letterSpacing: "0.3em",
              }}
            >
              CONFIDENTIAL &nbsp; CONFIDENTIAL &nbsp; CONFIDENTIAL
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Documents Page
// ─────────────────────────────────────────────────────────────
export default function DocumentsPage() {
  const { t } = useI18n();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const isAdmin = ADMIN_ROLES.includes(authUser?.role || "");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Document list & search
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // System options for Custom access selection
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);

  // Drag & Upload state
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Upload Form Visibility options
  const [uploadVisibility, setUploadVisibility] = useState<VisibilityType>("all");
  const [uploadAllowedRoles, setUploadAllowedRoles] = useState<string[]>([]);
  const [uploadAllowedUsers, setUploadAllowedUsers] = useState<string[]>([]);

  // Edit Access Modal
  const [editingDoc, setEditingDoc] = useState<DocumentItem | null>(null);
  const [editVisibility, setEditVisibility] = useState<VisibilityType>("all");
  const [editAllowedRoles, setEditAllowedRoles] = useState<string[]>([]);
  const [editAllowedUsers, setEditAllowedUsers] = useState<string[]>([]);
  const [updatingSettings, setUpdatingSettings] = useState(false);

  // Delete Confirmation Modal
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // PDF Viewer
  const [viewingDoc, setViewingDoc] = useState<DocumentItem | null>(null);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const data = await api.get<DocumentItem[]>("/documents");
      setDocuments(data || []);
    } catch (err) {
      console.error("Failed to load documents", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async () => {
    try {
      const [rolesRes, posRes, membersRes] = await Promise.all([
        api.get<CustomRole[]>("/roles/custom-roles").catch(() => []),
        api.get<Position[]>("/roles/positions").catch(() => []),
        api.get<OrgMember[]>("/users").catch(() => []),
      ]);
      setCustomRoles(rolesRes || []);
      setPositions(posRes || []);
      setOrgMembers(membersRes || []);
    } catch (err) {
      console.error("Failed to fetch custom roles/members", err);
    }
  };

  useEffect(() => {
    setAuthUser(getAuthUser());
    fetchDocuments();
    fetchMetadata();
  }, []);

  // Combined roles list for selection dropdown
  const allRoleOptions = [
    ...BUILTIN_ROLES.map((r) => ({ key: r.key, label: r.label, type: "Built-in" })),
    ...customRoles.map((cr) => ({ key: cr.name, label: cr.name, type: "Custom Role" })),
    ...positions.map((p) => ({ key: p.name, label: p.name, type: "Position" })),
  ];

  const getRoleBadgeLabel = (roleKey: string) => {
    const matched = allRoleOptions.find((r) => r.key === roleKey);
    return matched ? matched.label : roleKey;
  };

  // Upload actions
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) return;
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("visibility", uploadVisibility);
      formData.append("allowed_roles", JSON.stringify(uploadAllowedRoles));
      formData.append("allowed_users", JSON.stringify(uploadAllowedUsers));
      await api.post("/documents/upload", formData);
      setSelectedFile(null);
      setUploadVisibility("all");
      setUploadAllowedRoles([]);
      setUploadAllowedUsers([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchDocuments();
    } catch (err) {
      alert("Failed to upload document. " + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const toggleUploadRole = (roleKey: string) => {
    setUploadAllowedRoles((prev) =>
      prev.includes(roleKey) ? prev.filter((r) => r !== roleKey) : [...prev, roleKey]
    );
  };

  const addUploadUser = (userId: string) => {
    if (userId && !uploadAllowedUsers.includes(userId)) {
      setUploadAllowedUsers((prev) => [...prev, userId]);
    }
  };

  const removeUploadUser = (userId: string) =>
    setUploadAllowedUsers((prev) => prev.filter((u) => u !== userId));

  const openEditModal = (doc: DocumentItem) => {
    setEditingDoc(doc);
    setEditVisibility(doc.visibility);
    setEditAllowedRoles(doc.allowed_roles || []);
    setEditAllowedUsers((doc.allowed_users || []).map((u) => u.user_id));
  };

  const toggleEditRole = (roleKey: string) => {
    setEditAllowedRoles((prev) =>
      prev.includes(roleKey) ? prev.filter((r) => r !== roleKey) : [...prev, roleKey]
    );
  };

  const addEditUser = (userId: string) => {
    if (userId && !editAllowedUsers.includes(userId)) {
      setEditAllowedUsers((prev) => [...prev, userId]);
    }
  };

  const removeEditUser = (userId: string) =>
    setEditAllowedUsers((prev) => prev.filter((u) => u !== userId));

  const handleSaveVisibility = async () => {
    if (!editingDoc) return;
    try {
      setUpdatingSettings(true);
      await api.patch(`/documents/${editingDoc.id}/visibility`, {
        visibility: editVisibility,
        allowed_roles: editAllowedRoles,
        allowed_users: editAllowedUsers,
      });
      setEditingDoc(null);
      fetchDocuments();
    } catch (err) {
      alert("Failed to update visibility: " + (err as Error).message);
    } finally {
      setUpdatingSettings(false);
    }
  };

  // Admin-only clean download (no watermark)
  const handleDownload = async (doc: DocumentItem) => {
    if (!isAdmin) return; // double-check
    try {
      const match = document.cookie.match(/token=([^;]+)/);
      const token = match ? match[1] : "";
      const res = await fetch(`${API_URL}/documents/${doc.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Could not download file: " + (err as Error).message);
    }
  };

  // Delete Document
  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    try {
      setDeleting(true);
      await api.delete(`/documents/${docToDelete.id}`);
      setDocToDelete(null);
      fetchDocuments();
    } catch (err) {
      alert("Failed to delete document: " + (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  const filteredDocs = documents.filter(
    (doc) =>
      doc.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.uploader_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-surface-900">{t.nav.documents}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          {isAdmin
            ? "Upload files and manage granular role & member access controls"
            : "View documents shared with you. Documents are watermarked and cannot be downloaded."}
        </p>
      </div>

      {/* ── Upload Box & Settings Grid – ADMIN ONLY ── */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Drop Zone */}
          <div className="lg:col-span-6 bg-white border border-surface-200 rounded-2xl p-6 shadow-sm">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload-input"
            />
            <label
              htmlFor="file-upload-input"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer block ${
                dragging
                  ? "border-primary-500 bg-primary-50/50 scale-[0.99]"
                  : "border-surface-200 bg-surface-50/50 hover:border-surface-300 hover:bg-white"
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-sm text-surface-700 font-medium">{t.documents.dragDrop}</p>
              <p className="text-xs text-surface-400 mt-1">PDF, DOCX, XLSX, images up to 50MB</p>
              {selectedFile && (
                <div className="mt-4 px-3 py-2 bg-primary-50 border border-primary-200 text-primary-800 text-xs font-semibold rounded-lg inline-flex items-center gap-2">
                  <span>📎 {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
                </div>
              )}
            </label>
          </div>

          {/* Upload Visibility & Settings */}
          <div className="lg:col-span-6 bg-white rounded-2xl border border-surface-200 p-6 shadow-sm space-y-5">
            <div>
              <h2 className="text-sm font-bold text-surface-900">
                Who can access this document?
              </h2>
              <p className="text-xs text-surface-500 mt-0.5">
                Choose who can view this file once uploaded
              </p>
            </div>

            {/* Visual 3-card selector */}
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setUploadVisibility("all")}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  uploadVisibility === "all"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20 shadow-xs"
                    : "border-surface-200 bg-surface-50/40 hover:bg-white hover:border-surface-300"
                }`}
              >
                <div className="text-xl mb-1.5">🌐</div>
                <div>
                  <div className={`text-xs font-bold ${uploadVisibility === "all" ? "text-primary-900" : "text-surface-900"}`}>
                    Everyone
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5 leading-snug">
                    All org members
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setUploadVisibility("admins")}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  uploadVisibility === "admins"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20 shadow-xs"
                    : "border-surface-200 bg-surface-50/40 hover:bg-white hover:border-surface-300"
                }`}
              >
                <div className="text-xl mb-1.5">🛡️</div>
                <div>
                  <div className={`text-xs font-bold ${uploadVisibility === "admins" ? "text-primary-900" : "text-surface-900"}`}>
                    Admins
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5 leading-snug">
                    Staff & org admins
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setUploadVisibility("custom")}
                className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  uploadVisibility === "custom"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20 shadow-xs"
                    : "border-surface-200 bg-surface-50/40 hover:bg-white hover:border-surface-300"
                }`}
              >
                <div className="text-xl mb-1.5">👥</div>
                <div>
                  <div className={`text-xs font-bold ${uploadVisibility === "custom" ? "text-primary-900" : "text-surface-900"}`}>
                    Custom
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5 leading-snug">
                    Roles / people
                  </div>
                </div>
              </button>
            </div>

            {/* Custom Access Options - Shown only when Custom is chosen */}
            {uploadVisibility === "custom" && (
              <div className="space-y-4 pt-3 border-t border-surface-100 bg-surface-50/50 p-4 rounded-xl border border-surface-200/80">
                {/* 1. Clickable Role Pills */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-surface-800">
                      1. Allowed Roles & Positions
                    </span>
                    {uploadAllowedRoles.length > 0 && (
                      <span className="text-[11px] font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full border border-primary-200">
                        {uploadAllowedRoles.length} selected
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-surface-500 mb-2">
                    Click any role to toggle access:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {allRoleOptions.map((r) => {
                      const isSelected = uploadAllowedRoles.includes(r.key);
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => toggleUploadRole(r.key)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? "bg-primary-600 text-white border-primary-600 shadow-2xs scale-[1.02]"
                              : "bg-white text-surface-700 border-surface-200 hover:border-surface-400 hover:bg-surface-50"
                          }`}
                        >
                          <span className={isSelected ? "font-bold" : "text-surface-400"}>
                            {isSelected ? "✓" : "+"}
                          </span>
                          <span>{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Specific Member Selector */}
                <div className="pt-2 border-t border-surface-200/60">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-surface-800">
                      2. Specific Members (Optional)
                    </span>
                    {uploadAllowedUsers.length > 0 && (
                      <span className="text-[11px] font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full border border-primary-200">
                        {uploadAllowedUsers.length} selected
                      </span>
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addUploadUser(e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 text-xs font-medium text-surface-700 focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">+ Add a specific member...</option>
                    {orgMembers
                      .filter((m) => !uploadAllowedUsers.includes(m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name || m.name} ({m.email})
                        </option>
                      ))}
                  </select>

                  {uploadAllowedUsers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {uploadAllowedUsers.map((uid) => {
                        const member = orgMembers.find((m) => m.id === uid);
                        return (
                          <span
                            key={uid}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-surface-200 text-surface-800 rounded-lg text-xs font-medium shadow-2xs"
                          >
                            <span>👤 {member ? member.display_name || member.name : uid}</span>
                            <button
                              type="button"
                              onClick={() => removeUploadUser(uid)}
                              className="text-surface-400 hover:text-red-600 font-bold ml-1 transition"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Upload Button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={!selectedFile || uploading}
                onClick={handleUploadSubmit}
                className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all shadow-sm flex items-center justify-center gap-2 ${
                  !selectedFile || uploading
                    ? "bg-surface-100 text-surface-400 cursor-not-allowed border border-surface-200"
                    : "bg-primary-600 hover:bg-primary-700 text-white cursor-pointer active:scale-[0.99]"
                }`}
              >
                {uploading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    <span>Uploading document...</span>
                  </>
                ) : (
                  <>
                    <span>📤</span>
                    <span>Upload Document</span>
                  </>
                )}
              </button>
              {!selectedFile && (
                <p className="text-[11px] text-center text-surface-400 mt-2">
                  Please drop or select a file on the left first
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Document Library ── */}
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-surface-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-surface-900">Document Library</h2>
            <p className="text-xs text-surface-500">
              {isAdmin
                ? "Documents you uploaded or have access to manage"
                : "Click any document to view it · Documents are watermarked · Download not permitted"}
            </p>
          </div>
          <div className="w-full md:w-72 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-surface-200 text-xs focus:ring-2 focus:ring-primary-500 focus:outline-none"
            />
            <svg className="w-4 h-4 text-surface-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
        </div>

        {!isAdmin && (
          <div className="mx-5 mt-4 mb-0 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-xs text-amber-800 font-medium leading-relaxed">
              <strong>View-only access:</strong> Documents are displayed with a CONFIDENTIAL watermark. Downloading, printing, and copying is restricted. All access is logged.
            </p>
          </div>
        )}

        {loading ? (
          <div className="divide-y divide-surface-100">
            {[1, 2, 3, 4].map((i) => (
              <DocumentSkeleton key={i} />
            ))}
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <div className="text-3xl">📁</div>
            <p className="text-sm font-medium text-surface-600">No documents found</p>
            <p className="text-xs text-surface-400">
              {isAdmin ? "Upload a file or adjust search filters" : "No documents have been shared with you yet"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100">
            {filteredDocs.map((doc) => {
              const isUploader = doc.uploaded_by === authUser?.id;
              const canEdit = isUploader || isAdmin;

              return (
                <div
                  key={doc.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-surface-50/60 transition"
                >
                  {/* Clickable document info */}
                  <button
                    type="button"
                    onClick={() => setViewingDoc(doc)}
                    className="flex items-start gap-3.5 min-w-0 text-left group flex-1"
                  >
                    <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center shrink-0 text-surface-600 font-bold text-sm group-hover:bg-primary-100 group-hover:text-primary-700 transition">
                      📄
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-surface-900 truncate group-hover:text-primary-700 transition">
                        {doc.filename}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500 mt-0.5">
                        <span>By <strong className="text-surface-700">{doc.uploader_name}</strong></span>
                        <span>•</span>
                        <span>{doc.created_at}</span>
                        {!isAdmin && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            🔒 View only
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {doc.visibility === "all" && (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold rounded-md">
                            🌐 All Members
                          </span>
                        )}
                        {doc.visibility === "admins" && (
                          <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 text-[11px] font-semibold rounded-md">
                            🛡️ Only Admins
                          </span>
                        )}
                        {doc.visibility === "restricted" && (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold rounded-md">
                            🔒 Restricted (Only Uploader)
                          </span>
                        )}
                        {doc.visibility === "custom" && (
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold rounded-md">
                              ⚙️ Custom Access
                            </span>
                            {doc.allowed_roles?.map((r) => (
                              <span key={r} className="px-1.5 py-0.5 bg-surface-100 text-surface-700 border border-surface-200 text-[10px] rounded">
                                {getRoleBadgeLabel(r)}
                              </span>
                            ))}
                            {doc.allowed_users?.map((u) => (
                              <span key={u.user_id} className="px-1.5 py-0.5 bg-surface-100 text-surface-700 border border-surface-200 text-[10px] rounded">
                                👤 {u.user_name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {/* View button (all users) */}
                    <button
                      type="button"
                      onClick={() => setViewingDoc(doc)}
                      className="px-3 py-1.5 bg-surface-100 hover:bg-surface-200 text-surface-700 border border-surface-200 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                    >
                      👁 View
                    </button>

                    {/* Download button – ADMIN ONLY */}
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        className="px-3 py-1.5 bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-200 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                      >
                        ⬇️ Download
                      </button>
                    )}

                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => openEditModal(doc)}
                        className="px-3 py-1.5 bg-surface-100 hover:bg-surface-200 text-surface-700 border border-surface-200 rounded-lg text-xs font-semibold transition"
                      >
                        ⚙️ Edit Access
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setDocToDelete(doc)}
                        className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg text-xs font-semibold transition"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Watermarked PDF Viewer Modal ── */}
      {viewingDoc && (
        <WatermarkedPDFViewer
          docId={viewingDoc.id}
          filename={viewingDoc.filename}
          onClose={() => setViewingDoc(null)}
          isAdmin={isAdmin}
        />
      )}

      {/* ── Edit Visibility Modal ── */}
      {editingDoc && (
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-5">
            <div>
              <h3 className="text-base font-bold text-surface-900">
                Edit Access for &quot;{editingDoc.filename}&quot;
              </h3>
              <p className="text-xs text-surface-500 mt-0.5">
                Manage who can view this document in your organization
              </p>
            </div>

            {/* 3 Visual Cards */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setEditVisibility("all")}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  editVisibility === "all"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20 shadow-xs"
                    : "border-surface-200 bg-surface-50/40 hover:bg-white hover:border-surface-300"
                }`}
              >
                <div className="text-lg mb-1">🌐</div>
                <div>
                  <div className={`text-xs font-bold ${editVisibility === "all" ? "text-primary-900" : "text-surface-900"}`}>
                    Everyone
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5 leading-tight">
                    All org members
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEditVisibility("admins")}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  editVisibility === "admins"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20 shadow-xs"
                    : "border-surface-200 bg-surface-50/40 hover:bg-white hover:border-surface-300"
                }`}
              >
                <div className="text-lg mb-1">🛡️</div>
                <div>
                  <div className={`text-xs font-bold ${editVisibility === "admins" ? "text-primary-900" : "text-surface-900"}`}>
                    Admins
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5 leading-tight">
                    Staff & org admins
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setEditVisibility("custom")}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                  editVisibility === "custom"
                    ? "border-primary-600 bg-primary-50/60 ring-2 ring-primary-500/20 shadow-xs"
                    : "border-surface-200 bg-surface-50/40 hover:bg-white hover:border-surface-300"
                }`}
              >
                <div className="text-lg mb-1">👥</div>
                <div>
                  <div className={`text-xs font-bold ${editVisibility === "custom" ? "text-primary-900" : "text-surface-900"}`}>
                    Custom
                  </div>
                  <div className="text-[10px] text-surface-500 mt-0.5 leading-tight">
                    Roles / people
                  </div>
                </div>
              </button>
            </div>

            {/* Custom Access Options in Modal */}
            {editVisibility === "custom" && (
              <div className="space-y-4 pt-3 border-t border-surface-100 bg-surface-50/50 p-4 rounded-xl border border-surface-200/80">
                {/* 1. Clickable Role Pills */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-surface-800">
                      1. Allowed Roles & Positions
                    </span>
                    {editAllowedRoles.length > 0 && (
                      <span className="text-[11px] font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full border border-primary-200">
                        {editAllowedRoles.length} selected
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {allRoleOptions.map((r) => {
                      const isSelected = editAllowedRoles.includes(r.key);
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => toggleEditRole(r.key)}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 cursor-pointer ${
                            isSelected
                              ? "bg-primary-600 text-white border-primary-600 shadow-2xs"
                              : "bg-white text-surface-700 border-surface-200 hover:border-surface-400 hover:bg-surface-50"
                          }`}
                        >
                          <span className={isSelected ? "font-bold" : "text-surface-400"}>
                            {isSelected ? "✓" : "+"}
                          </span>
                          <span>{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Specific Member Selector */}
                <div className="pt-2 border-t border-surface-200/60">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-surface-800">
                      2. Specific Members (Optional)
                    </span>
                    {editAllowedUsers.length > 0 && (
                      <span className="text-[11px] font-medium text-primary-700 bg-primary-50 px-2 py-0.5 rounded-full border border-primary-200">
                        {editAllowedUsers.length} selected
                      </span>
                    )}
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) addEditUser(e.target.value);
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-surface-200 text-xs font-medium text-surface-700 focus:ring-2 focus:ring-primary-500 bg-white"
                  >
                    <option value="">+ Add a specific member...</option>
                    {orgMembers
                      .filter((m) => !editAllowedUsers.includes(m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name || m.name} ({m.email})
                        </option>
                      ))}
                  </select>

                  {editAllowedUsers.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {editAllowedUsers.map((uid) => {
                        const member = orgMembers.find((m) => m.id === uid);
                        return (
                          <span
                            key={uid}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-surface-200 text-surface-800 rounded-lg text-xs font-medium shadow-2xs"
                          >
                            <span>👤 {member ? member.display_name || member.name : uid}</span>
                            <button
                              type="button"
                              onClick={() => removeEditUser(uid)}
                              className="text-surface-400 hover:text-red-600 font-bold ml-1 transition"
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-surface-100">
              <button
                type="button"
                onClick={() => setEditingDoc(null)}
                className="px-4 py-2 bg-surface-100 hover:bg-surface-200 text-surface-700 rounded-xl text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updatingSettings}
                onClick={handleSaveVisibility}
                className="px-5 py-2 bg-primary-600 text-white rounded-xl text-xs font-semibold hover:bg-primary-700 transition shadow-xs cursor-pointer"
              >
                {updatingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {docToDelete && (
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-surface-900">Delete Document</h3>
            <p className="text-xs text-surface-600">
              Are you sure you want to delete <strong>&quot;{docToDelete.filename}&quot;</strong>? This file will be permanently removed.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDocToDelete(null)}
                className="px-4 py-2 bg-surface-100 text-surface-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold transition"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}