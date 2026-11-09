/**
 * Bandeau « mise à jour disponible » : réservé aux installations hors store.
 * Une release GitHub sort avant que le store ait relu la version ; l'annoncer
 * à une installation du store promettait une mise à jour introuvable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, isNewer, isStoreInstall } from './version';

function stubChrome(installType: string | Error) {
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '1.1.0' }) },
    management: {
      getSelf: vi.fn(async () => {
        if (installType instanceof Error) throw installType;
        return { installType };
      }),
    },
  });
}

function stubRelease(tag: string) {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ tag_name: tag }), { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

afterEach(() => vi.unstubAllGlobals());

describe('isStoreInstall', () => {
  it.each([
    ['normal', true],
    ['development', false],
    ['sideload', false],
    ['admin', false],
  ])('installType %s → store %s', async (type, expected) => {
    stubChrome(type);
    expect(await isStoreInstall()).toBe(expected);
  });

  it('API absente ou en erreur : considéré comme store (on se tait)', async () => {
    stubChrome(new Error('management indisponible'));
    expect(await isStoreInstall()).toBe(true);
    vi.stubGlobal('chrome', { runtime: {} });
    expect(await isStoreInstall()).toBe(true);
  });
});

describe('checkForUpdate', () => {
  it('installation du store : aucune requête, aucun bandeau', async () => {
    stubChrome('normal');
    const fetchSpy = stubRelease('v1.2.0');
    expect(await checkForUpdate()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('contrôle positif : installation manuelle, release plus récente → annoncée', async () => {
    stubChrome('development');
    stubRelease('v1.2.0');
    expect(await checkForUpdate()).toBe('1.2.0');
  });

  it('installation manuelle déjà à jour : rien', async () => {
    stubChrome('development');
    stubRelease('v1.1.0');
    expect(await checkForUpdate()).toBeNull();
  });
});

describe('isNewer', () => {
  it('compare composante par composante', () => {
    expect(isNewer('1.10.0', '1.9.9')).toBe(true);
    expect(isNewer('1.1.0', '1.1.0')).toBe(false);
  });
});
