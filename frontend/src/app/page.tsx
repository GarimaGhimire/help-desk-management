"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser, homeForRole } from "@/lib/api";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const user = getAuthUser();
    if (!user) {
      router.replace("/login");
      return;
    }
    router.replace(homeForRole(user.role));
  }, [router]);

  return null;
}