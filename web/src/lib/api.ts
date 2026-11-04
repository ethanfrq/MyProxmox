// Appels du navigateur vers le serveur MyProxmox (ou vers la démo locale).
import { useCallback, useEffect, useRef, useState } from "react";
import { DEMO } from "./env";
import { demoApi } from "./demo";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Ajoute au message de Proxmox ce qu'il faut faire, pour les erreurs les plus courantes. */
const HINTS: [RegExp, string][] = [
  [/permission check failed|^permission denied|\bno permission\b|\b403\b/i, "Il te manque un droit pour cette action : demande-le à un administrateur (Datacenter > Permissions)."],
  [/\bis locked\b|\block\b.*\btimeout\b|got timeout/i, "Une autre opération est en cours sur cet élément : attends qu'elle se termine, puis réessaie."],
  [/already exists|already defined/i, "Choisis un autre nom ou un autre identifiant."],
  [/not running/i, "Démarre-la d'abord, puis réessaie."],
  [/no route to host|connection refused|unreachable|is not online|\b595\b/i, "Le nœud ou le service ne répond pas : vérifie qu'il est allumé et joignable."],
  [/parameter verification failed|property is missing|value does not match/i, "Vérifie les champs du formulaire, puis réessaie."],
];
export function explain(status: number, message: string) {
  if (/[.!?]\s*[A-ZÀ-Ý][^.]*(vérifie|réessaie|demande|attends|choisis|démarre)/i.test(message)) return message; // déjà une consigne
  const hint = HINTS.find(([re]) => re.test(message))?.[1] ?? (status === 403 ? HINTS[0][1] : status >= 502 && status <= 504 ? "Proxmox a mis trop de temps à répondre. Réessaie dans un instant." : "");
  return hint ? `${message.replace(/\s+$/, "").replace(/([^.!?])$/, "$1.")} ${hint}` : message;
}

type Query = Record<string, string | number | boolean | undefined>;
interface Opts { method?: string; body?: unknown; query?: Query }

export async function api<T = any>(url: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  if (DEMO) {
    try { return (await demoApi(method, url, opts.body, opts.query)) as T; } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      throw new ApiError(status, explain(status, (e as Error).message));
    }
  }
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : "";
  const res = await fetch(url + qs, {
    method,
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  }).catch(() => { throw new ApiError(0, "MyProxmox ne répond pas. Vérifie ta connexion et que le serveur MyProxmox tourne, puis réessaie."); });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth") && !url.startsWith("/api/monitoring") && !location.pathname.endsWith("/login")) {
    location.href = `${import.meta.env.BASE_URL}login`.replace("//", "/");
  }
  if (!res.ok) throw new ApiError(res.status, explain(res.status, json.error ?? `Erreur ${res.status}`));
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
