/**
 * Tests du contrôleur d'overlay — fonctions pures uniquement.
 *
 * Le `VespryController` complet dépend de chrome.runtime, IndexedDB et de
 * la session Discord ; on évite de le piloter en test direct (le moteur
 * d'export est déjà couvert par `export-runner.test.ts`). Ici on cible
 * la logique extraite en fonctions pures — actuellement `collectDmThreads`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  collectDmThreads,
  collectGuildThreads,
  MAX_THREAD_SEARCH_PAGES,
  type DmThreadProbe,
  type GuildThreadProbe,
} from './controller';
import { DiscordApiError, type RawChannel, type RawMessage } from '../../engine/types';

/** Crée un message minimal avec un thread optionnel. */
function makeMessage(id: string, thread?: RawChannel): RawMessage {
  return {
    id,
    type: 0,
    channel_id: 'dm-1',
    author: { id: 'u1', username: 'sam' },
    content: `m${id}`,
    timestamp: '2026-05-01T00:00:00.000Z',
    attachments: [],
    embeds: [],
    ...(thread ? { thread } : {}),
  };
}

/** Fabrique un thread RawChannel (type 11 = public thread, type 12 = private). */
function makeThread(id: string, name: string, parentId = 'dm-1'): RawChannel {
  return { id, type: 11, name, parent_id: parentId };
}

/** Mock minimal d'API Discord — retourne les messages prédéfinis par salon. */
function fakeApi(byChannel: Record<string, RawMessage[]>): DmThreadProbe {
  return {
    getMessages: vi.fn(async (channelId: string) => byChannel[channelId] ?? []),
  };
}

describe('collectDmThreads', () => {
  it('un DM avec 5 messages dont 2 portent un thread → 3 salons (DM + 2 threads)', async () => {
    // Cas spec : la sélection d'origine = un seul DM. Sur ses 5 derniers
    // messages, deux ont ouvert un thread. La méthode doit renvoyer
    // [DM, thread1, thread2] — soit 3 « salons » exportables.
    const dm: RawChannel = { id: 'dm-1', type: 1, name: 'sam <> alice' };
    const t1 = makeThread('th-1', 'idée projet');
    const t2 = makeThread('th-2', 'liens utiles');
    const api = fakeApi({
      'dm-1': [
        makeMessage('5', t1),
        makeMessage('4'),
        makeMessage('3', t2),
        makeMessage('2'),
        makeMessage('1'),
      ],
    });

    const expanded = await collectDmThreads(api, [dm]);

    expect(expanded).toHaveLength(3);
    expect(expanded[0]).toBe(dm);
    const ids = expanded.slice(1).map((c) => c.id).sort();
    expect(ids).toEqual(['th-1', 'th-2']);
  });

  it('déduplique les threads par id (deux messages pointant le même thread)', async () => {
    const dm: RawChannel = { id: 'dm-1', type: 1, name: 'sam <> alice' };
    const shared = makeThread('th-shared', 'fil partagé');
    const api = fakeApi({
      'dm-1': [
        makeMessage('3', shared),
        makeMessage('2'),
        makeMessage('1', shared),
      ],
    });

    const expanded = await collectDmThreads(api, [dm]);

    // Un seul thread malgré deux références — la Map dédoublonne par id.
    expect(expanded).toHaveLength(2);
    expect(expanded[1]?.id).toBe('th-shared');
  });

  it('couvre les DM (type 1) et les group DM (type 3)', async () => {
    const dm: RawChannel = { id: 'dm-1', type: 1, name: 'alice' };
    const groupDm: RawChannel = { id: 'gdm-1', type: 3, name: 'amis' };
    const t1 = makeThread('th-1', 'idée', 'dm-1');
    const t2 = makeThread('th-2', 'plan', 'gdm-1');
    const api = fakeApi({
      'dm-1': [makeMessage('1', t1)],
      'gdm-1': [makeMessage('1', t2)],
    });

    const expanded = await collectDmThreads(api, [dm, groupDm]);

    const ids = expanded.map((c) => c.id);
    expect(ids).toContain('th-1');
    expect(ids).toContain('th-2');
    expect(expanded).toHaveLength(4);
  });

  it('saute les salons non-DM (guild text) — on ne fetch pas inutilement', async () => {
    const guildText: RawChannel = { id: 'g-1', type: 0, name: 'général' };
    const getMessages = vi.fn(async () => []);
    const api: DmThreadProbe = { getMessages };

    const expanded = await collectDmThreads(api, [guildText]);

    expect(expanded).toEqual([guildText]);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('tolère un DM qui throw (révoqué / vidé) — pas de propagation', async () => {
    const dm: RawChannel = { id: 'dm-bad', type: 1, name: 'inaccessible' };
    const api: DmThreadProbe = {
      getMessages: vi.fn(async () => { throw new Error('403 forbidden'); }),
    };

    // Ne lève pas — le DM cassé est ignoré, la liste retourne le salon seul.
    const expanded = await collectDmThreads(api, [dm]);
    expect(expanded).toEqual([dm]);
  });

  it('aucun thread → retourne la liste d\'origine inchangée', async () => {
    const dm: RawChannel = { id: 'dm-1', type: 1, name: 'sam <> alice' };
    const api = fakeApi({
      'dm-1': [makeMessage('1'), makeMessage('2')],
    });

    const expanded = await collectDmThreads(api, [dm]);

    expect(expanded).toHaveLength(1);
    expect(expanded[0]).toBe(dm);
  });
});

describe('collectDmThreads — refus de Discord', () => {
  it('un refus n\'est jamais avalé : il remonte', async () => {
    const api: DmThreadProbe = {
      getMessages: vi.fn(async () => { throw new DiscordApiError('refused', 403, 'non'); }),
    };
    await expect(collectDmThreads(api, [{ id: 'dm-1', type: 1 }])).rejects.toMatchObject({ kind: 'refused' });
  });
});

// Essai réel du 06/11/2026 : uniquement les requêtes que le client fait.
describe('collectGuildThreads', () => {
  const text: RawChannel = { id: 'c1', type: 0, name: 'général' };
  const forum: RawChannel = { id: 'f1', type: 15, name: 'forum' };
  const voice: RawChannel = { id: 'v1', type: 2, name: 'vocal' };

  function guildApi(over: Partial<GuildThreadProbe> = {}): GuildThreadProbe {
    return {
      getMessages: vi.fn(async () => []),
      searchArchivedThreads: vi.fn(async () => ({ threads: [], hasMore: false })),
      ...over,
    };
  }

  it('fils des messages récents + fils archivés paginés (offset cumulé), dédupliqués', async () => {
    const active = makeThread('t-active', 'actif', 'c1');
    const archivedA = makeThread('t-a', 'archivé A', 'c1');
    const archivedB = makeThread('t-b', 'archivé B', 'c1');
    const search = vi.fn(async (_ch: string, offset: number) => (offset === 0
      ? { threads: [archivedA, active], hasMore: true }
      : { threads: [archivedB], hasMore: false }));
    const api = guildApi({
      getMessages: vi.fn(async () => [makeMessage('1', active), makeMessage('2')]),
      searchArchivedThreads: search,
    });
    const out = await collectGuildThreads(api, [text]);
    expect(out.map((c) => c.id)).toEqual(['c1', 't-active', 't-a', 't-b']);
    expect(search.mock.calls).toEqual([['c1', 0], ['c1', 2]]);
  });

  it('forum : recherche de fils, pas de lecture de messages ; vocal : rien', async () => {
    const api = guildApi();
    await collectGuildThreads(api, [forum, voice]);
    expect(api.getMessages).not.toHaveBeenCalled();
    expect(api.searchArchivedThreads).toHaveBeenCalledTimes(1);
    expect(api.searchArchivedThreads).toHaveBeenCalledWith('f1', 0);
  });

  it('pagination bornée', async () => {
    let n = 0;
    const api = guildApi({
      searchArchivedThreads: vi.fn(async () => ({ threads: [makeThread(`t${n++}`, 'x', 'f1')], hasMore: true })),
    });
    await collectGuildThreads(api, [forum]);
    expect(api.searchArchivedThreads).toHaveBeenCalledTimes(MAX_THREAD_SEARCH_PAGES);
  });

  it('salon inaccessible (forbidden) : ignoré, la suite continue', async () => {
    const api = guildApi({
      getMessages: vi.fn(async () => { throw new DiscordApiError('forbidden', 403, 'accès'); }),
      searchArchivedThreads: vi.fn(async () => { throw new DiscordApiError('forbidden', 403, 'accès'); }),
    });
    expect((await collectGuildThreads(api, [text, forum])).map((c) => c.id)).toEqual(['c1', 'f1']);
  });

  it('refus de Discord pendant la lecture ou la recherche : remonte, rien d\'autre n\'est demandé', async () => {
    const refused = () => { throw new DiscordApiError('refused', 403, 'non'); };
    const a = guildApi({ getMessages: vi.fn(async () => refused()) });
    await expect(collectGuildThreads(a, [text, forum])).rejects.toMatchObject({ kind: 'refused' });
    expect(a.searchArchivedThreads).not.toHaveBeenCalled();
    const b = guildApi({ searchArchivedThreads: vi.fn(async () => refused()) });
    await expect(collectGuildThreads(b, [forum, text])).rejects.toMatchObject({ kind: 'refused' });
    expect(b.getMessages).not.toHaveBeenCalled();
  });
});
