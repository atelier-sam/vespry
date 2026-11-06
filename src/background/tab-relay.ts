/**
 * Relais REST moteur → onglet discord.com.
 *
 * Utilisé par le service worker Chrome (le moteur vit dans l'offscreen, qui
 * n'a pas `chrome.tabs`) et appelé directement par l'event page Firefox (qui
 * héberge le moteur et a `chrome.tabs`).
 *
 * Sans état (PLAN F4) : le service worker peut être tué à tout moment, donc
 * on interroge les onglets à chaque requête. Ordre d'essai : l'onglet actif,
 * puis les autres du plus récent au plus ancien. Un onglet qui ne répond pas
 * (pas de content script, bridge absent) cède la place au suivant ; un
 * onglet qui a REÇU la requête et l'a perdue (timeout) arrête tout — la
 * requête est peut-être partie, on ne la double pas sur un autre onglet.
 */
import {
  isRestRelayReply,
  REST_MESSAGE_KIND,
  RELAY_TIMEOUT_MS,
  type RestRelayMessage,
  type RestRelayReply,
  type TransportRequest,
} from '../engine/transport';

export const DISCORD_TAB_PATTERNS = ['https://discord.com/*', 'https://*.discord.com/*'];

export interface RelayTab {
  id?: number | undefined;
  active?: boolean | undefined;
  discarded?: boolean | undefined;
  lastAccessed?: number | undefined;
}

export interface TabApi {
  queryDiscordTabs(): Promise<RelayTab[]>;
  sendToTab(tabId: number, message: RestRelayMessage): Promise<unknown>;
}

export const chromeTabApi: TabApi = {
  queryDiscordTabs: () => chrome.tabs.query({ url: DISCORD_TAB_PATTERNS }),
  sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
};

/** Ordre d'essai : actif d'abord, puis le plus récemment consulté. */
export function orderTabs(tabs: RelayTab[]): number[] {
  return tabs
    .filter((t): t is RelayTab & { id: number } => typeof t.id === 'number' && !t.discarded)
    .sort((a, b) => {
      if (!!a.active !== !!b.active) return a.active ? -1 : 1;
      return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    })
    .map((t) => t.id);
}

const TIMED_OUT = Symbol('timed-out');

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/**
 * Relaie une requête au premier onglet Discord capable de l'émettre.
 * Ne rejette jamais : toute panne est une `RestRelayReply` d'échec.
 */
export async function relayRestToTab(
  api: TabApi,
  req: TransportRequest,
  // Légèrement au-dessus du délai du content script, pour qu'il réponde le premier.
  timeoutMs = RELAY_TIMEOUT_MS + 2_000,
): Promise<RestRelayReply> {
  let tabs: RelayTab[];
  try {
    tabs = await api.queryDiscordTabs();
  } catch (e) {
    return { ok: false, failure: 'bridge', message: `Onglets illisibles : ${String(e)}` };
  }
  const message: RestRelayMessage = { kind: REST_MESSAGE_KIND, req };
  for (const tabId of orderTabs(tabs)) {
    let reply: unknown;
    try {
      reply = await withTimeout(api.sendToTab(tabId, message), timeoutMs);
    } catch {
      continue; // pas de content script dans cet onglet : suivant
    }
    if (reply === TIMED_OUT) {
      return { ok: false, failure: 'timeout', message: 'L\'onglet Discord n\'a pas répondu' };
    }
    if (!isRestRelayReply(reply)) {
      continue; // content script d'une ancienne version : suivant
    }
    // Bridge absent dans cet onglet (rien n'est parti) : on essaie le suivant.
    if (!reply.ok && reply.failure === 'no-tab') continue;
    return reply;
  }
  return { ok: false, failure: 'no-tab', message: 'Aucun onglet Discord ouvert' };
}
