/**
 * Rapport de schéma opt-in. Essai réel du 06/11/2026 : appelé depuis
 * l'offscreen (sans `chrome.storage`), il levait à chaque fin d'export et
 * l'opt-in ne pouvait jamais aboutir. Il passe désormais par le service
 * worker, avec les champs dans le message.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSchemaReportMessage, maybeSendSchemaReport, SCHEMA_REPORT_KIND } from './schema-report';

const KEY = 'vespry.schemaReport';

function fakeChrome(initial: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initial };
  const local = {
    get: vi.fn(async (k: string) => ({ [k]: data[k] })),
    set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(data, o); }),
  };
  vi.stubGlobal('chrome', { storage: { local }, runtime: { getManifest: () => ({ version: '1.1.0' }) } });
  return { data, local };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isSchemaReportMessage — message reçu d\'un autre contexte', () => {
  it('accepte des noms de champs', () => {
    expect(isSchemaReportMessage({ kind: SCHEMA_REPORT_KIND, fields: ['message.foo', 'embed.bar'] })).toBe(true);
  });
  it.each([
    ['autre kind', { kind: 'autre', fields: ['a'] }],
    ['champs absents', { kind: SCHEMA_REPORT_KIND }],
    ['champ non texte', { kind: SCHEMA_REPORT_KIND, fields: [1] }],
    ['champ vide', { kind: SCHEMA_REPORT_KIND, fields: [''] }],
    ['champ trop long', { kind: SCHEMA_REPORT_KIND, fields: ['x'.repeat(201)] }],
    ['trop de champs', { kind: SCHEMA_REPORT_KIND, fields: Array.from({ length: 201 }, (_, i) => `f${i}`) }],
    ['null', null],
  ])('refuse : %s', (_label, m) => {
    expect(isSchemaReportMessage(m)).toBe(false);
  });
});

describe('maybeSendSchemaReport', () => {
  it('sans chrome.storage (contexte offscreen) : ne lève pas, n\'émet rien', async () => {
    vi.stubGlobal('chrome', { runtime: {} });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(maybeSendSchemaReport('https://api.example', ['message.foo'])).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opt-in absent : rien ne part', async () => {
    fakeChrome({});
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    await maybeSendSchemaReport('https://api.example', ['message.foo']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opt-in actif : un envoi, puis plus rien pour les mêmes champs', async () => {
    const { data } = fakeChrome({ [KEY]: { enabled: true } });
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    await maybeSendSchemaReport('https://api.example/', ['b', 'a']);
    await maybeSendSchemaReport('https://api.example/', ['a', 'b']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/schema-report');
    const body = JSON.parse(String(init.body)) as { fields: string[] };
    expect(body.fields).toEqual(['b', 'a']);
    expect((data[KEY] as { lastSentSig?: string }).lastSentSig).toBe('a,b');
  });

  it('aucun champ inconnu : ne lit même pas le stockage', async () => {
    const { local } = fakeChrome({ [KEY]: { enabled: true } });
    await maybeSendSchemaReport('https://api.example', []);
    expect(local.get).not.toHaveBeenCalled();
  });
});
