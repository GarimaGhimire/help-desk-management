"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, assetUrl, type Profile } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Avatar } from "@/components/avatar";

const MAX_AVATAR = 2 * 1024 * 1024;

export default function SettingsPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    api
      .get<Profile>("/me")
      .then((p) => {
        setProfile(p);
        setDisplayName(p.display_name || p.name);
        setPhone(p.phone || "");
      })
      .catch(() => router.push("/login"));
  }, [router]);

  useEffect(() => {
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  if (!profile) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl">
        <div className="h-8 w-40 bg-surface-100 rounded-lg" />
        <div className="h-64 bg-surface-100 rounded-2xl" />
      </div>
    );
  }

  const pickFile = (f: File | undefined) => {
    setAvatarError("");
    if (!f) return;
    if (f.size > MAX_AVATAR) {
      setAvatarError("2 MB max");
      return;
    }
    previewUrl.current = URL.createObjectURL(f);
    setAvatarBusy(true);
    force((n) => n + 1);
    const form = new FormData();
    form.append("avatar", f);
    api
      .post<Profile>("/me/avatar", form)
      .then((p) => setProfile(p))
      .catch((err) => setAvatarError(err instanceof Error ? err.message : "Upload failed"))
      .finally(() => setAvatarBusy(false));
  };

  const removePhoto = async () => {
    setAvatarError("");
    setAvatarBusy(true);
    try {
      const p = await api.delete<Profile>("/me/avatar");
      setProfile(p);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setAvatarBusy(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const p = await api.patch<Profile>("/me", {
        display_name: displayName.trim(),
        phone: phone.trim(),
      });
      setProfile(p);
      setDisplayName(p.display_name || p.name);
      setPhone(p.phone || "");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    setDeactivating(true);
    try {
      await api.post("/me/deactivate");
      document.cookie = "token=; path=/; max-age=0";
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate");
      setConfirmOpen(false);
    } finally {
      setDeactivating(false);
    }
  };

  const currentAvatar = previewUrl.current || assetUrl(profile.avatar_url);
  const hasStoredAvatar = Boolean(profile.avatar_url);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-2xl font-semibold text-surface-900">{t.settings.title}</h1>
        <p className="text-sm text-surface-500 mt-1">{t.settings.subtitle}</p>
      </div>

      <section className="bg-white rounded-2xl border border-surface-200 shadow-card overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-100">
          <h2 className="text-sm font-semibold text-surface-900">{t.settings.profileSection}</h2>
        </div>
        <div className="px-6 py-5 space-y-6">
          <div className="flex items-center gap-5">
            <Avatar src={currentAvatar} name={displayName || profile.name} size="xl" />
            <div>
              <p className="text-sm font-medium text-surface-900">{t.settings.profilePicture}</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarBusy}
                  className="text-sm text-primary-600 font-medium hover:text-primary-700 disabled:opacity-50 transition-colors"
                >
                  {t.settings.changePhoto}
                </button>
                {hasStoredAvatar && (
                  <button
                    onClick={removePhoto}
                    disabled={avatarBusy}
                    className="text-sm text-surface-500 hover:text-red-600 disabled:opacity-50 transition-colors"
                  >
                    {t.settings.removePhoto}
                  </button>
                )}
              </div>
              <p className="text-xs text-surface-400 mt-1">PNG, JPG, WEBP or GIF · 2 MB max</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          </div>
          {avatarError && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm animate-fade-in">
              {avatarError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.settings.displayName}</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={255}
                placeholder={profile.name}
                className="w-full px-3.5 py-2.5 rounded-xl border border-surface-200 text-sm focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition"
              />
              <p className="text-[11px] text-surface-400 mt-1">{t.settings.displayNameHint}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500 mb-1.5">{t.settings.phone}</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={20}
                placeholder="+977..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-surface-200 text-sm focus:outline-none focus:border-primary-400 focus:ring-[3px] focus:ring-primary-100 transition"
              />
              <p className="text-[11px] text-surface-400 mt-1">{t.settings.phoneHint}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !displayName.trim()}
              className="px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {saving ? t.settings.saving : t.settings.save}
            </button>
            {saved && (
              <span className="text-sm text-primary-600 font-medium animate-fade-in inline-flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {t.settings.saved}
              </span>
            )}
          </div>

          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm animate-fade-in">
              {error}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-surface-200 shadow-card overflow-hidden">
        <div className="px-6 py-5 border-b border-surface-100">
          <h2 className="text-sm font-semibold text-surface-900">{t.settings.accountSection}</h2>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-surface-900">{t.settings.passwordChange}</p>
              <p className="text-xs text-surface-400 mt-0.5">{t.settings.passwordChangeHint}</p>
            </div>
            <button
              onClick={() => router.push("/change-password")}
              className="px-4 py-2 rounded-xl border border-surface-200 text-sm text-surface-700 hover:bg-surface-50 transition-colors shrink-0"
            >
              {t.settings.open}
            </button>
          </div>
        </div>
      </section>

      {profile.role !== "superadmin" && (
        <section className="bg-white rounded-2xl border border-red-100 shadow-card overflow-hidden">
          <div className="px-6 py-5 border-b border-red-50 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-semibold text-red-700">{t.settings.dangerZone}</h2>
          </div>
          <div className="px-6 py-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-surface-900">{t.settings.deactivateTitle}</p>
              <p className="text-xs text-surface-500 mt-1 max-w-md leading-relaxed">{t.settings.deactivateHint}</p>
            </div>
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={deactivating}
              className="px-4 py-2 rounded-xl border border-red-200 text-sm text-red-600 hover:bg-red-50 transition-colors shrink-0"
            >
              {t.settings.deactivate}
            </button>
          </div>
        </section>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={() => !deactivating && setConfirmOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-pop w-full max-w-sm p-6 animate-pop-in">
            <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-surface-900">{t.settings.confirmTitle}</h3>
            <p className="text-sm text-surface-500 mt-1.5 leading-relaxed">{t.settings.confirmBody}</p>
            <div className="flex gap-2 mt-6">
              <button
                onClick={deactivate}
                disabled={deactivating}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 active:scale-[0.985] disabled:opacity-50 transition-all"
              >
                {deactivating ? t.settings.deactivating : t.settings.confirm}
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={deactivating}
                className="px-4 py-2.5 rounded-xl border border-surface-200 text-sm text-surface-600 hover:bg-surface-50 transition-colors"
              >
                {t.settings.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}