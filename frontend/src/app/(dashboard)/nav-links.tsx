"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export type NavItem = {
  href: string;
  icon: string;
  label: string;
};

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

function NavIcon({ icon, active }: { icon: string; active: boolean }) {
  const color = active ? "text-primary-600" : "text-surface-400";
  if (icon === "chat")
    return (
      <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
    );
  if (icon === "users")
    return (
      <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    );
  if (icon === "admin")
    return (
      <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
    );
  return (
    <svg className={`w-5 h-5 ${color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

export default function NavLinks({
  isSuperadminDefault,
}: {
  items?: NavItem[];
  isSuperadminDefault?: boolean;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    setRole(getAuthUser()?.role ?? null);
  }, [pathname]);

  const onAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isSuperadmin =
    onAdminRoute ||
    role === "superadmin" ||
    (role === null && (isSuperadminDefault ?? false));

  const displayItems: NavItem[] = allNavItems
    .filter(({ href }) => (isSuperadmin ? href === "/admin" : href !== "/admin"))
    .map(({ href, icon, labelKey }) => ({
      href,
      icon,
      label: t.nav[labelKey],
    }));

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {displayItems.map(({ href, icon, label }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-primary-50 text-primary-700"
                : "text-surface-600 hover:bg-surface-50 hover:text-surface-900"
            }`}
          >
            <NavIcon icon={icon} active={active} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}