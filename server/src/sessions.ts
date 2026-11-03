// Sessions en mémoire : on garde le ticket Proxmox côté serveur, le navigateur
// ne reçoit qu'un identifiant aléatoire dans un cookie HttpOnly.
// Un redémarrage de l'app déconnecte tout le monde, c'est voulu.
import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { renew, ticketCall } from "./pve";
import type { Call } from "../../shared/types";

export interface Session {
  id: string;
  username: string;
  ticket: string;
  csrf: string;
  admin: boolean;
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
  if (Date.now() - s.renewedAt > RENEW) {
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
  req.call = ticketCall(s.ticket, s.csrf);
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.admin) return res.status(403).json({ error: "Réservé aux comptes qui ont le droit Sys.Modify sur « / » dans Proxmox." });
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
