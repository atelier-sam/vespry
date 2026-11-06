/**
 * Émetteur REST du monde MAIN, testé sans navigateur : `window` est une
 * doublure, le registre webpack du client Discord est simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RestRelayReply } from '../engine/transport';

type Bridge = typeof import('./rest-bridge');

interface FakeWin {
  webpackChunkdiscord_app?: unknown[];
  addEventListener: (type: string, cb: (e: MessageEvent) => void) => void;
  [k: string]: unknown;
}

/** Registre webpack minimal : `push` appelle le 3e élément avec `require`. */
function webpackWith(exportsList: unknown[]): unknown[] {
  const cache: Record<string, { exports: unknown }> = {};
  exportsList.forEach((exp, i) => { cache[String(i)] = { exports: exp }; });
  const arr: unknown[] = [];
  arr.push = (...items: unknown[]): number => {
    for (const item of items) {
      const cb = (item as unknown[])[2];
      if (typeof cb === 'function') (cb as (r: unknown) => void)({ c: cache });
    }
    return arr.length;
  };
  return arr;
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
    win.webpackChunkdiscord_app = webpackWith([{ get, del: vi.fn(), put: vi.fn(), patch: vi.fn() }]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, { method: 'GET', path: '/users/@me' });
    expect(r).toMatchObject({ ok: true, res: { status: 429, retryAfterSec: 3.5, via: 'client' } });
  });

  it('DELETE passe par `del`, réponse sans corps → 204', async () => {
    const del = vi.fn(async () => undefined);
    win.webpackChunkdiscord_app = webpackWith([{ get: vi.fn(), del, put: vi.fn(), patch: vi.fn() }]);
    const r = await bridge.executeRest(neverFetch as unknown as typeof fetch, {
      method: 'DELETE', path: '/channels/1/messages/2',
    });
    expect(del).toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, res: { status: 204 } });
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
