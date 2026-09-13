const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/token=([^;]+)/);
  return match ? match[1] : null;
}

export function getCurrentUserId(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return decoded.sub || null;
  } catch {
    return null;
  }
}

export type AuthUser = {
  id: string;
  role: string;
  org: string;
  mustChangePassword: boolean;
};

export type Profile = {
  id: string;
  name: string;
  display_name: string;
  email: string;
  phone: string;
  avatar_url: string;
  role: string;
  org_id: string;
  language_pref: string;
  must_change_password: boolean;
  created_at: string;
  last_login_at?: string;
  org_suspended?: boolean;
  org?: { id: string; name: string; slug: string; is_active?: boolean } | null;
};

export function roleLabelKey(role: string): string {
  if (["superadmin", "org_admin", "group_admin", "org_member"].includes(role)) return role;
  return "org_member";
}

// assetUrl turns a server-relative path (e.g. "/avatars/x.png") into an
// absolute URL against the API host.
export function assetUrl(path?: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// getAuthUser decodes role/org from the access token (kept in sync by the API
// on every request, so role changes are reflected on next token refresh).
export function getAuthUser(): AuthUser | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return {
      id: decoded.sub || "",
      role: decoded.role || "",
      org: decoded.org || "",
      mustChangePassword: false,
    };
  } catch {
    return null;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!headers["Content-Type"] && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      document.cookie = "token=; path=/; max-age=0";
      window.location.href = "/login";
    }
    throw new Error("unauthorized");
  }

  // 428 = account needs a new password before any other access.
  if (res.status === 428) {
    if (typeof window !== "undefined") {
      window.location.href = "/change-password";
    }
    throw new Error("password change required");
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  get: <T>(endpoint: string) =>
    request<T>(endpoint, { method: "GET" }),

  post: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),

  patch: <T>(endpoint: string, body: unknown) =>
    request<T>(endpoint, { method: "PATCH", body: JSON.stringify(body) }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: "DELETE" }),
};

export function isLoggedIn(): boolean {
  return getToken() !== null;
}

export function homeForRole(role?: string): string {
  return role === "superadmin" ? "/admin" : "/groups";
}