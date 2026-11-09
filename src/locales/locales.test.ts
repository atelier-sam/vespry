/**
 * Parité des 15 langues : mêmes clés que l'anglais (langue source de
 * repli), mêmes variables `{x}` dans chaque texte, aucun texte vide.
 *
 * Pourquoi : `t()` retombe sur l'anglais quand une clé manque, donc une
 * traduction oubliée ne se voit jamais en développement. Et une variable
 * mal recopiée (`{n}` traduit en `{nombre}`) s'afficherait telle quelle.
 * L'avertissement de sanction (`tos.*`) DOIT exister dans chaque langue.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname);
const load = (f: string): Record<string, string> =>
  JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, string>;

const en = load('en.json');
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

/**
 * Garde « phrase restée en anglais » : `t()` retombe sur l'anglais quand une
 * clé manque, mais une clé PRÉSENTE dont le texte est la copie exacte de
 * l'anglais passe le test de parité sans qu'aucun utilisateur ne la lise dans
 * sa langue. Constat du 06/11/2026 : ~110 clés par langue (purge, reset,
 * tuto, schedule…) étaient restées en anglais, dont la modale de suppression.
 *
 * Une « phrase » = au moins un espace et au moins 12 lettres une fois les
 * variables `{x}` retirées. Les mots isolés (Audio, Sticker, Auto, Link, les
 * noms de format JSON/HTML/CSV) restent légitimement identiques dans
 * plusieurs langues et ne sont pas visés.
 *
 * Liste d'exceptions : clé par clé, par locale, avec la raison. Vide à
 * dessein ; y ajouter une entrée exige de justifier pourquoi le texte est
 * identique dans CETTE langue (jamais « traduction en attente »).
 */
const SENTENCE_ALLOWLIST: Record<string, Record<string, string>> = {
  // 'xx.json': { 'cle.exemple': 'raison pour laquelle le texte est identique dans cette langue' },
};
const stripVars = (s: string): string => s.replace(/\{\w+\}/g, '');
const isEnglishSentence = (s: string): boolean =>
  /\s/.test(s.trim()) && (stripVars(s).match(/\p{L}/gu) ?? []).length >= 12;

/**
 * INDEX.md du zip (`idx.*`, packager.ts). Le texte se traduit, mais les noms
 * de dossiers et de champs sont le contrat du format que lit un agent IA :
 * chaque langue doit les porter tels quels (voir docs/SCHEMA.md).
 */
const IDX_LITERALS: Record<string, string[]> = {
  'idx.read_html': ['html/', '.html'],
  'idx.read_json': [
    'json/', '.json', '`id`', '`timestamp`', '`author`', '`content`', '`attachments`',
    '`embeds`', '`reactions`', '`mentions`', '`message_reference`', '`localPath`',
  ],
  'idx.read_tabular': ['csv/', '.csv', 'txt/', '.txt'],
  'idx.read_media': ['`media/`', '`video/`', '`audio/`', '`files/`'],
  'idx.read_manifest': ['`manifest.json`'],
  'idx.read_schema': ['`docs/SCHEMA.md`', '{url}'],
};

describe('locales', () => {
  it('15 langues présentes', () => {
    expect(files.length).toBe(15);
  });

  it("le détecteur de phrase distingue phrases, mots isolés et formats", () => {
    expect(isEnglishSentence('Preparing the archive…')).toBe(true);
    expect(isEnglishSentence('Audio')).toBe(false);
    expect(isEnglishSentence('Sticker')).toBe(false);
    expect(isEnglishSentence('{h}:00 UTC')).toBe(false);
    expect(isEnglishSentence('{n} msg/file')).toBe(false);
    expect(isEnglishSentence('Details ▾')).toBe(false);
    // 10 lettres seulement hors variables : sous le seuil.
    expect(isEnglishSentence('{n} Hello world')).toBe(false);
    expect(isEnglishSentence('Delete messages')).toBe(true);
  });

  for (const f of files) {
    describe(f, () => {
      const loc = load(f);
      it('mêmes clés que en.json', () => {
        expect(Object.keys(loc).sort()).toEqual(Object.keys(en).sort());
      });
      it('aucune phrase anglaise laissée telle quelle', () => {
        if (f === 'en.json') return;
        const allowed = SENTENCE_ALLOWLIST[f] ?? {};
        const left = Object.entries(en)
          .filter(([k, v]) => loc[k] === v && isEnglishSentence(v) && !(k in allowed))
          .map(([k]) => k);
        expect(left, `${f} : phrases encore en anglais`).toEqual([]);
      });
      it("INDEX.md : noms de dossiers et de champs conservés dans chaque langue", () => {
        for (const [k, literals] of Object.entries(IDX_LITERALS)) {
          for (const lit of literals) {
            expect(loc[k] ?? '', `${f} ${k} doit contenir ${lit}`).toContain(lit);
          }
        }
      });
      it('mêmes variables et aucun texte vide', () => {
        for (const [k, v] of Object.entries(en)) {
          const tr = loc[k];
          expect(typeof tr === 'string' && tr.trim().length > 0, `${f} ${k} vide`).toBe(true);
          expect(vars(tr ?? ''), `${f} ${k}`).toEqual(vars(v));
        }
      });
    });
  }
});
