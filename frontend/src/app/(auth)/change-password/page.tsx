"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, getAuthUser, homeForRole } from "@/lib/api";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const passwordValid = (p: string) => {
    if (p.length < 10) return false;
    if (!/[a-z]/.test(p)) return false;
    if (!/[A-Z]/.test(p)) return false;
    if (!/[0-9]/.test(p)) return false;
    if (!/[^A-Za-z0-9]/.test(p)) return false;
    if (/\s/.test(p)) return false;
    return true;
  };

  const submit = async () => {
    setError("");
    if (!passwordValid(newPassword)) {
      setError("Password must be 10+ characters with upper, lower, digit, and special characters.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      router.push(homeForRole(getAuthUser()?.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-primary-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-lg">FD</span>
          </div>
          <h1 className="text-xl font-semibold text-surface-900">Set a new password</h1>
          <p className="text-sm text-surface-500 mt-1">
            You must set a password of your own before continuing.
          </p>
        </div>

        <div className="bg-white rounded-xl border border-surface-200 p-6 shadow-sm">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1.5">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1.5">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1.5">Confirm new password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
              />
            </div>
            <p className="text-xs text-surface-400 leading-relaxed">
              10+ characters, include uppercase, lowercase, a number and a special character (no spaces).
            </p>
            <button
              onClick={submit}
              disabled={loading || !currentPassword || !newPassword || !confirm}
              className="w-full py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}