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

describe('locales', () => {
  it('15 langues présentes', () => {
    expect(files.length).toBe(15);
  });

  for (const f of files) {
    describe(f, () => {
      const loc = load(f);
      it('mêmes clés que en.json', () => {
        expect(Object.keys(loc).sort()).toEqual(Object.keys(en).sort());
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
