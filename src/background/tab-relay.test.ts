import { describe, expect, it, vi } from 'vitest';
import { orderTabs, relayRestToTab, type TabApi } from './tab-relay';
import type { RestRelayReply } from '../engine/transport';

const REQ = { method: 'GET' as const, path: '/users/@me' };
const OK: RestRelayReply = { ok: true, res: { status: 200, body: {}, nonJson: false } };

function api(tabs: { id: number; active?: boolean; lastAccessed?: number; discarded?: boolean }[],
  send: (id: number) => Promise<unknown>): TabApi & { sent: number[] } {
  const sent: number[] = [];
  return {
    sent,
    queryDiscordTabs: async () => tabs,
    sendToTab: (id) => { sent.push(id); return send(id); },
  };
}

describe('tab-relay', () => {
  it('ordre : onglet actif, puis le plus récent ; onglets déchargés ignorés', () => {
    expect(orderTabs([
      { id: 1, lastAccessed: 10 }, { id: 2, active: true, lastAccessed: 1 },
      { id: 3, lastAccessed: 50 }, { id: 4, discarded: true, lastAccessed: 99 },
    ])).toEqual([2, 3, 1]);
  });

  it('aucun onglet → no-tab', async () => {
    expect(await relayRestToTab(api([], async () => OK), REQ)).toMatchObject({ ok: false, failure: 'no-tab' });
  });

  it('onglet sans content script → essaie le suivant', async () => {
    const a = api([{ id: 1, active: true }, { id: 2 }], async (id) => {
      if (id === 1) throw new Error('Receiving end does not exist');
      return OK;
    });
    expect(await relayRestToTab(a, REQ)).toEqual(OK);
    expect(a.sent).toEqual([1, 2]);
  });

  it('bridge absent dans un onglet (no-tab) → suivant', async () => {
    const a = api([{ id: 1, active: true }, { id: 2 }], async (id) =>
      (id === 1 ? { ok: false, failure: 'no-tab', message: 'x' } : OK));
    expect(await relayRestToTab(a, REQ)).toEqual(OK);
  });

  it('délai dépassé → timeout, la requête n\'est PAS rejouée sur un autre onglet', async () => {
    vi.useFakeTimers();
    const a = api([{ id: 1, active: true }, { id: 2 }], () => new Promise(() => {}));
    const p = relayRestToTab(a, REQ, 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await p).toMatchObject({ ok: false, failure: 'timeout' });
    expect(a.sent).toEqual([1]);
    vi.useRealTimers();
  });

  it('un refus du bridge (rejected) est rendu tel quel', async () => {
    const a = api([{ id: 1 }], async () => ({ ok: false, failure: 'rejected', message: 'x' }));
    expect(await relayRestToTab(a, REQ)).toMatchObject({ ok: false, failure: 'rejected' });
  });

  // Relecture Codex M1 : une rupture APRÈS remise ne se rejoue pas ailleurs.
  it('liaison rompue après remise → timeout, PAS d\'essai sur un autre onglet', async () => {
    const a = api([{ id: 1, active: true }, { id: 2 }], async (id) => {
      if (id === 1) throw new Error('The message port closed before a response was received.');
      return OK;
    });
    expect(await relayRestToTab(a, REQ)).toMatchObject({ ok: false, failure: 'timeout' });
    expect(a.sent).toEqual([1]);
  });

  // Relecture Codex H5.
  it('onglet d\'un autre compte → suivant ; aucun du bon compte → wrong-account', async () => {
    const wrong = { ok: false, failure: 'wrong-account', message: 'x' };
    const a = api([{ id: 1, active: true }, { id: 2 }], async (id) => (id === 1 ? wrong : OK));
    expect(await relayRestToTab(a, REQ)).toEqual(OK);
    const b = api([{ id: 1, active: true }], async () => wrong);
    expect(await relayRestToTab(b, REQ)).toMatchObject({ ok: false, failure: 'wrong-account' });
  });
});
