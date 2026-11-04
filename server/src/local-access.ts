// Ce que chaque rôle de compte MyProxmox a le droit d'appeler.
// Les comptes Proxmox ne passent pas par ici : Proxmox applique leurs propres droits.
import type { Request, Response, NextFunction } from "express";
import type { LocalRole } from "../../shared/types";

// Routes utiles à tout compte connecté (chemins relatifs à /api)
const COMMON = [/^\/auth\/me$/, /^\/auth\/logout$/, /^\/auth\/local\/(totp|password)(\/.*)?$/];

// Écritures sans effet sur Proxmox, permises au rôle lecture
const LECTURE_WRITES = [/^\/notifications\/read$/];

const RULES: Record<LocalRole, (method: string, path: string) => boolean> = {
  // Écran de monitoring uniquement
  monitoring: (_m, p) => /^\/monitoring(\/|$)/.test(p),
  // Toutes les pages en lecture, aucune action
  lecture: (m, p) => m === "GET" || LECTURE_WRITES.some((r) => r.test(p)),
};

export function localAllowed(role: LocalRole, method: string, path: string) {
  if (COMMON.some((r) => r.test(path))) return true;
  return RULES[role]?.(method, path) ?? false;
}

/** Middleware placé après requireSession : refuse avec 403 ce que le rôle ne permet pas. */
export function localGuard(req: Request, res: Response, next: NextFunction) {
  const s = req.session;
  if (!s || s.kind !== "local") return next();
  if (localAllowed(s.role!, req.method, req.path)) return next();
  const msg = s.role === "monitoring"
    ? "Ce compte ne donne accès qu'à l'écran de monitoring."
    : "Ce compte est en lecture seule : demande à un administrateur de faire cette action.";
  res.status(403).json({ error: msg });
}

/** Privilèges conservés pour un compte en lecture : uniquement ceux qui permettent de voir. */
const READ_PRIVS = /\.Audit$|^Sys\.Syslog$/;
export function readOnlyPermissions(map: Record<string, Record<string, number>>) {
  const out: Record<string, Record<string, number>> = {};
  for (const [path, privs] of Object.entries(map ?? {})) {
    out[path] = Object.fromEntries(Object.entries(privs).filter(([k]) => READ_PRIVS.test(k)));
  }
  return out;
}
