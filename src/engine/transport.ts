/**
 * Transport des requêtes REST Discord — contrat entre le moteur et l'endroit
 * d'où partent réellement les requêtes.
 *
 * Pourquoi un contrat. Depuis mars 2026, Discord sanctionne les comptes dont
 * l'historique est aspiré par des requêtes qui ne ressemblent pas à celles de
 * son client (origine `chrome-extension://`, sans cookies, sans les en-têtes
 * du client web). Le moteur (offscreen / background Firefox) ne doit donc plus
 * émettre lui-même : il confie chaque requête à l'onglet discord.com, où le
 * bridge MAIN la fait passer par le client Discord (cf. `content/rest-bridge.ts`).
 *
 * Ce module est PUR (aucun `chrome.*`) : il définit les types échangés sur le
 * fil, leur validation, et la liste blanche des routes autorisées. La même
 * liste blanche est appliquée des deux côtés (moteur et bridge) — une seule
 * source, importée par les deux.
 */

/** Verbes autorisés : lecture de l'historique et suppression de ses messages. */
export type TransportMethod = 'GET' | 'DELETE';

/** Requête REST, chemin SANS préfixe de version (`/channels/…`). */
export interface TransportRequest {
  method: TransportMethod;
  /** Chemin + query string, ex. `/channels/1/messages?limit=100`. */
  path: string;
  /**
   * Compte attendu (id utilisateur). La page refuse d'émettre si sa session
   * est celle d'un autre compte : un export ou une purge ne change jamais de
   * compte en cours de route (relecture Codex H5, 06/11/2026). Absent pour
   * la toute première requête (`/users/@me`), qui sert à le connaître.
   */
  asUser?: string;
}

/** Réponse normalisée, quel que soit le chemin réellement emprunté. */
export interface TransportResponse {
  status: number;
  /** Corps JSON décodé, ou null (204, corps vide, corps non-JSON). */
  body: unknown;
  /** `true` si le corps existait mais n'était pas du JSON (page Cloudflare…). */
  nonJson: boolean;
  /** `retry_after` en secondes, lu dans le corps ou l'en-tête, si présent. */
  retryAfterSec?: number;
  /** Voie empruntée côté page — diagnostic uniquement. */
  via?: 'client' | 'fetch';
}

/**
 * Pannes du transport lui-même (aucune réponse HTTP exploitable).
 * - `no-tab` : aucun onglet discord.com prêt à émettre ;
 * - `timeout` : la page n'a pas répondu à temps (captcha affiché, onglet figé) ;
 * - `no-client-headers` : le client Discord n'a encore émis aucune requête
 *   dont on puisse reprendre les en-têtes, et son module REST est introuvable ;
 * - `rejected` : la route n'est pas dans la liste blanche ;
 * - `bridge` : erreur inattendue côté page ;
 * - `wrong-account` : l'onglet est connecté à un autre compte.
 */
export type TransportFailure =
  | 'no-tab'
  | 'timeout'
  | 'no-client-headers'
  | 'rejected'
  | 'bridge'
  /** La session de l'onglet est celle d'un autre compte que `asUser` (rien n'est parti). */
  | 'wrong-account';

export class TransportError extends Error {
  constructor(
    public readonly failure: TransportFailure,
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

/** Le seul point d'émission du moteur. Une méthode, toute la politique derrière. */
export interface DiscordTransport {
  send(req: TransportRequest): Promise<TransportResponse>;
}

const SNOWFLAKE = '\\d{1,25}';

/**
 * Liste blanche des routes. Toute requête hors liste est refusée AVANT
 * émission, des deux côtés du fil. Ajouter une route = l'ajouter ici, nulle
 * part ailleurs.
 */
const ALLOWED: ReadonlyArray<{ method: TransportMethod; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/users\/@me$/ },
  { method: 'GET', pattern: /^\/users\/@me\/guilds$/ },
  { method: 'GET', pattern: /^\/users\/@me\/channels$/ },
  { method: 'GET', pattern: new RegExp(`^/guilds/${SNOWFLAKE}/channels$`) },
  { method: 'GET', pattern: new RegExp(`^/guilds/${SNOWFLAKE}/threads/active$`) },
  { method: 'GET', pattern: new RegExp(`^/guilds/${SNOWFLAKE}/messages/search$`) },
  { method: 'GET', pattern: new RegExp(`^/channels/${SNOWFLAKE}$`) },
  { method: 'GET', pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages$`) },
  { method: 'GET', pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages/search$`) },
  { method: 'GET', pattern: new RegExp(`^/channels/${SNOWFLAKE}/threads/archived/(public|private)$`) },
  {
    method: 'GET',
    // Segment emoji = sortie d'`encodeURIComponent` (cf. `getReactions`) :
    // caractères non réservés ou `%XX`, jamais de point (les noms d'emoji
    // custom sont alphanumériques). L'ancien `[^/?#]+` laissait passer `\`
    // et `%2e%2e`, que l'analyseur d'URL normalise en remontée de chemin
    // (relecture Codex H2, 06/11/2026).
    pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages/${SNOWFLAKE}/reactions/(?:[A-Za-z0-9_\\-!~*'()]|%[0-9A-Fa-f]{2})+$`),
  },
  { method: 'DELETE', pattern: new RegExp(`^/channels/${SNOWFLAKE}/messages/${SNOWFLAKE}$`) },
];

/** Vrai si la requête est autorisée (méthode + chemin hors query string). */
export function isAllowedRequest(
  req: { method?: unknown; path?: unknown; asUser?: unknown },
): req is TransportRequest {
  if (req.method !== 'GET' && req.method !== 'DELETE') return false;
  if (req.asUser !== undefined && (typeof req.asUser !== 'string' || !/^\d{1,25}$/.test(req.asUser))) {
    return false;
  }
  if (typeof req.path !== 'string' || req.path.length > 2048) return false;
  if (!req.path.startsWith('/')) return false;
  const pathOnly = req.path.split('?')[0] ?? '';
  // Pas de remontée de répertoire ni de double slash : le chemin doit rester
  // une route API, jamais une URL arbitraire.
  if (pathOnly.includes('..') || pathOnly.includes('//')) return false;
  // Un chemin n'est accepté que s'il ressort IDENTIQUE de l'analyseur d'URL
  // (celui qu'emploient fetch et le module REST du client). Ce qu'il
  // normaliserait (`\`, `%2e`, `%2f`, `%5c`, fragment) pourrait sortir de la
  // route vérifiée : refus, des deux côtés du fil.
  if (/[\\#]/.test(req.path) || /%(?:2e|2f|5c)/i.test(pathOnly)) return false;
  if (!isCanonicalPath(pathOnly)) return false;
  return ALLOWED.some((r) => r.method === req.method && r.pattern.test(pathOnly));
}

// Préfixe neutre : la garde `no-direct-api.test.ts` interdit l'URL de l'API
// hors de rest-bridge.ts, et la normalisation ne dépend pas du préfixe.
const CANON_PREFIX = '/r';

function isCanonicalPath(pathOnly: string): boolean {
  try {
    return new URL(CANON_PREFIX + pathOnly, 'https://canon.invalid').pathname === CANON_PREFIX + pathOnly;
  } catch {
    return false;
  }
}

/** Validation d'une réponse reçue du fil (données venues d'un autre contexte). */
export function isTransportResponse(v: unknown): v is TransportResponse {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.status === 'number'
    && Number.isInteger(r.status)
    && typeof r.nonJson === 'boolean'
    && (r.retryAfterSec === undefined || typeof r.retryAfterSec === 'number')
  );
}

/**
 * Vrai si un `sendMessage` a échoué FAUTE DE DESTINATAIRE (« Could not
 * establish connection. Receiving end does not exist. », Chrome et Firefox) :
 * le message n'a été remis à personne, rien n'est parti. Toute autre rupture
 * (port fermé avant la réponse, onglet qui navigue, service worker tué) peut
 * survenir APRÈS la remise : la requête est peut-être partie, on ne la
 * rejoue pas (relecture Codex M1, 06/11/2026).
 */
export function isNoReceiverError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Receiving end does not exist|Could not establish connection/i.test(msg);
}

/**
 * Id utilisateur porté par un jeton de session Discord : le premier segment
 * est l'id en base64 (sans remplissage, parfois en base64url). `null` si le
 * jeton n'a pas cette forme.
 */
export function userIdFromToken(token: string | undefined): string | null {
  if (!token) return null;
  const head = token.replace(/^Bearer\s+/i, '').split('.')[0] ?? '';
  if (!/^[A-Za-z0-9+/_-]{4,64}$/.test(head)) return null;
  const b64 = head.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const id = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return /^\d{5,25}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

// --- Messages échangés sur le fil (moteur → SW/background → onglet) ---

export const REST_MESSAGE_KIND = 'vespry-rest' as const;

export interface RestRelayMessage {
  kind: typeof REST_MESSAGE_KIND;
  req: TransportRequest;
}

export type RestRelayReply =
  | { ok: true; res: TransportResponse }
  | { ok: false; failure: TransportFailure; message: string };

export function isRestRelayMessage(m: unknown): m is RestRelayMessage {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return o.kind === REST_MESSAGE_KIND && !!o.req && typeof o.req === 'object'
    && isAllowedRequest(o.req as Record<string, unknown>);
}

const FAILURES: ReadonlySet<string> = new Set([
  'no-tab', 'timeout', 'no-client-headers', 'rejected', 'bridge', 'wrong-account',
]);

export function isRestRelayReply(v: unknown): v is RestRelayReply {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (o.ok === true) return isTransportResponse(o.res);
  return o.ok === false && typeof o.failure === 'string' && FAILURES.has(o.failure)
    && typeof o.message === 'string';
}

/** Convertit une réponse du fil en résultat ou en `TransportError`. */
export function unwrapReply(reply: unknown): TransportResponse {
  if (!isRestRelayReply(reply)) {
    throw new TransportError('bridge', 'Réponse du relais illisible');
  }
  if (!reply.ok) throw new TransportError(reply.failure, reply.message);
  return reply.res;
}

/** Délai max d'une requête relayée (captcha, onglet figé…). */
export const RELAY_TIMEOUT_MS = 30_000;
