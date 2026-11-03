// Envoi des notifications vers Discord, ntfy ou un webhook générique.
import type { Channel, Level, Notification } from "../../shared/types";

const RANK: Record<Level, number> = { info: 0, warning: 1, critical: 2 };
const COLOR: Record<Level, number> = { info: 0x2c6aa8, warning: 0xe57000, critical: 0xc62828 };
const NTFY_PRIORITY: Record<Level, string> = { info: "default", warning: "high", critical: "urgent" };

export async function send(channel: Channel, n: Notification) {
  const prefix = n.resolved ? "Résolu : " : "";
  const title = `${prefix}${n.title}`;
  let res: Response;
  if (channel.type === "discord") {
    res = await fetch(channel.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "MyProxmox",
        embeds: [{ title, description: n.message, color: n.resolved ? 0x2f8f3a : COLOR[n.level], timestamp: n.at, footer: { text: `MyProxmox · ${n.level}` } }],
      }),
    });
  } else if (channel.type === "ntfy") {
    res = await fetch(channel.url, {
      method: "POST",
      headers: {
        Title: encodeURIComponent(title).length === title.length ? title : `=?UTF-8?B?${Buffer.from(title).toString("base64")}?=`,
        Priority: n.resolved ? "default" : NTFY_PRIORITY[n.level],
        Tags: n.resolved ? "white_check_mark" : n.level === "critical" ? "rotating_light" : n.level === "warning" ? "warning" : "information_source",
        ...(channel.token ? { Authorization: `Bearer ${channel.token}` } : {}),
      },
      body: n.message,
    });
  } else {
    res = await fetch(channel.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(channel.token ? { Authorization: channel.token } : {}) },
      body: JSON.stringify({ source: "myproxmox", ...n, title }),
    });
  }
  if (!res.ok) throw new Error(`${channel.name} : réponse ${res.status} ${(await res.text()).slice(0, 120)}`);
}

export async function dispatch(channels: Channel[], n: Notification) {
  const targets = channels.filter((c) => c.enabled && RANK[n.level] >= RANK[c.minLevel]);
  const results = await Promise.allSettled(targets.map((c) => send(c, n)));
  for (const r of results) if (r.status === "rejected") console.error("[notifications]", (r.reason as Error).message);
}
