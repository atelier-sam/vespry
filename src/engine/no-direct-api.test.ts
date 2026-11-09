/**
 * Garde de non-régression (export discret) : aucune requête vers l'API
 * Discord ne doit partir d'un contexte d'extension. Le seul émetteur est
 * `content/rest-bridge.ts`, dans la page discord.com.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('aucun appel direct à l\'API Discord', () => {
  it('discord.com/api et /api/v n\'apparaissent que dans rest-bridge.ts', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith(join('content', 'rest-bridge.ts')))
      .filter((f) => /discord(app)?\.com\/api|['"`]\/api\/v\d/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('aucun en-tête authorization posé hors du bridge', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes(join('content', 'rest-bridge.ts')) && !f.includes(join('content', 'discord-bridge.ts')))
      .filter((f) => /[Aa]uthorization['"]?\s*:/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
