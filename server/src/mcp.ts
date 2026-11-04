// Serveur MCP intégré (transport « Streamable HTTP », sans état).
// Claude, ou tout autre client MCP, s'authentifie avec une clé créée dans
// l'interface. Chaque clé a un niveau : "read" (lecture) ou "actions".
// Toutes les requêtes passent par le jeton de service, jamais par un compte humain,
// et tout ce qui modifie quelque chose est inscrit au journal.
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getConfig, logActivity, saveConfig, sameHash, version, type McpKey } from "./config";
import { serviceCall } from "./pve";
import { activeAlerts } from "./engine";
import { backupStatus, inventory, overview, security, serverHealth, storageInsights } from "../../shared/insights";
import { ago, bytes, pct, uptime, TASK_LABEL } from "../../shared/format";
import type { Call } from "../../shared/types";

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (data: unknown): Text => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const error = (msg: string): Text => ({ content: [{ type: "text", text: msg }], isError: true });

async function locate(call: Call, vmid: number) {
  const list = await call("GET", "/cluster/resources", { type: "vm" });
  const g = list.find((r: any) => r.vmid === vmid);
  if (!g) throw new Error(`Aucune machine avec l'identifiant ${vmid}. Utilise lister_machines pour voir les identifiants.`);
  return g as { node: string; type: "qemu" | "lxc"; name: string; status: string; vmid: number };
}

function buildServer(key: McpKey) {
  const server = new McpServer({ name: "myproxmox", version: version() }, {
    instructions:
      "Tu pilotes un serveur Proxmox VE à travers MyProxmox. Commence par etat_general pour avoir une vue d'ensemble. " +
      "Les identifiants de machines (vmid) sont des nombres comme 101. Avant d'éteindre ou de redémarrer une machine, " +
      "demande toujours confirmation à l'utilisateur et rappelle-lui ce que fait cette machine si tu le sais. " +
      `Le niveau d'accès de cette clé est « ${key.level} »${key.level === "read" ? " : tu peux seulement consulter" : ""}.`,
  });
  const call = serviceCall();
  const actor = `mcp:${key.name}`;
  const canAct = key.level === "actions";

  const read = (name: string, title: string, description: string, schema: z.ZodRawShape, fn: (args: any) => Promise<unknown>) =>
    server.registerTool(name, { title, description, inputSchema: schema, annotations: { readOnlyHint: true, openWorldHint: false } }, async (args: any) => {
      try {
        return json(await fn(args));
      } catch (e) {
        return error((e as Error).message);
      }
    });

  const act = (name: string, title: string, description: string, schema: z.ZodRawShape, destructive: boolean, fn: (args: any) => Promise<{ message: string; target: string; upid?: string }>) =>
    server.registerTool(name, { title, description: `${description} Nécessite une clé MCP de niveau « actions ».`, inputSchema: schema, annotations: { readOnlyHint: false, destructiveHint: destructive, openWorldHint: false } }, async (args: any) => {
      if (!canAct) {
        await logActivity({ actor, action: name, target: JSON.stringify(args), result: "refusé", detail: "clé en lecture seule" });
        return error("Refusé : cette clé MCP est en lecture seule. L'utilisateur peut créer une clé « actions » dans MyProxmox > Claude & MCP.");
      }
      try {
        const r = await fn(args);
        await logActivity({ actor, action: name, target: r.target, result: "ok" });
        return json({ message: r.message, tache: r.upid });
      } catch (e) {
        await logActivity({ actor, action: name, target: JSON.stringify(args), result: "erreur", detail: (e as Error).message });
        return error((e as Error).message);
      }
    });

  read("etat_general", "État général", "Vue d'ensemble du serveur : nœuds (CPU, RAM, disque, uptime), nombre de machines, plus gros consommateurs, surallocation, stockage et alertes actives.", {}, async () => {
    const ov = await overview(call);
    return {
      noeuds: ov.nodes.map((n: any) => ({
        nom: n.node, statut: n.status, cpu: pct(n.cpu), coeurs: n.maxcpu, ram: `${bytes(n.mem)} / ${bytes(n.maxmem)}`,
        disque_systeme: `${bytes(n.disk)} / ${bytes(n.maxdisk)}`, allume_depuis: uptime(n.uptime),
        version: n.detail?.pveversion, charge: n.detail?.loadavg?.join(" "),
      })),
      machines: { total: ov.counts.guests, en_marche: ov.counts.running, vm: ov.counts.vms, conteneurs: ov.counts.containers },
      plus_gros_cpu: ov.top.cpu.map((g: any) => `${g.name} (${g.vmid}) ${pct(g.cpu)}`),
      plus_gros_ram: ov.top.mem.map((g: any) => `${g.name} (${g.vmid}) ${bytes(g.mem)}`),
      surallocation: { vcpu_alloues: ov.allocation.vcpu, coeurs_physiques: ov.allocation.pcpu, ram_allouee: bytes(ov.allocation.vram), ram_physique: bytes(ov.allocation.pram) },
      stockage: ov.storages.map((s: any) => ({ nom: s.storage, utilise: `${bytes(s.disk)} / ${bytes(s.maxdisk)}`, taux: pct(s.disk / (s.maxdisk || 1)) })),
      alertes_actives: activeAlerts().map((a) => `[${a.level}] ${a.title} : ${a.message}`),
      taches_en_echec_24h: ov.failedTasks.map((t: any) => `${TASK_LABEL[t.type] ?? t.type} ${t.id} : ${t.status}`),
    };
  });

  read("lister_machines", "Lister les machines", "Toutes les VM et conteneurs avec statut, adresses IP, MAC, pont réseau, VLAN, tags et démarrage automatique.", {
    filtre: z.enum(["toutes", "en_marche", "arretees"]).optional().describe("Filtrer par statut"),
  }, async ({ filtre }) => {
    const rows = await inventory(call);
    return rows
      .filter((r) => filtre === "en_marche" ? r.status === "running" : filtre === "arretees" ? r.status !== "running" : true)
      .map((r) => ({ vmid: r.vmid, nom: r.name, type: r.type === "qemu" ? "VM" : "conteneur", statut: r.status, noeud: r.node, ip: r.ips, mac: r.nics.map((n) => n.mac), pont: r.nics.map((n) => n.bridge), vlan: r.nics.map((n) => n.vlan).filter(Boolean), tags: r.tags, demarrage_auto: r.onboot }));
  });

  read("details_machine", "Détails d'une machine", "Statut, consommation, configuration complète, snapshots et dernières sauvegardes d'une VM ou d'un conteneur.", {
    vmid: z.number().int().describe("Identifiant de la machine, par exemple 101"),
  }, async ({ vmid }) => {
    const g = await locate(call, vmid);
    const base = `/nodes/${g.node}/${g.type}/${vmid}`;
    const [status, config, snaps] = await Promise.all([call("GET", `${base}/status/current`), call("GET", `${base}/config`), call("GET", `${base}/snapshot`)]);
    const bk = await backupStatus(call).catch(() => null);
    const row = bk?.rows.find((r: any) => r.vmid === vmid);
    return {
      vmid, nom: g.name, type: g.type, noeud: g.node, statut: status.status, cpu: pct(status.cpu), ram: `${bytes(status.mem)} / ${bytes(status.maxmem)}`,
      allume_depuis: uptime(status.uptime), configuration: config,
      snapshots: snaps.filter((s: any) => s.name !== "current").map((s: any) => ({ nom: s.name, description: s.description, date: s.snaptime ? new Date(s.snaptime * 1000).toISOString() : null })),
      derniere_sauvegarde: row?.lastBackup ? ago(row.lastBackup) : "aucune", nombre_sauvegardes: row?.backupCount ?? 0,
    };
  });

  read("alertes_actives", "Alertes actives", "Problèmes détectés en ce moment : nœud hors ligne, stockage plein, disque SMART en défaut, machine qui devrait tourner, sauvegarde ancienne...", {}, async () => activeAlerts());

  read("sante_serveur", "Santé du serveur", "Services Proxmox, disques (santé SMART, usure des SSD), pools ZFS, mises à jour en attente, certificats, DNS.", {
    noeud: z.string().optional().describe("Nom du nœud (par défaut : le premier)"),
  }, async ({ noeud }) => {
    const nodes = await call("GET", "/nodes");
    const node = noeud ?? nodes[0]?.node;
    const h = await serverHealth(call, node);
    return {
      noeud: node,
      services_arretes: h.services.filter((s: any) => s.state !== "running").map((s: any) => s.name),
      disques: h.disks.map((d: any) => ({ disque: d.devpath, modele: d.model, taille: bytes(d.size), sante: d.health, usure_restante: d.wearout })),
      zfs: h.zfs.map((p: any) => ({ pool: p.name, etat: p.health, utilise: `${bytes(p.alloc)} / ${bytes(p.size)}` })),
      mises_a_jour: h.updates.map((u: any) => `${u.Package} ${u.OldVersion} -> ${u.Version}`),
      certificats: h.certificates.map((c: any) => ({ fichier: c.filename, expire_dans_jours: Math.floor((c.notafter - Date.now() / 1000) / 86400) })),
      dns: h.dns,
    };
  });

  read("stockage", "Stockage", "Espaces de stockage avec occupation et estimation du nombre de jours avant d'être plein.", {}, async () => {
    const list = await storageInsights(call);
    return list.map((s: any) => ({ nom: s.storage, noeud: s.node, type: s.type, contenu: s.content, utilise: `${bytes(s.used)} / ${bytes(s.total)}`, taux: pct(s.used_fraction ?? s.used / (s.total || 1)), plein_dans_jours: s.daysToFull }));
  });

  read("sauvegardes", "Sauvegardes", "Pour chaque machine : date de la dernière sauvegarde, nombre, taille, présence dans une tâche planifiée, snapshots anciens.", {}, async () => {
    const b = await backupStatus(call, getConfig().rules.backupMaxDays);
    return {
      resume: { sauvegardes: b.count, taille_totale: bytes(b.totalSize), machines_sans_sauvegarde_recente: b.stale, machines_hors_planification: b.notInJob },
      taches_planifiees: b.jobs.map((j: any) => ({ id: j.id, horaire: j.schedule, stockage: j.storage, machines: j.vmid ?? (j.all ? "toutes" : ""), active: !!j.enabled })),
      machines: b.rows.map((r: any) => ({ vmid: r.vmid, nom: r.name, derniere: r.lastBackup ? ago(r.lastBackup) : "jamais", nombre: r.backupCount, planifiee: r.inJob, snapshots: r.snapshots })),
    };
  });

  read("securite", "Sécurité", "Points de sécurité : 2FA des comptes, jetons API, pare-feu, certificats, échecs de connexion récents, mises à jour de sécurité.", {}, async () => {
    const s = await security(call);
    return { constats: s.findings, echecs_connexion_par_ip: s.failuresByIp, pare_feu: s.firewall, comptes: s.users.map((u: any) => ({ compte: u.userid, actif: u.enabled, double_auth: u.tfa, jetons: u.tokens.length })) };
  });

  read("reseau", "Réseau", "Interfaces et ponts réseau du serveur, DNS, et adresses IP des machines.", {}, async () => {
    const nodes = await call("GET", "/nodes");
    const node = nodes[0]?.node;
    const [ifaces, dns, inv] = await Promise.all([call("GET", `/nodes/${node}/network`), call("GET", `/nodes/${node}/dns`).catch(() => null), inventory(call)]);
    return {
      interfaces: ifaces.map((i: any) => ({ nom: i.iface, type: i.type, active: !!i.active, adresse: i.cidr ?? i.address, passerelle: i.gateway, ports: i.bridge_ports, commentaire: i.comments })),
      dns,
      machines: inv.map((r) => ({ vmid: r.vmid, nom: r.name, ip: r.ips, pont: r.nics.map((n) => n.bridge) })),
    };
  });

  read("taches_recentes", "Tâches récentes", "Dernières tâches Proxmox (démarrages, sauvegardes...) avec leur résultat.", {
    echecs_seulement: z.boolean().optional().describe("Ne montrer que les tâches en échec"),
    nombre: z.number().int().min(1).max(100).optional(),
  }, async ({ echecs_seulement, nombre }) => {
    const tasks = await call("GET", "/cluster/tasks");
    return tasks.filter((t: any) => !echecs_seulement || (t.status && t.status !== "OK")).slice(0, nombre ?? 20)
      .map((t: any) => ({ tache: TASK_LABEL[t.type] ?? t.type, cible: t.id, noeud: t.node, debut: new Date(t.starttime * 1000).toISOString(), resultat: t.status ?? "en cours", par: t.user }));
  });

  act("alimentation_machine", "Démarrer, éteindre ou redémarrer", "Démarre, éteint proprement (ACPI) ou redémarre une machine. L'arrêt forcé n'est pas disponible.", {
    vmid: z.number().int(),
    action: z.enum(["start", "shutdown", "reboot"]).describe("start = démarrer, shutdown = éteindre proprement, reboot = redémarrer"),
  }, true, async ({ vmid, action }) => {
    const g = await locate(call, vmid);
    const upid = await call("POST", `/nodes/${g.node}/${g.type}/${vmid}/status/${action}`);
    return { message: `Action « ${action} » lancée sur ${g.name} (${vmid}).`, target: `${g.name} (${vmid})`, upid };
  });

  act("snapshot_machine", "Prendre un snapshot", "Crée un point de restauration de la machine. Utile avant une mise à jour.", {
    vmid: z.number().int(),
    nom: z.string().regex(/^[a-zA-Z][\w-]{1,39}$/).optional().describe("Nom du snapshot (lettres, chiffres, - et _), par exemple avant-maj"),
    description: z.string().max(200).optional(),
  }, false, async ({ vmid, nom, description }) => {
    const g = await locate(call, vmid);
    const snapname = nom ?? `claude-${new Date().toISOString().slice(0, 16).replace(/\D/g, "")}`;
    const upid = await call("POST", `/nodes/${g.node}/${g.type}/${vmid}/snapshot`, { snapname, description: description ?? "Créé par Claude via MyProxmox" });
    return { message: `Snapshot « ${snapname} » lancé sur ${g.name} (${vmid}).`, target: `${g.name} (${vmid})`, upid };
  });

  act("sauvegarder_machine", "Sauvegarder maintenant", "Lance une sauvegarde immédiate (mode snapshot, sans interruption) vers un stockage de sauvegarde.", {
    vmid: z.number().int(),
    stockage: z.string().optional().describe("Stockage de destination (par défaut : le premier qui accepte les sauvegardes)"),
  }, false, async ({ vmid, stockage }) => {
    const g = await locate(call, vmid);
    let storage = stockage;
    if (!storage) {
      const list = await call("GET", `/nodes/${g.node}/storage`, { content: "backup" });
      storage = list.find((s: any) => s.active)?.storage;
      if (!storage) throw new Error("Aucun stockage n'accepte les sauvegardes sur ce nœud.");
    }
    const upid = await call("POST", `/nodes/${g.node}/vzdump`, { vmid, storage, mode: "snapshot", compress: "zstd" });
    return { message: `Sauvegarde de ${g.name} (${vmid}) lancée vers ${storage}.`, target: `${g.name} (${vmid})`, upid };
  });

  // ── Datacenter, HA, SDN, Ceph, pare-feu, permissions, réplication, PBS ──

  read("datacenter", "Datacenter", "Cluster (quorum, nœuds), options du datacenter, stockages déclarés et tâches de sauvegarde planifiées.", {}, async () => {
    const [status, options, storages, jobs] = await Promise.all([
      call("GET", "/cluster/status").catch(() => []), call("GET", "/cluster/options").catch(() => ({})),
      call("GET", "/storage"), call("GET", "/cluster/backup").catch(() => []),
    ]);
    const cluster = status.find((s: any) => s.type === "cluster");
    return {
      cluster: cluster ? { nom: cluster.name, quorum: !!cluster.quorate, noeuds: cluster.nodes } : "nœud seul, sans cluster",
      noeuds: status.filter((s: any) => s.type === "node").map((n: any) => ({ nom: n.name, en_ligne: !!n.online, ip: n.ip })),
      options,
      stockages: storages.map((s: any) => ({ nom: s.storage, type: s.type, contenu: s.content, partage: !!s.shared, desactive: !!s.disable, noeuds: s.nodes ?? "tous" })),
      sauvegardes_planifiees: jobs.map((j: any) => ({ id: j.id, horaire: j.schedule, stockage: j.storage, machines: j.vmid ?? (j.all ? "toutes" : j.pool ? `pool ${j.pool}` : ""), active: j.enabled !== 0 })),
    };
  });

  read("haute_disponibilite", "Haute disponibilité", "État du gestionnaire HA, ressources protégées (machines redémarrées ailleurs si un nœud tombe) et groupes HA.", {}, async () => {
    const [status, resources, groups] = await Promise.all([
      call("GET", "/cluster/ha/status/current"), call("GET", "/cluster/ha/resources"), call("GET", "/cluster/ha/groups").catch(() => []),
    ]);
    return {
      etat: status.map((s: any) => ({ id: s.id, type: s.type, noeud: s.node, statut: s.status })),
      ressources: resources.map((r: any) => ({ id: r.sid, etat_voulu: r.state, groupe: r.group, commentaire: r.comment })),
      groupes: groups.map((g: any) => ({ nom: g.group, noeuds: g.nodes, restreint: !!g.restricted })),
    };
  });

  read("reseau_logiciel", "Réseau logiciel (SDN)", "Zones, VNets et sous-réseaux du SDN, et changements en attente d'application.", {}, async () => {
    const [zones, vnets] = await Promise.all([call("GET", "/cluster/sdn/zones"), call("GET", "/cluster/sdn/vnets")]);
    const subnets = await Promise.all(vnets.map((v: any) => call("GET", `/cluster/sdn/vnets/${v.vnet}/subnets`).catch(() => [])));
    return {
      en_attente: [...zones, ...vnets].some((x: any) => x.state),
      zones: zones.map((z: any) => ({ nom: z.zone, type: z.type, pont: z.bridge, noeuds: z.nodes ?? "tous" })),
      vnets: vnets.map((v: any, i: number) => ({ nom: v.vnet, zone: v.zone, tag: v.tag, alias: v.alias, sous_reseaux: subnets[i].map((s: any) => ({ cidr: s.cidr, passerelle: s.gateway, snat: !!s.snat })) })),
    };
  });

  read("ceph", "Ceph", "Santé du cluster Ceph : état, alertes, moniteurs, OSD, espace utilisé et pools.", {}, async () => {
    const nodes = await call("GET", "/nodes");
    for (const n of nodes.filter((x: any) => x.status === "online")) {
      try {
        const st = await call("GET", `/nodes/${n.node}/ceph/status`);
        const pools = await call("GET", `/nodes/${n.node}/ceph/pool`).catch(() => []);
        return {
          lu_depuis: n.node, sante: st.health?.status,
          alertes: Object.entries(st.health?.checks ?? {}).map(([k, v]: [string, any]) => `${k} : ${v.summary?.message ?? ""}`),
          moniteurs: st.monmap?.mons?.map((m: any) => m.name),
          osd: { total: st.osdmap?.num_osds, actifs: st.osdmap?.num_up_osds, dans_le_cluster: st.osdmap?.num_in_osds },
          espace: st.pgmap ? `${bytes(st.pgmap.bytes_used)} / ${bytes(st.pgmap.bytes_total)}` : undefined,
          pools: pools.map((p: any) => ({ nom: p.pool_name, copies: p.size, minimum: p.min_size, pg: p.pg_num, utilise: pct(p.percent_used ?? 0) })),
        };
      } catch { /* Ceph absent sur ce nœud, on essaie le suivant */ }
    }
    return { sante: "Ceph n'est installé sur aucun nœud en ligne." };
  });

  read("pare_feu", "Pare-feu", "Options, règles et groupes de sécurité du pare-feu du datacenter. Avec un vmid, règles de cette machine.", {
    vmid: z.number().int().optional().describe("Identifiant d'une machine pour voir ses propres règles"),
  }, async ({ vmid }) => {
    const rule = (r: any) => ({ pos: r.pos, actif: !!r.enable, sens: r.type, action: r.action, macro: r.macro, source: r.source, destination: r.dest, proto: r.proto, port: r.dport, commentaire: r.comment });
    if (vmid !== undefined) {
      const g = await locate(call, vmid);
      const [options, rules] = await Promise.all([call("GET", `/nodes/${g.node}/${g.type}/${vmid}/firewall/options`), call("GET", `/nodes/${g.node}/${g.type}/${vmid}/firewall/rules`)]);
      return { machine: `${g.name} (${vmid})`, options, regles: rules.map(rule) };
    }
    const [options, rules, groups] = await Promise.all([call("GET", "/cluster/firewall/options"), call("GET", "/cluster/firewall/rules"), call("GET", "/cluster/firewall/groups")]);
    return { options, regles: rules.map(rule), groupes_de_securite: groups.map((x: any) => ({ nom: x.group, commentaire: x.comment })) };
  });

  read("permissions", "Permissions", "Utilisateurs, groupes et permissions (qui a quel rôle sur quel chemin).", {}, async () => {
    const [users, groups, acl] = await Promise.all([call("GET", "/access/users"), call("GET", "/access/groups"), call("GET", "/access/acl")]);
    return {
      utilisateurs: users.map((u: any) => ({ compte: u.userid, actif: u.enable !== 0, expire: u.expire ? new Date(u.expire * 1000).toISOString().slice(0, 10) : "jamais", groupes: u.groups, double_auth: !!u["tfa-locked-until"] || !!u.keys })),
      groupes: groups.map((g: any) => ({ nom: g.groupid, membres: g.users, commentaire: g.comment })),
      permissions: acl.map((a: any) => ({ chemin: a.path, qui: a.ugid, type: a.type, role: a.roleid, propage: !!a.propagate })),
    };
  });

  read("replication", "Réplication", "Tâches de réplication entre nœuds, avec la date de la dernière synchronisation et les échecs.", {}, async () => {
    const jobs = await call("GET", "/cluster/replication");
    const nodes = await call("GET", "/nodes");
    const states = (await Promise.all(nodes.filter((n: any) => n.status === "online").map((n: any) => call("GET", `/nodes/${n.node}/replication`).catch(() => [])))).flat();
    return jobs.map((j: any) => {
      const s = states.find((x: any) => x.id === j.id) ?? {};
      return { id: j.id, machine: j.guest, vers: j.target, horaire: j.schedule, active: !j.disable, derniere_synchro: s.last_sync ? ago(s.last_sync) : "jamais", echecs: s.fail_count ?? 0, erreur: s.error };
    });
  });

  read("proxmox_backup_server", "Proxmox Backup Server", "Stockages de type PBS : serveur, datastore, espace utilisé et nombre de sauvegardes.", {}, async () => {
    const storages = (await call("GET", "/storage")).filter((s: any) => s.type === "pbs");
    if (!storages.length) return { message: "Aucun stockage Proxmox Backup Server n'est déclaré." };
    const nodes = await call("GET", "/nodes");
    const node = nodes.find((n: any) => n.status === "online")?.node;
    return Promise.all(storages.map(async (s: any) => {
      const [st, content] = await Promise.all([
        call("GET", `/nodes/${node}/storage/${s.storage}/status`).catch(() => null),
        call("GET", `/nodes/${node}/storage/${s.storage}/content`, { content: "backup" }).catch(() => []),
      ]);
      return { nom: s.storage, serveur: s.server, datastore: s.datastore, actif: !!st?.active, utilise: st ? `${bytes(st.used)} / ${bytes(st.total)}` : "injoignable", sauvegardes: content.length };
    }));
  });

  // ── Actions non destructrices ──

  act("migrer_machine", "Migrer une machine", "Déplace une machine vers un autre nœud du cluster. Une VM allumée migre à chaud ; un conteneur allumé redémarre sur le nœud cible.", {
    vmid: z.number().int(),
    cible: z.string().describe("Nom du nœud de destination"),
  }, false, async ({ vmid, cible }) => {
    const g = await locate(call, vmid);
    if (g.node === cible) throw new Error(`${g.name} (${vmid}) est déjà sur ${cible}.`);
    const nodes = await call("GET", "/nodes");
    if (!nodes.some((n: any) => n.node === cible && n.status === "online")) throw new Error(`Le nœud ${cible} n'existe pas ou n'est pas en ligne. Utilise datacenter pour voir les nœuds.`);
    const running = g.status === "running";
    const params = g.type === "qemu" ? { target: cible, online: running ? 1 : 0, "with-local-disks": 1 } : { target: cible, restart: running ? 1 : 0 };
    const upid = await call("POST", `/nodes/${g.node}/${g.type}/${vmid}/migrate`, params);
    return { message: `Migration de ${g.name} (${vmid}) de ${g.node} vers ${cible} lancée.`, target: `${g.name} (${vmid}) -> ${cible}`, upid };
  });

  act("cloner_modele", "Créer une machine depuis un modèle", "Crée une nouvelle machine à partir d'un modèle (template). Seuls les modèles peuvent être clonés par cet outil.", {
    vmid: z.number().int().describe("Identifiant du modèle"),
    nom: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$/).describe("Nom de la nouvelle machine (lettres, chiffres, points et tirets)"),
    nouvel_id: z.number().int().min(100).optional().describe("Identifiant de la nouvelle machine (par défaut : le prochain libre)"),
    complet: z.boolean().optional().describe("Copie complète des disques (par défaut : clone lié, plus rapide)"),
  }, false, async ({ vmid, nom, nouvel_id, complet }) => {
    const g = await locate(call, vmid);
    const conf = await call("GET", `/nodes/${g.node}/${g.type}/${vmid}/config`);
    if (!Number(conf.template)) throw new Error(`${g.name} (${vmid}) n'est pas un modèle. Seuls les modèles peuvent être clonés par Claude.`);
    const newid = nouvel_id ?? Number(await call("GET", "/cluster/nextid"));
    const params = { newid, full: complet ? 1 : 0, ...(g.type === "qemu" ? { name: nom } : { hostname: nom }) };
    const upid = await call("POST", `/nodes/${g.node}/${g.type}/${vmid}/clone`, params);
    return { message: `Création de ${nom} (${newid}) depuis le modèle ${g.name} lancée.`, target: `${g.name} (${vmid}) -> ${nom} (${newid})`, upid };
  });

  act("tag_machine", "Ajouter ou retirer un tag", "Ajoute ou retire un tag sur une machine. Les tags servent à classer et filtrer les machines.", {
    vmid: z.number().int(),
    action: z.enum(["ajouter", "retirer"]),
    tag: z.string().regex(/^[a-z0-9_][a-z0-9_.+-]{0,62}$/i).describe("Le tag, par exemple web ou prod"),
  }, false, async ({ vmid, action, tag }) => {
    const g = await locate(call, vmid);
    const base = `/nodes/${g.node}/${g.type}/${vmid}`;
    const conf = await call("GET", `${base}/config`);
    const tags = String(conf.tags ?? "").split(/[;,\s]+/).filter(Boolean);
    const next = action === "ajouter" ? [...new Set([...tags, tag])] : tags.filter((t) => t !== tag);
    if (next.length === tags.length && next.every((t, i) => t === tags[i])) return { message: `Rien à changer : ${g.name} ${action === "ajouter" ? "a déjà" : "n'a pas"} le tag « ${tag} ».`, target: `${g.name} (${vmid})` };
    await call("PUT", `${base}/config`, next.length ? { tags: next.join(";") } : { delete: "tags" });
    return { message: `Tag « ${tag} » ${action === "ajouter" ? "ajouté à" : "retiré de"} ${g.name} (${vmid}).`, target: `${g.name} (${vmid}) tag ${tag}` };
  });

  return server;
}

function findKey(req: Request): McpKey | null {
  const auth = String(req.headers.authorization ?? "");
  const value = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!value) return null;
  return getConfig().mcpKeys.find((k) => sameHash(value, k.hash)) ?? null;
}

export async function handleMcp(req: Request, res: Response) {
  const cfg = getConfig();
  if (!cfg.modules.mcp) return res.status(404).json({ error: "Module MCP désactivé dans MyProxmox." });
  const key = findKey(req);
  if (!key) return res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Clé MCP invalide ou absente" }, id: null });
  if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Utilise POST" }, id: null });

  // Mise à jour de « dernière utilisation » au plus une fois par minute
  if (!key.lastUsed || Date.now() - Date.parse(key.lastUsed) > 60000) {
    key.lastUsed = new Date().toISOString();
    saveConfig({ mcpKeys: cfg.mcpKeys }).catch(() => {});
  }
  const server = buildServer(key);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
