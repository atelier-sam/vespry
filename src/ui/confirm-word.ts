/**
 * Mot à taper pour confirmer une suppression définitive (PurgeModal).
 *
 * Pourquoi pas une égalité stricte : le mot est traduit (SİL en turc, USUŃ en
 * polonais, 削除 en japonais). Une égalité stricte refusait « sil » tapé en
 * minuscules (la majuscule de i est İ en turc, pas I) et une saisie dont
 * l'accent arrive décomposé (NFD, fréquent sur macOS). On compare donc après
 * normalisation NFC et passage en majuscules SELON LA LANGUE.
 *
 * Le mot anglais DELETE est accepté partout : un clavier sans la bonne
 * méthode de saisie (IME japonais, coréen, chinois) ne doit pas bloquer la
 * personne. Le geste reste délibéré : il faut taper un mot entier.
 */
const FALLBACK_WORD = 'DELETE';

function fold(s: string, locale: string): string {
  return s.normalize('NFC').trim().toLocaleUpperCase(locale);
}

export function confirmWordMatches(typed: string, word: string, locale: string): boolean {
  const got = fold(typed, locale);
  if (got.length === 0) return false;
  return got === fold(word, locale) || got === FALLBACK_WORD;
}
