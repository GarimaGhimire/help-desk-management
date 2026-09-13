"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export default function BrandLink({ isSuperadminDefault }: { isSuperadminDefault?: boolean }) {
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

  return (
    <Link
      href={isSuperadmin ? "/admin" : "/groups"}
      className="flex items-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-300"
      title={t.app.title}
    >
      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-600 to-accent-600 flex items-center justify-center shadow-sm">
        <span className="text-white font-bold text-sm">FD</span>
      </div>
      <span className="ml-3 font-semibold text-surface-900 text-sm hover:text-primary-700 transition-colors">
        {t.app.title}
      </span>
    </Link>
  );
}
