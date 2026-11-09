import { describe, expect, it } from 'vitest';
import { markPending, takePending, SCHEDULE_PENDING_KEY } from './scheduled-pending';

/** Stockage en mémoire dont chaque opération rend la main (comme chrome.storage). */
function asyncStorage() {
  const data: Record<string, unknown> = {};
  const tick = () => new Promise<void>((r) => setTimeout(r, 1));
  return {
    data,
    get: async (k: string) => { await tick(); return { [k]: data[k] }; },
    set: async (o: Record<string, unknown>) => { await tick(); Object.assign(data, o); },
    remove: async (k: string) => { await tick(); delete data[k]; },
  } as unknown as Parameters<typeof takePending>[0] & { data: Record<string, unknown> };
}

describe('takePending', () => {
  // Relecture Codex M5 : deux onglets prêts en même temps.
  it('deux prises concurrentes : une seule obtient le planifié', async () => {
    const s = asyncStorage();
    await markPending(s, { guildId: '1', guildName: 'G', since: 5 });
    const [a, b] = await Promise.all([takePending(s), takePending(s)]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
    expect(s.data[SCHEDULE_PENDING_KEY]).toBeUndefined();
  });

  it('une prise qui échoue ne bloque pas la suivante', async () => {
    const s = asyncStorage();
    const broken = { ...s, get: async () => { throw new Error('boom'); } } as typeof s;
    await expect(takePending(broken)).rejects.toThrow('boom');
    await markPending(s, { guildId: '1', guildName: 'G', since: 5 });
    expect(await takePending(s)).toMatchObject({ guildId: '1' });
  });
});
