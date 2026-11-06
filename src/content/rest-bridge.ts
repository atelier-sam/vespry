/**
 * Émetteur REST dans la page discord.com — monde MAIN.
 *
 * C'est le SEUL endroit de Vespry d'où partent les requêtes vers l'API
 * Discord. Le moteur (offscreen / background Firefox) lui confie chaque
 * requête par le relais (SW → content script ISOLATED → ici), et elle part
 * comme une requête du client Discord lui-même :
 *
 *  1. Voie « client » : le module REST interne du client web (trouvé dans le
 *     registre webpack, méthode utilisée par Vencord). Mêmes en-têtes, même
 *     version d'API, mêmes cookies, même gestion interne que le client.
 *  2. Voie « fetch » (repli si le module est introuvable) : `fetch` même-origine
 *     sur `/api/v9`, cookies inclus, avec les en-têtes RECOPIÉS des requêtes que
 *     le client a lui-même émises (jamais d'en-tête inventé). Si le client n'a
 *     encore rien émis, on attend ; au-delà de 20 s → `no-client-headers`.
 *
 * Canal avec le content script : `MessageChannel` privé, ouvert par une poignée
 * de main unique. Les réponses (le contenu des messages) ne sont donc pas
 * diffusées à tous les écouteurs `message` de la page à chaque requête.
 *
 * Chaque requête est revérifiée contre la liste blanche (`transport.ts`)
 * avant émission : ce module n'émet rien d'autre que de la lecture
 * d'historique et la suppression de ses propres messages.
 */
import {
  isAllowedRequest,
  type RestRelayReply,
  type TransportRequest,
  type TransportResponse,
} from '../engine/transport';
import { REST_HANDSHAKE_SOURCE } from './rest-bridge-protocol';

/** En-têtes du client recopiés pour la voie « fetch ». */
const CAPTURED_HEADERS = [
  'authorization',
  'x-super-properties',
  'x-discord-locale',
  'x-discord-timezone',
  'x-debug-options',
] as const;
type CapturedName = (typeof CAPTURED_HEADERS)[number];
const CAPTURED_SET: ReadonlySet<string> = new Set(CAPTURED_HEADERS);

const captured = new Map<CapturedName, string>();

/** Appelé par les patchs fetch/XHR du bridge pour chaque en-tête vu. */
export function observeClientHeader(name: string, value: string): void {
  const key = name.toLowerCase();
  if (!CAPTURED_SET.has(key) || !value) return;
  captured.set(key as CapturedName, value);
}

/** Diagnostic automatisé (cf. scripts/bridge-test.mjs). */
interface RestDebug {
  __vespryRestVia?: 'client' | 'fetch';
  __vespryRestCount?: number;
  __vespryHeadersSeen?: string;
}
const dbg = window as unknown as RestDebug;

// --- Voie 1 : module REST du client ---

/** Forme minimale du module REST interne du client Discord. */
interface ClientRest {
  get(opts: ClientRestOptions): Promise<unknown>;
  del(opts: ClientRestOptions): Promise<unknown>;
}
interface ClientRestOptions {
  url: string;
  query?: Record<string, string>;
  oldFormErrors?: boolean;
}

interface WebpackRequire {
  c?: Record<string, { exports?: unknown } | undefined>;
}

function looksLikeRest(v: unknown): v is ClientRest & { put: unknown; patch: unknown } {
  if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false;
  const o = v as Record<string, unknown>;
  return typeof o.get === 'function' && typeof o.del === 'function'
    && typeof o.put === 'function' && typeof o.patch === 'function';
}

let cachedRest: ClientRest | null = null;

/** Cherche le module REST dans le cache webpack du client. Null si absent. */
function findClientRest(): ClientRest | null {
  if (cachedRest) return cachedRest;
  const chunks = (window as unknown as { webpackChunkdiscord_app?: unknown }).webpackChunkdiscord_app;
  if (!Array.isArray(chunks)) return null;
  let req: WebpackRequire | null = null;
  try {
    chunks.push([[Symbol('vespry')], {}, (r: WebpackRequire) => { req = r; }]);
    chunks.pop();
  } catch {
    return null;
  }
  const cache = (req as WebpackRequire | null)?.c;
  if (!cache) return null;
  for (const mod of Object.values(cache)) {
    const exp = mod?.exports;
    if (!exp || typeof exp !== 'object') continue;
    if (looksLikeRest(exp)) return (cachedRest = exp);
    for (const value of Object.values(exp as Record<string, unknown>)) {
      if (looksLikeRest(value)) return (cachedRest = value);
    }
  }
  return null;
}

function splitPath(path: string): { url: string; query: Record<string, string> } {
  const [url = path, qs = ''] = path.split('?', 2);
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  return { url, query };
}

function retryAfterFrom(body: unknown): number | undefined {
  if (body && typeof body === 'object' && 'retry_after' in body) {
    const n = (body as { retry_after: unknown }).retry_after;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Réponse ou rejet du module client → réponse normalisée, ou null si illisible. */
function normalizeClient(value: unknown, fallbackStatus: number): TransportResponse | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as { status?: unknown; body?: unknown; text?: unknown };
  const status = typeof o.status === 'number' ? o.status : fallbackStatus;
  if (typeof o.status !== 'number' && fallbackStatus !== 200) return null;
  let body: unknown = o.body ?? null;
  let nonJson = false;
  if (typeof body === 'string') {
    const raw = body;
    try {
      body = JSON.parse(raw);
    } catch {
      nonJson = raw.length > 0;
      body = null;
    }
  }
  const out: TransportResponse = { status, body, nonJson, via: 'client' };
  const ra = retryAfterFrom(body);
  if (ra !== undefined) out.retryAfterSec = ra;
  return out;
}

async function sendViaClient(rest: ClientRest, req: TransportRequest): Promise<TransportResponse | null> {
  const opts: ClientRestOptions = { ...splitPath(req.path), oldFormErrors: true };
  try {
    const res = await (req.method === 'GET' ? rest.get(opts) : rest.del(opts));
    return normalizeClient(res, 200) ?? { status: 204, body: null, nonJson: false, via: 'client' };
  } catch (err) {
    // Le client rejette avec un objet réponse ({ status, body }) sur 4xx/5xx.
    const r = normalizeClient(err, 0);
    if (r) return r;
    // Rejet sans statut : forme du module changée ou panne réseau. On oublie
    // le module (il sera recherché à nouveau) et on laisse le repli décider.
    cachedRest = null;
    return null;
  }
}

// --- Voie 2 : fetch même-origine avec les en-têtes du client ---

const HEADERS_WAIT_MS = 20_000;
const HEADERS_POLL_MS = 250;

async function waitForClientHeaders(): Promise<boolean> {
  const deadline = Date.now() + HEADERS_WAIT_MS;
  while (Date.now() < deadline) {
    if (captured.has('authorization') && captured.has('x-super-properties')) return true;
    await new Promise<void>((r) => setTimeout(r, HEADERS_POLL_MS));
  }
  return false;
}

async function sendViaFetch(
  nativeFetch: typeof fetch,
  req: TransportRequest,
): Promise<RestRelayReply> {
  if (!(await waitForClientHeaders())) {
    return {
      ok: false,
      failure: 'no-client-headers',
      message: 'Le client Discord n\'a encore émis aucune requête à imiter',
    };
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of captured) headers[k] = v;
  let res: Response;
  try {
    res = await nativeFetch.call(window, `/api/v9${req.path}`, {
      method: req.method,
      headers,
      credentials: 'include',
    });
  } catch (e) {
    return { ok: false, failure: 'bridge', message: `Réseau : ${String(e)}` };
  }
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  let nonJson = false;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      nonJson = true;
    }
  }
  const out: TransportResponse = { status: res.status, body, nonJson, via: 'fetch' };
  const ra = retryAfterFrom(body) ?? Number(res.headers.get('retry-after') ?? NaN);
  if (Number.isFinite(ra)) out.retryAfterSec = ra;
  return { ok: true, res: out };
}

/** Émet une requête autorisée par la meilleure voie disponible. */
export async function executeRest(nativeFetch: typeof fetch, raw: unknown): Promise<RestRelayReply> {
  if (!raw || typeof raw !== 'object' || !isAllowedRequest(raw as { method?: unknown; path?: unknown })) {
    return { ok: false, failure: 'rejected', message: 'Route hors liste blanche' };
  }
  const req = raw as TransportRequest;
  dbg.__vespryRestCount = (dbg.__vespryRestCount ?? 0) + 1;
  dbg.__vespryHeadersSeen = [...captured.keys()].join(',');
  try {
    const rest = findClientRest();
    if (rest) {
      const res = await sendViaClient(rest, req);
      if (res) {
        dbg.__vespryRestVia = 'client';
        return { ok: true, res };
      }
    }
    dbg.__vespryRestVia = 'fetch';
    return await sendViaFetch(nativeFetch, req);
  } catch (e) {
    return { ok: false, failure: 'bridge', message: String(e) };
  }
}

// --- Canal privé avec le content script ---

interface PortRequest {
  id: number;
  req: unknown;
}

function isPortRequest(v: unknown): v is PortRequest {
  return !!v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'number';
}

/**
 * Écoute la poignée de main du content script. La dernière reçue gagne : après
 * une mise à jour de l'extension, le nouveau content script rouvre un canal.
 */
export function installRestServer(nativeFetch: typeof fetch): void {
  let active: MessagePort | null = null;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { source?: unknown } | null;
    if (!data || data.source !== REST_HANDSHAKE_SOURCE) return;
    const port = event.ports[0];
    if (!port) return;
    active?.close();
    active = port;
    port.onmessage = (msg: MessageEvent) => {
      if (!isPortRequest(msg.data)) return;
      const { id, req } = msg.data;
      void executeRest(nativeFetch, req).then((reply) => {
        port.postMessage({ id, reply });
      });
    };
    port.postMessage({ ready: true });
  });
}
