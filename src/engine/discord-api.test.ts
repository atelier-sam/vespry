import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordApi } from './discord-api';
import { DiscordApiError, isStopError } from './types';
import { TransportError } from './transport';
import { FakeTransport, instantPacer, ok, status } from './test-fakes';

afterEach(() => {
  vi.unstubAllGlobals();
});

function apiWith(t: FakeTransport): DiscordApi {
  return new DiscordApi({ transport: t, pacer: instantPacer() });
}

describe('DiscordApi — émission', () => {
  it('passe par le transport, chemins sans version, jamais par fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const t = new FakeTransport([ok([{ id: '1', name: 'G' }])]);
    expect(await apiWith(t).getGuilds()).toEqual([{ id: '1', name: 'G' }]);
    expect(t.calls).toEqual([{ method: 'GET', path: '/users/@me/guilds' }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('getMessages construit le curseur before', async () => {
    const t = new FakeTransport([ok([])]);
    await apiWith(t).getMessages('11', '12345');
    expect(t.calls[0]?.path).toBe('/channels/11/messages?limit=100&before=12345');
  });

  it('un salon à la fois : deux appels concurrents ne sont jamais en vol ensemble', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const t = new FakeTransport([], () => ok([]));
    const slow = {
      send: async (req: Parameters<FakeTransport['send']>[0]) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return t.send(req);
      },
    };
    const api = new DiscordApi({ transport: slow, pacer: instantPacer() });
    await Promise.all([api.getMessages('1'), api.getMessages('2'), api.deleteMessage('3', '4')]);
    expect(maxInFlight).toBe(1);
  });
});

describe('DiscordApi — politique d\'erreurs', () => {
  it('429 court : attend, ralentit le Pacer, puis réussit', async () => {
    const pacer = instantPacer();
    const t = new FakeTransport([status(429, { retry_after: 1 }, { retryAfterSec: 1 }), ok([])]);
    const api = new DiscordApi({ transport: t, pacer });
    await api.getGuilds();
    expect(t.calls).toHaveLength(2);
    expect(pacer.snapshot().slowdown).toBeGreaterThan(1);
  });

  it('429 répété : arrêt net rate-limited (pas de rafale)', async () => {
    const r429 = status(429, { retry_after: 1 }, { retryAfterSec: 1 });
    const t = new FakeTransport([r429, r429, r429, ok([])]);
    await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind: 'rate-limited' });
    expect(t.calls).toHaveLength(3);
  });

  it('429 avec retry_after > 60 s : arrêt immédiat', async () => {
    const t = new FakeTransport([status(429, { retry_after: 300 }, { retryAfterSec: 300 })]);
    await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind: 'rate-limited' });
    expect(t.calls).toHaveLength(1);
  });

  it('401 → auth (arrêt)', async () => {
    const t = new FakeTransport([status(401, { message: 'no' })]);
    const err = await apiWith(t).getCurrentUser().catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'DiscordApiError', kind: 'auth' });
    expect(isStopError(err)).toBe(true);
  });

  it('403 Missing Access (50001) → forbidden, salon ignoré, pas un arrêt', async () => {
    const t = new FakeTransport([status(403, { code: 50001, message: 'Missing Access' })]);
    const err = await apiWith(t).getGuildChannels('1').catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: 'forbidden' });
    expect(isStopError(err)).toBe(false);
  });

  it('403 sans code d\'accès → refused (arrêt)', async () => {
    const t = new FakeTransport([status(403, { code: 40002, message: 'verify' })]);
    await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind: 'refused' });
  });

  it('captcha demandé → refused, jamais contourné', async () => {
    const t = new FakeTransport([status(400, { captcha_key: ['captcha-required'], captcha_sitekey: 'x' })]);
    await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind: 'refused' });
    expect(t.calls).toHaveLength(1);
  });

  it('page non-JSON (Cloudflare) → blocked', async () => {
    const t = new FakeTransport([{ status: 503, body: null, nonJson: true }]);
    await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('pannes du transport : no-tab, no-client, timeout→refused', async () => {
    const cases: [TransportError, string][] = [
      [new TransportError('no-tab', 'x'), 'no-tab'],
      [new TransportError('no-client-headers', 'x'), 'no-client'],
      [new TransportError('timeout', 'x'), 'refused'],
    ];
    for (const [e, kind] of cases) {
      const t = new FakeTransport([e]);
      await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind });
    }
  });

  it('500 → unknown', async () => {
    const t = new FakeTransport([status(500, { message: 'oops' })]);
    await expect(apiWith(t).getGuilds()).rejects.toMatchObject({ kind: 'unknown', status: 500 });
  });

  it('search : erreur non fatale → null, arrêt net → remonte', async () => {
    const soft = new FakeTransport([status(403, { code: 50001 })]);
    expect(await apiWith(soft).searchMessageCount('1', '2')).toBeNull();
    const hard = new FakeTransport([status(401, {})]);
    await expect(apiWith(hard).searchMessageCount('1', '2')).rejects.toBeInstanceOf(DiscordApiError);
  });
});

describe('DiscordApi — deleteMessage', () => {
  it('DELETE sur le bon chemin, 204 accepté', async () => {
    const t = new FakeTransport([status(204)]);
    await apiWith(t).deleteMessage('11', '22');
    expect(t.calls).toEqual([{ method: 'DELETE', path: '/channels/11/messages/22' }]);
  });

  it('404 = succès idempotent (relais expiré alors que le DELETE était parti)', async () => {
    const t = new FakeTransport([status(404, { message: 'Unknown Message' })]);
    await expect(apiWith(t).deleteMessage('11', '22')).resolves.toBeUndefined();
  });

  it('403 Missing Permissions → forbidden', async () => {
    const t = new FakeTransport([status(403, { code: 50013 })]);
    await expect(apiWith(t).deleteMessage('11', '22')).rejects.toMatchObject({ kind: 'forbidden', status: 403 });
  });
});

describe('DiscordApi — médias CDN', () => {
  it('downloadAsset renvoie null sur échec (CDN signé, sans identité)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const t = new FakeTransport();
    expect(await apiWith(t).downloadAsset('https://cdn.discordapp.com/x.png')).toBeNull();
    expect(t.calls).toHaveLength(0);
  });
});
