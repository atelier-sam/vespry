/**
 * Export planifié en attente d'un onglet Discord.
 *
 * Les requêtes ne partent plus que de la page discord.com : si l'alarme tire
 * alors qu'aucun onglet n'est ouvert, rien ne peut partir. L'hôte (service
 * worker Chrome, event page Firefox) range alors le planifié sous une clé
 * DISTINCTE de `vespry.scheduled` (la modifier relancerait l'alarme) et le
 * tire à l'ouverture du prochain onglet Discord (`discord-tab-ready`).
 */
export const SCHEDULE_NO_TAB = 'no-discord-tab' as const;
export const SCHEDULE_PENDING_KEY = 'vespry.scheduled.pending' as const;

export interface PendingScheduled {
  guildId: string;
  guildName: string;
  /** Heure du tir manqué (ms epoch). */
  since: number;
}

type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

export function isPendingScheduled(v: unknown): v is PendingScheduled {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.guildId === 'string' && typeof o.guildName === 'string'
    && typeof o.since === 'number';
}

export async function markPending(storage: Storage, p: PendingScheduled): Promise<void> {
  await storage.set({ [SCHEDULE_PENDING_KEY]: p });
}

/** Lit et retire l'attente (un seul tir par attente). */
export async function takePending(storage: Storage): Promise<PendingScheduled | null> {
  const got = await storage.get(SCHEDULE_PENDING_KEY);
  const v: unknown = got[SCHEDULE_PENDING_KEY];
  if (!isPendingScheduled(v)) return null;
  await storage.remove(SCHEDULE_PENDING_KEY);
  return v;
}
