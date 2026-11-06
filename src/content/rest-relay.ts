/**
 * Relais REST côté content script ISOLATED.
 *
 * Reçoit les requêtes du moteur par `chrome.runtime` (message `vespry-rest`
 * envoyé par `chrome.tabs.sendMessage`) et les passe à l'émetteur du monde
 * MAIN (`rest-bridge.ts`) par un `MessageChannel` privé.
 *
 * Pourquoi un `MessageChannel` et pas `window.postMessage` à chaque requête :
 * les réponses contiennent l'historique des conversations. Diffusées sur
 * `window`, elles seraient lisibles par tout script de la page, et un script
 * MAIN pourrait forger des réponses. Le port n'est transféré qu'une fois, à la
 * poignée de main ; ensuite tout passe par lui.
 */
import { REST_HANDSHAKE_SOURCE } from './rest-bridge-protocol';
import {
  isAllowedRequest,
  isRestRelayReply,
  RELAY_TIMEOUT_MS,
  type RestRelayReply,
  type TransportRequest,
} from '../engine/transport';

/** Attente maximale de la poignée de main avec le monde MAIN. */
const HANDSHAKE_TIMEOUT_MS = 5_000;
const HANDSHAKE_RETRY_MS = 500;
const MAX_CANDIDATES = 100;

interface Pending {
  resolve(reply: RestRelayReply): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RelayEnv {
  /** Fenêtre de la page (postMessage vers le monde MAIN). */
  target: Pick<Window, 'postMessage'>;
  origin: string;
  timeoutMs?: number;
  handshakeTimeoutMs?: number;
}

export class RestPortClient {
  private port: MessagePort | null = null;
  private connecting: Promise<MessagePort | null> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Tentatives de poignée de main encore à l'écoute (jusqu'au premier `ready`). */
  private readonly candidates = new Set<MessagePort>();
  /** Appels de `connect()` en attente du canal. */
  private readonly waiters = new Set<(port: MessagePort | null) => void>();

  constructor(private readonly env: RelayEnv) {}

  /** Ouvre le canal (une fois), en relançant la poignée de main tant que MAIN ne répond pas. */
  connect(): Promise<MessagePort | null> {
    if (this.port) return Promise.resolve(this.port);
    if (!this.connecting) {
      this.connecting = this.handshake().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private handshake(): Promise<MessagePort | null> {
    const limit = this.env.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (port: MessagePort | null): void => {
        if (settled) return;
        settled = true;
        clearInterval(retry);
        clearTimeout(giveUp);
        resolve(port);
      };
      this.waiters.add(finish);
      const attempt = (): void => {
        if (settled || this.port) return;
        const channel = new MessageChannel();
        const local = channel.port1;
        this.candidates.add(local);
        // Sans bridge du tout (extension mise à jour, onglet pas rechargé),
        // chaque requête ajoute des tentatives : on borne, en fermant les
        // plus anciennes (un `ready` légitime arrive en millisecondes).
        while (this.candidates.size > MAX_CANDIDATES) {
          const oldest = this.candidates.values().next().value as MessagePort;
          oldest.close();
          this.candidates.delete(oldest);
        }
        local.onmessage = (ev: MessageEvent) => {
          const data = ev.data as { ready?: unknown } | null;
          if (!data || data.ready !== true) return;
          this.adopt(local);
        };
        this.env.target.postMessage(
          { source: REST_HANDSHAKE_SOURCE },
          this.env.origin,
          [channel.port2],
        );
      };
      const retry = setInterval(attempt, HANDSHAKE_RETRY_MS);
      // Délai dépassé : CETTE requête échoue (`no-tab`), mais les tentatives
      // restent à l'écoute. Le bridge garde la PREMIÈRE poignée de main reçue
      // (cf. rest-bridge, H1) : fermer une tentative acceptée dont le `ready`
      // arrive en retard perdrait le seul canal qu'il acceptera, jusqu'au
      // rechargement de l'onglet (re-relecture Codex, 06/11/2026).
      const giveUp = setTimeout(() => {
        this.waiters.delete(finish);
        finish(null);
      }, limit);
      attempt();
    });
  }

  /** Premier `ready` reçu : ce port devient LE canal, les autres tentatives se ferment. */
  private adopt(local: MessagePort): void {
    if (this.port) {
      if (local !== this.port) local.close();
      return;
    }
    this.port = local;
    local.onmessage = (msg: MessageEvent) => this.onReply(msg.data);
    for (const p of this.candidates) if (p !== local) p.close();
    this.candidates.clear();
    for (const w of this.waiters) w(local);
    this.waiters.clear();
  }

  private onReply(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const { id, reply } = data as { id?: unknown; reply?: unknown };
    if (typeof id !== 'number') return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(isRestRelayReply(reply)
      ? reply
      : { ok: false, failure: 'bridge', message: 'Réponse de la page illisible' });
  }

  /** Transmet une requête au monde MAIN. Ne rejette jamais : toute panne est une réponse. */
  async request(req: TransportRequest): Promise<RestRelayReply> {
    if (!isAllowedRequest(req)) {
      return { ok: false, failure: 'rejected', message: 'Route hors liste blanche' };
    }
    const port = await this.connect();
    if (!port) {
      // Le bridge MAIN ne répond pas (page pas encore prête, extension mise
      // à jour sans rechargement de l'onglet) : cet onglet ne peut pas émettre.
      return { ok: false, failure: 'no-tab', message: 'Onglet Discord sans bridge actif' };
    }
    const id = this.nextId++;
    const timeoutMs = this.env.timeoutMs ?? RELAY_TIMEOUT_MS;
    return new Promise<RestRelayReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Captcha affiché par le client, onglet figé… On ne contourne jamais :
        // le moteur s'arrête (cf. PLAN F7).
        resolve({ ok: false, failure: 'timeout', message: 'La page Discord n\'a pas répondu' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      port.postMessage({ id, req });
    });
  }
}
