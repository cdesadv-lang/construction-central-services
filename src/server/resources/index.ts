import { notFound } from "@/lib/errors";
import { coreResources } from "./core";
import { partyResources } from "./parties";
import { treasuryResources } from "./treasury";
import { opsResources } from "./ops";
import type { ResourceDef } from "./engine";

export const RESOURCES: Record<string, ResourceDef> = { ...coreResources, ...partyResources, ...treasuryResources, ...opsResources };

export function getDef(name: string) {
  const def = RESOURCES[name];
  if (!def) throw notFound(`Unknown resource ${name}`);
  return def;
}
