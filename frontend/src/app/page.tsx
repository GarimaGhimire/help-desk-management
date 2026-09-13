"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser, homeForRole } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(homeForRole(getAuthUser()?.role));
  }, [router]);

  return null;
}