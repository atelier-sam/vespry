import { describe, expect, it, vi } from 'vitest';
import { RelayTransport } from './relay-transport';
import { TransportError } from './transport';

const REQ = { method: 'GET' as const, path: '/users/@me' };

describe('RelayTransport', () => {
  it('rend la réponse du relais', async () => {
    const t = new RelayTransport(async () => ({ ok: true, res: { status: 200, body: { id: '1' }, nonJson: false } }));
    expect(await t.send(REQ)).toMatchObject({ status: 200, body: { id: '1' } });
  });

  it('refuse une route hors liste blanche sans rien relayer', async () => {
    const relay = vi.fn();
    const t = new RelayTransport(relay);
    await expect(t.send({ method: 'GET', path: '/users/@me/billing/payment-sources' }))
      .rejects.toMatchObject({ failure: 'rejected' });
    expect(relay).not.toHaveBeenCalled();
  });

  it('échec du relais → TransportError typée', async () => {
    const t = new RelayTransport(async () => ({ ok: false, failure: 'no-tab', message: 'x' }));
    await expect(t.send(REQ)).rejects.toBeInstanceOf(TransportError);
  });

  it('service worker absent (sendMessage rejette) → no-tab, reprenable', async () => {
    const t = new RelayTransport(async () => { throw new Error('Could not establish connection'); });
    await expect(t.send(REQ)).rejects.toMatchObject({ failure: 'no-tab' });
  });

  it('réponse illisible → bridge', async () => {
    const t = new RelayTransport(async () => ({ nope: true }));
    await expect(t.send(REQ)).rejects.toMatchObject({ failure: 'bridge' });
  });

  it('relais muet → timeout', async () => {
    vi.useFakeTimers();
    const t = new RelayTransport(() => new Promise(() => {}), 1_000);
    const p = t.send(REQ).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await p).toMatchObject({ failure: 'timeout' });
    vi.useRealTimers();
  });
});
