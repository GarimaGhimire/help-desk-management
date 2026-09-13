"use client";

import { useEffect, useState } from "react";
import { api, type Profile } from "@/lib/api";

export default function SuspensionOverlay() {
  const [suspended, setSuspended] = useState(false);

  useEffect(() => {
    api
      .get<Profile>("/me")
      .then((p) => {
        if (p?.org_suspended || p?.org?.is_active === false) {
          setSuspended(true);
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.message.toLowerCase().includes("suspended")) {
          setSuspended(true);
        }
      });
  }, []);

  const signOut = () => {
    document.cookie = "token=; path=/; max-age=0";
    window.location.href = "/login";
  };

  if (!suspended) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/60 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-red-100 max-w-md w-full p-8 text-center space-y-5 animate-scale-up">
        <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-600 mx-auto flex items-center justify-center border border-red-100 shadow-sm">
          <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        
        <div className="space-y-2">
          <h2 className="text-xl font-extrabold text-surface-900 tracking-tight">Organization Account Suspended</h2>
          <p className="text-sm text-surface-600 leading-relaxed">
            Your organization account has been suspended by an administrator. Access to chats, documents, and staff features is currently unavailable.
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={signOut}
            className="w-full py-3 px-5 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-semibold text-sm transition-all shadow-md flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
