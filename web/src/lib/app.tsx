// Contexte global : personne connectée, réglages, alertes et notifications en direct.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { DEMO } from "./env";
import type { Alert, Me, Notification, PublicSettings } from "../../../shared/types";

interface AppState {
  me: Me;
  settings: PublicSettings | null;
  reloadSettings: () => Promise<void>;
  alerts: (Alert & { since?: string })[];
  notifications: Notification[];
  reloadNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => useContext(Ctx)!;

export function AppProvider({ me, children, onNotification }: { me: Me; children: ReactNode; onNotification?: (n: Notification) => void }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [alerts, setAlerts] = useState<AppState["alerts"]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notify = useRef(onNotification);
  notify.current = onNotification;

  const reloadSettings = useCallback(async () => setSettings(await api<PublicSettings>("/api/settings")), []);
  const reloadNotifications = useCallback(async () => setNotifications(await api<Notification[]>("/api/notifications")), []);
  const reloadAlerts = useCallback(async () => setAlerts((await api("/api/alerts")).alerts), []);
  const markAllRead = useCallback(async () => {
    await api("/api/notifications/read", { method: "POST", body: { ids: "all" } });
    setNotifications((l) => l.map((n) => ({ ...n, read: true })));
  }, []);

  useEffect(() => {
    reloadSettings().catch(() => {});
    reloadNotifications().catch(() => {});
    reloadAlerts().catch(() => {});
    const id = setInterval(() => {
      reloadAlerts().catch(() => {});
      reloadNotifications().catch(() => {});
    }, 60000);
    if (DEMO) return () => clearInterval(id);
    // Événements en direct envoyés par le serveur
    const es = new EventSource("/api/events");
    es.addEventListener("notification", (e) => {
      const n = JSON.parse((e as MessageEvent).data) as Notification;
      setNotifications((l) => [n, ...l]);
      notify.current?.(n);
    });
    es.addEventListener("alerts", (e) => setAlerts(JSON.parse((e as MessageEvent).data)));
    return () => {
      clearInterval(id);
      es.close();
    };
  }, [reloadSettings, reloadNotifications, reloadAlerts]);

  return <Ctx.Provider value={{ me, settings, reloadSettings, alerts, notifications, reloadNotifications, markAllRead }}>{children}</Ctx.Provider>;
}

/** Notification système du navigateur (si l'utilisateur l'a autorisée). */
export function browserNotify(n: Notification) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (localStorage.getItem("myproxmox-browser-notif") === "off") return;
    if (n.level === "info" && !n.resolved) return;
    new Notification(`${n.resolved ? "Résolu : " : ""}${n.title}`, { body: n.message, icon: "/favicon.svg", tag: n.key ?? n.id });
  } catch {
    /* navigateur sans prise en charge */
  }
}
