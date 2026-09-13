"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { api, getAuthUser } from "@/lib/api";
import { DocumentSkeleton } from "@/components/ui/skeleton";

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

export default function DocumentsPage() {
  const { t } = useI18n();
  const authUser = getAuthUser();
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

  // Selected role & user dropdown values for + button
  const [roleToAdd, setRoleToAdd] = useState<string>("");
  const [userToAdd, setUserToAdd] = useState<string>("");

  // Edit Access Modal
  const [editingDoc, setEditingDoc] = useState<DocumentItem | null>(null);
  const [editVisibility, setEditVisibility] = useState<VisibilityType>("all");
  const [editAllowedRoles, setEditAllowedRoles] = useState<string[]>([]);
  const [editAllowedUsers, setEditAllowedUsers] = useState<string[]>([]);
  const [editRoleToAdd, setEditRoleToAdd] = useState<string>("");
  const [editUserToAdd, setEditUserToAdd] = useState<string>("");
  const [updatingSettings, setUpdatingSettings] = useState(false);

  // Delete Confirmation Modal
  const [docToDelete, setDocToDelete] = useState<DocumentItem | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    fetchDocuments();
    fetchMetadata();
  }, []);

  // Combined roles list for selection dropdown
  const allRoleOptions = [
    ...BUILTIN_ROLES.map((r) => ({ key: r.key, label: r.label, type: "Built-in" })),
    ...customRoles.map((cr) => ({ key: cr.name, label: cr.name, type: "Custom Role" })),
    ...positions.map((p) => ({ key: p.name, label: p.name, type: "Position" })),
  ];

  // Helper to format role name badge
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

      // Reset form
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

  // Add & Remove Role Tag helpers (Upload)
  const addUploadRole = () => {
    if (roleToAdd && !uploadAllowedRoles.includes(roleToAdd)) {
      setUploadAllowedRoles([...uploadAllowedRoles, roleToAdd]);
      setRoleToAdd("");
    }
  };

  const removeUploadRole = (roleKey: string) => {
    setUploadAllowedRoles(uploadAllowedRoles.filter((r) => r !== roleKey));
  };

  // Add & Remove Member Tag helpers (Upload)
  const addUploadUser = () => {
    if (userToAdd && !uploadAllowedUsers.includes(userToAdd)) {
      setUploadAllowedUsers([...uploadAllowedUsers, userToAdd]);
      setUserToAdd("");
    }
  };

  const removeUploadUser = (userId: string) => {
    setUploadAllowedUsers(uploadAllowedUsers.filter((u) => u !== userId));
  };

  // Edit Access Modal actions
  const openEditModal = (doc: DocumentItem) => {
    setEditingDoc(doc);
    setEditVisibility(doc.visibility);
    setEditAllowedRoles(doc.allowed_roles || []);
    setEditAllowedUsers((doc.allowed_users || []).map((u) => u.user_id));
  };

  const addEditRole = () => {
    if (editRoleToAdd && !editAllowedRoles.includes(editRoleToAdd)) {
      setEditAllowedRoles([...editAllowedRoles, editRoleToAdd]);
      setEditRoleToAdd("");
    }
  };

  const removeEditRole = (roleKey: string) => {
    setEditAllowedRoles(editAllowedRoles.filter((r) => r !== roleKey));
  };

  const addEditUser = () => {
    if (editUserToAdd && !editAllowedUsers.includes(editUserToAdd)) {
      setEditAllowedUsers([...editAllowedUsers, editUserToAdd]);
      setEditUserToAdd("");
    }
  };

  const removeEditUser = (userId: string) => {
    setEditAllowedUsers(editAllowedUsers.filter((u) => u !== userId));
  };

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

  // Download Handler
  const handleDownload = async (doc: DocumentItem) => {
    try {
      const match = document.cookie.match(/token=([^;]+)/);
      const token = match ? match[1] : "";
      const res = await fetch(`http://localhost:8080/documents/${doc.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error("Download failed");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
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

  // Filtered document list
  const filteredDocs = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.uploader_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-surface-900">{t.nav.documents}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          Upload files and manage granular role & member access controls
        </p>
      </div>

      {/* Upload Box & Settings Grid */}
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
        <div className="lg:col-span-6 bg-white rounded-2xl border border-surface-200 p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-surface-900 border-b border-surface-100 pb-3">
            Visibility & Access Settings
          </h2>

          <div>
            <label className="block text-xs font-medium text-surface-600 mb-1.5">
              Access Permission Level
            </label>
            <select
              value={uploadVisibility}
              onChange={(e) => setUploadVisibility(e.target.value as VisibilityType)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-surface-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500 transition"
            >
              <option value="all">🌐 All Members (Everyone in organization)</option>
              <option value="admins">🛡️ Only Admins (Admins & Superadmins)</option>
              <option value="restricted">🔒 Restricted (Only Uploader - hidden from admins)</option>
              <option value="custom">⚙️ Custom Access (Select Roles & Members)</option>
            </select>
          </div>

          {uploadVisibility === "custom" && (
            <div className="space-y-4 pt-2 border-t border-surface-100">
              {/* Allowed Roles Picker */}
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1.5">
                  Allowed Roles / Positions
                </label>
                <div className="flex gap-2 mb-2">
                  <select
                    value={roleToAdd}
                    onChange={(e) => setRoleToAdd(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-surface-200 text-xs focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select a role to add...</option>
                    {allRoleOptions.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label} ({r.type})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addUploadRole}
                    className="px-3 py-2 bg-surface-900 text-white rounded-lg text-xs font-semibold hover:bg-surface-800 transition"
                  >
                    + Add Role
                  </button>
                </div>

                {/* Selected Role Tags */}
                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-surface-50 rounded-lg border border-surface-200">
                  {uploadAllowedRoles.length === 0 && (
                    <span className="text-xs text-surface-400 italic">No role tags added yet</span>
                  )}
                  {uploadAllowedRoles.map((roleKey) => (
                    <span
                      key={roleKey}
                      className="group inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-surface-300 text-surface-700 rounded-md text-xs font-medium shadow-2xs hover:border-red-300 transition"
                    >
                      🏷️ {getRoleBadgeLabel(roleKey)}
                      <button
                        type="button"
                        onClick={() => removeUploadRole(roleKey)}
                        className="text-surface-400 group-hover:text-red-600 font-bold ml-1"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              {/* Allowed Custom Members Picker */}
              <div>
                <label className="block text-xs font-medium text-surface-600 mb-1.5">
                  Specific Custom Members
                </label>
                <div className="flex gap-2 mb-2">
                  <select
                    value={userToAdd}
                    onChange={(e) => setUserToAdd(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg border border-surface-200 text-xs focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">Select a member to add...</option>
                    {orgMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name || m.name} ({m.email})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addUploadUser}
                    className="px-3 py-2 bg-surface-900 text-white rounded-lg text-xs font-semibold hover:bg-surface-800 transition"
                  >
                    + Add Member
                  </button>
                </div>

                {/* Selected User Tags */}
                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-surface-50 rounded-lg border border-surface-200">
                  {uploadAllowedUsers.length === 0 && (
                    <span className="text-xs text-surface-400 italic">No custom members added yet</span>
                  )}
                  {uploadAllowedUsers.map((uid) => {
                    const member = orgMembers.find((m) => m.id === uid);
                    return (
                      <span
                        key={uid}
                        className="group inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-surface-300 text-surface-700 rounded-md text-xs font-medium shadow-2xs hover:border-red-300 transition"
                      >
                        👤 {member ? member.display_name || member.name : uid}
                        <button
                          type="button"
                          onClick={() => removeUploadUser(uid)}
                          className="text-surface-400 group-hover:text-red-600 font-bold ml-1"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!selectedFile || uploading}
            onClick={handleUploadSubmit}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition shadow-sm ${
              !selectedFile || uploading
                ? "bg-surface-100 text-surface-400 cursor-not-allowed"
                : "bg-primary-600 hover:bg-primary-700 text-white"
            }`}
          >
            {uploading ? "Uploading..." : "Upload Document"}
          </button>
        </div>
      </div>

      {/* Document Library Section */}
      <div className="bg-white rounded-2xl border border-surface-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-surface-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-surface-900">Document Library</h2>
            <p className="text-xs text-surface-500">Documents you uploaded or have access to view</p>
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
            <p className="text-xs text-surface-400">Upload a file or adjust search filters</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100">
            {filteredDocs.map((doc) => {
              const isUploader = doc.uploaded_by === authUser?.id;
              const isAdmin = ["superadmin", "org_admin", "staff_admin"].includes(authUser?.role || "");
              const canEdit = isUploader || isAdmin;

              return (
                <div key={doc.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-surface-50/60 transition">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-surface-100 flex items-center justify-center shrink-0 text-surface-600 font-bold text-sm">
                      📄
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-surface-900 truncate">
                        {doc.filename}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500 mt-0.5">
                        <span>By <strong className="text-surface-700">{doc.uploader_name}</strong></span>
                        <span>•</span>
                        <span>{doc.created_at}</span>
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
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownload(doc)}
                      className="px-3 py-1.5 bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-200 rounded-lg text-xs font-semibold transition flex items-center gap-1"
                    >
                      ⬇️ Download
                    </button>
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

      {/* Edit Visibility Modal */}
      {editingDoc && (
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-surface-900">
              Edit Access Settings for "{editingDoc.filename}"
            </h3>

            <div>
              <label className="block text-xs font-medium text-surface-600 mb-1">
                Access Level
              </label>
              <select
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value as VisibilityType)}
                className="w-full px-3.5 py-2 rounded-xl border border-surface-200 text-sm font-medium focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">🌐 All Members</option>
                <option value="admins">🛡️ Only Admins</option>
                <option value="restricted">🔒 Restricted (Only Uploader)</option>
                <option value="custom">⚙️ Custom Access</option>
              </select>
            </div>

            {editVisibility === "custom" && (
              <div className="space-y-3 pt-2 border-t border-surface-100">
                {/* Edit Roles */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">
                    Allowed Roles
                  </label>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={editRoleToAdd}
                      onChange={(e) => setEditRoleToAdd(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-surface-200 text-xs"
                    >
                      <option value="">Select role...</option>
                      {allRoleOptions.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addEditRole}
                      className="px-3 py-1.5 bg-surface-900 text-white rounded-lg text-xs font-medium"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-2 bg-surface-50 rounded-lg border border-surface-200 min-h-[32px]">
                    {editAllowedRoles.map((rk) => (
                      <span key={rk} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-surface-300 text-xs rounded">
                        🏷️ {getRoleBadgeLabel(rk)}
                        <button type="button" onClick={() => removeEditRole(rk)} className="font-bold text-red-500 ml-1">×</button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Edit Users */}
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1">
                    Allowed Members
                  </label>
                  <div className="flex gap-2 mb-2">
                    <select
                      value={editUserToAdd}
                      onChange={(e) => setEditUserToAdd(e.target.value)}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-surface-200 text-xs"
                    >
                      <option value="">Select member...</option>
                      {orgMembers.map((m) => (
                        <option key={m.id} value={m.id}>{m.display_name || m.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addEditUser}
                      className="px-3 py-1.5 bg-surface-900 text-white rounded-lg text-xs font-medium"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 p-2 bg-surface-50 rounded-lg border border-surface-200 min-h-[32px]">
                    {editAllowedUsers.map((uid) => {
                      const member = orgMembers.find((m) => m.id === uid);
                      return (
                        <span key={uid} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-surface-300 text-xs rounded">
                          👤 {member ? member.display_name || member.name : uid}
                          <button type="button" onClick={() => removeEditUser(uid)} className="font-bold text-red-500 ml-1">×</button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-surface-100">
              <button
                type="button"
                onClick={() => setEditingDoc(null)}
                className="px-4 py-2 bg-surface-100 text-surface-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updatingSettings}
                onClick={handleSaveVisibility}
                className="px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-semibold hover:bg-primary-700 transition"
              >
                {updatingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {docToDelete && (
        <div className="fixed inset-0 bg-surface-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-surface-900">Delete Document</h3>
            <p className="text-xs text-surface-600">
              Are you sure you want to delete <strong>"{docToDelete.filename}"</strong>? This file will be permanently removed.
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