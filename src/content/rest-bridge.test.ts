/**
 * Émetteur REST du monde MAIN, testé sans navigateur : `window` est une
 * doublure, le registre webpack du client Discord est simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestRelayReply } from '../engine/transport';
import { REST_HANDSHAKE_SOURCE } from './rest-bridge-protocol';

type Bridge = typeof import('./rest-bridge');

interface FakeWin {
  webpackChunkdiscord_app?: unknown[];
  addEventListener: (type: string, cb: (e: MessageEvent) => void) => void;
  [k: string]: unknown;
}

/** Fabrique de module factice : son code source porte (ou non) la marque du module HTTP. */
const MARKED = function marked() { return 'if(t.oldFormErrors&&a?.body?.code===50035){}'; };
const UNMARKED = function unmarked() { return 'rien'; };

interface FakeRuntime { exportsList: unknown[]; marked?: boolean }

/**
 * Registre webpack factice : `push` appelle le 3e élément avec le `require`
 * de CHAQUE runtime, dans l'ordre, comme les runtimes chaînés de Discord.
 */
function webpackRuntimes(runtimes: FakeRuntime[]): unknown[] {
  const reqs = runtimes.map(({ exportsList, marked = true }) => {
    const c: Record<string, { exports: unknown }> = {};
    const m: Record<string, unknown> = {};
    exportsList.forEach((exp, i) => {
      c[String(i)] = { exports: exp };
      m[String(i)] = marked ? MARKED : UNMARKED;
    });
    return { c, m };
  });
  const arr: unknown[] = [];
  arr.push = (...items: unknown[]): number => {
    for (const item of items) {
      const cb = (item as unknown[])[2];
      if (typeof cb === 'function') for (const r of reqs) (cb as (r: unknown) => void)(r);
    }
    return arr.length;
  };
  return arr;
}

/** Un seul runtime, modules marqués. */
function webpackWith(exportsList: unknown[]): unknown[] {
  return webpackRuntimes([{ exportsList }]);
}

/** Module HTTP factice à la forme du vrai (`Bo` du client, 06/11/2026). */
function restModule(over: Partial<Record<'get' | 'post' | 'put' | 'patch' | 'del', unknown>> = {}) {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over };
}

let win: FakeWin;
let bridge: Bridge;

beforeEach(async () => {
  vi.resetModules();
  win = { addEventListener: () => {} };
  vi.stubGlobal('window', win);
  bridge = await import('./rest-bridge');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const neverFetch = vi.fn(async () => { throw new Error('fetch ne doit pas être appelé'); });

describe('rest-bridge — liste blanche', () => {
  it('refuse un POST et une route hors liste, sans rien émettre', async () => {
    const f = vi.fn();
    for (const req of [
      { method: 'POST', path: '/channels/1/messages' },
      { method: 'GET', path: '/users/@me/billing' },
      { method: 'GET', path: '/channels/1/../../users/@me' },
      { method: 'DELETE', path: '/guilds/1' },
      'pas un objet',
    ]) {
      const r = await bridge.executeRest(f as unknown as typeof fetch, req);
      expect(r).toMatchObject({ ok: false, failure: 'rejected' });
    }
    expect(f).not.toHaveBeenCalled();
  });
});

describe('rest-bridge — voie 1 : module REST du client', () => {
  it('passe par le module du client (query séparée, version laissée au client)', async () => {
    const get = vi.fn(async () => ({ status: 200, body: [{ id: '9' }] }));
    const rest = { get, del: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn() };
    win.webpackChunkdiscord_app = webpackWith([{ other: 1 }, { Z: rest }]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'GET', path: '/channels/11/messages?limit=100&before=5',
    });
    expect(r).toEqual({ ok: true, res: { status: 200, body: [{ id: '9' }], nonJson: false, via: 'client' } });
    expect(get).toHaveBeenCalledWith({ url: '/channels/11/messages', query: { limit: '100', before: '5' }, oldFormErrors: true });
    expect(win.__vespryRestVia).toBe('client');
  });

  it('rejet du client avec statut (429) → réponse normalisée avec retry_after', async () => {
    const get = vi.fn(async () => { throw { status: 429, body: { retry_after: 3.5 } }; });
    win.webpackChunkdiscord_app = webpackWith([restModule({ get })]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { status: 429, retryAfterSec: 3.5, via: 'client' } });
  });

  it('DELETE passe par `del` (le module rend { ok, status: 204 })', async () => {
    const del = vi.fn(async () => ({ ok: true, status: 204, body: null }));
    win.webpackChunkdiscord_app = webpackWith([restModule({ del })]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2',
    });
    expect(del).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, res: { status: 204 } });
  });

  // Essai réel du 06/11/2026 : l'ancienne règle rendait un « 204 vide » pour
  // toute résolution qui n'était pas un objet. Une lecture ratée passait pour
  // un salon sans message.
  it('résolution qui n\'est pas un objet → panne bridge, jamais un succès vide, jamais rejouée', async () => {
    const get = vi.fn(async () => 'une chaîne de traduction');
    win.webpackChunkdiscord_app = webpackWith([restModule({ get })]);
    const f = vi.fn();
    const r = await bridge.executeRest(f as unknown as typeof fetch, { method: 'GET', path: '/channels/1/messages' });
    expect(r).toMatchObject({ ok: false, failure: 'bridge' });
    expect(get).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
  });
});

// Essai réel du 06/11/2026 sur la page Discord : 4 runtimes webpack sur le
// même tableau, le module HTTP dans le premier, un runtime annexe de 102
// modules en dernier ; 92 proxys de traduction qui rendent une fonction pour
// n'importe quelle clé.
describe('rest-bridge — identification du module HTTP du client', () => {
  function headersSeen(): void {
    bridge.observeClientHeader('authorization', 't');
    bridge.observeClientHeader('x-super-properties', 's');
  }
  const okFetch = () => vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
  /** Le premier repli paie l'attente unique du module (10 s) : horloge simulée. */
  async function execAfterWait(f: unknown, req: unknown): Promise<RestRelayReply> {
    vi.useFakeTimers();
    const p = bridge.executeRest(f as typeof fetch, req);
    await vi.advanceTimersByTimeAsync(10_500);
    return p;
  }

  it('module dans le PREMIER runtime, runtime annexe en dernier → voie client', async () => {
    const get = vi.fn(async () => ({ ok: true, status: 200, body: { id: '1' } }));
    win.webpackChunkdiscord_app = webpackRuntimes([
      { exportsList: [{ other: 1 }, { Bo: restModule({ get }) }] },
      { exportsList: [] },
      { exportsList: [{ annexe: true }] },
    ]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { status: 200, via: 'client' } });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('proxy de traduction (une fonction pour toute clé) → jamais appelé, repli fetch', async () => {
    const touched: string[] = [];
    const proxyCall = vi.fn(() => 'texte');
    const i18n = new Proxy({}, {
      get: (_t, k) => { touched.push(String(k)); return proxyCall; },
    });
    win.webpackChunkdiscord_app = webpackWith([{ default: i18n }]);
    headersSeen();
    const f = okFetch();
    const r = await execAfterWait(f, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { via: 'fetch' } });
    expect(proxyCall).not.toHaveBeenCalled();
    // Aucune clé lue sur le proxy : on ne laisse pas de trace dans le cache de traduction.
    expect(touched).toEqual([]);
  });

  it('bonne forme mais module sans la marque oldFormErrors → repli fetch', async () => {
    const get = vi.fn();
    win.webpackChunkdiscord_app = webpackRuntimes([{ exportsList: [restModule({ get })], marked: false }]);
    headersSeen();
    const f = okFetch();
    const r = await execAfterWait(f, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { via: 'fetch' } });
    expect(get).not.toHaveBeenCalled();
  });

  it('verbes en accesseurs (pas des données) → refusé', async () => {
    const get = vi.fn();
    const sneaky = restModule();
    Object.defineProperty(sneaky, 'get', { get: () => get, enumerable: true });
    win.webpackChunkdiscord_app = webpackWith([sneaky]);
    headersSeen();
    const r = await execAfterWait(okFetch(), { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { via: 'fetch' } });
    expect(get).not.toHaveBeenCalled();
  });

  it('module évalué APRÈS la première requête → attendu, voie client (jamais le repli)', async () => {
    vi.useFakeTimers();
    const get = vi.fn(async () => ({ ok: true, status: 200, body: {} }));
    const late: unknown[] = [{ other: 1 }];
    win.webpackChunkdiscord_app = webpackWith(late);
    const f = vi.fn();
    const p = bridge.executeRest(f as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    await vi.advanceTimersByTimeAsync(2_000);
    // Le client évalue son module HTTP pendant l'attente.
    win.webpackChunkdiscord_app = webpackWith([...late, { Bo: restModule({ get }) }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toMatchObject({ ok: true, res: { via: 'client' } });
    expect(f).not.toHaveBeenCalled();
  });

  it('attente payée UNE fois : module introuvable → la requête suivante part aussitôt par le repli', async () => {
    win.webpackChunkdiscord_app = webpackWith([{ other: 1 }]);
    headersSeen();
    const f = okFetch();
    expect(await execAfterWait(f, { method: 'GET', path: '/users/@me' })).toMatchObject({ ok: true, res: { via: 'fetch' } });
    vi.useRealTimers();
    const t0 = Date.now();
    expect(await bridge.executeRest(f as unknown as typeof fetch, { method: 'GET', path: '/users/@me' }))
      .toMatchObject({ ok: true, res: { via: 'fetch' } });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('un export dont l\'accesseur lève (liaison circulaire) ne casse pas la recherche', async () => {
    const get = vi.fn(async () => ({ ok: true, status: 200, body: {} }));
    const broken = {};
    Object.defineProperty(broken, 'X', { get: () => { throw new ReferenceError('TDZ'); }, enumerable: true });
    win.webpackChunkdiscord_app = webpackWith([broken, { Bo: restModule({ get }) }]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { via: 'client' } });
  });
});

describe('rest-bridge — voie 2 : fetch même-origine', () => {
  it('recopie les en-têtes vus chez le client, cookies inclus, /api/v9', async () => {
    bridge.observeClientHeader('Authorization', 'tok-123');
    bridge.observeClientHeader('X-Super-Properties', 'abc');
    bridge.observeClientHeader('X-Discord-Locale', 'fr');
    bridge.observeClientHeader('X-Fingerprint', 'ignoré');
    const f = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"id":"1"}', { status: 200 }));
    const r = await bridge.executeRest(f as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { status: 200, body: { id: '1' }, via: 'fetch' } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/v9/users/@me');
    expect(init.credentials).toBe('include');
    expect(init.headers).toEqual({ authorization: 'tok-123', 'x-super-properties': 'abc', 'x-discord-locale': 'fr' });
  });

  it('corps non-JSON (page Cloudflare) → nonJson', async () => {
    bridge.observeClientHeader('authorization', 't');
    bridge.observeClientHeader('x-super-properties', 's');
    const f = vi.fn(async () => new Response('<html>Just a moment</html>', { status: 503 }));
    const r = await bridge.executeRest(f as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { status: 503, nonJson: true } });
  });

  it('sans en-têtes du client : attend, puis no-client-headers (jamais d\'en-tête inventé)', async () => {
    vi.useFakeTimers();
    const f = vi.fn();
    const p = bridge.executeRest(f as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    await vi.advanceTimersByTimeAsync(21_000);
    const r: RestRelayReply = await p;
    expect(r).toMatchObject({ ok: false, failure: 'no-client-headers' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('rest-bridge — voie 1 sans double envoi', () => {
  // Relecture Codex M2 : le module a été appelé, rien ne dit que la requête
  // n'est pas partie. Pas de repli fetch derrière.
  it('rejet du client SANS statut → panne bridge, jamais rejouée par fetch', async () => {
    const del = vi.fn(async () => { throw new Error('forme inattendue'); });
    win.webpackChunkdiscord_app = webpackWith([restModule({ del })]);
    const f = vi.fn();
    const r = await bridge.executeRest(f as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2',
    });
    expect(r).toMatchObject({ ok: false, failure: 'bridge' });
    expect(del).toHaveBeenCalledTimes(1);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('rest-bridge — poignée de main (Codex H1)', () => {
  type Listener = { cb: (e: MessageEvent) => void; capture: boolean };

  function handshakeEvent(port: MessagePort): MessageEvent & { stopped: () => boolean } {
    let stopped = false;
    return {
      source: win,
      data: { source: REST_HANDSHAKE_SOURCE },
      ports: [port],
      stopImmediatePropagation: () => { stopped = true; },
      stopped: () => stopped,
    } as unknown as MessageEvent & { stopped: () => boolean };
  }

  function nextMessage(port: MessagePort, ms = 100): Promise<unknown> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve('rien'), ms);
      port.onmessage = (ev) => { clearTimeout(t); resolve(ev.data); };
    });
  }

  it('écoute en capture, la première poignée de main gagne, toutes sont arrêtées', async () => {
    const listeners: Listener[] = [];
    win.addEventListener = ((_t: string, cb: (e: MessageEvent) => void, capture?: boolean) => {
      listeners.push({ cb, capture: capture === true });
    }) as FakeWin['addEventListener'];
    bridge.installRestServer(neverFetch as unknown as typeof fetch);
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.capture).toBe(true);

    const first = new MessageChannel();
    const e1 = handshakeEvent(first.port2);
    const ready1 = nextMessage(first.port1);
    listeners[0]?.cb(e1);
    expect(await ready1).toEqual({ ready: true });
    expect(e1.stopped()).toBe(true);

    // Un script de la page tente de prendre la place : ignoré, et arrêté.
    const intruder = new MessageChannel();
    const e2 = handshakeEvent(intruder.port2);
    const ready2 = nextMessage(intruder.port1);
    listeners[0]?.cb(e2);
    expect(await ready2).toBe('rien');
    expect(e2.stopped()).toBe(true);

    for (const c of [first, intruder]) { c.port1.close(); c.port2.close(); }
  });
});

// Relecture Codex H5 : une tâche ne change jamais de compte en cours de route.
describe('rest-bridge — compte lié', () => {
  const ME = '123456789012345678';
  const OTHER = '876543210987654321';
  const tokenOf = (id: string): string => `${btoa(id).replace(/=+$/, '')}.GzAbCd.secretpart`;

  function clientWith(del = vi.fn(async () => ({ ok: true, status: 204, body: null }))) {
    win.webpackChunkdiscord_app = webpackWith([restModule({ get: vi.fn(async () => ({ status: 200, body: [] })), del })]);
    return del;
  }

  it('bon compte → émis', async () => {
    const del = clientWith();
    bridge.observeClientHeader('Authorization', tokenOf(ME));
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2', asUser: ME,
    });
    expect(r).toMatchObject({ ok: true });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('autre compte → wrong-account, RIEN n\'est émis', async () => {
    const del = clientWith();
    bridge.observeClientHeader('authorization', tokenOf(OTHER));
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2', asUser: ME,
    });
    expect(r).toMatchObject({ ok: false, failure: 'wrong-account' });
    expect(del).not.toHaveBeenCalled();
  });

  it('compte encore inconnu (aucun en-tête) → attend puis no-client-headers', async () => {
    vi.useFakeTimers();
    const del = clientWith();
    const p = bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2', asUser: ME,
    });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await p).toMatchObject({ ok: false, failure: 'no-client-headers' });
    expect(del).not.toHaveBeenCalled();
  });

  it('jeton de forme inconnue : compte invérifiable, RIEN n\'est émis (ni lecture, ni suppression)', async () => {
    const del = clientWith();
    bridge.observeClientHeader('authorization', 'nouveau-format-sans-point');
    const read = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'GET', path: '/users/@me/guilds', asUser: ME,
    });
    expect(read).toMatchObject({ ok: false, failure: 'wrong-account' });
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2', asUser: ME,
    });
    expect(r).toMatchObject({ ok: false, failure: 'wrong-account' });
    expect(del).not.toHaveBeenCalled();
  });

  it('sans lien de compte (premier /users/@me) : un jeton illisible n\'empêche pas la lecture', async () => {
    clientWith();
    bridge.observeClientHeader('authorization', 'nouveau-format-sans-point');
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true });
  });

  // Re-relecture Codex H5 : le compte change PENDANT l'attente des en-têtes
  // de la voie fetch. Le contrôle se fait sur l'en-tête qui part, pas avant.
  it('voie fetch : compte basculé pendant l\'attente des en-têtes → wrong-account, aucun fetch', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    bridge.observeClientHeader('authorization', tokenOf(ME));
    const p = bridge.executeRest(fetchSpy as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2', asUser: ME,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    // L'utilisateur change de compte dans la page : le client émet sous B.
    bridge.observeClientHeader('authorization', tokenOf(OTHER));
    bridge.observeClientHeader('x-super-properties', 'e30=');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toMatchObject({ ok: false, failure: 'wrong-account' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('voie fetch, contrôle positif : même compte → émis avec CE jeton', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    bridge.observeClientHeader('authorization', tokenOf(ME));
    bridge.observeClientHeader('x-super-properties', 'e30=');
    const r = await bridge.executeRest(fetchSpy as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2', asUser: ME,
    });
    expect(r).toMatchObject({ ok: true });
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBe(tokenOf(ME));
  });
});

// Re-relecture Codex H1 : un script de la page qui remplace les primitives du
// navigateur APRÈS le chargement du bridge ne reçoit pas le port.
describe('rest-bridge — primitives figées au chargement', () => {
  it('postMessage remplacé par la page : jamais appelé, le bridge répond quand même', async () => {
    let listener: ((e: MessageEvent) => void) | null = null;
    win.addEventListener = ((_t: string, cb: (e: MessageEvent) => void) => { listener = cb; }) as FakeWin['addEventListener'];
    bridge.installRestServer(neverFetch as unknown as typeof fetch);

    const original = MessagePort.prototype.postMessage;
    const leaked: unknown[] = [];
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: unknown[]) {
      leaked.push(this);
      return Reflect.apply(original, this, args);
    } as typeof original;
    try {
      const ch = new MessageChannel();
      const ready = new Promise((resolve) => { ch.port1.onmessage = (ev) => resolve(ev.data); });
      let stopped = false;
      (listener as unknown as (e: MessageEvent) => void)({
        source: win,
        data: { source: REST_HANDSHAKE_SOURCE },
        ports: [ch.port2],
        stopImmediatePropagation: () => { stopped = true; },
      } as unknown as MessageEvent);
      expect(await ready).toEqual({ ready: true });
      expect(stopped).toBe(true);
      expect(leaked).toEqual([]);
      ch.port1.close();
      ch.port2.close();
    } finally {
      MessagePort.prototype.postMessage = original;
    }
  });
});
