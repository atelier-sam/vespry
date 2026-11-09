/**
 * Envoi opt-in d'un rapport de schéma au service Vespry.
 *
 * Strictement minimal — uniquement `{ version, locale, fields[] }`.
 * Pas de jeton, pas de message, pas d'id, pas de stack trace.
 *
 * Stocké dans `chrome.storage.local` (clé `vespry.schemaReport`) :
 *   - `enabled` : opt-in explicite, défaut FALSE.
 *   - `lastSentSig` : signature du dernier rapport envoyé pour éviter
 *     le bombardement (un rapport au plus par exécution avec les MÊMES
 *     champs inconnus).
 *
 * Le moteur tourne dans l'offscreen, qui n'a pas `chrome.storage` : il
 * envoie les champs au service worker (message `schema-report`), qui lit
 * l'opt-in et émet. Avant (essai réel du 06/11/2026), l'appel direct depuis
 * l'offscreen levait à chaque fin d'export et l'opt-in ne pouvait jamais
 * aboutir.
 */
import { getVersion } from '../version';
import { getDetectedUnknowns } from './schema-watch';

const STORAGE_KEY = 'vespry.schemaReport';
export const SCHEMA_REPORT_KIND = 'schema-report' as const;
/** Bornes du message reçu par le service worker (donnée d'un autre contexte). */
const MAX_FIELDS = 200;
const MAX_FIELD_LENGTH = 200;

export interface SchemaReportMessage {
  kind: typeof SCHEMA_REPORT_KIND;
  fields: string[];
}

export function isSchemaReportMessage(m: unknown): m is SchemaReportMessage {
  if (!m || typeof m !== 'object') return false;
  const o = m as { kind?: unknown; fields?: unknown };
  return o.kind === SCHEMA_REPORT_KIND
    && Array.isArray(o.fields)
    && o.fields.length <= MAX_FIELDS
    && o.fields.every((f) => typeof f === 'string' && f.length > 0 && f.length <= MAX_FIELD_LENGTH);
}
interface StoredState {
  enabled: boolean;
  lastSentSig?: string;
}

async function readState(): Promise<StoredState> {
  const all = await chrome.storage.local.get(STORAGE_KEY);
  const s = all[STORAGE_KEY] as StoredState | undefined;
  return s ?? { enabled: false };
}

async function writeState(state: StoredState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** Lit l'état actuel de l'opt-in. Défaut : désactivé. */
export async function isSchemaReportEnabled(): Promise<boolean> {
  return (await readState()).enabled;
}

/** Bascule l'opt-in. Si désactivé, on oublie aussi la dernière signature. */
export async function setSchemaReportEnabled(enabled: boolean): Promise<void> {
  const prev = await readState();
  await writeState(enabled ? { ...prev, enabled: true } : { enabled: false });
}

/** Signature locale = champs triés joints — pour ne pas réémettre la même. */
function localSignature(fields: string[]): string {
  return [...fields].sort().join(',');
}

/**
 * Envoie un rapport si l'opt-in est ON et qu'il y a des champs nouveaux.
 * Idempotent : aucun envoi si rien n'a changé depuis le dernier rapport.
 * Ne lève jamais — un échec réseau est silencieux.
 */
export async function maybeSendSchemaReport(
  apiUrl: string,
  detected: readonly string[] = getDetectedUnknowns(),
): Promise<void> {
  if (!apiUrl) return;
  const fields = [...detected];
  if (fields.length === 0) return;
  try {
    const state = await readState();
    if (!state.enabled) return;
    const sig = localSignature(fields);
    if (state.lastSentSig === sig) return;
    await fetch(`${apiUrl.replace(/\/+$/, '')}/schema-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version: getVersion(),
        locale: (navigator.language || 'en').slice(0, 8),
        fields,
      }),
    });
    await writeState({ ...state, lastSentSig: sig });
  } catch {
    /* stockage ou réseau indisponible — sans gravité, on retentera plus tard */
  }
}
