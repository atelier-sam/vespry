/**
 * Formats selon la langue. Avant le 08/11/2026 l'heure du journal, la date des
 * zones, la date des messages de l'aperçu et le montant du don étaient figés
 * en `'fr-FR'` : un Américain lisait « 20/05 » pour le 20 mai.
 */
import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatEuros,
  formatMegabytes,
  formatMessageTime,
  resolveFormatLocale,
} from './locale-format';

/** Espaces insécables (fines ou non) selon la version d'ICU : on les écrase. */
const plain = (s: string): string => s.replace(/[  ]/g, ' ');

describe('resolveFormatLocale', () => {
  it('la région du navigateur affine la langue de l\'interface quand c\'est la même langue', () => {
    expect(resolveFormatLocale('en-US', 'en')).toBe('en-US');
    expect(resolveFormatLocale('en-GB', 'en')).toBe('en-GB');
    expect(resolveFormatLocale('fr-CA', 'fr')).toBe('fr-CA');
    expect(resolveFormatLocale('pt-BR', 'pt')).toBe('pt-BR');
  });

  it('langue sans dictionnaire (interface repliée en anglais) : formats de l\'interface, pas du navigateur', () => {
    expect(resolveFormatLocale('sv-SE', 'en')).toBe('en');
    expect(resolveFormatLocale('da', 'en')).toBe('en');
  });

  it('un tag à trois lettres n\'est pas pris pour la langue à deux lettres qui le préfixe', () => {
    // « fil » (filipino) n'est pas « fi » (finnois).
    expect(resolveFormatLocale('fil-PH', 'fi')).toBe('fi');
  });

  it('vide, absent ou invalide : langue de l\'interface', () => {
    expect(resolveFormatLocale(undefined, 'de')).toBe('de');
    expect(resolveFormatLocale('', 'de')).toBe('de');
    expect(resolveFormatLocale('  ', 'de')).toBe('de');
    expect(resolveFormatLocale('xx_$$ not a tag', 'de')).toBe('de');
  });

  it('casse normalisée', () => {
    expect(resolveFormatLocale('PT-br', 'pt')).toBe('pt-BR');
  });
});

describe('formatClock', () => {
  const morning = new Date(2026, 4, 20, 9, 5, 3);

  it('24 h sur 2 chiffres en en-US comme en fr-FR (journal en police fixe)', () => {
    expect(formatClock(morning, 'en-US')).toBe('09:05:03');
    expect(formatClock(morning, 'fr-FR')).toBe('09:05:03');
    expect(formatClock(new Date(2026, 4, 20, 16, 12, 22), 'en-US')).toBe('16:12:22');
  });

  it('minuit : 00:05:03, jamais 24:05:03', () => {
    expect(formatClock(new Date(2026, 4, 20, 0, 5, 3), 'en-US')).toBe('00:05:03');
  });

  it('suit la convention de la langue (le finnois sépare par des points)', () => {
    expect(formatClock(new Date(2026, 4, 20, 16, 12, 22), 'fi')).toBe('16.12.22');
  });
});

describe('formatDate', () => {
  const ms = new Date(2026, 4, 20, 12, 0, 0).getTime();

  it('mois d\'abord en en-US, jour d\'abord en fr-FR et en en-GB', () => {
    expect(formatDate(ms, 'en-US')).toBe('5/20/2026');
    expect(formatDate(ms, 'fr-FR')).toBe('20/05/2026');
    expect(formatDate(ms, 'en-GB')).toBe('20/05/2026');
  });
});

describe('formatMessageTime', () => {
  const ts = new Date(2026, 4, 20, 14, 30, 0).toISOString();

  it('le 20 mai : « 05/20 » pour un Américain, « 20/05 » pour un Français', () => {
    const us = plain(formatMessageTime(ts, 'en-US'));
    const fr = plain(formatMessageTime(ts, 'fr-FR'));
    expect(us).toMatch(/^05\/20\b/);
    expect(fr).toMatch(/^20\/05\b/);
  });

  it('heure 12 h (AM/PM) en en-US, 24 h en fr-FR', () => {
    expect(plain(formatMessageTime(ts, 'en-US'))).toMatch(/02:30 PM$/i);
    expect(plain(formatMessageTime(ts, 'fr-FR'))).toMatch(/14:30$/);
  });
});

describe('formatEuros', () => {
  it('montant rond : sans décimales, symbole à la place de la langue', () => {
    expect(plain(formatEuros(500, 'en-US'))).toBe('€5');
    expect(plain(formatEuros(500, 'fr-FR'))).toBe('5 €');
    expect(plain(formatEuros(1000, 'de'))).toBe('10 €');
  });

  it('montant non rond : toujours deux décimales, virgule ou point selon la langue', () => {
    expect(plain(formatEuros(350, 'en-US'))).toBe('€3.50');
    expect(plain(formatEuros(350, 'fr-FR'))).toBe('3,50 €');
    expect(plain(formatEuros(105, 'fr-FR'))).toBe('1,05 €');
  });
});

describe('formatMegabytes', () => {
  it('une décimale, unité de la langue (Mo en français, MB en anglais)', () => {
    expect(plain(formatMegabytes(184_600_000, 'en-US'))).toBe('184.6 MB');
    expect(plain(formatMegabytes(184_600_000, 'fr-FR'))).toBe('184,6 Mo');
  });

  it('un fichier minuscule s\'affiche quand même (0,0)', () => {
    expect(plain(formatMegabytes(0, 'en-US'))).toBe('0.0 MB');
  });
});
