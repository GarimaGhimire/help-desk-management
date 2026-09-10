"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { api } from "@/lib/api";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [contact, setContact] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const requestOtp = async () => {
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/request-otp", { contact });
      setOtpSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ token: string }>("/auth/verify-otp", { contact, code: otp });
      document.cookie = `token=${res.token}; path=/; SameSite=Lax; Secure`;
      router.push("/groups");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
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
          <h1 className="text-xl font-semibold text-surface-900">{t.app.login}</h1>
          <p className="text-sm text-surface-500 mt-1">{t.auth.enterPhone}</p>
        </div>

        <div className="bg-white rounded-xl border border-surface-200 p-6 shadow-sm">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">
              {error}
            </div>
          )}

          {!otpSent ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1.5">Phone or Email</label>
                <input
                  type="text"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="+977-9841000000"
                  className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition"
                />
              </div>
              <button
                onClick={requestOtp}
                disabled={loading || !contact}
                className="w-full py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Sending..." : t.auth.sendOtp}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-surface-500 mb-1.5">Verification Code</label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter 6-digit code"
                  maxLength={6}
                  className="w-full px-3 py-2.5 rounded-lg border border-surface-200 text-sm placeholder:text-surface-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition tracking-widest text-center font-mono text-lg"
                />
              </div>
              <button
                onClick={verifyOtp}
                disabled={loading || !otp}
                className="w-full py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Verifying..." : t.auth.verify}
              </button>
              <button
                onClick={() => { setOtpSent(false); setOtp(""); setError(""); }}
                className="w-full py-2 text-sm text-surface-500 hover:text-surface-700 transition-colors"
              >
                ← Change phone number
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}