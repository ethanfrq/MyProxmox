// Comptes MyProxmox, indépendants des comptes Proxmox, stockés dans data/users.json.
// Mots de passe hachés avec scrypt et un sel par compte. Rien n'est envoyé à Proxmox.
import { readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { DATA_DIR, DEMO } from "./config";
import { COMMON_PASSWORDS } from "./common-passwords";
import type { LocalRole, LocalStatus, LocalUserInfo } from "../../shared/types";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface LocalUser {
  id: string;
  username: string;
  displayName: string;
  hash: string; // base64
  salt: string; // base64
  role: LocalRole;
  status: LocalStatus;
  createdAt: string;
  lastLogin?: string;
  totpSecret?: string; // en attente de confirmation tant que totpEnabled est faux
  totpEnabled?: boolean;
}

const FILE = () => path.join(DATA_DIR, "users.json");
let users: LocalUser[] | null = null;

export const ROLES: LocalRole[] = ["monitoring", "lecture"];
export const isRole = (r: unknown): r is LocalRole => ROLES.includes(r as LocalRole);

async function hashPassword(pw: string, salt = randomBytes(16)) {
  const h = await scrypt(pw, salt, 64);
  return { hash: h.toString("base64"), salt: salt.toString("base64") };
}

async function seedDemo(): Promise<LocalUser[]> {
  // Comptes fictifs du mode démo. Mot de passe de tous : « demo-monitoring »
  const mk = async (username: string, displayName: string, role: LocalRole, status: LocalStatus, daysAgo: number): Promise<LocalUser> => ({
    id: randomUUID(), username, displayName, role, status, ...(await hashPassword("demo-monitoring")),
    createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    lastLogin: status === "active" ? new Date(Date.now() - 3600000 * daysAgo).toISOString() : undefined,
  });
  return [
    await mk("tv-salon", "TV du salon", "monitoring", "active", 20),
    await mk("lea", "Léa (lecture)", "lecture", "active", 12),
    await mk("stagiaire", "Stagiaire", "monitoring", "pending", 1),
    await mk("ancien-ecran", "Ancien écran", "monitoring", "disabled", 90),
  ];
}

export async function getUsers(): Promise<LocalUser[]> {
  if (users) return users;
  try {
    users = JSON.parse(readFileSync(FILE(), "utf8")) as LocalUser[];
  } catch {
    users = DEMO ? await seedDemo() : [];
    if (DEMO) await save();
  }
  return users;
}

async function save() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE());
}

export function publicUser(u: LocalUser): LocalUserInfo {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status, createdAt: u.createdAt, lastLogin: u.lastLogin, totp: !!u.totpEnabled };
}

const err = (msg: string, status = 400) => Object.assign(new Error(msg), { status });

/** Règles de mot de passe. Retourne un message d'erreur ou null. */
export function checkPassword(pw: string, username = "") {
  if (typeof pw !== "string" || pw.length < 10) return "Le mot de passe doit faire au moins 10 caractères.";
  if (pw.length > 200) return "Le mot de passe est trop long (200 caractères au plus).";
  const low = pw.toLowerCase();
  const core = low.replace(/[\d\W_]+$/, "").replace(/^[\d\W_]+/, "");
  if (COMMON_PASSWORDS.has(low) || (core.length >= 3 && COMMON_PASSWORDS.has(core))) {
    return "Ce mot de passe fait partie des plus courants. Choisis-en un autre, par exemple trois ou quatre mots sans lien.";
  }
  if (username && low.includes(username.toLowerCase())) return "Le mot de passe ne doit pas contenir l'identifiant.";
  if (new Set(pw).size < 4) return "Le mot de passe répète trop les mêmes caractères.";
  return null;
}

export function checkUsername(u: string) {
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(u)) return "Identifiant : 2 à 32 caractères, minuscules, chiffres, point, tiret ou soulignement.";
  return null;
}

export async function findUser(username: string) {
  return (await getUsers()).find((u) => u.username === username.toLowerCase().trim());
}
export async function getUser(id: string) {
  return (await getUsers()).find((u) => u.id === id);
}

export async function createUser(input: { username: string; displayName?: string; password: string; role: LocalRole; status: LocalStatus }) {
  const username = input.username.toLowerCase().trim();
  const bad = checkUsername(username) ?? checkPassword(input.password, username);
  if (bad) throw err(bad);
  if (!isRole(input.role)) throw err("Rôle inconnu.");
  if (await findUser(username)) throw err("Cet identifiant est déjà pris. Choisis-en un autre.", 409);
  const u: LocalUser = {
    id: randomUUID(), username, displayName: (input.displayName ?? "").trim().slice(0, 60) || username,
    role: input.role, status: input.status, createdAt: new Date().toISOString(), ...(await hashPassword(input.password)),
  };
  (await getUsers()).push(u);
  await save();
  return u;
}

export async function updateUser(id: string, patch: Partial<Pick<LocalUser, "displayName" | "role" | "status" | "lastLogin" | "totpSecret" | "totpEnabled">>) {
  const u = await getUser(id);
  if (!u) throw err("Compte introuvable.", 404);
  if (patch.role !== undefined && !isRole(patch.role)) throw err("Rôle inconnu.");
  Object.assign(u, patch);
  if (patch.displayName !== undefined) u.displayName = patch.displayName.trim().slice(0, 60) || u.username;
  await save();
  return u;
}

export async function setPassword(id: string, password: string) {
  const u = await getUser(id);
  if (!u) throw err("Compte introuvable.", 404);
  const bad = checkPassword(password, u.username);
  if (bad) throw err(bad);
  Object.assign(u, await hashPassword(password));
  await save();
}

export async function deleteUser(id: string) {
  const list = await getUsers();
  const i = list.findIndex((u) => u.id === id);
  if (i < 0) throw err("Compte introuvable.", 404);
  list.splice(i, 1);
  await save();
}

/** Vérifie identifiant et mot de passe. Prend toujours le même temps, que le compte existe ou non. */
export async function verifyPassword(username: string, password: string) {
  const u = await findUser(username);
  const salt = u ? Buffer.from(u.salt, "base64") : randomBytes(16);
  const h = await scrypt(String(password ?? ""), salt, 64);
  if (!u) return null;
  const ok = timingSafeEqual(h, Buffer.from(u.hash, "base64"));
  return ok ? u : null;
}

// ── Limitation des essais : 5 par minute et par adresse IP ─────────
const attempts = new Map<string, number[]>();
export function tooManyAttempts(ip: string) {
  const now = Date.now();
  const list = (attempts.get(ip) ?? []).filter((t) => now - t < 60000);
  attempts.set(ip, list);
  return list.length >= 5;
}
export function recordAttempt(ip: string) {
  const list = attempts.get(ip) ?? [];
  list.push(Date.now());
  attempts.set(ip, list);
}
