// Sessions en mémoire : on garde le ticket Proxmox côté serveur, le navigateur
// ne reçoit qu'un identifiant aléatoire dans un cookie HttpOnly.
// Un redémarrage de l'app déconnecte tout le monde, c'est voulu.
import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { renew, serviceCall, ticketCall } from "./pve";
import type { Call, LocalRole } from "../../shared/types";

/**
 * Deux sortes de sessions, avec le même cookie :
 *  - "proxmox" : connexion avec un compte Proxmox, on garde son ticket ;
 *  - "local"   : compte MyProxmox, qui lit Proxmox avec le jeton de service et
 *                n'a accès qu'à ce que son rôle permet (voir local-access.ts).
 */
export interface Session {
  id: string;
  kind: "proxmox" | "local";
  username: string;
  ticket: string; // vide pour une session locale
  csrf: string;
  admin: boolean;
  role?: LocalRole;
  userId?: string;
  displayName?: string;
  renewedAt: number;
  lastSeen: number;
}

const sessions = new Map<string, Session>();
export const COOKIE = "myproxmox_sid";
const IDLE = 8 * 3600 * 1000; // déconnexion après 8 h sans activité
const RENEW = 60 * 60 * 1000; // renouvellement du ticket Proxmox toutes les heures

export function createSession(s: Omit<Session, "id" | "renewedAt" | "lastSeen">) {
  const id = randomBytes(32).toString("base64url");
  const full = { ...s, id, renewedAt: Date.now(), lastSeen: Date.now() };
  sessions.set(id, full);
  return full;
}

export function destroySession(id?: string) {
  if (id) sessions.delete(id);
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setCookie(res: Response, id: string) {
  res.setHeader("Set-Cookie", `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${IDLE / 1000}`);
}

export function clearCookie(res: Response) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

export async function getSession(req: Request): Promise<Session | null> {
  const id = readCookie(req, COOKIE);
  const s = id ? sessions.get(id) : undefined;
  if (!s) return null;
  if (Date.now() - s.lastSeen > IDLE) {
    sessions.delete(s.id);
    return null;
  }
  s.lastSeen = Date.now();
  if (s.kind === "proxmox" && Date.now() - s.renewedAt > RENEW) {
    try {
      const r = await renew(s.username, s.ticket);
      s.ticket = r.ticket;
      s.csrf = r.csrf;
      s.renewedAt = Date.now();
    } catch {
      sessions.delete(s.id);
      return null;
    }
  }
  return s;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
      call?: Call;
    }
  }
}

export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const s = await getSession(req);
  if (!s) return res.status(401).json({ error: "Session expirée, reconnecte-toi." });
  req.session = s;
  req.call = s.kind === "local" ? serviceCall() : ticketCall(s.ticket, s.csrf);
  next();
}

/** Ferme toutes les sessions d'un compte local (désactivation, suppression, nouveau mot de passe). */
export function destroyUserSessions(userId: string) {
  for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.admin || req.session.kind !== "proxmox") return res.status(403).json({ error: "Réservé aux comptes Proxmox qui ont le droit Sys.Modify sur « / »." });
  next();
}

/** Diffusion d'événements en direct (Server-Sent Events) vers les navigateurs connectés. */
const streams = new Set<Response>();
export function addStream(res: Response) {
  streams.add(res);
  res.on("close", () => streams.delete(res));
}
export function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of streams) r.write(msg);
}
