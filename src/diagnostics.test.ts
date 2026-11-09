/**
 * Rapport de bug : il part dans un ticket GitHub PUBLIC. Avant le 06/11/2026,
 * le résumé et le journal d'une tâche échouée y mettaient le nom du serveur
 * et des salons en clair, malgré la mention « ne contient ni jeton ni
 * contenu de messages ».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildIssueUrl, buildReport, collectReport, ISSUE_FORM, ISSUE_URL_MAX, renderReport, ReportRedactor, reportProblem,
  wellFormed,
} from './diagnostics';

vi.mock('./version', () => ({ GITHUB_REPO: 'atelier-sam/vespry', getVersion: () => '1.1.0' }));

const LOG = [
  '16:12:22  → #général…',
  '16:12:25  #général · +100 msg',
  '16:12:26  #Mon fil de discussion · ↓ 3 images',
  '16:12:30  ✓ #général — 2 msg',
  '16:12:31  ✗ salon introuvable : run_x/1100000000000000002',
  '16:12:32  ✗ échec https://cdn.discordapp.com/attachments/1/2/photo-de-moi.png?ex=abc',
  '16:12:33  ✗ contact sam@example.org',
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReportRedactor', () => {
  it('salons : alias stable par nom, noms à espaces compris', () => {
    const r = new ReportRedactor();
    const out = LOG.slice(0, 4).map((l) => r.line(l));
    expect(out).toEqual([
      '16:12:22  → #channel-1…',
      '16:12:25  #channel-1 · +100 msg',
      '16:12:26  #channel-2 · ↓ 3 images',
      '16:12:30  ✓ #channel-1 — 2 msg',
    ]);
  });

  it('identifiants, liens et e-mails masqués', () => {
    const r = new ReportRedactor();
    expect(r.line(LOG[4] ?? '')).toBe('16:12:31  ✗ salon introuvable : run_x/<id>');
    expect(r.line(LOG[5] ?? '')).toBe('16:12:32  ✗ échec <link>');
    expect(r.line(LOG[6] ?? '')).toBe('16:12:33  ✗ contact <e-mail>');
  });

  it('nom du serveur masqué partout ; nom trop court ignoré', () => {
    expect(new ReportRedactor(['Studio Kitsune']).line('Paquet de Studio Kitsune prêt')).toBe('Paquet de [server] prêt');
    expect(new ReportRedactor(['a']).line('une ligne banale')).toBe('une ligne banale');
  });

  it('contrôle positif : les titres Markdown et les chemins d\'extension restent', () => {
    const r = new ReportRedactor();
    expect(r.line('### Log')).toBe('### Log');
    expect(r.line('### Journal')).toBe('### Journal');
    expect(r.line('at f (chrome-extension://abcdef/assets/x.js:1:2)')).toBe('at f (chrome-extension://abcdef/assets/x.js:1:2)');
    expect(r.line('16:12:40  📦 Paquet prêt — 0.1 Mo')).toBe('16:12:40  📦 Paquet prêt — 0.1 Mo');
  });
});

describe('ReportRedactor — noms et liens adverses (revue Codex, 09/11/2026)', () => {
  const lines = (r: ReportRedactor, xs: string[]): string[] => xs.map((l) => r.line(l));

  it('nom de salon CONNU qui contient un séparateur : masqué en entier', () => {
    const r = new ReportRedactor([], ['Dossier — Alice Martin', 'Notes · Bob…']);
    expect(lines(r, [
      '16:12:22  → #Dossier — Alice Martin…',
      '16:12:30  ✓ #Dossier — Alice Martin — 2 msg',
      '16:12:31  #Notes · Bob… · +100 msg',
    ])).toEqual([
      '16:12:22  → #channel-1…',
      '16:12:30  ✓ #channel-1 — 2 msg',
      '16:12:31  #channel-2 · +100 msg',
    ]);
  });

  it('nom de salon INCONNU qui contient un séparateur : le repli ne laisse rien du nom', () => {
    const r = new ReportRedactor();
    for (const l of ['→ #Dossier — Alice Martin…', '✓ #Dossier — Alice Martin — 2 msg', '#Notes · Bob · ↓ images: 3']) {
      const out = r.line(l);
      expect(out).not.toMatch(/Alice|Martin|Bob|Dossier|Notes/);
    }
    // Contrôle positif : le compteur après le dernier séparateur reste lisible.
    expect(r.line('✓ #Dossier — Alice Martin — 2 msg')).toBe('✓ #channel-1 — 2 msg');
  });

  it('un serveur nommé « https » ne désarme pas la passe des liens', () => {
    const out = new ReportRedactor(['https']).line('✗ échec https://cdn.discordapp.com/attachments/1/secret-photo.png?ex=abc');
    expect(out).toBe('✗ échec <link>');
    // Contrôle positif : le nom seul, hors lien, est bien masqué.
    expect(new ReportRedactor(['https']).line('serveur https prêt')).toBe('serveur [server] prêt');
  });

  it('un serveur nommé « link » ne réécrit pas le jeton <link>', () => {
    expect(new ReportRedactor(['link']).line('voir https://x.example/a')).toBe('voir <link>');
  });

  it('parenthèse ou crochet dans un lien : la fin du lien ne reste pas en clair', () => {
    const r = new ReportRedactor();
    expect(r.line('err https://example.org/photo).png?token=secret fin')).toBe('err <link> fin');
    expect(r.line('err https://example.org/a]b?token=secret')).toBe('err <link>');
  });

  it('caractères d\'usage privé en entrée : rendus tels quels, sans effet sur le masquage', () => {
    const out = new ReportRedactor(['Studio Kitsune']).line('a \uE000\uE100\uE001 Studio Kitsune');
    expect(out).toBe('a \uE000\uE100\uE001 [server]');
  });

  // Seconde revue Codex (09/11/2026) : régressions de la méthode par passes à jetons.
  it('nom de serveur qui CONTIENT une adresse ou un lien : masqué en entier', () => {
    expect(new ReportRedactor(['Alice sam@example.org']).line('serveur Alice sam@example.org prêt'))
      .toBe('serveur [server] prêt');
    expect(new ReportRedactor(['Studio https://example.org']).line('serveur Studio https://example.org prêt'))
      .toBe('serveur [server] prêt');
    // Contrôle positif : l'adresse seule, sans le nom, reste une adresse.
    expect(new ReportRedactor(['Alice sam@example.org']).line('écrire à sam@example.org')).toBe('écrire à <e-mail>');
  });

  it('salon connu COURT, vrai nom inconnu plus long : la fin du nom ne reste pas en clair', () => {
    const r = new ReportRedactor([], ['Dossier']);
    for (const l of ['→ #Dossier — Alice Martin…', '✓ #Dossier — Alice Martin — 2 msg']) {
      expect(r.line(l)).not.toMatch(/Alice|Martin/);
    }
    // Contrôle positif : le salon connu seul garde son alias et son compteur.
    expect(r.line('✓ #Dossier — 2 msg')).toMatch(/^✓ #channel-\d+ — 2 msg$/u);
  });

  it('fin de ligne CR (texte CRLF) : le repli masque quand même', () => {
    const r = new ReportRedactor();
    expect(r.line('✓ #Alice — 2 msg\r')).toBe('✓ #channel-1 — 2 msg ');
    expect(r.line('→ #Bob\u2028suite…')).not.toContain('Bob');
  });

  it('alias stable entre salon connu et repli pour le même nom', () => {
    const r = new ReportRedactor([], ['général']);
    expect(r.line('→ #général…')).toBe('→ #channel-1…');
    expect(r.line('✓ #général — 3 msg')).toBe('✓ #channel-1 — 3 msg');
    expect(r.line('#général · ↓ images: 2')).toBe('#channel-1 · ↓ images: 2');
  });
});

describe('buildReport', () => {
  it('rien d\'identifiant dans le rapport assemblé', () => {
    const body = buildReport('Export échoué', LOG, new ReportRedactor(['Studio Kitsune']));
    for (const leak of ['général', 'Mon fil', '1100000000000000002', 'cdn.discordapp.com', 'sam@example.org']) {
      expect(body, leak).not.toContain(leak);
    }
    expect(body).toContain('### Log');
    expect(body).toContain('#channel-2');
  });
  it('journal CRLF : aucune ligne n\'échappe au masquage', () => {
    const body = buildReport('x', ['✓ #Alice — 2 msg\r\n→ #Bob Martin…\r'], new ReportRedactor());
    expect(body).not.toMatch(/Alice|Bob|Martin|\r/u);
    expect(body).toContain('#channel-1 — 2 msg');
  });
});

describe('reportProblem', () => {
  it('le ticket ouvert ne porte ni le nom du serveur ni ceux des salons', async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    await reportProblem('Export échoué : Studio Kitsune', LOG, ['Studio Kitsune']);
    const url = decodeURIComponent(String((open.mock.calls[0] as unknown[] | undefined)?.[0]));
    expect(url).toContain('github.com/atelier-sam/vespry/issues/new');
    expect(url).not.toContain('Studio Kitsune');
    expect(url).not.toContain('général');
    expect(url).toContain('[server]');
  });
  it('noms exacts des salons transmis : ni l\'URL ni le presse-papier ne portent un nom à séparateur', async () => {
    const writeText = vi.fn(async (_t: string) => {});
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { language: 'en', userAgent: 'test', clipboard: { writeText } });
    const log = ['16:12:22  → #Dossier — Alice Martin…', '16:12:30  ✓ #Dossier — Alice Martin — 2 msg'];
    await reportProblem('Export failed', log, ['Studio Kitsune'], ['Dossier — Alice Martin']);
    const url = decodeURIComponent(String((open.mock.calls[0] as unknown[] | undefined)?.[0]));
    const copied = String(writeText.mock.calls[0]?.[0]);
    for (const out of [url, copied]) {
      expect(out).not.toMatch(/Alice|Martin|Dossier/);
      expect(out).toContain('✓ #channel-1 — 2 msg');
    }
  });
  it('formulaire bug.yml, champ report, plus de body=', async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    expect(await reportProblem('Export failed', LOG.slice(0, 2))).toBe('issue');
    const url = String((open.mock.calls[0] as unknown[] | undefined)?.[0]);
    expect(url).toContain('/issues/new?template=bug.yml&title=');
    expect(url).toContain('&report=');
    expect(url).not.toContain('body=');
    expect(new URL(url).searchParams.get('title')).toBe('[bug] Export failed');
  });

  it('rapport trop long : rapport COMPLET copié AVANT l\'ouverture, notice qui dit de coller', async () => {
    const order: string[] = [];
    const writeText = vi.fn(async (_t: string) => { order.push('copy'); });
    const open = vi.fn(() => { order.push('open'); return null; });
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { language: 'en', userAgent: 'test', clipboard: { writeText } });
    expect(await reportProblem('Export failed', bigLog(250, 200))).toBe('issue-truncated');
    expect(order).toEqual(['copy', 'open']);
    const url = String((open.mock.calls[0] as unknown[] | undefined)?.[0]);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
    expect(reportOf(url)).toContain('the full report is in your clipboard: paste it here');
    expect(new URL(url).searchParams.get('version')).toBe('1.1.0');
    const copied = String(writeText.mock.calls[0]?.[0]);
    expect(copied).toContain('line 000 ');
    expect(copied).toContain('line 249 ');
    expect(copied).not.toContain('removed (');
  });

  it('copie refusée : jamais « issue-truncated », la notice ne promet pas le presse-papier', async () => {
    const writeText = vi.fn(async () => { throw new Error('Document is not focused'); });
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('navigator', { language: 'en', userAgent: 'test', clipboard: { writeText } });
    expect(await reportProblem('Export failed', bigLog(250, 200))).toBe('issue');
    const text = reportOf(String((open.mock.calls[0] as unknown[] | undefined)?.[0]));
    expect(text).toContain('(report too long for a link)');
    expect(text).not.toContain('clipboard');
  });

  it('moitié de paire UTF-16 dans le journal : pas d\'exception, U+FFFD à la place', async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    const broken = '📦 Paquet'.slice(1); // commence par une moitié basse isolée
    expect(await reportProblem('x\uD83D', [broken, ...bigLog(250, 200)])).not.toBe('clipboard');
    const url = String((open.mock.calls[0] as unknown[] | undefined)?.[0]);
    expect(() => decodeURIComponent(url)).not.toThrow();
    expect(wellFormed(broken)).toBe('� Paquet');
  });
});

/** `n` lignes de `width` caractères, numérotées pour savoir lesquelles restent. */
function bigLog(n: number, width: number, filler = 'x'): string[] {
  return Array.from({ length: n }, (_, i) => `line ${String(i).padStart(3, '0')} `.padEnd(width, filler));
}

function reportOf(url: string): string {
  return new URL(url).searchParams.get('report') ?? '';
}

/** Clôtures ``` équilibrées et pied présent : le formulaire ajoute ses champs APRÈS. */
function wellShaped(text: string): boolean {
  const fences = text.split('\n').filter((l) => l === '```').length;
  return fences % 2 === 0 && text.endsWith('Read it before sending: the issue is public._');
}

describe('buildIssueUrl', () => {
  const REPO = 'atelier-sam/vespry';

  it('contrôle positif : un petit rapport passe entier, sans notice', () => {
    const r = collectReport('Export failed', LOG.slice(0, 3));
    const { url, truncated } = buildIssueUrl(REPO, '[bug] Export failed', r);
    expect(truncated).toBe(false);
    expect(reportOf(url)).toBe(renderReport(r));
    expect(reportOf(url)).not.toContain('removed');
    expect(url).toContain(`issues/new?template=${ISSUE_FORM.file}&title=`);
  });

  it('250 lignes de 200 caractères : URL ≤ 5000, retrait MINIMAL des plus anciennes, compte exact', () => {
    const r = collectReport('Export failed', bigLog(250, 200));
    const { url, truncated } = buildIssueUrl(REPO, '[bug] Export failed', r);
    expect(truncated).toBe(true);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
    const text = reportOf(url);
    expect(wellShaped(text)).toBe(true);
    const m = /… (\d+) earlier log lines removed \(report too long for a link\) …/u.exec(text);
    expect(m).not.toBeNull();
    const dropped = Number(m?.[1]);
    const kept = text.split('\n').filter((l) => l.startsWith('line '));
    expect(dropped + kept.length).toBe(250);
    expect(kept.at(-1)).toMatch(/^line 249 /u);
    expect(kept[0]).toMatch(new RegExp(`^line ${String(dropped).padStart(3, '0')} `, 'u'));
    // Minimal : avec une ligne retirée de moins, l'URL dépasserait.
    const head = url.split(`&${ISSUE_FORM.report}=`)[0] ?? '';
    const lessTrim = renderReport(r, { log: dropped - 1, errors: 0, unknowns: 0, copied: false });
    expect(`${head}&report=${encodeURIComponent(lessTrim)}`.length).toBeGreaterThan(ISSUE_URL_MAX);
  });

  it('caractères non ASCII comptés APRÈS encodage (japonais : 9 octets par caractère)', () => {
    const r = collectReport('エクスポート失敗', bigLog(120, 120, '日'));
    const { url, truncated } = buildIssueUrl(REPO, '[bug] エクスポート失敗', r);
    expect(truncated).toBe(true);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX);
    expect(() => decodeURIComponent(url)).not.toThrow();
    expect(reportOf(url)).toContain('earlier log lines removed');
  });

  it('masqué d\'abord : aucune fuite, et l\'URL est une sous-séquence du rapport complet', () => {
    const log = [...LOG, ...bigLog(200, 150)];
    const r = collectReport('Export failed: Studio Kitsune', log, new ReportRedactor(['Studio Kitsune']));
    const { url, truncated } = buildIssueUrl(REPO, `[bug] ${r.summary}`, r);
    expect(truncated).toBe(true);
    for (const leak of ['Studio Kitsune', 'général', '1100000000000000002', 'sam@example.org']) {
      expect(decodeURIComponent(url), leak).not.toContain(leak);
    }
    expect(r.summary).toContain('[server]');
    const full = new Set(renderReport(r).split('\n'));
    const extra = reportOf(url).split('\n').filter((l) => !full.has(l));
    expect(extra).toHaveLength(1); // la seule ligne neuve est la notice
    expect(extra[0]).toMatch(/earlier log lines removed/u);
  });

  it('planchers : le journal garde ses 15 dernières lignes avant que les erreurs soient touchées', () => {
    const r = { ...collectReport('x', bigLog(100, 100)), errors: bigLog(40, 100, 'e') };
    const text = reportOf(buildIssueUrl(REPO, '[bug] x', r).url);
    expect(text).toMatch(/earlier error lines removed/u);
    expect(text.split('\n').filter((l) => /^line \d{3} x/u.test(l))).toHaveLength(15);
    expect(text.split('\n').filter((l) => /^line \d{3} e/u.test(l)).length).toBeGreaterThanOrEqual(10);
    expect(wellShaped(text)).toBe(true);
  });

  it('balayage de la limite : toujours ≤ max, toujours décodable, notice juste dès que coupé', () => {
    const r = collectReport('Export 📦 échoué %20 日本', [
      ...bigLog(60, 90),
      '📦 Paquet prêt — 日本語のテキスト 100%',
      ...bigLog(60, 90, '日'),
    ]);
    for (let max = 300; max <= 6000; max += 37) {
      const { url, truncated } = buildIssueUrl(REPO, '[bug] 😀 title', r, { maxLength: max });
      expect(url.length, String(max)).toBeLessThanOrEqual(max);
      expect(() => decodeURIComponent(url), String(max)).not.toThrow();
      const text = reportOf(url);
      if (truncated && max >= 2500) {
        expect(wellShaped(text), String(max)).toBe(true);
        const m = /… (\d+) earlier log lines removed/u.exec(text);
        const kept = text.split('\n').filter((l) => /^line \d{3} /u.test(l) || l.startsWith('📦')).length;
        expect(Number(m?.[1]) + kept, String(max)).toBe(121);
      }
    }
  });

  it('dernier recours (budget minuscule) : coupe sur caractères entiers, emoji compris', () => {
    const emo = { ...collectReport('x'), unknowns: ['😀'.repeat(3000)] };
    for (const max of [400, 401, 402, 403]) {
      const { url } = buildIssueUrl(REPO, '[bug] x', emo, { maxLength: max });
      expect(url.length).toBeLessThanOrEqual(max);
      expect(() => decodeURIComponent(url)).not.toThrow();
    }
  });

  it('titre et résumé démesurés bornés', () => {
    const r = collectReport('b'.repeat(5000));
    expect(Array.from(r.summary).length).toBeLessThanOrEqual(300);
    const { url } = buildIssueUrl(REPO, 'a'.repeat(5000), r);
    expect(new URL(url).searchParams.get('title')?.length).toBeLessThanOrEqual(120);
  });
});
