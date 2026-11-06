/**
 * Rapport de bug : il part dans un ticket GitHub PUBLIC. Avant le 06/11/2026,
 * le résumé et le journal d'une tâche échouée y mettaient le nom du serveur
 * et des salons en clair, malgré la mention « ne contient ni jeton ni
 * contenu de messages ».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReport, ReportRedactor, reportProblem } from './diagnostics';

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
      '16:12:22  → #salon-1…',
      '16:12:25  #salon-1 · +100 msg',
      '16:12:26  #salon-2 · ↓ 3 images',
      '16:12:30  ✓ #salon-1 — 2 msg',
    ]);
  });

  it('identifiants, liens et e-mails masqués', () => {
    const r = new ReportRedactor();
    expect(r.line(LOG[4] ?? '')).toBe('16:12:31  ✗ salon introuvable : run_x/<id>');
    expect(r.line(LOG[5] ?? '')).toBe('16:12:32  ✗ échec <lien>');
    expect(r.line(LOG[6] ?? '')).toBe('16:12:33  ✗ contact <e-mail>');
  });

  it('nom du serveur masqué partout ; nom trop court ignoré', () => {
    expect(new ReportRedactor(['Studio Kitsune']).line('Paquet de Studio Kitsune prêt')).toBe('Paquet de [serveur] prêt');
    expect(new ReportRedactor(['a']).line('une ligne banale')).toBe('une ligne banale');
  });

  it('contrôle positif : les titres Markdown et les chemins d\'extension restent', () => {
    const r = new ReportRedactor();
    expect(r.line('### Journal')).toBe('### Journal');
    expect(r.line('at f (chrome-extension://abcdef/assets/x.js:1:2)')).toBe('at f (chrome-extension://abcdef/assets/x.js:1:2)');
    expect(r.line('16:12:40  📦 Paquet prêt — 0.1 Mo')).toBe('16:12:40  📦 Paquet prêt — 0.1 Mo');
  });
});

describe('buildReport', () => {
  it('rien d\'identifiant dans le rapport assemblé', () => {
    const body = buildReport('Export échoué', LOG, new ReportRedactor(['Studio Kitsune']));
    for (const leak of ['général', 'Mon fil', '1100000000000000002', 'cdn.discordapp.com', 'sam@example.org']) {
      expect(body, leak).not.toContain(leak);
    }
    expect(body).toContain('### Journal');
    expect(body).toContain('#salon-2');
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
    expect(url).toContain('[serveur]');
  });
});
