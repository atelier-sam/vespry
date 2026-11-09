/**
 * Témoin de l'essai réel du 06/11/2026 : export d'un salon texte, fils inclus.
 * Ce banc joue l'enqueue COMPLET (contrôleur réel, transport factice routé
 * par chemin) et vérifie que la recherche de fils part, sous la forme exacte
 * qu'emploie le client Discord. (Sur le banc réel, elle n'était pas relayée :
 * le service worker du profil de test tournait sur une ancienne version.)
 */
import { describe, expect, it } from 'vitest';
import { VespryController } from './controller';
import { FakeTransport, instantPacer, ok } from '../../engine/test-fakes';
import type { TransportRequest, TransportResponse } from '../../engine/transport';

const ME = { id: '123456789012345678', username: 'moi' };
const GUILD = { id: '1100000000000000001', name: 'Studio Kitsune' };
const CHANNEL = { id: '1100000000000000002', name: 'annonces', type: 0, guild_id: GUILD.id };

function route(req: TransportRequest): TransportResponse {
  const p = req.path;
  if (p === '/users/@me') return ok(ME);
  if (p === '/users/@me/guilds') return ok([GUILD]);
  if (p.includes('/threads/search')) return ok({ threads: [], members: [], has_more: false });
  if (p.includes('/messages/search')) return ok({ total_results: 0, messages: [] });
  if (p.includes('/messages')) return ok([]);
  return ok([]);
}

describe('enqueue — fils d\'un salon texte (essai réel 06/11)', () => {
  it('la recherche de fils part avant le premier message exporté', async () => {
    const t = new FakeTransport([], route);
    const c = new VespryController({
      transport: t,
      pacer: instantPacer(),
      requestToken: async () => 'jeton',
      requestPace: async () => null,
    });
    await c.init();
    expect(c.api).not.toBeNull();
    await c.enqueue(GUILD as never, [CHANNEL as never], { images: false, videos: false, audio: false, files: false }, {
      includeThreads: true,
      zones: [],
      zoneMode: 'any',
      partitionSize: 0,
      formats: ['html'],
    } as never);
    const paths = t.calls.map((r) => r.path);
    const search = paths.findIndex((p) => p.includes('/threads/search'));
    expect(search, `requêtes émises : ${paths.join(' , ')}`).toBeGreaterThan(-1);
    // Même forme que le client Discord (cf. discord-api.searchArchivedThreads).
    expect(paths[search]).toBe(
      `/channels/${CHANNEL.id}/threads/search?archived=true&sort_by=last_message_time&sort_order=desc&limit=25&offset=0`,
    );
  });
});
