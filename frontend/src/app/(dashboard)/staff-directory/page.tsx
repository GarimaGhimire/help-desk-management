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
  const [authUser, setAuthUser] = useState<ReturnType<typeof getAuthUser>>(null);

  useEffect(() => {
    setAuthUser(getAuthUser());
  }, []);

  const canCreateStaff =
    authUser?.role === "org_admin" ||
    authUser?.role === "staff_admin" ||
    authUser?.role === "superadmin";

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
  const [staffRole, setStaffRole] = useState("org_member");

  // Edit role modal state
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editRole, setEditRole] = useState("org_member");
  const [updatingRole, setUpdatingRole] = useState(false);
  const [editError, setEditError] = useState("");

  // Roles & Positions state
  const [customRoles, setCustomRoles] = useState<{ id: string; name: string }[]>([]);
  const [positions, setPositions] = useState<{ id: string; name: string }[]>([]);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [positionModalOpen, setPositionModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [newPosName, setNewPosName] = useState("");
  const [newPosDesc, setNewPosDesc] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);
  const [modalItemError, setModalItemError] = useState("");

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

  const fetchRolesAndPositions = async () => {
    try {
      const [rData, pData] = await Promise.all([
        api.get<{ id: string; name: string }[]>("/roles/custom-roles"),
        api.get<{ id: string; name: string }[]>("/roles/positions"),
      ]);
      setCustomRoles(rData);
      setPositions(pData);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchRolesAndPositions();
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
        role: staffRole,
      };
      if (staffPassword) body.password = staffPassword;
      const created = await api.post<Employee>("/users", body);
      setStaffSuccess(true);
      setStaffName("");
      setStaffEmail("");
      setStaffPassword("");
      setStaffRole("org_member");
      setCreateStaffOpen(false);
      setStaffError("");
      setCreatingStaff(false);
      setAllStaff((prev) => [created, ...prev]);
    } catch (err) {
      setStaffError(
        err instanceof Error ? err.message : "Failed to create staff account"
      );
      setCreatingStaff(false);
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEmployee) return;
    setUpdatingRole(true);
    setEditError("");
    try {
      const updated = await api.patch<Employee>(`/users/${editEmployee.id}`, {
        role: editRole,
      });
      setAllStaff((prev) =>
        prev.map((emp) => (emp.id === updated.id ? updated : emp))
      );
      setEditEmployee(null);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to update role"
      );
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setCreatingItem(true);
    setModalItemError("");
    try {
      await api.post("/roles/custom-roles", {
        name: newRoleName.trim(),
        description: newRoleDesc.trim(),
      });
      setNewRoleName("");
      setNewRoleDesc("");
      setRoleModalOpen(false);
      fetchRolesAndPositions();
    } catch (err) {
      setModalItemError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setCreatingItem(false);
    }
  };

  const handleCreatePosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPosName.trim()) return;
    setCreatingItem(true);
    setModalItemError("");
    try {
      await api.post("/roles/positions", {
        name: newPosName.trim(),
        description: newPosDesc.trim(),
      });
      setNewPosName("");
      setNewPosDesc("");
      setPositionModalOpen(false);
      fetchRolesAndPositions();
    } catch (err) {
      setModalItemError(err instanceof Error ? err.message : "Failed to create position");
    } finally {
      setCreatingItem(false);
    }
  };

  const canEditStaffRole = (emp: Employee) => {
    if (!authUser) return false;
    if (authUser.role === "superadmin") return true;
    if (authUser.role === "org_admin") return emp.role !== "org_admin";
    if (authUser.role === "staff_admin")
      return emp.role !== "org_admin" && emp.role !== "staff_admin";
    return false;
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-surface-900">
          {t.nav.staffDirectory}
        </h1>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-surface-500">
            Find colleagues and team members
          </p>
          {canCreateStaff && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRoleModalOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-surface-700 text-xs font-medium hover:bg-surface-50 transition-colors"
              >
                + New Custom Role
              </button>
              <button
                onClick={() => setPositionModalOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-surface-200 bg-white text-surface-700 text-xs font-medium hover:bg-surface-50 transition-colors"
              >
                + New Position
              </button>
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

      {/* Roles & Positions Tags Banner */}
      {(customRoles.length > 0 || positions.length > 0) && (
        <div className="mb-6 p-4 bg-surface-50 border border-surface-200 rounded-xl space-y-2">
          {customRoles.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-surface-500">Custom Roles:</span>
              {customRoles.map((r) => (
                <span key={r.id} className="text-xs px-2.5 py-1 rounded-full bg-primary-100 text-primary-800 font-medium">
                  {r.name}
                </span>
              ))}
            </div>
          )}
          {positions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-surface-500">Positions:</span>
              {positions.map((p) => (
                <span key={p.id} className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-medium">
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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
              <div className="flex items-center gap-2 shrink-0">
                {e.role && (
                  <span className="text-xs px-2.5 py-1 rounded-full bg-surface-100 text-surface-600 capitalize font-medium">
                    {e.role.replace("_", " ")}
                  </span>
                )}
                {canEditStaffRole(e) && (
                  <button
                    onClick={() => {
                      setEditEmployee(e);
                      setEditRole(e.role);
                      setEditError("");
                    }}
                    className="text-xs text-primary-600 hover:text-primary-800 font-medium px-2 py-1 rounded hover:bg-primary-50 transition-colors"
                  >
                    Edit Role
                  </button>
                )}
              </div>
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

      {/* Modal: Create Custom Role */}
      {roleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !creatingItem && setRoleModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-surface-900 mb-1">Create Custom Role</h3>
            <p className="text-xs text-surface-500 mb-4">Define a new custom role for your organization staff.</p>
            <form onSubmit={handleCreateRole}>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Role Name</label>
                  <input
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="e.g. Senior Support Agent"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Description (Optional)</label>
                  <input
                    value={newRoleDesc}
                    onChange={(e) => setNewRoleDesc(e.target.value)}
                    placeholder="e.g. Handles Tier 2 escalations"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              {modalItemError && <div className="mb-3 text-xs text-red-600">{modalItemError}</div>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creatingItem || !newRoleName.trim()}
                  className="flex-1 py-2 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {creatingItem ? "Saving..." : "Create Role"}
                </button>
                <button
                  type="button"
                  onClick={() => setRoleModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-surface-200 text-xs text-surface-600 hover:bg-surface-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Position */}
      {positionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => !creatingItem && setPositionModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-surface-900 mb-1">Create Position</h3>
            <p className="text-xs text-surface-500 mb-4">Define a new job title or position for staff directory.</p>
            <form onSubmit={handleCreatePosition}>
              <div className="space-y-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Position Name</label>
                  <input
                    value={newPosName}
                    onChange={(e) => setNewPosName(e.target.value)}
                    placeholder="e.g. Helpdesk Lead"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-500 mb-1">Description (Optional)</label>
                  <input
                    value={newPosDesc}
                    onChange={(e) => setNewPosDesc(e.target.value)}
                    placeholder="e.g. Operations division"
                    className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              </div>
              {modalItemError && <div className="mb-3 text-xs text-red-600">{modalItemError}</div>}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={creatingItem || !newPosName.trim()}
                  className="flex-1 py-2 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50"
                >
                  {creatingItem ? "Saving..." : "Create Position"}
                </button>
                <button
                  type="button"
                  onClick={() => setPositionModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-surface-200 text-xs text-surface-600 hover:bg-surface-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Role Modal */}
      {editEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => !updatingRole && setEditEmployee(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-surface-900 mb-1">
              Edit Role / Position
            </h3>
            <p className="text-xs text-surface-500 mb-4">
              Updating role for <span className="font-medium text-surface-800">{editEmployee.name}</span>
            </p>

            <form onSubmit={handleUpdateRole}>
              <div className="mb-4">
                <label className="block text-xs font-medium text-surface-500 mb-1.5">
                  System Permission Level
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  <option value="org_member">Staff Member (org_member)</option>
                  {(authUser?.role === "org_admin" || authUser?.role === "superadmin") && (
                    <option value="staff_admin">Staff Administrator (staff_admin)</option>
                  )}
                </select>
              </div>

              {editError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
                  {editError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={updatingRole}
                  className="flex-1 py-2 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-700 disabled:opacity-50 transition-all"
                >
                  {updatingRole ? "Saving..." : "Save Role"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditEmployee(null)}
                  disabled={updatingRole}
                  className="px-4 py-2 rounded-lg border border-surface-200 text-xs text-surface-600 hover:bg-surface-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
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
                {(authUser?.role === "org_admin" || authUser?.role === "superadmin") && (
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-surface-500 mb-1.5">
                      Role / Permission Level
                    </label>
                    <select
                      value={staffRole}
                      onChange={(e) => setStaffRole(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      <option value="org_member">Staff Member (org_member)</option>
                      <option value="staff_admin">Staff Administrator (staff_admin)</option>
                    </select>
                  </div>
                )}
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