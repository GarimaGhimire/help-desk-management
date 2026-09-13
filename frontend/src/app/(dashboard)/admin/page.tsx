"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getAuthUser, homeForRole } from "@/lib/api";

type Org = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  staff_limit: number | null;
  group_limit: number | null;
  created_at: string;
};

type AuditEntry = {
  id: string;
  org_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata?: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
};

function LimitCell({ label, value, used }: { label: string; value: number | null; used: number }) {
  return (
    <div className="text-sm">
      <div className="text-surface-500 text-xs">{label}</div>
      <div className={value !== null && used >= value ? "text-red-600 font-medium" : "text-surface-900"}>
        {value === null ? "∞" : `${used} / ${value}`}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"organizations" | "audit">("organizations");

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<{ org_id: string | null }[]>([]);
  const [groups, setGroups] = useState<{ org_id: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // create org form
  const [showCreate, setShowCreate] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: "", slug: "", staff_limit: "", group_limit: "" });
  const [creating, setCreating] = useState(false);

  // per-org admin creation
  const [adminForm, setAdminForm] = useState<Record<string, { name: string; email: string; password: string }>>({});
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [adminCreating, setAdminCreating] = useState<Record<string, boolean>>({});
  const [adminMsg, setAdminMsg] = useState<Record<string, string>>({});

  // org deletion confirmation
  const [deleteOrg, setDeleteOrg] = useState<Org | null>(null);
  const [deleting, setDeleting] = useState(false);

  // audit
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditOrg, setAuditOrg] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    const user = getAuthUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.role !== "superadmin") {
      router.replace(homeForRole(user.role));
      return;
    }
  }, [router]);

  const loadOrganizations = useCallback(async () => {
    const [o, u, g] = await Promise.all([
      api.get<Org[]>("/admin/orgs"),
      api.get<{ org_id: string | null }[]>("/users"),
      api.get<{ org_id: string | null }[]>("/groups"),
    ]);
    setOrgs(o);
    setUsers(u);
    setGroups(g);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organizations");
    } finally {
      setLoading(false);
    }
  }, [loadOrganizations]);

  useEffect(() => {
    load();
  }, [load]);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    setError("");
    try {
      const qs = auditOrg ? `?org_id=${auditOrg}` : "";
      const a = await api.get<AuditEntry[]>(`/admin/audit${qs}`);
      setAudit(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setAuditLoading(false);
    }
  }, [auditOrg]);

  useEffect(() => {
    if (tab === "audit") loadAudit();
  }, [tab, loadAudit]);

  const staffCount = (orgId: string) => users.filter((u) => u.org_id === orgId).length;
  const groupCount = (orgId: string) => groups.filter((g) => g.org_id === orgId).length;

  const parseLimit = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) throw new Error("limits must be positive whole numbers (or blank for unlimited)");
    return n;
  };

  const createOrg = async () => {
    setCreating(true);
    setError("");
    try {
      const body: Record<string, unknown> = { name: newOrg.name };
      if (newOrg.slug.trim()) body.slug = newOrg.slug;
      body.staff_limit = parseLimit(newOrg.staff_limit);
      body.group_limit = parseLimit(newOrg.group_limit);
      await api.post("/admin/orgs", body);
      setShowCreate(false);
      setNewOrg({ name: "", slug: "", staff_limit: "", group_limit: "" });
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setCreating(false);
    }
  };

  const updateOrg = async (org: Org, patch: { is_active?: boolean; staff_limit?: number | null; group_limit?: number | null }) => {
    setError("");
    try {
      await api.patch(`/admin/orgs/${org.id}`, patch);
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update organization");
    }
  };

  const createOrgAdmin = async (org: Org) => {
    const f = adminForm[org.id];
    if (!f || !f.name.trim() || !f.email.trim()) return;
    const pw = f.password;
    if (pw) {
      const valid =
        pw.length >= 10 &&
        /[a-z]/.test(pw) &&
        /[A-Z]/.test(pw) &&
        /[0-9]/.test(pw) &&
        /[^A-Za-z0-9]/.test(pw) &&
        !/\s/.test(pw);
      if (!valid) {
        setAdminMsg((p) => ({
          ...p,
          [org.id]: "Password must be 10+ chars with upper, lower, digit, special char (no spaces).",
        }));
        return;
      }
    }
    setAdminCreating((p) => ({ ...p, [org.id]: true }));
    setAdminMsg((p) => ({ ...p, [org.id]: "" }));
    setError("");
    try {
      const body: Record<string, unknown> = {
        name: f.name.trim(),
        email: f.email.trim(),
        role: "org_admin",
        org_id: org.id,
      };
      if (pw) body.password = pw;
      await api.post<{ id: string; role: string }>("/users", body);
      setAdminMsg((p) => ({
        ...p,
        [org.id]: pw
          ? `${f.name.trim()} created (org_admin). They can sign in with the password you set.`
          : `${f.name.trim()} created (org_admin). Temp password emailed.`,
      }));
      setAdminForm((p) => ({ ...p, [org.id]: { name: "", email: "", password: "" } }));
      setShowPassword((p) => ({ ...p, [org.id]: false }));
    } catch (err) {
      setAdminMsg((p) => ({ ...p, [org.id]: err instanceof Error ? err.message : "Failed to create admin" }));
    } finally {
      setAdminCreating((p) => ({ ...p, [org.id]: false }));
    }
  };

  const confirmDeleteOrg = async () => {
    if (!deleteOrg) return;
    setDeleting(true);
    setError("");
    try {
      await api.delete(`/admin/orgs/${deleteOrg.id}`);
      setDeleteOrg(null);
      await loadOrganizations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete organization");
    } finally {
      setDeleting(false);
    }
  };

  const badge = (active: boolean) =>
    active ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Suspended</span>
    );

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-surface-900">Platform Admin</h1>
          <p className="text-sm text-surface-500 mt-0.5">Manage companies and their quotas</p>
        </div>
        <div className="flex items-center gap-2">
          {["organizations", "audit"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t as typeof tab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                tab === t ? "bg-primary-600 text-white" : "bg-white border border-surface-200 text-surface-600 hover:bg-surface-50"
              }`}
            >
              {t === "organizations" ? "Organizations" : "Audit log"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {tab === "organizations" ? (
        <>
          {!showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="mb-4 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
            >
              + New organization
            </button>
          )}

          {showCreate && (
            <div className="mb-5 bg-white rounded-xl border border-surface-200 p-5 shadow-sm space-y-3">
              <h3 className="text-sm font-semibold text-surface-900">New organization</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Name *</label>
                  <input
                    value={newOrg.name}
                    onChange={(e) => setNewOrg((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Acme Bank"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Slug (optional)</label>
                  <input
                    value={newOrg.slug}
                    onChange={(e) => setNewOrg((p) => ({ ...p, slug: e.target.value }))}
                    placeholder="acme-bank"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Staff limit (blank = unlimited)</label>
                  <input
                    value={newOrg.staff_limit}
                    onChange={(e) => setNewOrg((p) => ({ ...p, staff_limit: e.target.value }))}
                    placeholder="25"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Group limit (blank = unlimited)</label>
                  <input
                    value={newOrg.group_limit}
                    onChange={(e) => setNewOrg((p) => ({ ...p, group_limit: e.target.value }))}
                    placeholder="10"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={createOrg}
                  disabled={creating || !newOrg.name.trim()}
                  className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-lg border border-surface-200 text-sm text-surface-600 hover:bg-surface-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-surface-500">Loading…</p>
          ) : (
            <div className="space-y-4">
              {orgs.map((org) => {
                const editing = adminForm[org.id];
                return (
                  <div key={org.id} className="bg-white rounded-xl border border-surface-200 p-5 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-surface-900">{org.name}</h3>
                          {badge(org.is_active)}
                        </div>
                        <p className="text-xs text-surface-400 font-mono mt-0.5">{org.slug}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          value={org.staff_limit ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const lim = v === "" ? null : Number(v);
                            if (!Number.isNaN(lim)) updateOrg(org, { staff_limit: lim });
                          }}
                          placeholder="∞"
                          title="Staff limit"
                          className="w-16 px-2 py-1 text-center rounded-lg border border-surface-200 text-sm"
                        />
                        <input
                          value={org.group_limit ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const lim = v === "" ? null : Number(v);
                            if (!Number.isNaN(lim)) updateOrg(org, { group_limit: lim });
                          }}
                          placeholder="∞"
                          title="Group limit"
                          className="w-16 px-2 py-1 text-center rounded-lg border border-surface-200 text-sm"
                        />
                        <button
                          onClick={() => updateOrg(org, { is_active: !org.is_active })}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            org.is_active
                              ? "border-red-200 text-red-600 hover:bg-red-50"
                              : "border-green-200 text-green-600 hover:bg-green-50"
                          }`}
                        >
                          {org.is_active ? "Suspend" : "Activate"}
                        </button>
                        <button
                          onClick={() => setDeleteOrg(org)}
                          title="Delete organization"
                          className="p-2 rounded-lg border border-surface-200 text-surface-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-8">
                      <LimitCell label="Staff accounts" value={org.staff_limit} used={staffCount(org.id)} />
                      <LimitCell label="Groups" value={org.group_limit} used={groupCount(org.id)} />
                    </div>

                    <div className="mt-4 pt-4 border-t border-surface-100">
                      <p className="text-xs font-medium text-surface-700 mb-2">Create org admin</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editing?.name ?? ""}
                          onChange={(e) => setAdminForm((p) => ({ ...p, [org.id]: { name: e.target.value, email: editing?.email ?? "", password: editing?.password ?? "" } }))}
                          placeholder="Admin name"
                          className="px-3 py-2 rounded-lg border border-surface-200 text-sm"
                        />
                        <input
                          value={editing?.email ?? ""}
                          onChange={(e) => setAdminForm((p) => ({ ...p, [org.id]: { name: editing?.name ?? "", email: e.target.value, password: editing?.password ?? "" } }))}
                          placeholder="admin@company.com"
                          className="px-3 py-2 rounded-lg border border-surface-200 text-sm"
                        />
                        <div className="relative">
                          <input
                            value={editing?.password ?? ""}
                            onChange={(e) => setAdminForm((p) => ({ ...p, [org.id]: { name: editing?.name ?? "", email: editing?.email ?? "", password: e.target.value } }))}
                            placeholder="Password (optional)"
                            type={showPassword[org.id] ? "text" : "password"}
                            className="px-3 py-2 pr-9 rounded-lg border border-surface-200 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((p) => ({ ...p, [org.id]: !p[org.id] }))}
                            tabIndex={-1}
                            aria-label={showPassword[org.id] ? "Hide password" : "Show password"}
                            title={showPassword[org.id] ? "Hide password" : "Show password"}
                            className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-surface-400 hover:text-surface-600 transition-colors"
                          >
                            {showPassword[org.id] ? (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                            )}
                          </button>
                        </div>
                        <button
                          onClick={() => createOrgAdmin(org)}
                          disabled={adminCreating[org.id] || !editing?.name.trim() || !editing?.email.trim()}
                          className="px-3 py-2 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800 disabled:opacity-50"
                        >
                          {adminCreating[org.id] ? "Creating…" : "Create"}
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-surface-400">
                        Set a password to skip the emailed temp password (policy: 10+ chars, upper/lower/digit/special).
                      </p>
                      {adminMsg[org.id] && (
                        <p className="mt-2 text-xs text-surface-500">{adminMsg[org.id]}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-xl border border-surface-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-surface-900">Audit log</h3>
            <div className="flex items-center gap-2">
              <select
                value={auditOrg}
                onChange={(e) => setAuditOrg(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-surface-200 text-sm"
              >
                <option value="">All organizations</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                onClick={loadAudit}
                disabled={auditLoading}
                className="px-3 py-1.5 rounded-lg border border-surface-200 text-sm text-surface-600 hover:bg-surface-50 disabled:opacity-50"
              >
                {auditLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>
          {audit.length === 0 ? (
            <p className="text-sm text-surface-400 py-6 text-center">No audit events yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-surface-400 border-b border-surface-100">
                    <th className="pb-2 pr-4 font-medium">Action</th>
                    <th className="pb-2 pr-4 font-medium">Target</th>
                    <th className="pb-2 pr-4 font-medium">IP</th>
                    <th className="pb-2 font-medium">When</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-b border-surface-50">
                      <td className="py-2 pr-4 font-mono text-xs text-surface-700">{a.action}</td>
                      <td className="py-2 pr-4 text-surface-600">
                        {a.target_type ?? "—"}
                        {a.target_id ? ` (${a.target_id.slice(0, 8)}…)` : ""}
                      </td>
                      <td className="py-2 pr-4 text-xs text-surface-400">{a.ip_address ?? "—"}</td>
                      <td className="py-2 text-xs text-surface-400">{new Date(a.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {deleteOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !deleting && setDeleteOrg(null)} />
          <div className="relative bg-white rounded-xl border border-surface-200 shadow-xl w-full max-w-md p-6 mx-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-lg bg-red-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-surface-900">Delete organization?</h3>
                <p className="text-sm text-surface-600 mt-1 leading-relaxed">
                  This will permanently delete{" "}
                  <span className="font-medium text-surface-900">{deleteOrg.name}</span> and{" "}
                  <span className="font-medium text-red-600">everything related</span> to it — all staff accounts, groups,
                  conversations, documents and audit records.{" "}
                  <span className="font-semibold text-surface-900">This action cannot be undone.</span>
                </p>
                <p className="text-xs text-surface-400 mt-2">
                  Current usage: {staffCount(deleteOrg.id)} staff · {groupCount(deleteOrg.id)} groups
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                onClick={() => setDeleteOrg(null)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-lg border border-surface-200 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteOrg}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}