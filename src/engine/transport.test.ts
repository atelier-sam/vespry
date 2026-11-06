import { describe, expect, it } from 'vitest';
import { isAllowedRequest, userIdFromToken } from './transport';

const R = '/channels/111/messages/222/reactions/';

describe('isAllowedRequest — liste blanche des routes', () => {
  it('accepte les routes de lecture et la suppression d’un message', () => {
    expect(isAllowedRequest({ method: 'GET', path: '/users/@me' })).toBe(true);
    expect(isAllowedRequest({ method: 'GET', path: '/channels/1/messages?limit=100&before=9' })).toBe(true);
    expect(isAllowedRequest({ method: 'DELETE', path: '/channels/1/messages/2' })).toBe(true);
  });

  it('accepte les emoji tels que getReactions les encode (unicode et custom)', () => {
    for (const key of ['👍', 'party_blob:123456789012345678', '❤️', 'a-b_c']) {
      const path = `${R}${encodeURIComponent(key)}?limit=100&type=0`;
      expect(isAllowedRequest({ method: 'GET', path })).toBe(true);
    }
  });

  // Relecture Codex H2 (06/11/2026) : le segment emoji ouvrait une remontée
  // de chemin, normalisée ensuite par l'analyseur d'URL.
  it('refuse une remontée de chemin cachée dans le segment emoji', () => {
    const attaques = [
      `${R}%2e%2e\\%2e%2e\\%2e%2e\\%2e%2e\\%2e%2e\\%2e%2e\\users\\@me\\billing\\payment-sources`,
      `${R}%2E%2E`,
      `${R}..`,
      `${R}x%2fy`,
      `${R}x%5Cy`,
      `${R}x\\y`,
      `${R}x#frag`,
      `${R}x.y`,
    ];
    for (const path of attaques) {
      expect(isAllowedRequest({ method: 'GET', path }), path).toBe(false);
    }
  });

  it('refuse méthode, chemin hors liste, URL absolue', () => {
    expect(isAllowedRequest({ method: 'POST', path: '/users/@me' })).toBe(false);
    expect(isAllowedRequest({ method: 'GET', path: '/users/@me/billing/payment-sources' })).toBe(false);
    expect(isAllowedRequest({ method: 'GET', path: 'https://evil.example/' })).toBe(false);
    expect(isAllowedRequest({ method: 'GET', path: '//evil.example/channels/1' })).toBe(false);
    expect(isAllowedRequest({ method: 'DELETE', path: '/channels/1/messages' })).toBe(false);
  });
});

describe('userIdFromToken', () => {
  it('lit l\'id du premier segment (base64 sans remplissage, base64url)', () => {
    const id = '123456789012345678';
    const head = btoa(id).replace(/=+$/, '');
    expect(userIdFromToken(`${head}.Gx.y`)).toBe(id);
    expect(userIdFromToken(`${head.replace(/\+/g, '-').replace(/\//g, '_')}.Gx.y`)).toBe(id);
  });
  it('null si absent ou de forme inconnue', () => {
    expect(userIdFromToken(undefined)).toBeNull();
    expect(userIdFromToken('pas.un.jeton!')).toBeNull();
    expect(userIdFromToken(`${btoa('abc')}.x.y`)).toBeNull();
  });
  it('asUser doit être un id', () => {
    expect(isAllowedRequest({ method: 'GET', path: '/users/@me', asUser: '42' })).toBe(true);
    expect(isAllowedRequest({ method: 'GET', path: '/users/@me', asUser: 'x' })).toBe(false);
    expect(isAllowedRequest({ method: 'GET', path: '/users/@me', asUser: 42 })).toBe(false);
  });
});
