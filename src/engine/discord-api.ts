/**
 * Client API Discord — `engine/discord-api.ts`.
 *
 * Dérivé de `discord-service.ts` de Discrub Classic (MIT), réécrit en module
 * autonome (sans Redux), typé strict.
 *
 * Depuis la 1.0 « export discret », ce client n'émet plus rien lui-même : chaque
 * requête passe par le `Pacer` (une seule en vol, délais aléatoires, pauses)
 * puis par un `DiscordTransport` qui la fait partir de l'onglet discord.com,
 * via le client Discord (cf. `transport.ts`, `content/rest-bridge.ts`).
 *
 * Politique d'erreurs — ARRÊT NET plutôt que relance en rafale :
 * - 401 → `auth` ; 403 « accès manquant » (50001/50013) → `forbidden` (salon
 *   ignoré) ; autre 403, captcha, délai de relais dépassé → `refused` ;
 * - 429 court (≤ 60 s, < 3 d'affilée) → attente + ralentissement durable,
 *   sinon `rate-limited` ;
 * - réponse d'erreur non-JSON (page Cloudflare) → `blocked` ;
 * - aucun onglet Discord → `no-tab` (reprise automatique possible).
 * Les erreurs d'arrêt (`isStopError`) ne doivent JAMAIS être avalées par un
 * appelant : elles mettent le run en pause.
 */
import { recordEvent } from '../diagnostics';
import type { Pacer, RequestKind } from './pacer';
import { TransportError, type DiscordTransport, type TransportResponse } from './transport';
import {
  DiscordApiError,
  isLatchingStop,
  isStopError,
  type RawChannel,
  type RawEmoji,
  type RawGuild,
  type RawMessage,
  type RawUser,
  type Snowflake,
  type ThreadSearchResponse,
} from './types';

/** Page de la recherche de fils du client Discord (`limit` de `THREAD_SEARCH`). */
export const THREAD_SEARCH_PAGE = 25;

/** 429 consécutifs tolérés sur une même requête avant l'arrêt. */
const MAX_CONSECUTIVE_429 = 2;
/** Au-delà de cette attente demandée par Discord, on s'arrête. */
const MAX_RETRY_AFTER_SEC = 60;
/** Marge aléatoire ajoutée au `retry_after` (ms). */
const RETRY_JITTER: readonly [number, number] = [2_000, 5_000];
/** Codes Discord « accès manquant » : salon inaccessible, pas un refus du compte. */
const MISSING_ACCESS_CODES: ReadonlySet<number> = new Set([50001, 50013]);

export interface DiscordApiOptions {
  transport: DiscordTransport;
  pacer: Pacer;
  /** Appelé quand le verrou d'arrêt se pose (pour diffuser l'état aux vues). */
  onHalt?: (e: DiscordApiError) => void;
}

function bodyCode(body: unknown): number | null {
  if (body && typeof body === 'object' && 'code' in body) {
    const c = (body as { code: unknown }).code;
    return typeof c === 'number' ? c : null;
  }
  return null;
}

function isCaptcha(body: unknown): boolean {
  return !!body && typeof body === 'object'
    && ('captcha_key' in body || 'captcha_sitekey' in body);
}

/** Traduit une panne de transport en erreur d'API typée. */
function fromTransport(e: TransportError, path: string): DiscordApiError {
  switch (e.failure) {
    case 'no-tab':
      return new DiscordApiError('no-tab', 0, 'Aucun onglet Discord ouvert');
    case 'no-client-headers':
      return new DiscordApiError('no-client', 0, 'Client Discord pas encore prêt dans l\'onglet');
    case 'timeout':
      return new DiscordApiError('refused', 0, `Discord n'a pas répondu (captcha ou onglet figé) : ${path}`);
    case 'wrong-account':
      // Traité comme une session perdue : le message d'arrêt dit de se
      // reconnecter (au bon compte) puis de reprendre.
      return new DiscordApiError('auth', 0, 'L\'onglet Discord est connecté à un autre compte que celui de la tâche');
    default:
      return new DiscordApiError('unknown', 0, `Relais : ${e.message}`);
  }
}

export class DiscordApi {
  private readonly transport: DiscordTransport;
  private readonly pacer: Pacer;
  /**
   * Verrou d'arrêt (relecture Codex H3/H4, 06/11/2026). Le premier refus de
   * Discord (`isLatchingStop`) le pose ; ensuite TOUTE requête, quelle que
   * soit la tâche qui l'émet, échoue avec la même erreur SANS partir. Sans
   * lui, un refus arrêtait la tâche qui l'avait reçu, mais la file passait
   * au run suivant, une purge parallèle continuait, et un appelant qui avale
   * l'erreur (pré-comptage, découverte des fils) relançait la suivante.
   * Levé seulement par `clearHalt()`, sur un geste explicite de l'utilisateur.
   */
  private halt: DiscordApiError | null = null;
  /** Compte auquel toutes les requêtes sont liées, cf. `bindUser`. */
  private boundUser: string | null = null;

  private readonly onHalt: ((e: DiscordApiError) => void) | undefined;

  constructor(opts: DiscordApiOptions) {
    this.transport = opts.transport;
    this.pacer = opts.pacer;
    this.onHalt = opts.onHalt;
  }

  /**
   * Lie le client à un compte : chaque requête suivante porte `asUser`, et la
   * page refuse d'émettre si sa session est celle d'un autre compte.
   */
  bindUser(userId: string): void {
    this.boundUser = userId;
  }

  /** Raison du verrou d'arrêt en cours, ou null. */
  get haltedBy(): DiscordApiError | null {
    return this.halt;
  }

  /** Lève le verrou. Réservé aux gestes explicites de l'utilisateur. */
  clearHalt(): void {
    this.halt = null;
  }

  private haltError(): DiscordApiError {
    const h = this.halt as DiscordApiError;
    return new DiscordApiError(h.kind, h.status, `Arrêt en cours (${h.kind}) : ${h.message}`);
  }

  /**
   * `tolerate404` — résout avec `null` au lieu de lever `not_found` (DELETE
   * d'un message déjà supprimé = succès idempotent).
   */
  private async request<T>(
    path: string,
    opts: { method?: 'GET' | 'DELETE'; kind: RequestKind; tolerate404?: boolean },
  ): Promise<T | null> {
    const { method = 'GET', kind, tolerate404 = false } = opts;
    try {
      return await this.requestOnce<T>(path, method, kind, tolerate404);
    } catch (e) {
      if (isLatchingStop(e) && !this.halt) {
        this.halt = e;
        recordEvent('warn', `Stop latched (${e.kind}): ${e.message}`);
        this.onHalt?.(e);
      }
      throw e;
    }
  }

  private async requestOnce<T>(
    path: string,
    method: 'GET' | 'DELETE',
    kind: RequestKind,
    tolerate404: boolean,
  ): Promise<T | null> {
    let consecutive429 = 0;
    for (;;) {
      if (this.halt) throw this.haltError();
      let res: TransportResponse;
      try {
        res = await this.pacer.run(kind, () => {
          // Vérifié au moment d'émettre, pas seulement à l'entrée : une
          // requête déjà en file derrière celle qui a été refusée ne part pas.
          if (this.halt) throw this.haltError();
          return this.transport.send(
            this.boundUser ? { method, path, asUser: this.boundUser } : { method, path },
          );
        });
      } catch (e) {
        if (e instanceof DiscordApiError) throw e;
        if (e instanceof TransportError) throw fromTransport(e, path);
        throw new DiscordApiError('network', 0, `Échec réseau : ${String(e)}`);
      }

      const { status, body } = res;
      if (status >= 200 && status < 300) {
        return (status === 204 ? null : (body as T)) ?? null;
      }
      if (res.nonJson && status >= 400) {
        throw new DiscordApiError('blocked', status, `Réponse non-JSON ${status} sur ${path} (protection anti-robot)`);
      }
      if (isCaptcha(body)) {
        throw new DiscordApiError('refused', status, `Discord demande un captcha : ${path}`);
      }
      if (status === 429) {
        consecutive429 += 1;
        const wait = res.retryAfterSec ?? 5;
        if (consecutive429 > MAX_CONSECUTIVE_429 || wait > MAX_RETRY_AFTER_SEC) {
          throw new DiscordApiError('rate-limited', 429, `Limite de débit Discord (${wait} s) sur ${path}`);
        }
        this.pacer.noteRateLimited();
        recordEvent('warn', `429 on ${path}, waiting ${wait} s then slowing down`);
        this.pacer.blockFor(wait * 1000 + this.pacer.pick(RETRY_JITTER));
        continue;
      }
      if (status === 401) {
        throw new DiscordApiError('auth', 401, 'Session Discord expirée ou invalide');
      }
      if (status === 403) {
        const code = bodyCode(body);
        if (code !== null && MISSING_ACCESS_CODES.has(code)) {
          throw new DiscordApiError('forbidden', 403, `Accès refusé : ${path}`);
        }
        throw new DiscordApiError('refused', 403, `Discord a refusé la requête (code ${code ?? '?'}) : ${path}`);
      }
      if (status === 404) {
        if (tolerate404) return null;
        throw new DiscordApiError('not_found', 404, `Ressource introuvable : ${path}`);
      }
      throw new DiscordApiError('unknown', status, `Erreur HTTP ${status} sur ${path}`);
    }
  }

  /**
   * Surcharge interne : appelle `request()` en GET classique et garantit un
   * résultat non-null. Tous les appelants historiques (getGuilds, getMessages,
   * etc.) passent par ici — pas de cast `as T` côté chacun d'eux.
   */
  private async get<T>(path: string, kind: RequestKind = 'read'): Promise<T> {
    const r = await this.request<T>(path, { method: 'GET', kind });
    // Un GET réussi a toujours un corps JSON — un null serait un bug du
    // relais, pas un cas légitime.
    if (r === null) {
      throw new DiscordApiError('unknown', 0, `Réponse vide inattendue : ${path}`);
    }
    return r;
  }

  /** Compte connecté (GET /users/@me). */
  getCurrentUser(): Promise<RawUser> {
    return this.get<RawUser>('/users/@me');
  }

  /** Serveurs du compte (GET /users/@me/guilds). */
  getGuilds(): Promise<RawGuild[]> {
    return this.get<RawGuild[]>('/users/@me/guilds');
  }

  /** Salons d'un serveur (GET /guilds/{id}/channels). */
  getGuildChannels(guildId: Snowflake): Promise<RawChannel[]> {
    return this.get<RawChannel[]>(`/guilds/${guildId}/channels`);
  }

  /** Un salon précis (GET /channels/{id}). */
  getChannel(channelId: Snowflake): Promise<RawChannel> {
    return this.get<RawChannel>(`/channels/${channelId}`);
  }

  /** Conversations privées et group DM (GET /users/@me/channels). */
  getDmChannels(): Promise<RawChannel[]> {
    return this.get<RawChannel[]>('/users/@me/channels');
  }

  /**
   * Un lot de 100 messages d'un salon, du plus récent au plus ancien.
   * `before` = id du plus ancien message déjà récupéré (curseur de pagination).
   */
  getMessages(channelId: Snowflake, before?: Snowflake): Promise<RawMessage[]> {
    // Ordre des paramètres du client (`before` puis `limit`, observé sur ses
    // propres requêtes le 06/11/2026). La taille de page reste 100 : le
    // client lit par 10 puis 20, mais 5× plus de requêtes serait un autre
    // signal (cf. preuves-prod de la session export discret).
    const cursor = before ? `before=${before}&` : '';
    return this.get<RawMessage[]>(
      `/channels/${channelId}/messages?${cursor}limit=100`,
    );
  }

  /**
   * Nombre estimé de messages dans un salon — sert au pré-comptage pour la
   * barre de progression fluide. Discord renvoie `total_results` plafonné
   * à 8000 (limite de son index Elasticsearch).
   *
   * `maxId` / `minId` (optionnels) bornent la recherche temporellement —
   * utilisés par le pré-comptage en dichotomie quand le compte global
   * est plafonné (cf. `preCount` dans export-runner.ts).
   *
   * Renvoie `null` si l'appel échoue (perms manquantes, salon vide,
   * erreur réseau) — l'appelant retombe sur l'ancien calcul par salons.
   */
  async searchMessageCount(
    guildId: Snowflake,
    channelId: Snowflake,
    maxId?: Snowflake,
    minId?: Snowflake,
  ): Promise<number | null> {
    try {
      const params = [`channel_id=${channelId}`, 'limit=1'];
      if (maxId) params.push(`max_id=${maxId}`);
      if (minId) params.push(`min_id=${minId}`);
      const res = await this.get<{ total_results?: number }>(
        `/guilds/${guildId}/messages/search?${params.join('&')}`,
        'search',
      );
      const n = res.total_results;
      return typeof n === 'number' && n >= 0 ? n : null;
    } catch (e) {
      // Un arrêt net (refus, blocage, plus d'onglet) n'est pas « non-fatal » :
      // il doit remonter et mettre le run en pause.
      if (isStopError(e)) throw e;
      // 403 (pas la permission de chercher), 404 (salon inaccessible),
      // 429 (rate-limit excédé) — tous non-fatals pour l'export lui-même.
      // Traçé pour qu'un utilisateur dont l'estimation foire en masse puisse
      // ouvrir un rapport éclairant.
      recordEvent('warn', `searchMessageCount(${channelId}) failed: ${String(e)}`);
      return null;
    }
  }

  /**
   * Variante DM : l'API search guild n'existe pas pour les DMs. Discord
   * expose `/channels/{id}/messages/search?limit=1` qui marche aussi pour
   * les channels DM/group. Supporte aussi `max_id`/`min_id` pour la
   * dichotomie en cas de plafonnement à 8000.
   */
  async searchDmMessageCount(
    channelId: Snowflake,
    maxId?: Snowflake,
    minId?: Snowflake,
  ): Promise<number | null> {
    try {
      const params = ['limit=1'];
      if (maxId) params.push(`max_id=${maxId}`);
      if (minId) params.push(`min_id=${minId}`);
      const res = await this.get<{ total_results?: number }>(
        `/channels/${channelId}/messages/search?${params.join('&')}`,
        'search',
      );
      const n = res.total_results;
      return typeof n === 'number' && n >= 0 ? n : null;
    } catch (e) {
      if (isStopError(e)) throw e;
      // Même logique que searchMessageCount — non-fatal, mais on trace pour
      // pouvoir investiguer si l'estimation foire systématiquement sur les DMs.
      recordEvent('warn', `searchDmMessageCount(${channelId}) failed: ${String(e)}`);
      return null;
    }
  }

  /**
   * Une page de fils archivés (et de posts de forum) d'un salon.
   *
   * Requête IDENTIQUE à celle du navigateur de fils du client Discord
   * (`THREAD_SEARCH`, mêmes paramètres dans le même ordre, page de 25, lus
   * dans son code le 06/11/2026). Le client n'appelle JAMAIS
   * `/guilds/{id}/threads/active` (sa table de routes ne le contient pas : il
   * reçoit les fils actifs par la passerelle) ni `threads/archived/*`. Les
   * appeler depuis un compte utilisateur était une signature, et la réponse
   * de Discord à `threads/active` posait le verrou d'arrêt dès le premier
   * export (essai réel du 06/11/2026).
   */
  async searchArchivedThreads(
    channelId: Snowflake,
    offset: number,
  ): Promise<{ threads: RawChannel[]; hasMore: boolean }> {
    const res = await this.get<ThreadSearchResponse>(
      `/channels/${channelId}/threads/search?archived=true&sort_by=last_message_time`
        + `&sort_order=desc&limit=${THREAD_SEARCH_PAGE}&offset=${offset}`,
    );
    return { threads: res?.threads ?? [], hasMore: res?.has_more === true };
  }

  /**
   * Tous les utilisateurs ayant réagi à un message avec un emoji donné.
   *
   * L'`emojiParam` de l'URL diffère selon la nature de l'emoji :
   * - unicode  → le `name` brut (ex. `👍`), URL-encodé ;
   * - custom   → `name:id` (ex. `vespry:123456789`), URL-encodé.
   *
   * Discord distingue deux familles de réactions : normales (`type=0`) et
   * « super-réactions » burst (`type=1`). On interroge les DEUX, puis on
   * fusionne en dédupliquant par `user.id` — un même utilisateur peut figurer
   * dans les deux familles.
   *
   * Chaque famille est paginée par lots de 100 via le curseur `after`.
   */
  async getReactions(
    channelId: Snowflake,
    messageId: Snowflake,
    emoji: RawEmoji,
  ): Promise<RawUser[]> {
    // Emoji custom : `name:id`. Emoji unicode : `name` seul. Sans l'un ni
    // l'autre, l'emoji n'est pas adressable — on renvoie une liste vide.
    let emojiKey: string;
    if (emoji.id) {
      if (!emoji.name) return [];
      emojiKey = `${emoji.name}:${emoji.id}`;
    } else if (emoji.name) {
      emojiKey = emoji.name;
    } else {
      return [];
    }
    const emojiParam = encodeURIComponent(emojiKey);
    const basePath = `/channels/${channelId}/messages/${messageId}/reactions/${emojiParam}`;

    const byId = new Map<Snowflake, RawUser>();
    // type 0 = réactions normales, type 1 = super-réactions « burst ».
    for (const type of [0, 1] as const) {
      let after: Snowflake | undefined;
      for (;;) {
        const cursor = after ? `&after=${after}` : '';
        const page = await this.get<RawUser[]>(
          `${basePath}?limit=100&type=${type}${cursor}`,
        );
        for (const user of page) {
          if (!byId.has(user.id)) byId.set(user.id, user);
        }
        // Page incomplète → plus rien à paginer pour cette famille.
        if (page.length < 100) break;
        after = page[page.length - 1]?.id;
        if (!after) break;
      }
    }
    return [...byId.values()];
  }

  /**
   * Supprime un message Discord (`DELETE /channels/{}/messages/{}`).
   *
   * Discord renvoie un 204 No Content en cas de succès. La méthode résout
   * sans valeur — appel impératif uniquement.
   *
   * Gestion d'erreurs :
   * - **204** → succès, on résout.
   * - **404** → le message n'existe plus (déjà supprimé par l'utilisateur,
   *   par un modérateur, par Vespry lui-même dans une exécution précédente).
   *   On considère ça comme un **succès idempotent** : l'effet désiré est
   *   atteint. On log un avertissement console, on ne lève pas.
   * - **403** → permission refusée (ce n'est pas notre message et on n'est
   *   pas modérateur du salon). Lève `DiscordApiError('forbidden')` —
   *   l'appelant peut décider d'ignorer ou de remonter à l'utilisateur.
   * - **401** → session expirée. Lève `DiscordApiError('auth')`.
   * - **429** → politique commune de `request()` (attente courte ou arrêt).
   *
   * On ne supporte PAS `bulk-delete` (POST /messages/bulk-delete) :
   * l'API exige des messages de moins de 14 jours, 2 à 100 par lot — trop
   * spécifique pour gagner. On supprime un par un, au rythme du `Pacer`
   * (type `delete` : 3-6 s en mode discret).
   */
  async deleteMessage(
    channelId: Snowflake,
    messageId: Snowflake,
  ): Promise<void> {
    const path = `/channels/${channelId}/messages/${messageId}`;
    const result = await this.request<null>(path, {
      method: 'DELETE',
      kind: 'delete',
      // 404 = idempotence : un message déjà supprimé est un succès (y compris
      // quand un relais a expiré alors que le DELETE était déjà parti).
      tolerate404: true,
    });
    // `result === null` est le seul cas attendu (204 ou 404 toléré).
    // On le signale uniquement quand c'est un 404 — pas moyen de le savoir
    // ici sans changer la signature de `request()`. On log au niveau
    // appelant si besoin (la PurgeQueue saura distinguer).
    void result;
  }

  /**
   * Télécharge un média depuis le CDN Discord. Pas d'en-tête `authorization` :
   * l'URL CDN est elle-même signée. Renvoie le Blob, ou null sur échec.
   */
  async downloadAsset(url: string): Promise<Blob | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // 403 / 404 sur lien CDN signé typiquement = URL expirée (~24 h).
        // L'asset reste marqué `failed` dans le store, on note la raison.
        recordEvent('warn', `downloadAsset ${res.status} ${res.statusText} ${url.slice(0, 80)}`);
        return null;
      }
      return await res.blob();
    } catch (e) {
      // Erreur réseau / CSP / lien malformé — l'export continue mais l'asset
      // manquera dans le zip. Sam doit voir ces lignes dans le rapport.
      recordEvent('warn', `downloadAsset failed: ${String(e)} on ${url.slice(0, 80)}`);
      return null;
    }
  }
}
