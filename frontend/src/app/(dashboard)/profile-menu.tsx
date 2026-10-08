"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, assetUrl, roleLabelKey, type Profile } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Avatar } from "@/components/avatar";

export default function ProfileMenu() {
  const { t } = useI18n();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .get<Profile>("/me")
      .then(setProfile)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    // Re-fetch profile so the avatar stays in sync with recent changes.
    api
      .get<Profile>("/me")
      .then(setProfile)
      .catch(() => {});

    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!profile) {
    return <div className="w-9 h-9 rounded-full bg-surface-100 animate-pulse" />;
  }

  const displayName = profile.display_name || profile.name;

  const signOut = () => {
    document.cookie = "token=; path=/; max-age=0";
    window.location.href = "/login";
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 rounded-full hover:bg-surface-100 transition-colors"
      >
        <Avatar src={assetUrl(profile.avatar_url)} name={displayName} size="md" />
        <span className="hidden sm:block text-left">
          <span className="block text-sm font-medium text-surface-900 leading-tight">{displayName}</span>
          <span className="block text-xs text-surface-500 leading-tight">
            {t.profile.roleLabel[roleLabelKey(profile.role) as keyof typeof t.profile.roleLabel]}
          </span>
        </span>
        <svg
          className={`w-4 h-4 text-surface-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-surface-200 shadow-pop overflow-hidden animate-pop-in z-50">
          <div className="px-4 py-3.5 border-b border-surface-100 flex items-center gap-3">
            <Avatar src={assetUrl(profile.avatar_url)} name={displayName} size="lg" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-surface-900 truncate">{displayName}</p>
              <p className="text-xs text-surface-500 truncate">{profile.email || profile.phone}</p>
              {profile.org?.name && (
                <p className="text-[11px] text-primary-600 mt-0.5 truncate">{profile.org.name}</p>
              )}
              {(profile.org_suspended || profile.org?.is_active === false) && (
                <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                  Suspended Account
                </span>
              )}
            </div>
          </div>

          <div className="p-1.5">
            <button
              onClick={() => {
                setOpen(false);
                router.push("/settings");
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-surface-700 hover:bg-surface-50 transition-colors"
            >
              <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {t.profile.settings}
            </button>
            <button
              onClick={() => router.push("/change-password")}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-surface-700 hover:bg-surface-50 transition-colors"
            >
              <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              {t.profile.changePassword}
            </button>
          </div>

          <div className="p-1.5 border-t border-surface-100">
            <button
              onClick={signOut}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              {t.profile.signOut}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}