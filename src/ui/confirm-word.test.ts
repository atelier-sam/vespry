import { describe, expect, it } from 'vitest';
import { confirmWordMatches } from './confirm-word';

describe('confirmWordMatches — mot de confirmation de la purge', () => {
  it('turc : « sil » en minuscules vaut SİL', () => {
    expect(confirmWordMatches('sil', 'SİL', 'tr')).toBe(true);
  });
  it('accent décomposé (NFD) accepté', () => {
    expect(confirmWordMatches('löschen', 'LÖSCHEN', 'de')).toBe(true);
    expect(confirmWordMatches('usuń', 'USUŃ', 'pl')).toBe(true);
  });
  it('casse et espaces autour ignorés', () => {
    expect(confirmWordMatches('  supprimer ', 'SUPPRIMER', 'fr')).toBe(true);
  });
  it('DELETE accepté dans toutes les langues (clavier sans IME)', () => {
    expect(confirmWordMatches('delete', '削除', 'ja')).toBe(true);
  });
  it('contrôle positif : un autre mot, un mot partiel ou vide refusés', () => {
    expect(confirmWordMatches('', 'SUPPRIMER', 'fr')).toBe(false);
    expect(confirmWordMatches('SUPPRIME', 'SUPPRIMER', 'fr')).toBe(false);
    expect(confirmWordMatches('oui', 'SUPPRIMER', 'fr')).toBe(false);
    expect(confirmWordMatches('削', '削除', 'ja')).toBe(false);
  });
});
