/**
 * Verrou d'arrêt posé pendant le CHARGEMENT de la session (re-relecture Codex
 * H3, 06/11/2026) : le client API d'un chargement raté est jeté, son verrou
 * ne doit pas partir avec lui. Aucune annonce d'onglet ne réémet ensuite vers
 * Discord ; seul le bouton Reprendre (`clearHalt`) relance le chargement.
 */
import { describe, expect, it } from 'vitest';
import { VespryController } from './controller';
import { FakeTransport, instantPacer, ok, status } from '../../engine/test-fakes';
import { TransportError } from '../../engine/transport';

const ME = { id: '123456789012345678', username: 'moi' };

function controllerWith(t: FakeTransport): VespryController {
  return new VespryController({
    transport: t,
    pacer: instantPacer(),
    requestToken: async () => 'jeton-identique',
    requestPace: async () => null,
  });
}

describe('VespryController — verrou de session (Codex H3)', () => {
  it('captcha au chargement : verrou posé, une annonce d\'onglet ne réémet RIEN', async () => {
    const t = new FakeTransport([status(400, { captcha_key: ['captcha-required'] })]);
    const c = controllerWith(t);
    await c.onDiscordTabReady();
    expect(t.calls).toHaveLength(1);
    expect(c.halt).toBe('refused');
    expect(c.api).toBeNull();

    // L'onglet se ré-annonce (rechargement, ré-annonce temporisée) : rien ne part.
    await c.onDiscordTabReady();
    await c.onDiscordTabReady();
    expect(t.calls).toHaveLength(1);
    expect(c.halt).toBe('refused');
  });

  it('le bouton Reprendre lève le verrou et relance le chargement', async () => {
    const t = new FakeTransport([
      status(400, { captcha_key: ['captcha-required'] }),
      ok(ME),
      ok([]),
    ]);
    const c = controllerWith(t);
    await c.onDiscordTabReady();
    expect(c.halt).toBe('refused');

    c.clearHalt();
    await expect.poll(() => c.api !== null).toBe(true);
    expect(c.halt).toBeNull();
    expect(t.calls.map((r) => r.path)).toEqual(['/users/@me', '/users/@me', '/users/@me/guilds']);
  });

  it('contrôle positif : une panne sans refus (pas d\'onglet) ne verrouille pas', async () => {
    const t = new FakeTransport([new TransportError('no-tab', 'aucun onglet'), ok(ME), ok([])]);
    const c = controllerWith(t);
    await c.onDiscordTabReady();
    expect(c.halt).toBeNull();
    // L'onglet s'ouvre : le chargement repart tout seul (reprise automatique permise).
    await c.onDiscordTabReady();
    expect(c.api).not.toBeNull();
  });
});

describe('VespryController — un seul chargement de session (essai réel 06/11)', () => {
  it('init et annonce d\'onglet simultanées : /users/@me et /guilds partent UNE fois', async () => {
    const t = new FakeTransport([], (req) => (req.path === '/users/@me' ? ok(ME) : ok([])));
    const c = controllerWith(t);
    await Promise.all([c.init(), c.onDiscordTabReady()]);
    expect(c.api).not.toBeNull();
    expect(t.calls.map((r) => r.path)).toEqual(['/users/@me', '/users/@me/guilds']);
  });

  it('contrôle positif : un chargement raté peut être retenté ensuite', async () => {
    const t = new FakeTransport([new TransportError('no-tab', 'aucun onglet'), ok(ME), ok([])]);
    const c = controllerWith(t);
    await c.onDiscordTabReady();
    expect(c.api).toBeNull();
    await c.onDiscordTabReady();
    expect(c.api).not.toBeNull();
    expect(t.calls.map((r) => r.path)).toEqual(['/users/@me', '/users/@me', '/users/@me/guilds']);
  });
});
