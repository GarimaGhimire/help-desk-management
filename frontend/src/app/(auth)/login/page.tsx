"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { api, getAuthUser, homeForRole } from "@/lib/api";

type Mode = "password" | "otp";

function Brand({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 flex items-center justify-center shadow-inner">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
        </svg>
      </div>
      <span className="text-white font-semibold tracking-tight">{title}</span>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("password");
  const [contact, setContact] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const passwordLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ token: string; must_change_password?: boolean }>("/auth/login", {
        contact,
        password,
      });
      const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
      document.cookie = `token=${res.token}; path=/; SameSite=Lax${isSecure ? "; Secure" : ""}`;
      if (res.must_change_password) {
        window.location.href = "/change-password";
        return;
      }
      window.location.href = homeForRole(getAuthUser()?.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

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
      const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
      document.cookie = `token=${res.token}; path=/; SameSite=Lax${isSecure ? "; Secure" : ""}`;
      const user = getAuthUser();
      window.location.href = homeForRole(user?.role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    "w-full pl-10 pr-3 py-2.5 rounded-xl border border-surface-200 bg-white text-sm placeholder:text-surface-400 focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition";
  const primaryBtnClass =
    "w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm";

  return (
    <div className="min-h-screen flex bg-surface-50">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden bg-gradient-to-br from-primary-950 via-primary-800 to-accent-700">
        <div className="absolute -top-32 -left-24 w-80 h-80 rounded-full bg-accent-500/30 blur-3xl" />
        <div className="absolute bottom-0 -right-24 w-96 h-96 rounded-full bg-primary-500/25 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative w-full flex flex-col px-12 py-10">
          <Brand title={t.app.title} />

          <div className="flex-1 flex flex-col justify-center max-w-md animate-fade-in-up">
            <h2 className="text-3xl xl:text-4xl font-semibold tracking-tight text-white leading-tight">
              {t.auth.headline}
            </h2>
            <ul className="mt-8 space-y-4">
              {t.auth.features.map((f) => (
                <li key={f} className="flex items-center gap-3 text-white/85 text-sm">
                  <span className="w-6 h-6 rounded-full bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-white/50 text-xs pt-8 border-t border-white/10">
            © {new Date().getFullYear()} Fintara. All rights reserved.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col">
        <div className="lg:hidden flex items-center justify-center pt-10 pb-2">
          <Brand title={t.app.title} />
        </div>

        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="w-full max-w-sm animate-fade-in-up">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-semibold tracking-tight text-surface-900">
                {otpSent ? t.auth.otp : t.app.welcomeBack}
              </h1>
              <p className="text-sm text-surface-500 mt-1.5">
                {otpSent ? t.auth.enterOtp : t.app.signInSubtitle}
              </p>
            </div>

            <div className="bg-white rounded-2xl border border-surface-200 shadow-card p-6">
              <div className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-xl bg-surface-100">
                {(["password", "otp"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m);
                      setError("");
                    }}
                    className={`py-2 text-sm font-medium rounded-lg transition-all ${
                      mode === m
                        ? "bg-white text-surface-900 shadow-sm"
                        : "text-surface-500 hover:text-surface-700"
                    }`}
                  >
                    {m === "password" ? t.app.login : t.auth.otp}
                  </button>
                ))}
              </div>

              {error && (
                <div className="mb-5 px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm flex items-start gap-2 animate-fade-in">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  {error}
                </div>
              )}

              {mode === "password" ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.auth.emailOrPhone}</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-surface-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                      </span>
                      <input
                        type="text"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder="you@company.com"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.auth.password}</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-surface-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                      </span>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && passwordLogin()}
                        placeholder="••••••••"
                        className={fieldClass}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        tabIndex={-1}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-surface-400 hover:text-surface-600 transition-colors"
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? (
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
                  </div>
                  <button
                    onClick={passwordLogin}
                    disabled={loading || !contact || !password}
                    className={primaryBtnClass}
                  >
                    {loading ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        {t.auth.signingIn}
                      </span>
                    ) : (
                      t.auth.signIn
                    )}
                  </button>
                </div>
              ) : !otpSent ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.auth.emailOrPhone}</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-surface-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                      </span>
                      <input
                        type="text"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        placeholder="+977-9841000000"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                  <button
                    onClick={requestOtp}
                    disabled={loading || !contact}
                    className={primaryBtnClass}
                  >
                    {loading ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        {t.auth.sending}
                      </span>
                    ) : (
                      t.auth.sendOtp
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.auth.verificationCode}</label>
                    <input
                      type="text"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      onKeyDown={(e) => e.key === "Enter" && verifyOtp()}
                      placeholder="000000"
                      inputMode="numeric"
                      className="w-full px-3 py-3 rounded-xl border border-surface-200 bg-white text-lg text-center tracking-[0.5em] font-mono focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition"
                    />
                  </div>
                  <button
                    onClick={verifyOtp}
                    disabled={loading || otp.length < 6}
                    className={primaryBtnClass}
                  >
                    {loading ? (
                      <span className="inline-flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        {t.auth.verifying}
                      </span>
                    ) : (
                      t.auth.verify
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setOtpSent(false);
                      setOtp("");
                      setError("");
                    }}
                    className="w-full py-1.5 text-sm text-surface-500 hover:text-surface-700 transition-colors"
                  >
                    ← {t.auth.changeNumber}
                  </button>
                </div>
              )}
            </div>

            <p className="text-center text-xs text-surface-400 mt-6">
              {t.app.tagline}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}