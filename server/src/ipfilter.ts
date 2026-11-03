// Filtre d'accès par plage d'adresses IP (CIDR), IPv4 et IPv6.
import type { Request, Response, NextFunction } from "express";
import { getConfig, PRIVATE_RANGES } from "./config";

function v4ToBig(ip: string): bigint | null {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return BigInt(((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]);
}

function v6ToBig(ip: string): bigint | null {
  if (ip.includes(".")) {
    // ::ffff:10.0.1.5
    const idx = ip.lastIndexOf(":");
    const v4 = v4ToBig(ip.slice(idx + 1));
    if (v4 === null) return null;
    ip = `${ip.slice(0, idx)}:${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

/** Normalise l'adresse du client : enlève le préfixe IPv4-mappé "::ffff:". */
export function normalizeIp(ip: string) {
  return ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
}

export function inRange(ipRaw: string, cidr: string): boolean {
  const ip = normalizeIp(ipRaw.trim());
  const [base, bitsRaw] = cidr.trim().split("/");
  const isV4 = base.includes(".") && !base.includes(":");
  if (isV4 !== (ip.includes(".") && !ip.includes(":"))) return false;
  const total = isV4 ? 32 : 128;
  const bits = bitsRaw === undefined ? total : Number(bitsRaw);
  const a = isV4 ? v4ToBig(ip) : v6ToBig(ip);
  const b = isV4 ? v4ToBig(base) : v6ToBig(base);
  if (a === null || b === null || !(bits >= 0 && bits <= total)) return false;
  const shift = BigInt(total - bits);
  return a >> shift === b >> shift;
}

export function validCidr(cidr: string) {
  const [base, bitsRaw] = cidr.trim().split("/");
  const isV4 = base.includes(".") && !base.includes(":");
  const n = isV4 ? v4ToBig(base) : v6ToBig(base);
  const total = isV4 ? 32 : 128;
  const bits = bitsRaw === undefined ? total : Number(bitsRaw);
  return n !== null && Number.isInteger(bits) && bits >= 0 && bits <= total;
}

export function clientIp(req: Request) {
  if (process.env.TRUST_PROXY === "1") {
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
    if (fwd) return normalizeIp(fwd);
  }
  return normalizeIp(req.socket.remoteAddress ?? "");
}

export function ipFilter(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
  const c = getConfig();
  // Avant la configuration, seuls la machine locale et les réseaux privés peuvent ouvrir l'onboarding
  const ranges = c.setupDone ? c.allowedRanges : PRIVATE_RANGES;
  // La machine qui héberge l'app garde toujours l'accès, pour ne jamais s'enfermer dehors
  if (ip === "127.0.0.1" || ip === "::1" || ranges.some((r) => inRange(ip, r))) return next();
  res.status(403).type("text/plain; charset=utf-8").send(`Accès refusé : l'adresse ${ip} n'est pas dans les plages autorisées par MyProxmox.`);
}
