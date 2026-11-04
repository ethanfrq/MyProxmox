// Faux pare-feu Proxmox, réutilisé pour une machine, un nœud ou le datacenter.
// Gère options, règles (avec leur position), alias, IPsets et journal.

type Any = any;
type Params = Record<string, unknown>;

export interface FwRule {
  type: "in" | "out" | "group" | "forward";
  action: string;
  enable?: number;
  macro?: string;
  source?: string;
  dest?: string;
  proto?: string;
  sport?: string;
  dport?: string;
  iface?: string;
  log?: string;
  comment?: string;
  "icmp-type"?: string;
}
export interface FwStore {
  options: Record<string, Any>;
  rules: FwRule[];
  aliases: { name: string; cidr: string; comment?: string }[];
  ipsets: { name: string; comment?: string; entries: { cidr: string; comment?: string; nomatch?: number }[] }[];
  groups?: { group: string; comment?: string; rules: FwRule[] }[];
}

export function newFirewall(options: Record<string, Any> = {}, rules: FwRule[] = []): FwStore {
  return { options: { enable: 0, policy_in: "DROP", policy_out: "ACCEPT", log_level_in: "nolog", log_level_out: "nolog", ...options }, rules, aliases: [], ipsets: [] };
}

const RULE_KEYS = ["type", "action", "enable", "macro", "source", "dest", "proto", "sport", "dport", "iface", "log", "comment", "icmp-type"];

function applyRule(r: Any, p: Params) {
  for (const k of RULE_KEYS) if (p[k] !== undefined && p[k] !== "") r[k] = k === "enable" ? Number(p[k]) : String(p[k]);
  for (const k of String(p.delete ?? "").split(",").filter(Boolean)) delete r[k];
  return r;
}

function rulesRoute(list: FwRule[], method: string, rest: string[], p: Params, fail: (s: number, m: string) => never): Any {
  if (!rest.length) {
    if (method === "GET") return list.map((r, pos) => ({ pos, ...r, ipversion: 4 }));
    if (method === "POST") {
      if (!p.type || !p.action) fail(400, "type et action sont obligatoires");
      const r = applyRule({ enable: 0 }, p);
      const pos = p.pos !== undefined ? Number(p.pos) : 0; // Proxmox ajoute en haut par défaut
      list.splice(Math.min(pos, list.length), 0, r);
      return null;
    }
  }
  const pos = Number(rest[0]);
  if (!list[pos]) fail(400, `no rule at position ${pos}`);
  if (method === "GET") return { pos, ...list[pos] };
  if (method === "PUT") {
    if (p.moveto !== undefined) {
      const [r] = list.splice(pos, 1);
      list.splice(Math.min(Number(p.moveto), list.length), 0, r);
    } else applyRule(list[pos], p);
    return null;
  }
  if (method === "DELETE") {
    list.splice(pos, 1);
    return null;
  }
  return fail(501, "méthode non simulée");
}

/** `rest` = segments après « firewall ». Retourne `undefined` si le chemin n'est pas géré. */
export function firewallRoute(fw: FwStore, method: string, rest: string[], p: Params, fail: (s: number, m: string) => never): Any {
  const [what, ...sub] = rest;
  if (what === undefined && method === "GET") return [{ name: "options" }, { name: "rules" }, { name: "aliases" }, { name: "ipset" }, { name: "log" }, { name: "refs" }];
  if (what === "options") {
    if (method === "GET") return { ...fw.options };
    if (method === "PUT") {
      for (const [k, v] of Object.entries(p)) if (!["delete", "digest"].includes(k)) fw.options[k] = typeof v === "boolean" ? Number(v) : v;
      for (const k of String(p.delete ?? "").split(",").filter(Boolean)) delete fw.options[k];
      return null;
    }
  }
  if (what === "rules") return rulesRoute(fw.rules, method, sub, p, fail);
  if (what === "groups" && fw.groups) {
    if (!sub.length) {
      if (method === "GET") return fw.groups.map((g) => ({ group: g.group, comment: g.comment ?? "" }));
      if (method === "POST") {
        if (p.rename) {
          const g = fw.groups.find((x) => x.group === p.rename) ?? fail(404, `no such security group '${p.rename}'`);
          Object.assign(g!, { group: String(p.group), comment: String(p.comment ?? g!.comment ?? "") });
          return null;
        }
        if (!/^[A-Za-z][\w-]{1,17}$/.test(String(p.group))) fail(400, "group: invalid format");
        if (fw.groups.some((g) => g.group === p.group)) fail(500, `security group '${p.group}' already exists`);
        fw.groups.push({ group: String(p.group), comment: String(p.comment ?? ""), rules: [] });
        return null;
      }
    }
    const grp = fw.groups.find((g) => g.group === sub[0]) ?? fail(404, `no such security group '${sub[0]}'`);
    if (sub.length === 1 && method === "DELETE") {
      if (grp.rules.length) fail(500, "security group is not empty");
      fw.groups = fw.groups.filter((g) => g !== grp);
      return null;
    }
    return rulesRoute(grp.rules, method, sub.slice(1), p, fail);
  }
  if (what === "aliases") {
    if (!sub.length) {
      if (method === "GET") return fw.aliases.map((a) => ({ ...a, ipversion: 4 }));
      if (method === "POST") {
        if (!/^[A-Za-z][\w-]{1,62}$/.test(String(p.name))) fail(400, "name: invalid format");
        if (fw.aliases.some((a) => a.name === p.name)) fail(500, `alias '${p.name}' already exists`);
        fw.aliases.push({ name: String(p.name), cidr: String(p.cidr), comment: String(p.comment ?? "") });
        return null;
      }
    }
    const a = fw.aliases.find((x) => x.name === sub[0]) ?? fail(404, `no such alias '${sub[0]}'`);
    if (method === "GET") return a;
    if (method === "PUT") {
      Object.assign(a, { cidr: String(p.cidr ?? a.cidr), comment: String(p.comment ?? a.comment ?? "") });
      if (p.rename) a.name = String(p.rename);
      return null;
    }
    if (method === "DELETE") {
      fw.aliases = fw.aliases.filter((x) => x !== a);
      return null;
    }
  }
  if (what === "ipset") {
    if (!sub.length) {
      if (method === "GET") return fw.ipsets.map((s) => ({ name: s.name, comment: s.comment ?? "" }));
      if (method === "POST") {
        if (!/^[A-Za-z][\w-]{1,62}$/.test(String(p.name))) fail(400, "name: invalid format");
        if (fw.ipsets.some((s) => s.name === p.name)) fail(500, `IPSet '${p.name}' already exists`);
        fw.ipsets.push({ name: String(p.name), comment: String(p.comment ?? ""), entries: [] });
        return null;
      }
    }
    const set = fw.ipsets.find((s) => s.name === sub[0]) ?? fail(404, `no such IPSet '${sub[0]}'`);
    if (sub.length === 1) {
      if (method === "GET") return set.entries;
      if (method === "POST") {
        if (set.entries.some((e) => e.cidr === p.cidr)) fail(500, `entry '${p.cidr}' already exists`);
        set.entries.push({ cidr: String(p.cidr), comment: String(p.comment ?? ""), nomatch: Number(p.nomatch ?? 0) });
        return null;
      }
      if (method === "DELETE") {
        if (set.entries.length) fail(500, "IPSet is not empty");
        fw.ipsets = fw.ipsets.filter((s) => s !== set);
        return null;
      }
    }
    const cidr = decodeURIComponent(sub.slice(1).join("/"));
    const e = set.entries.find((x) => x.cidr === cidr) ?? fail(404, `no such IP/Network '${cidr}'`);
    if (method === "GET") return e;
    if (method === "PUT") {
      Object.assign(e, { comment: String(p.comment ?? e.comment ?? ""), nomatch: Number(p.nomatch ?? e.nomatch ?? 0) });
      return null;
    }
    if (method === "DELETE") {
      set.entries = set.entries.filter((x) => x !== e);
      return null;
    }
  }
  if (what === "refs" && method === "GET") {
    return [...fw.aliases.map((a) => ({ type: "alias", name: a.name, ref: a.name, comment: a.comment ?? "" })), ...fw.ipsets.map((s) => ({ type: "ipset", name: s.name, ref: `+${s.name}`, comment: s.comment ?? "" }))];
  }
  if (what === "log" && method === "GET") {
    const t = Date.now();
    const line = (min: number, msg: string) => `${new Date(t - min * 60000).toISOString().slice(0, 19).replace("T", " ")} ${msg}`;
    return [
      line(14, "DROP: IN=fwbr101i0 SRC=192.168.1.44 DST=10.0.1.51 PROTO=TCP SPT=51234 DPT=22"),
      line(9, "ACCEPT: IN=fwbr101i0 SRC=10.0.1.42 DST=10.0.1.51 PROTO=TCP SPT=50112 DPT=8123"),
      line(3, "DROP: IN=fwbr101i0 SRC=203.0.113.9 DST=10.0.1.51 PROTO=UDP SPT=5353 DPT=5353"),
    ].map((t2, i) => ({ n: i + 1, t: t2 }));
  }
  return undefined;
}
