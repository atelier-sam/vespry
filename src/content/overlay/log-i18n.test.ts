/**
 * Journal d'export traduit (08/11/2026).
 *
 * En refaisant les captures du store, on a vu que le journal affiché à
 * l'utilisateur était écrit en français pour les 15 langues
 * (`${clock()}  ✗ session Discord perdue`…). Trois gardes :
 *
 *  1. SOURCE — `controller.ts` ne contient plus aucune ligne de journal en dur :
 *     tout passe par `journal('log.…')`, seul appelant de `clock()`.
 *  2. LANGUES — les lignes qui portent un nom de salon restent masquables par
 *     le rapport de bug (`ReportRedactor`) dans chacune des 15 langues, sans
 *     rien masquer d'autre.
 *  3. BOUT EN BOUT — une vraie purge écrit ses lignes dans la langue de
 *     l'interface (anglais, français, japonais).
 *
 * Chaque garde a son contrôle positif : une source fautive la fait rougir.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportRedactor } from '../../diagnostics';

vi.mock('../../version', () => ({ GITHUB_REPO: 'atelier-sam/vespry', getVersion: () => '1.1.0' }));

const LOCALES_DIR = join(__dirname, '..', '..', 'locales');
const CONTROLLER = join(__dirname, 'controller.ts');
type Dict = Record<string, string>;
const load = (f: string): Dict => JSON.parse(readFileSync(join(LOCALES_DIR, f), 'utf8')) as Dict;
const EN = load('en.json');
const LOCALE_FILES = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));

// ───────────────────────── 1. Garde source ─────────────────────────

/**
 * Cherche dans une source TypeScript tout ce qui contourne `journal()`.
 * AST et non regex : les commentaires, les chaînes multi-lignes et les
 * gabarits imbriqués ne la trompent pas.
 */
function findJournalViolations(source: string, knownKeys: ReadonlySet<string>): string[] {
  const sf = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const at = (n: ts.Node): string => `ligne ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const callee = (c: ts.CallExpression): string | null =>
    ts.isIdentifier(c.expression) ? c.expression.text : null;
  const insideFunction = (n: ts.Node, name: string): boolean => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name?.text === name) return true;
    }
    return false;
  };
  const hasLetters = (s: string): boolean => /\p{L}/u.test(s);
  const containsClock = (n: ts.Node): boolean => {
    let found = false;
    const walk = (x: ts.Node): void => {
      if (ts.isCallExpression(x) && callee(x) === 'clock') found = true;
      ts.forEachChild(x, walk);
    };
    walk(n);
    return found;
  };
  /** Clés littérales d'un argument : `'log.x'` ou `cond ? 'log.a' : 'log.b'`. */
  const literalKeys = (e: ts.Expression | undefined): string[] | null => {
    if (!e) return null;
    if (ts.isStringLiteralLike(e)) return [e.text];
    if (ts.isConditionalExpression(e)) {
      const a = literalKeys(e.whenTrue);
      const b = literalKeys(e.whenFalse);
      return a && b ? [...a, ...b] : null;
    }
    return null;
  };

  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const name = callee(n);
      if (name === 'clock' && !insideFunction(n, 'journal')) {
        out.push(`${at(n)} : clock() appelé hors de journal()`);
      }
      if (name === 'journal') {
        const keys = literalKeys(n.arguments[0]);
        if (!keys) out.push(`${at(n)} : journal() sans clé littérale`);
        else for (const k of keys) if (!knownKeys.has(k)) out.push(`${at(n)} : clé de journal inconnue « ${k} »`);
      }
      if (name === 't') {
        const first = n.arguments[0];
        // Clé construite (`stop.${kind}`, table de clés) : vérifiée à part.
        if (first && ts.isStringLiteralLike(first) && !knownKeys.has(first.text)) {
          out.push(`${at(n)} : clé t() inconnue « ${first.text} »`);
        }
      }
      if (name === 'pushLog') {
        const line = n.arguments[1];
        const ok = line && ts.isCallExpression(line) && ['journal', 'formatLog'].includes(callee(line) ?? '');
        if (!ok) out.push(`${at(n)} : pushLog() reçoit autre chose qu'une ligne de journal()`);
      }
    }
    // La règle d'origine : `${clock()}  <texte en dur>` en lettres.
    if (ts.isTemplateExpression(n) && containsClock(n)) {
      const pieces = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)];
      if (pieces.some(hasLetters)) out.push(`${at(n)} : texte en dur après clock() : ${JSON.stringify(pieces.join('…'))}`);
    }
    // Journal d'une tâche reconstruite : `log: [ … ]` ne porte que des journal().
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'log'
      && ts.isArrayLiteralExpression(n.initializer)) {
      for (const el of n.initializer.elements) {
        if (!(ts.isCallExpression(el) && callee(el) === 'journal')) {
          out.push(`${at(el)} : élément de log: [...] qui n'est pas un journal()`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const KNOWN = new Set(Object.keys(EN));

describe('journal d\'export : aucune ligne en dur dans controller.ts', () => {
  const source = readFileSync(CONTROLLER, 'utf8');

  it('la source réelle est propre', () => {
    expect(findJournalViolations(source, KNOWN)).toEqual([]);
  });

  it('la garde ne passe pas à vide : controller.ts porte bien une vingtaine de lignes de journal', () => {
    expect((source.match(/\bjournal\(/g) ?? []).length).toBeGreaterThanOrEqual(20);
  });

  describe('contrôle positif : chaque dérive rougit', () => {
    const wrap = (body: string): string =>
      `function journal(key: string) { return \`\${clock()}  \${t(key)}\`; }\n${body}`;

    it('la source saine passe', () => {
      expect(findJournalViolations(wrap("pushLog(l, journal('log.batch'));"), KNOWN)).toEqual([]);
      expect(findJournalViolations(wrap("pushLog(l, journal(x ? 'log.batch' : 'log.error'));"), KNOWN)).toEqual([]);
    });

    it('une ligne `${clock()}  texte` réintroduite est refusée (trois façons de la voir)', () => {
      const bad = wrap('pushLog(item.log, `${clock()}  ✗ session Discord perdue`);');
      const v = findJournalViolations(bad, KNOWN);
      expect(v.some((m) => m.includes('clock() appelé hors de journal()'))).toBe(true);
      expect(v.some((m) => m.includes('texte en dur après clock()'))).toBe(true);
      expect(v.some((m) => m.includes('pushLog()'))).toBe(true);
    });

    it('un texte en dur qui suit une interpolation est vu aussi', () => {
      const bad = wrap('const x = `${clock()}  ${a} échec`;');
      expect(findJournalViolations(bad, KNOWN).some((m) => m.includes('texte en dur'))).toBe(true);
    });

    it('un pushLog avec une chaîne brute, une clé inconnue ou une clé calculée est refusé', () => {
      expect(findJournalViolations(wrap("pushLog(l, 'terminé');"), KNOWN)).not.toEqual([]);
      expect(findJournalViolations(wrap("pushLog(l, journal('log.n_existe_pas'));"), KNOWN)).not.toEqual([]);
      expect(findJournalViolations(wrap('pushLog(l, journal(k));'), KNOWN)).not.toEqual([]);
      expect(findJournalViolations(wrap("const s = t('log.n_existe_pas');"), KNOWN)).not.toEqual([]);
    });

    it('un journal initial `log: [ … ]` en dur est refusé', () => {
      expect(findJournalViolations(wrap("const q = { log: [`${stamp}  ↻ repris`] };"), KNOWN)).not.toEqual([]);
      expect(findJournalViolations(wrap("const q = { log: [journal('log.resumed')] };"), KNOWN)).toEqual([]);
    });

    it('un commentaire ou une chaîne qui parle de clock() ne déclenche rien', () => {
      const src = wrap("// ${clock()}  texte en dur dans un commentaire\nconst s = 'clock()';");
      expect(findJournalViolations(src, KNOWN)).toEqual([]);
    });
  });

  it('les clés construites existent : stop.<raison> (6 raisons) et le libellé de chaque type de média', () => {
    for (const k of ['auth', 'refused', 'blocked', 'rate-limited', 'no-tab', 'no-client']) {
      expect(KNOWN.has(`stop.${k}`), `stop.${k}`).toBe(true);
    }
    // Table KIND_LABEL_KEY : lue dans la source, valeurs vérifiées une à une.
    const sf = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
    const values: string[] = [];
    const walk = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'KIND_LABEL_KEY'
        && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) {
          if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) values.push(p.initializer.text);
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(values).toHaveLength(6); // image, video, audio, file, emoji, avatar (Record<AssetKind>, tsc)
    for (const v of values) expect(KNOWN.has(v), v).toBe(true);
  });
});

// ──────────────── 2. Masquage du rapport, dans chaque langue ────────────────

const interpolate = (tpl: string, params: Record<string, string | number>): string =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? `{${k}}`));

/** Les lignes de journal qui portent un nom de salon (formatLog + début de purge). */
const CHANNEL_LINES: [key: string, params: Record<string, string | number>][] = [
  ['log.channel_start', {}],
  ['log.batch', { count: 100 }],
  ['log.media', { kind: 'Images', count: 12 }],
  ['log.channel_done', { total: 2 }],
  ['log.purge_start', { count: 12 }],
];

describe('rapport de bug : le nom du salon est masqué dans chaque langue', () => {
  const CHANNEL = 'Mon fil de discussion';
  for (const f of LOCALE_FILES) {
    it(f, () => {
      const dict = load(f);
      for (const [key, params] of CHANNEL_LINES) {
        const raw = `16:12:22  ${interpolate(dict[key] ?? '', { channel: CHANNEL, ...params })}`;
        expect(raw, `${f} ${key}`).toContain(`#${CHANNEL}`);
        const masked = new ReportRedactor().line(raw);
        // Exactement le salon, rien d'autre : ni fuite, ni masquage du reste de la ligne.
        expect(masked, `${f} ${key}`).toBe(raw.replace(`#${CHANNEL}`, '#channel-1'));
      }
    });
  }

  it('contrôle positif : un salon suivi de mots (« #x dans … ») avalerait la fin de la ligne', () => {
    const redactor = new ReportRedactor();
    const raw = `16:12:22  🗑 Suppression dans #${CHANNEL} de 12 msg`;
    expect(redactor.line(raw)).not.toBe(raw.replace(`#${CHANNEL}`, '#channel-1'));
  });
});

// ─────────────────── 3. Bout en bout : une vraie purge ───────────────────

const ME = { id: '123456789012345678', username: 'moi' };
const GUILD = { id: '1100000000000000001', name: 'Groupe Test' };
const CHANNEL_ID = '1100000000000000002';
const M1 = '1100000000000000003';
const M2 = '1100000000000000004';

/** Charge un contrôleur NEUF dont `t()` est dans la langue demandée (détectée à l'import). */
async function controllerIn(language: string) {
  vi.stubGlobal('navigator', { language });
  vi.resetModules();
  const { VespryController } = await import('./controller');
  const fakes = await import('../../engine/test-fakes');
  const transport = new fakes.FakeTransport([], (req) => {
    if (req.path === '/users/@me') return fakes.ok(ME);
    if (req.method === 'DELETE' && req.path.endsWith(M2)) return fakes.status(403, { code: 50013 });
    if (req.method === 'DELETE') return fakes.status(204);
    return fakes.ok([]);
  });
  const c = new VespryController({
    transport,
    pacer: fakes.instantPacer(),
    requestToken: async () => 'jeton',
    requestPace: async () => null,
    reportSchema: async () => {},
  });
  await c.init();
  return c;
}

async function purgeLog(language: string): Promise<string[]> {
  const c = await controllerIn(language);
  const id = await c.purgeMessages(GUILD as never, CHANNEL_ID, 'général', [M1, M2]);
  await expect.poll(() => c.purgeQueue.find((p) => p.runId === id)?.status).toBe('partial');
  return c.purgeQueue.find((p) => p.runId === id)?.log ?? [];
}

/** Retire l'horodatage « 16:12:22  » (format de la langue). */
const noClock = (l: string): string => l.replace(/^[\d.:]+ {2}/, '');

describe('purge de bout en bout : le journal suit la langue de l\'interface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('anglais', async () => {
    const log = (await purgeLog('en-US')).map(noClock);
    expect(log).toEqual([
      '🗑 Deleting 2 msg · #général',
      '· 1/2 processed (OK: 1, failed: 0)',
      '⊘ 403 on message 1100000000000000004 — access denied',
      '· 2/2 processed (OK: 1, failed: 1)',
      '⚠ Finished — deleted: 1, failed: 1',
    ]);
  });

  it('français', async () => {
    const log = (await purgeLog('fr-FR')).map(noClock);
    expect(log).toEqual([
      '🗑 Suppression de 2 msg · #général',
      '· 1/2 traités (OK : 1, échecs : 0)',
      '⊘ 403 sur le message 1100000000000000004 — accès refusé',
      '· 2/2 traités (OK : 1, échecs : 1)',
      '⚠ Terminé — supprimés : 1, échecs : 1',
    ]);
  });

  it('japonais : aucun mot français ni anglais ne traîne', async () => {
    const log = (await purgeLog('ja-JP')).map(noClock);
    expect(log[0]).toBe('🗑 2 件のメッセージを削除中 · #général');
    expect(log.at(-1)).toBe('⚠ 完了 — 削除：1、失敗：1');
    for (const line of log) expect(line, line).not.toMatch(/purge|supprim|Finished|Deleting|traités/i);
  });

  it('l\'horodatage suit la langue (24 h, séparateurs de la locale)', async () => {
    const [first] = await purgeLog('fi-FI');
    expect(first).toMatch(/^\d{2}\.\d{2}\.\d{2} {2}🗑 /);
    const [en] = await purgeLog('en-US');
    expect(en).toMatch(/^\d{2}:\d{2}:\d{2} {2}🗑 /);
  });
});
