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
  userIdFromToken,
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

/**
 * `indeterminate` : le module a été APPELÉ puis a rejeté sans statut (forme
 * changée, panne réseau). La requête est peut-être partie : on ne la rejoue
 * PAS par le repli fetch (relecture Codex M2, 06/11/2026 : un DELETE ou une
 * lecture pouvait partir deux fois). Le moteur reçoit une panne et décide.
 */
async function sendViaClient(
  rest: ClientRest,
  req: TransportRequest,
): Promise<TransportResponse | 'indeterminate'> {
  const opts: ClientRestOptions = { ...splitPath(req.path), oldFormErrors: true };
  try {
    const res = await (req.method === 'GET' ? rest.get(opts) : rest.del(opts));
    return normalizeClient(res, 200) ?? { status: 204, body: null, nonJson: false, via: 'client' };
  } catch (err) {
    // Le client rejette avec un objet réponse ({ status, body }) sur 4xx/5xx.
    const r = normalizeClient(err, 0);
    if (r) return r;
    // On oublie le module : la requête SUIVANTE le cherchera à nouveau, ou
    // passera par le repli s'il a disparu.
    cachedRest = null;
    return 'indeterminate';
  }
}

// --- Voie 2 : fetch même-origine avec les en-têtes du client ---

const HEADERS_WAIT_MS = 20_000;
const HEADERS_POLL_MS = 250;

async function waitForHeaders(names: readonly CapturedName[]): Promise<boolean> {
  const deadline = Date.now() + HEADERS_WAIT_MS;
  while (Date.now() < deadline) {
    if (names.every((n) => captured.has(n))) return true;
    await new Promise<void>((r) => setTimeout(r, HEADERS_POLL_MS));
  }
  return false;
}

const waitForClientHeaders = (): Promise<boolean> =>
  waitForHeaders(['authorization', 'x-super-properties']);

/**
 * Compte lié (relecture Codex H5) : la session de la page doit être celle du
 * compte attendu. Le compte se lit dans l'en-tête `authorization` que le
 * client envoie lui-même.
 *
 * Deux temps, et c'est voulu :
 *  - `waitForAccount` (asynchrone) attend que le client ait émis un en-tête ;
 *  - `accountRefusal` (SYNCHRONE) compare juste avant l'émission, sur la
 *    valeur même qui part, sans aucun `await` entre la comparaison et l'envoi.
 * La re-relecture Codex a montré qu'un contrôle fait AVANT une autre attente
 * laissait passer un changement de compte survenu pendant cette attente.
 *
 * Un jeton de forme inconnue ne permet pas de savoir qui est connecté : rien
 * ne part (`wrong-account`, qui devient un arrêt expliqué côté moteur). Si
 * Discord change un jour ce format, Vespry s'arrête net au lieu de risquer
 * d'émettre sous le mauvais compte.
 */
async function waitForAccount(req: TransportRequest): Promise<RestRelayReply | null> {
  if (req.asUser === undefined) return null;
  if (await waitForHeaders(['authorization'])) return null;
  return {
    ok: false,
    failure: 'no-client-headers',
    message: 'Compte de la page inconnu : le client Discord n\'a encore rien émis',
  };
}

function accountRefusal(req: TransportRequest, authorization: string | undefined): RestRelayReply | null {
  if (req.asUser === undefined) return null;
  const id = userIdFromToken(authorization);
  if (id === null) {
    return { ok: false, failure: 'wrong-account', message: 'Compte de la page illisible : rien n\'est émis' };
  }
  if (id !== req.asUser) {
    return { ok: false, failure: 'wrong-account', message: 'Onglet connecté à un autre compte' };
  }
  return null;
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
  // Contrôle sur l'en-tête qui part réellement, sans attente avant l'envoi.
  const refused = accountRefusal(req, headers.authorization);
  if (refused) return refused;
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
    const unknown = await waitForAccount(req);
    if (unknown) return unknown;
    // Le repli fetch ne sert QUE si le module est introuvable AVANT l'appel.
    const rest = findClientRest();
    if (rest) {
      // Synchrone jusqu'à l'appel du module (cf. accountRefusal).
      const refused = accountRefusal(req, captured.get('authorization'));
      if (refused) return refused;
      const res = await sendViaClient(rest, req);
      dbg.__vespryRestVia = 'client';
      if (res === 'indeterminate') {
        return {
          ok: false,
          failure: 'bridge',
          message: 'Module REST du client : rejet sans statut, envoi incertain (pas de nouvel essai)',
        };
      }
      return { ok: true, res };
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

// Primitives du navigateur figées au chargement du module (relecture Codex,
// re-relecture H1). Ce module est évalué à `document_start`, avant tout
// script de la page. Un script hostile chargé ensuite peut remplacer
// `Event.prototype.stopImmediatePropagation`, le getter `MessageEvent#data`
// ou `MessagePort#postMessage` : chacune de ces méthodes reçoit en `this`
// l'événement de la poignée de main ou le port lui-même, donc lui livrerait
// le canal. On appelle les originaux. Le repli sur la méthode de l'objet ne
// sert qu'aux objets non natifs (doublures de test, événement fabriqué par
// la page avec ses propres champs, qui ne transporte que SON port).
type Getter<T> = (this: unknown) => T;
function nativeGetter<T>(proto: object | undefined, name: string): Getter<T> | null {
  if (!proto) return null;
  const d = Object.getOwnPropertyDescriptor(proto, name);
  return typeof d?.get === 'function' ? (d.get as Getter<T>) : null;
}
const NATIVE = {
  stopImmediate: typeof Event !== 'undefined' ? Event.prototype.stopImmediatePropagation : null,
  data: nativeGetter<unknown>(typeof MessageEvent !== 'undefined' ? MessageEvent.prototype : undefined, 'data'),
  ports: nativeGetter<readonly MessagePort[]>(typeof MessageEvent !== 'undefined' ? MessageEvent.prototype : undefined, 'ports'),
  source: nativeGetter<unknown>(typeof MessageEvent !== 'undefined' ? MessageEvent.prototype : undefined, 'source'),
  post: typeof MessagePort !== 'undefined' ? MessagePort.prototype.postMessage : null,
  onmessage: typeof MessagePort !== 'undefined'
    ? (Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')?.set ?? null)
    : null,
};

function readField<T>(native: Getter<T> | null, obj: object, key: string): T {
  if (native) {
    try {
      return Reflect.apply(native, obj, []);
    } catch {
      // objet non natif : on lit son champ
    }
  }
  return (obj as Record<string, T>)[key] as T;
}

function stopEvent(event: Event): void {
  if (NATIVE.stopImmediate) {
    try {
      Reflect.apply(NATIVE.stopImmediate, event, []);
      return;
    } catch {
      // objet non natif
    }
  }
  event.stopImmediatePropagation();
}

function postTo(port: MessagePort, msg: unknown): void {
  if (NATIVE.post) {
    try {
      Reflect.apply(NATIVE.post, port, [msg]);
      return;
    } catch {
      // objet non natif
    }
  }
  port.postMessage(msg);
}

function listenOn(port: MessagePort, handler: (ev: MessageEvent) => void): void {
  if (NATIVE.onmessage) {
    try {
      Reflect.apply(NATIVE.onmessage, port, [handler]);
      return;
    } catch {
      // objet non natif
    }
  }
  port.onmessage = handler;
}

async function serve(port: MessagePort, nativeFetch: typeof fetch, id: number, req: unknown): Promise<void> {
  const reply = await executeRest(nativeFetch, req);
  postTo(port, { id, reply });
}

/**
 * Écoute la poignée de main du content script. La PREMIÈRE acceptée gagne,
 * pour toute la vie de la page (relecture Codex H1, 06/11/2026).
 *
 * Modèle de menace. Ce script tourne dans le monde MAIN, comme les scripts de
 * Discord. Il ne peut pas authentifier son interlocuteur : un script hostile
 * dans la page détient déjà le jeton et les cookies, il n'a pas besoin de
 * Vespry pour émettre. Ce qu'il ne doit PAS pouvoir faire, c'est détourner le
 * canal (lire les requêtes du moteur, forger ses réponses). D'où :
 *  - l'écoute en phase de CAPTURE, posée à `document_start` avant tout script
 *    de la page : on voit la poignée de main en premier ;
 *  - `stopImmediatePropagation()` sur TOUTE poignée de main, acceptée ou
 *    non : aucun écouteur posé après nous ne reçoit un port ;
 *  - première acceptée = définitive : une poignée de main postée ensuite par
 *    la page ne remplace pas le canal du moteur. L'ancienne règle (« la
 *    dernière gagne ») laissait n'importe quel script s'y substituer.
 *  - les primitives du navigateur touchées par ce chemin sont figées au
 *    chargement (cf. `NATIVE`) : les remplacer après coup ne livre pas le port.
 * Limite assumée : un script qui contrôle la page peut de toute façon
 * réécrire le module REST du client Discord ou `Response#text`, donc fausser
 * ce que Discord montre, à Vespry comme à l'utilisateur. Ce qu'on garantit,
 * c'est qu'il ne prend pas le canal du moteur.
 * Coût assumé : après une mise à jour de l'extension, l'onglet Discord doit
 * être rechargé (Chrome ne réinjecte rien de toute façon ; un navigateur qui
 * réinjecterait verrait l'ancien bridge garder la main). Le moteur reçoit
 * alors `no-tab` et le dit ; mieux qu'un canal qu'un script peut détourner.
 */
export function installRestServer(nativeFetch: typeof fetch): void {
  let active: MessagePort | null = null;
  window.addEventListener('message', (event: MessageEvent) => {
    if (readField(NATIVE.source, event, 'source') !== window) return;
    const data = readField<unknown>(NATIVE.data, event, 'data') as { source?: unknown } | null;
    if (!data || typeof data !== 'object' || data.source !== REST_HANDSHAKE_SOURCE) return;
    // Toute poignée de main s'arrête ici, acceptée ou non : un script de la
    // page ne doit jamais recevoir un port destiné au bridge.
    stopEvent(event);
    if (active) return;
    const port = readField<readonly MessagePort[]>(NATIVE.ports, event, 'ports')[0];
    if (!port) return;
    active = port;
    listenOn(port, (msg: MessageEvent) => {
      const body = readField<unknown>(NATIVE.data, msg, 'data');
      if (!isPortRequest(body)) return;
      void serve(port, nativeFetch, body.id, body.req);
    });
    postTo(port, { ready: true });
  }, true);
}
