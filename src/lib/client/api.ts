"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

export class ClientApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

async function request<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {}, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (res.status === 401 && typeof window !== "undefined" && !url.includes("/auth/login")) {
    window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? {};
    let msg = e.message ?? res.statusText;
    if (Array.isArray(e.details)) msg += ": " + e.details.map((d: any) => `${(d.path ?? []).join(".")} ${d.message}`).join("; ");
    throw new ClientApiError(res.status, e.code ?? "ERROR", msg, e.details);
  }
  return json?.data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>("GET", url),
  post: <T = any>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T = any>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  put: <T = any>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T = any>(url: string) => request<T>("DELETE", url),
};

export function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
