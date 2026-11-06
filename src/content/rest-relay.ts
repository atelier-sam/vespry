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
      let done = false;
      // Toutes les tentatives restent à l'écoute jusqu'au premier `ready` :
      // le bridge garde la PREMIÈRE poignée de main reçue (cf. rest-bridge,
      // H1) ; fermer une tentative avant sa réponse perdrait le seul canal
      // qu'il acceptera.
      const tries: MessagePort[] = [];
      const attempt = (): void => {
        if (done) return;
        const channel = new MessageChannel();
        const local = channel.port1;
        tries.push(local);
        local.onmessage = (ev: MessageEvent) => {
          const data = ev.data as { ready?: unknown } | null;
          if (done || !data || data.ready !== true) return;
          done = true;
          clearInterval(retry);
          clearTimeout(giveUp);
          for (const p of tries) if (p !== local) p.close();
          local.onmessage = (msg: MessageEvent) => this.onReply(msg.data);
          this.port = local;
          resolve(local);
        };
        this.env.target.postMessage(
          { source: REST_HANDSHAKE_SOURCE },
          this.env.origin,
          [channel.port2],
        );
      };
      const retry = setInterval(attempt, HANDSHAKE_RETRY_MS);
      const giveUp = setTimeout(() => {
        if (done) return;
        done = true;
        clearInterval(retry);
        for (const p of tries) p.close();
        resolve(null);
      }, limit);
      attempt();
    });
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
