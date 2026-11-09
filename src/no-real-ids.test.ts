/**
 * Garde de vie privée : aucun identifiant Discord RÉEL dans le code, tests
 * compris. Le dépôt est public (miroir GitHub).
 *
 * Pourquoi : le 06/11/2026, quatre fichiers de test portaient l'identifiant
 * du serveur privé de l'auteur et de deux de ses salons, recopiés depuis un
 * essai réel. Les données de test sont désormais fictives (« Studio
 * Kitsune », identifiants 1100000000000000xxx) ; ce test empêche d'en
 * recopier de nouveaux.
 *
 * Règle : tout nombre de 17 à 20 chiffres (la forme d'un snowflake Discord)
 * doit être un identifiant visiblement synthétique, listé ci-dessous.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOTS = [
  join(__dirname),
  join(__dirname, '..', 'donor-service', 'src'),
  // Harnais de captures : ses données finissent sur les stores et le README.
  // Le 08/11/2026, export-harness.tsx portait encore un identifiant de salon
  // réel (19 chiffres), hors de portée de ce test qui ne lisait que src/.
  join(__dirname, '..', 'scripts'),
];
/** Dossiers générés, jamais versionnés. */
const SKIP_DIRS = new Set(['dist', 'node_modules']);

/** Identifiants fictifs autorisés. */
const SYNTHETIC: RegExp[] = [
  /^11000000000000000\d\d$/, // série fictive des tests
  /^123456789012345678$/,
  /^876543210987654321$/,
  /^\d{1,2}0{12,}\d{0,3}$/, // harnais : 100000000000000001, 310000000000000000…
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : walk(p);
    return /\.(ts|tsx|json|mjs|html)$/.test(name) ? [p] : [];
  });
}

/** Snowflakes non synthétiques trouvés dans un texte. */
function realLookingIds(text: string): string[] {
  return [...text.matchAll(/(?<!\d)\d{17,20}(?!\d)/g)]
    .map((m) => m[0])
    .filter((id) => !SYNTHETIC.some((re) => re.test(id)));
}

describe('aucun identifiant Discord réel dans le dépôt public', () => {
  it('contrôle positif : un snowflake réaliste est repéré, un fictif non', () => {
    expect(realLookingIds("guildId: '1234567890123456789'")).toEqual(['1234567890123456789']);
    expect(realLookingIds("guildId: '1100000000000000001'")).toEqual([]);
    expect(realLookingIds("id: '310000000000000000'")).toEqual([]);
    expect(realLookingIds("channel_id: '1505933366229340160'")).toEqual(['1505933366229340160']);
    expect(realLookingIds('timestamp 1788480000000')).toEqual([]); // 13 chiffres : une date, pas un id
  });

  it('src/, donor-service/src/ et scripts/ ne portent que des identifiants fictifs', () => {
    const self = join(__dirname, 'no-real-ids.test.ts');
    const offenders = ROOTS.flatMap(walk)
      .filter((f) => f !== self)
      .flatMap((f) => realLookingIds(readFileSync(f, 'utf8')).map((id) => `${relative(join(__dirname, '..'), f)}: ${id}`));
    expect(offenders).toEqual([]);
  });
});
