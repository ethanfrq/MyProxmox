// Informations calculées à partir de l'API Proxmox.
// Beaucoup ne sont pas affichées (ou pas au même endroit) dans l'interface
// native : IP de toutes les machines, machines sans sauvegarde, surallocation,
// date estimée de remplissage du stockage, santé SMART, échecs de connexion...
// Ces fonctions ne dépendent que d'un `call`, donc elles tournent aussi bien
// sur le serveur (vraie API) que dans le navigateur (démo).
import type { Call } from "./types";

const DAY = 86400;
const nowS = () => Math.floor(Date.now() / 1000);

export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

async function nodes(call: Call): Promise<string[]> {
  const list = await safe(call("GET", "/nodes"), [] as any[]);
  return list.filter((n: any) => n.status === "online").map((n: any) => n.node);
}

// ── Vue d'ensemble ──────────────────────────────────────────────────
export async function overview(call: Call) {
  const [resources, tasks] = await Promise.all([call("GET", "/cluster/resources"), safe(call("GET", "/cluster/tasks"), [] as any[])]);
  const nodeRes = resources.filter((r: any) => r.type === "node");
  const guests = resources.filter((r: any) => (r.type === "qemu" || r.type === "lxc") && !r.template).sort((a: any, b: any) => a.vmid - b.vmid);
  const storages = resources.filter((r: any) => r.type === "storage");
  const details = await Promise.all(nodeRes.map((n: any) => (n.status === "online" ? safe(call("GET", `/nodes/${n.node}/status`), null) : Promise.resolve(null))));
  const running = guests.filter((g: any) => g.status === "running");

  const pcpu = nodeRes.reduce((s: number, n: any) => s + (n.maxcpu ?? 0), 0);
  const pram = nodeRes.reduce((s: number, n: any) => s + (n.maxmem ?? 0), 0);
  const vcpu = guests.reduce((s: number, g: any) => s + (g.maxcpu ?? 0), 0);
  const vram = guests.reduce((s: number, g: any) => s + (g.maxmem ?? 0), 0);
  const vcpuRun = running.reduce((s: number, g: any) => s + (g.maxcpu ?? 0), 0);
  const vramRun = running.reduce((s: number, g: any) => s + (g.maxmem ?? 0), 0);

  // Une seule entrée par stockage partagé (sinon il est compté une fois par nœud)
  const seen = new Set<string>();
  const uniqueStorages = storages.filter((s: any) => {
    const k = s.shared ? s.storage : `${s.node}/${s.storage}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const day = nowS() - DAY;
  return {
    nodes: nodeRes.map((n: any, i: number) => ({ ...n, detail: details[i] })),
    guests,
    storages: uniqueStorages,
    counts: {
      guests: guests.length,
      running: running.length,
      vms: guests.filter((g: any) => g.type === "qemu").length,
      containers: guests.filter((g: any) => g.type === "lxc").length,
      nodesOnline: nodeRes.filter((n: any) => n.status === "online").length,
      nodes: nodeRes.length,
    },
    top: {
      cpu: [...running].sort((a: any, b: any) => b.cpu * b.maxcpu - a.cpu * a.maxcpu).slice(0, 5),
      mem: [...running].sort((a: any, b: any) => b.mem - a.mem).slice(0, 5),
    },
    allocation: {
      pcpu, vcpu, vcpuRun, pram, vram, vramRun,
      cpuRatio: pcpu ? vcpu / pcpu : 0,
      ramRatio: pram ? vram / pram : 0,
    },
    storage: {
      used: uniqueStorages.reduce((s: number, x: any) => s + (x.disk ?? 0), 0),
      total: uniqueStorages.reduce((s: number, x: any) => s + (x.maxdisk ?? 0), 0),
    },
    tasks: tasks.slice(0, 12),
    failedTasks: tasks.filter((t: any) => t.status && t.status !== "OK" && t.starttime > day),
  };
}

// ── Inventaire réseau : IP, MAC, pont, VLAN de chaque machine ───────
function parseNet(value: string) {
  const parts = Object.fromEntries(String(value).split(",").map((kv) => {
    const [k, ...v] = kv.split("=");
    return [k, v.join("=")];
  }));
  const macKey = Object.keys(parts).find((k) => /^(virtio|e1000e?|rtl8139|vmxnet3)$/.test(k));
  return {
    mac: (macKey ? parts[macKey] : parts.hwaddr ?? "").toUpperCase(),
    model: macKey ?? parts.type ?? "",
    bridge: parts.bridge ?? "",
    vlan: parts.tag ?? "",
    firewall: parts.firewall === "1",
    ipConfig: parts.ip ?? "",
  };
}

export interface InventoryRow {
  vmid: number;
  name: string;
  type: "qemu" | "lxc";
  node: string;
  status: string;
  tags: string[];
  ips: string[];
  ipv6: string[];
  nics: ReturnType<typeof parseNet>[];
  agent: boolean | null; // null = conteneur (pas d'agent nécessaire)
  onboot: boolean;
  ipSource: "agent" | "lxc" | "config" | "aucune";
}

export async function inventory(call: Call): Promise<InventoryRow[]> {
  const guests = (await call("GET", "/cluster/resources", { type: "vm" })).filter((g: any) => !g.template);
  return Promise.all(guests.map(async (g: any): Promise<InventoryRow> => {
    const base = `/nodes/${g.node}/${g.type}/${g.vmid}`;
    const config = await safe(call("GET", `${base}/config`), {} as any);
    const nics = Object.entries(config).filter(([k]) => /^net\d+$/.test(k)).map(([, v]) => parseNet(String(v)));
    let ips: string[] = [];
    let ipv6: string[] = [];
    let ipSource: InventoryRow["ipSource"] = "aucune";
    if (g.status === "running") {
      if (g.type === "qemu" && String(config.agent ?? "0").startsWith("1")) {
        const res = await safe(call("GET", `${base}/agent/network-get-interfaces`), null as any);
        for (const iface of res?.result ?? []) {
          if (iface.name === "lo") continue;
          for (const a of iface["ip-addresses"] ?? []) {
            if (a["ip-address-type"] === "ipv4" && !a["ip-address"].startsWith("127.")) ips.push(a["ip-address"]);
            if (a["ip-address-type"] === "ipv6" && !a["ip-address"].startsWith("fe80") && a["ip-address"] !== "::1") ipv6.push(a["ip-address"]);
          }
        }
        if (ips.length) ipSource = "agent";
      } else if (g.type === "lxc") {
        const res = await safe(call("GET", `${base}/interfaces`), [] as any[]);
        for (const iface of res) {
          if (iface.name === "lo") continue;
          if (iface.inet) ips.push(String(iface.inet).split("/")[0]);
          if (iface.inet6 && !String(iface.inet6).startsWith("fe80")) ipv6.push(String(iface.inet6).split("/")[0]);
        }
        if (ips.length) ipSource = "lxc";
      }
    }
    if (!ips.length) {
      // IP fixe déclarée dans la config du conteneur, ou dans cloud-init
      const fixed = [...nics.map((n) => n.ipConfig), ...Object.entries(config).filter(([k]) => /^ipconfig\d+$/.test(k)).map(([, v]) => String(v).match(/ip=([^,]+)/)?.[1] ?? "")]
        .filter((ip) => ip && ip !== "dhcp" && ip !== "manual").map((ip) => ip.split("/")[0]);
      if (fixed.length) {
        ips = fixed;
        ipSource = "config";
      }
    }
    return {
      vmid: g.vmid, name: g.name, type: g.type, node: g.node, status: g.status,
      tags: String(g.tags ?? config.tags ?? "").split(/[;,\s]+/).filter(Boolean),
      ips, ipv6, nics, ipSource,
      agent: g.type === "qemu" ? String(config.agent ?? "0").startsWith("1") : null,
      onboot: !!Number(config.onboot ?? 0),
    };
  }));
}

// ── Sauvegardes et snapshots ────────────────────────────────────────
export async function backupStatus(call: Call, maxDays = 7) {
  const resources = await call("GET", "/cluster/resources");
  const guests = resources.filter((r: any) => (r.type === "qemu" || r.type === "lxc") && !r.template);
  const backupStores = resources.filter((r: any) => r.type === "storage" && String(r.content ?? "").includes("backup") && r.status === "available");
  // Un stockage partagé n'est lu qu'une fois
  const seen = new Set<string>();
  const stores = backupStores.filter((s: any) => {
    const k = s.shared ? s.storage : `${s.node}/${s.storage}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const lists = await Promise.all(stores.map((s: any) => safe(call("GET", `/nodes/${s.node}/storage/${s.storage}/content`, { content: "backup" }), [] as any[]).then((l) => l.map((b: any) => ({ ...b, storage: s.storage })))));
  const backups = lists.flat();
  const [jobs, notCovered] = await Promise.all([
    safe(call("GET", "/cluster/backup"), [] as any[]),
    safe(call("GET", "/cluster/backup-info/not-backed-up"), [] as any[]),
  ]);
  const snaps = await Promise.all(guests.map((g: any) => safe(call("GET", `/nodes/${g.node}/${g.type}/${g.vmid}/snapshot`), [] as any[])));

  const limit = nowS() - maxDays * DAY;
  const rows = guests.map((g: any, i: number) => {
    const mine = backups.filter((b: any) => Number(b.vmid) === g.vmid).sort((a: any, b: any) => b.ctime - a.ctime);
    const snapshots = snaps[i].filter((s: any) => s.name !== "current");
    const oldest = snapshots.reduce((m: number, s: any) => (s.snaptime && (!m || s.snaptime < m) ? s.snaptime : m), 0);
    return {
      vmid: g.vmid, name: g.name, type: g.type, node: g.node, status: g.status,
      lastBackup: mine[0]?.ctime ?? 0,
      backupCount: mine.length,
      backupSize: mine.reduce((s: number, b: any) => s + (b.size ?? 0), 0),
      inJob: !notCovered.some((n: any) => Number(n.vmid) === g.vmid),
      stale: !mine[0] || mine[0].ctime < limit,
      snapshots: snapshots.length,
      oldestSnapshot: oldest,
    };
  });
  return {
    rows,
    jobs,
    totalSize: backups.reduce((s: number, b: any) => s + (b.size ?? 0), 0),
    count: backups.length,
    stale: rows.filter((r: any) => r.stale).length,
    notInJob: rows.filter((r: any) => !r.inJob).length,
    oldSnapshots: rows.filter((r: any) => r.oldestSnapshot && r.oldestSnapshot < nowS() - 30 * DAY).length,
  };
}

// ── Santé du serveur : services, disques, ZFS, mises à jour, certificats ──
export async function serverHealth(call: Call, node: string) {
  const b = `/nodes/${node}`;
  const [status, services, disks, zfs, updates, certificates, dns, time, subscription, network] = await Promise.all([
    safe(call("GET", `${b}/status`), null as any),
    safe(call("GET", `${b}/services`), [] as any[]),
    safe(call("GET", `${b}/disks/list`), [] as any[]),
    safe(call("GET", `${b}/disks/zfs`), [] as any[]),
    safe(call("GET", `${b}/apt/update`), [] as any[]),
    safe(call("GET", `${b}/certificates/info`), [] as any[]),
    safe(call("GET", `${b}/dns`), null as any),
    safe(call("GET", `${b}/time`), null as any),
    safe(call("GET", `${b}/subscription`), null as any),
    safe(call("GET", `${b}/network`), [] as any[]),
  ]);
  return { node, status, services, disks, zfs, updates, certificates, dns, time, subscription, network };
}

// ── Stockage avec estimation de remplissage ─────────────────────────
export async function storageInsights(call: Call) {
  const list: any[] = [];
  for (const node of await nodes(call)) {
    const stores = await safe(call("GET", `/nodes/${node}/storage`), [] as any[]);
    const withTrend = await Promise.all(stores.map(async (s: any) => {
      const pts = (await safe(call("GET", `/nodes/${node}/storage/${s.storage}/rrddata`, { timeframe: "week" }), [] as any[])).filter((p: any) => p.used !== undefined && p.total);
      return { ...s, node, daysToFull: forecastDays(pts) };
    }));
    list.push(...withTrend);
  }
  return list;
}

/** Régression linéaire sur l'espace utilisé → nombre de jours avant d'être plein (null si stable ou en baisse). */
export function forecastDays(pts: { time: number; used: number; total: number }[]): number | null {
  if (pts.length < 10) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.time, 0) / n;
  const my = pts.reduce((s, p) => s + p.used, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.time - mx) * (p.used - my);
    den += (p.time - mx) ** 2;
  }
  const slope = den ? num / den : 0; // octets par seconde
  const last = pts[pts.length - 1];
  if (slope <= 0) return null;
  const days = (last.total - last.used) / slope / DAY;
  return days > 3650 ? null : Math.max(0, Math.round(days));
}

// ── Sécurité ─────────────────────────────────────────────────────────
export interface Finding {
  level: "info" | "warning" | "critical" | "ok";
  title: string;
  detail: string;
}

export async function security(call: Call) {
  const nodeList = await nodes(call);
  const [users, tfa, clusterFw, acl] = await Promise.all([
    safe(call("GET", "/access/users", { full: 1 }), [] as any[]),
    safe(call("GET", "/access/tfa"), [] as any[]),
    safe(call("GET", "/cluster/firewall/options"), null as any),
    safe(call("GET", "/access/acl"), [] as any[]),
  ]);
  const perNode = await Promise.all(nodeList.map(async (node) => {
    const [certs, syslog, sub, fw, updates] = await Promise.all([
      safe(call("GET", `/nodes/${node}/certificates/info`), [] as any[]),
      safe(call("GET", `/nodes/${node}/syslog`, { service: "pvedaemon", limit: 2000 }), [] as any[]),
      safe(call("GET", `/nodes/${node}/subscription`), null as any),
      safe(call("GET", `/nodes/${node}/firewall/options`), null as any),
      safe(call("GET", `/nodes/${node}/apt/update`), [] as any[]),
    ]);
    return { node, certs, syslog, sub, fw, updates };
  }));

  const tfaUsers = new Set(tfa.filter((t: any) => (t.entries ?? []).some((e: any) => e.enable !== 0)).map((t: any) => t.userid));
  const userRows = users.map((u: any) => ({
    userid: u.userid,
    enabled: !!u.enable,
    expire: u.expire ?? 0,
    tfa: tfaUsers.has(u.userid),
    realm: String(u.userid).split("@")[1],
    tokens: (u.tokens ?? []).map((t: any) => ({ id: `${u.userid}!${t.tokenid}`, privsep: !!t.privsep, expire: t.expire ?? 0, comment: t.comment ?? "" })),
    roles: acl.filter((a: any) => a.ugid === u.userid).map((a: any) => `${a.roleid} sur ${a.path}`),
  }));

  // Échecs de connexion repérés dans le journal de pvedaemon
  const failures: { at: string; node: string; user: string; ip: string }[] = [];
  for (const n of perNode) {
    for (const line of n.syslog) {
      const t = String(line.t ?? "");
      if (!/authentication failure/i.test(t)) continue;
      failures.push({
        at: (t.match(/^(\d{4}-\d{2}-\d{2}[ T][\d:]{8}|\w{3}\s+\d+\s+[\d:]{8})/)?.[1] ?? t.slice(0, 15)).replace("T", " "),
        node: n.node,
        user: t.match(/user=(\S+)/)?.[1] ?? "?",
        ip: (t.match(/rhost=(\S+)/)?.[1] ?? "?").replace("::ffff:", ""),
      });
    }
  }
  const byIp = Object.entries(failures.reduce((m: Record<string, number>, f) => ({ ...m, [f.ip]: (m[f.ip] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);

  const certs = perNode.flatMap((n) => n.certs.map((c: any) => ({ ...c, node: n.node, days: Math.floor((c.notafter - nowS()) / DAY) })));
  const securityUpdates = perNode.flatMap((n) => n.updates.filter((u: any) => /secur/i.test(`${u.Origin} ${u.Title} ${u.Section}`) || u.Origin === "Debian" && /deb\d+u\d+/.test(u.Version)).map((u: any) => ({ ...u, node: n.node })));
  const allUpdates = perNode.reduce((s, n) => s + n.updates.length, 0);

  const findings: Finding[] = [];
  const root = userRows.find((u: any) => u.userid === "root@pam");
  if (root && !root.tfa) findings.push({ level: "warning", title: "Le compte root n'a pas de double authentification", detail: "Active la 2FA (TOTP) pour root@pam dans Proxmox : Datacenter > Permissions > Two Factor." });
  const noTfa = userRows.filter((u: any) => u.enabled && !u.tfa && u.realm !== "pam" && !u.userid.startsWith("myproxmox@"));
  if (noTfa.length) findings.push({ level: "info", title: `${noTfa.length} compte(s) sans double authentification`, detail: noTfa.map((u: any) => u.userid).join(", ") });
  const fullTokens = userRows.flatMap((u: any) => u.tokens.filter((t: any) => !t.privsep && !t.id.startsWith("myproxmox@")));
  if (fullTokens.length) findings.push({ level: "info", title: `${fullTokens.length} jeton(s) API avec tous les droits de leur utilisateur`, detail: `Sans séparation des privilèges (privsep=0) : ${fullTokens.map((t: any) => t.id).join(", ")}` });
  if (clusterFw && !Number(clusterFw.enable)) findings.push({ level: "warning", title: "Pare-feu du datacenter désactivé", detail: "Les règles de pare-feu des nœuds et des machines ne s'appliquent pas tant qu'il est coupé (Datacenter > Pare-feu > Options)." });
  for (const c of certs.filter((c: any) => c.days < 30)) findings.push({ level: c.days < 7 ? "critical" : "warning", title: `Certificat ${c.filename} (${c.node}) : expire dans ${c.days} j`, detail: c.subject });
  if (byIp.length) findings.push({ level: byIp[0][1] >= 5 ? "warning" : "info", title: `${failures.length} échec(s) de connexion récents`, detail: byIp.slice(0, 5).map(([ip, n]) => `${ip} (${n})`).join(", ") });
  if (securityUpdates.length) findings.push({ level: "warning", title: `${securityUpdates.length} mise(s) à jour de sécurité en attente`, detail: securityUpdates.map((u: any) => u.Package).join(", ") });
  else if (allUpdates) findings.push({ level: "info", title: `${allUpdates} mise(s) à jour disponibles`, detail: "Rien de marqué comme correctif de sécurité." });
  const noSub = perNode.filter((n) => n.sub && n.sub.status !== "active");
  if (noSub.length) findings.push({ level: "info", title: "Pas d'abonnement Proxmox", detail: "Normal pour un homelab : utilise le dépôt « no-subscription » pour recevoir les mises à jour." });
  if (!findings.some((f) => f.level === "warning" || f.level === "critical")) findings.unshift({ level: "ok", title: "Rien d'inquiétant", detail: "Aucun point de sécurité important détecté." });

  return {
    findings,
    users: userRows,
    failures: failures.slice(-100).reverse(),
    failuresByIp: byIp,
    certificates: certs,
    firewall: {
      datacenter: clusterFw ? !!Number(clusterFw.enable) : null,
      nodes: perNode.map((n) => ({ node: n.node, enabled: n.fw ? !!Number(n.fw.enable ?? 1) : null })),
    },
    subscription: perNode.map((n) => ({ node: n.node, status: n.sub?.status ?? "inconnu", level: n.sub?.level ?? "" })),
    securityUpdates,
  };
}

// ── Écran de monitoring (lecture seule) ─────────────────────────────
export async function monitoringSnapshot(call: Call) {
  const ov = await overview(call);
  const rrds = await Promise.all(ov.nodes.map((n: any) => (n.status === "online" ? safe(call("GET", `/nodes/${n.node}/rrddata`, { timeframe: "hour" }), [] as any[]) : Promise.resolve([]))));
  return {
    at: new Date().toISOString(),
    nodes: ov.nodes.map((n: any, i: number) => ({ ...n, rrd: rrds[i].filter((p: any) => p.cpu !== undefined) })),
    guests: ov.guests.map((g: any) => ({ vmid: g.vmid, name: g.name, type: g.type, status: g.status, cpu: g.cpu, maxcpu: g.maxcpu, mem: g.mem, maxmem: g.maxmem, uptime: g.uptime, node: g.node, netin: g.netin, netout: g.netout })),
    storages: ov.storages,
    counts: ov.counts,
    allocation: ov.allocation,
    storage: ov.storage,
    top: ov.top,
    tasks: ov.tasks.slice(0, 8),
    failedTasks: ov.failedTasks.length,
  };
}
