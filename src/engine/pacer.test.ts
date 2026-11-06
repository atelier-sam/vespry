import { describe, expect, it } from 'vitest';
import { PACE_PROFILES, Pacer, type PacerDeps } from './pacer';

const MIN = 60_000;

/** Horloge virtuelle : `sleep` avance le temps, ne bloque jamais. */
function virtualClock(random: () => number = () => 0.5): PacerDeps & { sleeps: number[]; t: () => number } {
  let now = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random,
    sleeps,
    t: () => now,
  };
}

describe('Pacer', () => {
  it('délai aléatoire borné par type entre deux requêtes (discret)', async () => {
    for (const r of [0, 0.999]) {
      const clock = virtualClock(() => r);
      const p = new Pacer('discreet', clock);
      await p.run('read', async () => 1);
      await p.run('read', async () => 1);
      const [lo, hi] = PACE_PROFILES.discreet.delays.read;
      const waited = clock.sleeps.at(-1) ?? 0;
      expect(waited).toBeGreaterThanOrEqual(lo - 1);
      expect(waited).toBeLessThanOrEqual(hi);
    }
  });

  it('la suppression est plus lente que la lecture', () => {
    for (const mode of ['discreet', 'normal'] as const) {
      const d = PACE_PROFILES[mode].delays;
      expect(d.delete[0]).toBeGreaterThan(d.read[0]);
    }
  });

  it('le cran normal est plus rapide mais garde pauses et plafond', () => {
    const n = PACE_PROFILES.normal;
    const d = PACE_PROFILES.discreet;
    expect(n.delays.read[1]).toBeLessThan(d.delays.read[1]);
    expect(n.restSpan).toEqual(d.restSpan);
    expect(n.sessionBudget).toBeGreaterThan(0);
  });

  it('file : une seule requête en vol, toutes sources confondues', async () => {
    const p = new Pacer('discreet', virtualClock());
    let inFlight = 0;
    let max = 0;
    const job = async (): Promise<void> => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
    };
    await Promise.all([p.run('read', job), p.run('delete', job), p.run('search', job), p.run('read', job)]);
    expect(max).toBe(1);
  });

  it('une erreur ne casse pas la file', async () => {
    const p = new Pacer('discreet', virtualClock());
    await expect(p.run('read', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(p.run('read', async () => 42)).resolves.toBe(42);
  });

  it('pause longue (horloge murale) après la plage d\'activité', async () => {
    const clock = virtualClock();
    const p = new Pacer('discreet', clock);
    await p.run('read', async () => 0);
    // Une plage d'activité dure au plus 50 min : on simule 51 min de requêtes.
    const start = clock.t();
    while (clock.t() - start < 51 * MIN) await p.run('read', async () => 0);
    const longRests = clock.sleeps.filter((ms) => ms >= 8 * MIN);
    expect(longRests.length).toBeGreaterThanOrEqual(1);
    expect(longRests[0]).toBeLessThanOrEqual(12 * MIN);
  });

  it('plafond de session : pause de 60 min puis compteur remis à zéro', async () => {
    const clock = virtualClock();
    const p = new Pacer('discreet', clock);
    const budget = PACE_PROFILES.discreet.sessionBudget;
    for (let i = 0; i < budget; i += 1) await p.run('read', async () => 0);
    expect(p.snapshot().requests).toBe(budget);
    await p.run('read', async () => 0);
    expect(clock.sleeps).toContain(PACE_PROFILES.discreet.budgetRestMs);
    expect(p.snapshot().requests).toBe(1);
  });

  it('429 : ralentissement ×1,5 plafonné à ×3', () => {
    const p = new Pacer('discreet', virtualClock());
    p.noteRateLimited();
    expect(p.snapshot().slowdown).toBeCloseTo(1.5);
    for (let i = 0; i < 10; i += 1) p.noteRateLimited();
    expect(p.snapshot().slowdown).toBe(3);
  });

  it('hold bloque la file sans compter de requête', async () => {
    const clock = virtualClock();
    const p = new Pacer('discreet', clock);
    await p.hold(5_000);
    expect(clock.sleeps).toContain(5_000);
    expect(p.snapshot().requests).toBe(0);
  });

  it('changement de cran pris en compte à la requête suivante', async () => {
    const clock = virtualClock(() => 0);
    const p = new Pacer('discreet', clock);
    await p.run('read', async () => 0);
    p.setMode('normal');
    await p.run('read', async () => 0);
    expect(clock.sleeps.at(-1)).toBe(PACE_PROFILES.normal.delays.read[0]);
    expect(p.currentMode).toBe('normal');
  });
});
