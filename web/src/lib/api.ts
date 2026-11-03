// Appels du navigateur vers le serveur MyProxmox (ou vers la démo locale).
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO } from "./env";
import { demoApi } from "./demo";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined>;
interface Opts { method?: string; body?: unknown; query?: Query }

export async function api<T = any>(url: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  if (DEMO) return demoApi(method, url, opts.body, opts.query) as Promise<T>;
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : "";
  const res = await fetch(url + qs, {
    method,
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth") && !url.startsWith("/api/monitoring") && !location.pathname.endsWith("/login")) {
    location.href = `${import.meta.env.BASE_URL}login`.replace("//", "/");
  }
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Erreur ${res.status}`);
  return json.data as T;
}

const P = (path: string) => `/api/pve${path}`;
/** Raccourcis vers l'API Proxmox (avec les droits de la personne connectée). */
export const pve = {
  get: <T = any>(path: string, query?: Query) => api<T>(P(path), { query }),
  post: <T = any>(path: string, body: unknown = {}) => api<T>(P(path), { method: "POST", body }),
  put: <T = any>(path: string, body: unknown = {}) => api<T>(P(path), { method: "PUT", body }),
  del: <T = any>(path: string, query?: Query) => api<T>(P(path), { method: "DELETE", query }),
};

/** Charge des données et les rafraîchit toutes les `interval` ms (0 = une seule fois). */
export function usePoll<T>(load: () => Promise<T>, interval = 5000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(load);
  ref.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await ref.current());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (!interval) return;
    const id = setInterval(() => document.visibilityState === "visible" && refresh(), interval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, interval, ...deps]);

  return { data, error, loading, refresh, setData };
}
