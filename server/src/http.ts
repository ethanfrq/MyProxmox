// Requêtes HTTPS bas niveau vers Proxmox.
// On utilise le module https de Node (et pas fetch) pour pouvoir accepter
// le certificat auto-signé que Proxmox installe par défaut.
import http from "node:http";
import https from "node:https";

export type Method = "GET" | "POST" | "PUT" | "DELETE";
export type Params = Record<string, unknown>;

export class PveError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const HINTS: Record<string, string> = {
  ECONNREFUSED: "connexion refusée (Proxmox éteint ou mauvais port ?)",
  EHOSTUNREACH: "hôte injoignable (mauvaise IP ou autre réseau ?)",
  ENETUNREACH: "réseau injoignable",
  ETIMEDOUT: "délai dépassé (pare-feu ou mauvaise IP ?)",
  ENOTFOUND: "adresse introuvable",
  DEPTH_ZERO_SELF_SIGNED_CERT: "certificat auto-signé refusé : coche « accepter le certificat auto-signé »",
  SELF_SIGNED_CERT_IN_CHAIN: "certificat auto-signé refusé : coche « accepter le certificat auto-signé »",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificat non vérifiable : coche « accepter le certificat auto-signé »",
  ERR_TLS_CERT_ALTNAME_INVALID: "le certificat ne correspond pas à cette adresse",
};

export function encode(params?: Params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  }
  return sp.toString();
}

export interface Target {
  url: string; // https://10.0.1.101:8006
  insecureTls: boolean;
}

export function request(target: Target, method: Method, path: string, headers: Record<string, string>, params?: Params): Promise<any> {
  const qs = encode(params);
  const hasBody = method === "POST" || method === "PUT";
  const url = new URL(`${target.url.replace(/\/+$/, "")}/api2/json${path}${!hasBody && qs ? `?${qs}` : ""}`);
  const h: Record<string, string> = { Accept: "application/json", ...headers };
  if (hasBody) {
    h["Content-Type"] = "application/x-www-form-urlencoded";
    h["Content-Length"] = String(Buffer.byteLength(qs));
  }
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method, headers: h, rejectUnauthorized: !target.insecureTls, timeout: 20000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => {
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* réponse non JSON */
        }
        const status = res.statusCode ?? 0;
        if (status >= 400) {
          const fields = json?.errors ? Object.entries(json.errors).map(([k, v]) => `${k} : ${v}`).join(" · ") : "";
          const reason = (res.statusMessage ?? "").trim();
          const msg = fields || json?.message || (status === 401 ? "identifiants refusés par Proxmox" : reason || text.trim().slice(0, 200) || `erreur ${status}`);
          reject(new PveError(status, String(msg).trim()));
        } else {
          resolve(json?.data);
        }
      });
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (e: NodeJS.ErrnoException) => reject(new PveError(502, HINTS[e.code ?? ""] ?? e.message)));
    if (hasBody) req.write(qs);
    req.end();
  });
}

/** Requête GET dont la réponse est relayée telle quelle (téléchargement de fichier). */
export function requestRaw(target: Target, path: string, headers: Record<string, string>, params?: Params): Promise<http.IncomingMessage> {
  const qs = encode(params);
  const url = new URL(`${target.url.replace(/\/+$/, "")}/api2/json${path}${qs ? `?${qs}` : ""}`);
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method: "GET", headers, rejectUnauthorized: !target.insecureTls, timeout: 60000 }, (res) => {
      if ((res.statusCode ?? 500) >= 400) {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => reject(new PveError(res.statusCode ?? 500, (res.statusMessage || text.slice(0, 200) || "erreur").trim())));
        return;
      }
      resolve(res);
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (e: NodeJS.ErrnoException) => reject(new PveError(502, HINTS[e.code ?? ""] ?? e.message)));
    req.end();
  });
}
