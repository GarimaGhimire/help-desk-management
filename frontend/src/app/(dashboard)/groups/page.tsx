"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { api, getAuthUser, homeForRole } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";

interface Group {
  id: string;
  name: string;
  type: string;
  role_in_group: string;
}

export default function GroupsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"internal" | "bank">("internal");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const fetchGroups = useCallback(() => {
    api.get<Group[]>("/groups").then(setGroups).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (getAuthUser()?.role === "superadmin") {
      router.replace(homeForRole("superadmin"));
      return;
    }
    fetchGroups();
  }, [router, fetchGroups]);

  const createGroup = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const group = await api.post<Group>("/groups", { name: newName.trim(), type: newType });
      setGroups((prev) => [group, ...prev]);
      setNewName("");
      setNewType("internal");
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-surface-900">{t.nav.groups}</h1>
          <p className="text-sm text-surface-500 mt-0.5">Your conversations and channels</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 transition-colors"
        >
          {t.groups.create}
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-white border border-surface-200 animate-pulse" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-surface-200">
          <svg className="w-10 h-10 text-surface-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
          </svg>
          <p className="text-sm text-surface-500">No groups yet</p>
          <p className="text-xs text-surface-400 mt-1">Create a group to start a conversation</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}/chat`}
              className="p-4 bg-white rounded-xl border border-surface-200 hover:border-primary-200 hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between">
                <h2 className="font-medium text-surface-900 text-sm">{group.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ml-2 ${
                  group.type === "bank"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-surface-100 text-surface-600"
                }`}>
                  {group.type === "bank" ? t.groups.bank : t.groups.internal}
                </span>
              </div>
              <p className="text-xs text-surface-400 mt-2 capitalize">{group.role_in_group}</p>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl border border-surface-200 shadow-xl w-full max-w-sm p-6 mx-4">
            <h2 className="text-base font-semibold text-surface-900 mb-4">{t.groups.create}</h2>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.groups.name}</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Support Team"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.groups.type}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setNewType("internal")}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      newType === "internal"
                        ? "border-primary-300 bg-primary-50 text-primary-700"
                        : "border-surface-200 text-surface-600 hover:bg-surface-50"
                    }`}
                  >
                    {t.groups.internal}
                  </button>
                  <button
                    onClick={() => setNewType("bank")}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                      newType === "bank"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : "border-surface-200 text-surface-600 hover:bg-surface-50"
                    }`}
                  >
                    {t.groups.bank}
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-surface-600 border border-surface-200 hover:bg-surface-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={createGroup}
                  disabled={creating || !newName.trim()}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? "Creating..." : t.groups.create}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}