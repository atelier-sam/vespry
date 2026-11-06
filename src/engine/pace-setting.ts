/**
 * Réglage « Rythme » persisté (`chrome.storage.local`).
 *
 * L'offscreen n'a pas `chrome.storage` : il demande la valeur au service
 * worker par le message `get-pace` au démarrage, et reçoit les changements
 * par la commande `set-pace`. Défaut : `discreet`.
 */
import type { PaceMode } from './pacer';

export const PACE_STORAGE_KEY = 'vespry.pace' as const;
export const GET_PACE_KIND = 'get-pace' as const;

export function isPaceMode(v: unknown): v is PaceMode {
  return v === 'discreet' || v === 'normal';
}

export function isGetPace(m: unknown): boolean {
  return typeof m === 'object' && m !== null && (m as { kind?: unknown }).kind === GET_PACE_KIND;
}

/** Lit le rythme enregistré ; toute valeur absente ou inconnue → `discreet`. */
export async function readPace(
  storage: Pick<chrome.storage.StorageArea, 'get'>,
): Promise<PaceMode> {
  const got = await storage.get(PACE_STORAGE_KEY);
  const v: unknown = got[PACE_STORAGE_KEY];
  return isPaceMode(v) ? v : 'discreet';
}
