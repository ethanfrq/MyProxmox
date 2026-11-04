// Dispositions nommées de l'écran de monitoring (mode « mur »), dans data/monitoring-layouts.json.
import { readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, DEMO } from "./config";
import { normalizeLayout, type MonLayout } from "../../shared/layouts";

const FILE = () => path.join(DATA_DIR, "monitoring-layouts.json");
let cache: Record<string, MonLayout> | null = null;

export function getLayouts(): Record<string, MonLayout> {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(FILE(), "utf8"));
    } catch {
      // Démo : une disposition « salon » prête à essayer (?layout=salon)
      cache = DEMO ? { salon: normalizeLayout("salon", { widgets: [
        { id: "kpis", w: 12, h: 1 }, { id: "guests", w: 8, h: 3 }, { id: "alerts", w: 4, h: 2 }, { id: "activity", w: 4, h: 1 },
        { id: "storage", w: 6, h: 2 }, { id: "net-history", w: 6, h: 2 },
      ] }) } : {};
    }
  }
  return cache!;
}

async function write() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(`${FILE()}.tmp`, JSON.stringify(cache, null, 2));
  await fs.rename(`${FILE()}.tmp`, FILE());
}

export async function saveLayout(name: string, body: unknown) {
  const layout = normalizeLayout(name, body);
  getLayouts()[layout.name] = layout;
  await write();
  return layout;
}

export async function deleteLayout(name: string) {
  delete getLayouts()[name];
  await write();
}
