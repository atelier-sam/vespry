/**
 * `DiscordTransport` du moteur : confie chaque requête à un relais vers
 * l'onglet discord.com et convertit la réponse.
 *
 * - Chrome (offscreen) : relais = `chrome.runtime.sendMessage` vers le
 *   service worker, qui choisit l'onglet (`background/tab-relay.ts`).
 * - Firefox (event page) : relais = appel direct de `relayRestToTab`.
 *
 * Aucune requête vers l'API Discord ne part d'ici : seulement un message.
 */
import {
  isAllowedRequest,
  REST_MESSAGE_KIND,
  RELAY_TIMEOUT_MS,
  TransportError,
  unwrapReply,
  type DiscordTransport,
  type RestRelayMessage,
  type TransportRequest,
  type TransportResponse,
} from './transport';

export type Relay = (req: TransportRequest) => Promise<unknown>;

export class RelayTransport implements DiscordTransport {
  constructor(
    private readonly relay: Relay,
    // Au-dessus des délais du content script et du relais d'onglet : c'est le
    // dernier filet, si le service worker lui-même ne répond plus.
    private readonly timeoutMs = RELAY_TIMEOUT_MS + 5_000,
  ) {}

  async send(req: TransportRequest): Promise<TransportResponse> {
    if (!isAllowedRequest(req)) {
      throw new TransportError('rejected', 'Route hors liste blanche');
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TransportError('timeout', 'Relais sans réponse')),
        this.timeoutMs,
      );
    });
    try {
      const reply = await Promise.race([this.relay(req), timeout]);
      return unwrapReply(reply);
    } catch (e) {
      if (e instanceof TransportError) throw e;
      // `sendMessage` rejette quand aucun récepteur n'existe (service worker
      // en cours de redémarrage) : traité comme « pas d'onglet », reprenable.
      throw new TransportError('no-tab', `Relais indisponible : ${String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Relais Chrome : offscreen → service worker. */
export const runtimeRelay: Relay = (req) => {
  const message: RestRelayMessage = { kind: REST_MESSAGE_KIND, req };
  return chrome.runtime.sendMessage(message);
};
