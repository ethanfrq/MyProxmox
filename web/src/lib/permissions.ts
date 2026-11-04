// Droits Proxmox de la personne connectée, lus une fois par session avec GET /access/permissions.
// Sert à masquer ou griser les actions qu'elle n'a pas le droit de faire.
import { cloneElement, createElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { pve } from "./api";

type PermMap = Record<string, Record<string, number>>;

let cache: Promise<PermMap> | null = null;
let value: PermMap | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Promise<PermMap> {
  if (!cache) {
    cache = pve.get<PermMap>("/access/permissions")
      .then((m) => (value = m ?? {}))
      .catch(() => (value = null)) // en cas d'échec, l'interface laisse faire : Proxmox refusera
      .then(() => {
        loaded = true;
        listeners.forEach((l) => l());
        return value as PermMap;
      });
  }
  return cache;
}

/** À appeler à la déconnexion pour ne pas garder les droits de la personne précédente. */
export function resetPermissions() {
  cache = null;
  value = null;
  loaded = false;
}

/** Chemins parents d'un chemin d'ACL : /vms/101 → /vms/101, /vms, / */
function parents(path: string) {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push("/" + parts.slice(0, i).join("/"));
  out.push("/");
  return out;
}

/** Vrai si la carte de droits donne `privilege` sur `path` (ou sur un parent). */
export function hasPermission(map: PermMap | null, path: string, privilege: string | string[]) {
  if (!map) return true;
  const wanted = Array.isArray(privilege) ? privilege : [privilege];
  for (const p of parents(path)) {
    const privs = map[p];
    if (privs) return wanted.some((w) => !!privs[w]);
  }
  return false;
}

/** Droits complets (null tant que ce n'est pas chargé). */
export function usePermissions() {
  const [map, setMap] = useState<PermMap | null>(value);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    const update = () => {
      setMap(value);
      setReady(true);
    };
    listeners.add(update);
    load().then(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return { map, ready };
}

/**
 * Indique si la personne connectée a le droit `privilege` sur `path`.
 * Pendant le chargement, `allowed` vaut false et `loading` true.
 */
export function usePermission(path: string, privilege: string | string[]) {
  const { map, ready } = usePermissions();
  return { allowed: ready && hasPermission(map, path, privilege), loading: !ready };
}

/** Libellé lisible d'un ou plusieurs privilèges, pour les info-bulles. */
const privLabel = (p: string | string[]) => (Array.isArray(p) ? p.join(" ou ") : p);

/**
 * Affiche son enfant seulement si le droit est présent.
 * mode="disable" (par défaut) : le bouton reste visible mais grisé, avec une info-bulle.
 * mode="hide" : rien n'est affiché.
 */
export function Can({ path, privilege, mode = "disable", children }: { path: string; privilege: string | string[]; mode?: "hide" | "disable"; children: ReactNode }) {
  const { allowed, loading } = usePermission(path, privilege);
  if (allowed) return children as ReactElement;
  if (mode === "hide" || loading) return mode === "hide" ? null : disable(children, "Vérification des droits…");
  return disable(children, `Il te manque le droit ${privLabel(privilege)} sur ${path}`);
}

function disable(children: ReactNode, title: string) {
  if (!isValidElement(children)) return createElement("span", { title }, children);
  const el = cloneElement(children as ReactElement<{ disabled?: boolean }>, { disabled: true });
  return createElement("span", { title, className: "can-off" }, el);
}
