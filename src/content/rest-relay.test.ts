import { afterEach, describe, expect, it } from 'vitest';
import { RestPortClient } from './rest-relay';
import { REST_HANDSHAKE_SOURCE } from './rest-bridge-protocol';

const REQ = { method: 'GET' as const, path: '/users/@me' };
const opened: MessagePort[] = [];

afterEach(() => {
  for (const p of opened.splice(0)) p.close();
});

/** Doublure du monde MAIN : répond `ready` puis renvoie `reply(req)` pour chaque requête. */
function fakeMain(reply: (req: unknown) => unknown, opts: { ignoreFirst?: number } = {}) {
  let handshakes = 0;
  return {
    handshakes: () => handshakes,
    target: {
      postMessage: (msg: unknown, _origin: string, transfer?: Transferable[]) => {
        if ((msg as { source?: unknown }).source !== REST_HANDSHAKE_SOURCE) return;
        handshakes += 1;
        if (handshakes <= (opts.ignoreFirst ?? 0)) return; // MAIN pas encore prêt
        const port = transfer?.[0] as MessagePort;
        opened.push(port);
        port.onmessage = (ev: MessageEvent) => {
          const { id, req } = ev.data as { id: number; req: unknown };
          const r = reply(req);
          if (r !== undefined) port.postMessage({ id, reply: r });
        };
        port.postMessage({ ready: true });
      },
    } as unknown as Pick<Window, 'postMessage'>,
  };
}

describe('RestPortClient (ISOLATED ↔ MAIN)', () => {
  it('poignée de main puis requête par le port privé', async () => {
    const main = fakeMain(() => ({ ok: true, res: { status: 200, body: { id: '1' }, nonJson: false } }));
    const c = new RestPortClient({ target: main.target, origin: 'https://discord.com' });
    expect(await c.request(REQ)).toMatchObject({ ok: true, res: { body: { id: '1' } } });
    expect(await c.request(REQ)).toMatchObject({ ok: true });
    expect(main.handshakes()).toBe(1);
  });

  it('relance la poignée de main tant que MAIN ne répond pas', async () => {
    const main = fakeMain(() => ({ ok: true, res: { status: 204, body: null, nonJson: false } }), { ignoreFirst: 2 });
    const c = new RestPortClient({ target: main.target, origin: 'https://discord.com', handshakeTimeoutMs: 3_000 });
    expect(await c.request(REQ)).toMatchObject({ ok: true });
    expect(main.handshakes()).toBe(3);
  });

  it('MAIN absent → no-tab (le relais essaiera un autre onglet)', async () => {
    const main = fakeMain(() => undefined, { ignoreFirst: 99 });
    const c = new RestPortClient({ target: main.target, origin: 'https://discord.com', handshakeTimeoutMs: 600 });
    expect(await c.request(REQ)).toMatchObject({ ok: false, failure: 'no-tab' });
  });

  it('page muette (captcha) → timeout', async () => {
    const main = fakeMain(() => undefined);
    const c = new RestPortClient({ target: main.target, origin: 'https://discord.com', timeoutMs: 200 });
    expect(await c.request(REQ)).toMatchObject({ ok: false, failure: 'timeout' });
  });

  it('réponse forgée illisible → bridge', async () => {
    const main = fakeMain(() => ({ ok: 'oui' }));
    const c = new RestPortClient({ target: main.target, origin: 'https://discord.com' });
    expect(await c.request(REQ)).toMatchObject({ ok: false, failure: 'bridge' });
  });

  // Re-relecture Codex : MAIN garde la PREMIÈRE poignée de main. Si son
  // `ready` arrive après le délai, le canal ne doit pas être perdu.
  it('ready en retard : la requête échoue (no-tab), le canal accepté sert à la suivante', async () => {
    let accepted: MessagePort | null = null;
    let handshakes = 0;
    const target = {
      postMessage: (_msg: unknown, _origin: string, transfer?: Transferable[]) => {
        handshakes += 1;
        const port = transfer?.[0] as MessagePort;
        opened.push(port);
        if (accepted) return; // première gagne, les suivantes sont ignorées
        accepted = port;
        port.onmessage = (ev: MessageEvent) => {
          const { id } = ev.data as { id: number };
          port.postMessage({ id, reply: { ok: true, res: { status: 204, body: null, nonJson: false } } });
        };
        setTimeout(() => port.postMessage({ ready: true }), 250); // page lente
      },
    } as unknown as Pick<Window, 'postMessage'>;
    const c = new RestPortClient({ target, origin: 'https://discord.com', handshakeTimeoutMs: 100 });
    expect(await c.request(REQ)).toMatchObject({ ok: false, failure: 'no-tab' });
    await new Promise((r) => setTimeout(r, 300));
    expect(await c.request(REQ)).toMatchObject({ ok: true });
    expect(handshakes).toBe(1);
  });

  it('route hors liste blanche refusée côté ISOLATED aussi', async () => {
    const main = fakeMain(() => ({ ok: true, res: { status: 200, body: {}, nonJson: false } }));
    const c = new RestPortClient({ target: main.target, origin: 'https://discord.com' });
    expect(await c.request({ method: 'GET', path: '/users/@me/settings' })).toMatchObject({ failure: 'rejected' });
    expect(main.handshakes()).toBe(0);
  });
});
