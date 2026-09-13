import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import NavLinks from "./nav-links";
import BrandLink from "./brand-link";
import LocaleToggle from "./locale-toggle";
import ProfileMenu from "./profile-menu";

import en from "@/locales/en.json";
import ne from "@/locales/ne.json";

type Locale = "en" | "ne";
const translations = { en, ne };

type NavCandidate = {
  href: string;
  icon: string;
  labelKey: "groups" | "staffDirectory" | "documents" | "admin";
};

const allNavItems: NavCandidate[] = [
  { href: "/groups", icon: "chat", labelKey: "groups" },
  { href: "/staff-directory", icon: "users", labelKey: "staffDirectory" },
  { href: "/documents", icon: "file", labelKey: "documents" },
  { href: "/admin", icon: "admin", labelKey: "admin" },
];

// decodeRole reads only the JWT payload (no signature verification) — enough
// for rendering the correct nav server-side; the API still enforces RBAC.
function decodeRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = cookies();
  const token = cookieStore.get("token")?.value;
  if (!token) redirect("/login");

  const locale = (cookieStore.get("lang")?.value === "ne" ? "ne" : "en") as Locale;
  const t = translations[locale];

  const isSuperadmin = decodeRole(token) === "superadmin";
  const items = allNavItems
    .filter(({ href }) => (isSuperadmin ? href === "/admin" : href !== "/admin"))
    .map(({ href, icon, labelKey }) => ({ href, icon, label: t.nav[labelKey] }));

  return (
    <div className="flex h-screen bg-surface-50">
      <aside className="w-64 bg-white border-r border-surface-200 flex flex-col">
        <div className="h-16 flex items-center px-5 border-b border-surface-100">
          <BrandLink isSuperadminDefault={isSuperadmin} />
        </div>

        <NavLinks items={items} isSuperadminDefault={isSuperadmin} />

        <div className="px-4 py-3 border-t border-surface-100">
          <p className="text-[11px] text-surface-400">{t.app.tagline}</p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/80 backdrop-blur-sm border-b border-surface-200 flex items-center justify-between px-6 sticky top-0 z-40">
          <div />
          <div className="flex items-center gap-3">
            <LocaleToggle />
            <ProfileMenu />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}