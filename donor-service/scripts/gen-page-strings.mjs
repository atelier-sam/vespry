#!/usr/bin/env node
/**
 * Génère `src/page-strings.generated.ts` à partir des traductions de
 * l'extension (`../src/locales/<lang>.json`).
 *
 * Pourquoi : la page de don publique (`/donate`) reprend mot pour mot la
 * modale de don de l'extension. Une seule source de vérité : les fichiers de
 * l'extension, traduits et testés. `test/page-strings.test.ts` rougit si ce
 * fichier généré n'est plus à jour.
 *
 * Usage : node scripts/gen-page-strings.mjs [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const LOCALES = ['en', 'fr', 'it', 'es', 'de', 'pt', 'ru', 'ja', 'ko', 'zh', 'tr', 'pl', 'nl', 'fi', 'hi'];

/** Clé de l'extension → nom du champ dans la page. */
export const KEYS = {
  'support.title': 'title',
  'support.intro': 'intro',
  'support.tier_s': 'tierS',
  'support.tier_m': 'tierM',
  'support.tier_l': 'tierL',
  'support.custom': 'custom',
  'support.show_name': 'showName',
  'support.name_ph': 'namePh',
  'support.msg_ph': 'msgPh',
  'support.pay': 'pay',
  'support.secured': 'secured',
  'support.error': 'error',
  'wall.supporters': 'supporters',
  'wall.supporter_one': 'supporterOne',
  'wall.first_hook': 'firstHook',
  'wall.thanks': 'thanks',
  'wall.thanks_anon': 'thanksAnon',
  'm.first': 'firstTier',
};

export function render(localesDir) {
  const out = {};
  for (const lang of LOCALES) {
    const dict = JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf8'));
    const en = JSON.parse(readFileSync(join(localesDir, 'en.json'), 'utf8'));
    out[lang] = Object.fromEntries(
      Object.entries(KEYS).map(([key, field]) => [field, dict[key] ?? en[key]]),
    );
  }
  const fields = Object.values(KEYS);
  return `// FICHIER GÉNÉRÉ par scripts/gen-page-strings.mjs — ne pas modifier à la main.
// Source : ../src/locales/<lang>.json (traductions de l'extension).

export interface SharedStrings {
${fields.map((f) => `  ${f}: string;`).join('\n')}
}

export const SHARED_STRINGS = ${JSON.stringify(out, null, 2)} as const satisfies Record<string, SharedStrings>;
`;
}

// Comparaison de chemins, pas d'URL : le dossier du projet contient espaces et accents.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = join(here, '..', 'src', 'page-strings.generated.ts');
  const fresh = render(join(here, '..', '..', 'src', 'locales'));
  if (process.argv.includes('--check')) {
    // Mode vérification (test) : n'écrit rien, échoue si le fichier a dérivé.
    if (readFileSync(target, 'utf8') !== fresh) {
      console.error('page-strings.generated.ts périmé : relancer node scripts/gen-page-strings.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(target, fresh);
    console.log(`écrit : ${target}`);
  }
}
