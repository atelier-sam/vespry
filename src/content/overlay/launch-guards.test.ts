import { describe, expect, it } from 'vitest';
import { createLatestGate, nextLaunchStep } from './launch-guards';

describe('createLatestGate — la réponse d\'un serveur quitté est ignorée', () => {
  it('serveur A puis B : la réponse de A, arrivée après, est périmée', async () => {
    const gate = createLatestGate();
    let shown: string[] = [];
    const load = (names: string[], ms: number) => {
      const token = gate.begin();
      return new Promise<void>((r) => setTimeout(() => {
        if (gate.isCurrent(token)) shown = names;
        r();
      }, ms));
    };
    const a = load(['channel-guide'], 30); // ancien serveur, réponse lente
    const b = load(['annonces'], 5);
    await Promise.all([a, b]);
    expect(shown).toEqual(['annonces']);
  });

  it('une seule demande reste valable', () => {
    const gate = createLatestGate();
    const t = gate.begin();
    expect(gate.isCurrent(t)).toBe(true);
  });
});

describe('nextLaunchStep', () => {
  const base = { tosAcked: true, tosConfirmed: false, largeRunAcked: false, pickedCount: 5 };

  it('premier export : la modale d\'avertissement d\'abord', () => {
    expect(nextLaunchStep({ ...base, tosAcked: false })).toBe('tos');
  });

  it('modale confirmée sur un gros lot : l\'estimation n\'est PAS sautée', () => {
    expect(nextLaunchStep({ ...base, tosAcked: false, tosConfirmed: true })).toBe('estimate');
  });

  it('peu de salons : envoi direct', () => {
    expect(nextLaunchStep({ ...base, pickedCount: 2 })).toBe('enqueue');
  });

  it('gros export déjà accepté : envoi direct', () => {
    expect(nextLaunchStep({ ...base, largeRunAcked: true })).toBe('enqueue');
  });

  it('rien de coché : rien', () => {
    expect(nextLaunchStep({ ...base, pickedCount: 0 })).toBe('nothing');
  });
});
