import { beforeEach, describe, expect, it } from 'vitest';
import { CheckpointStore } from './checkpoint-store';
import { buildJsonEnvelope, packageRun, ZipNameAllocator } from './packager';
import { profileForTier } from './perf-profile';
import { ALL_MEDIA } from './checkpoint-types';
import type { ChannelProgress, ExportRun, StoredAsset, StoredMessage } from './checkpoint-types';
import type { RawMessage } from './types';

function run(id: string): ExportRun {
  return {
    id,
    guildId: 'g1',
    guildName: 'Groupe Test',
    status: 'completed',
    options: {
      includeThreads: false,
      media: ALL_MEDIA,
      zones: [],
      zoneMode: 'any',
      formats: ['json', 'html', 'csv', 'txt'],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function channel(runId: string, id: string, name: string): ChannelProgress {
  return {
    runId, channelId: id, name, category: null, type: 0,
    status: 'done', cursor: null, messageCount: 0,
  };
}

function message(runId: string, channelId: string, id: string): StoredMessage {
  const m: RawMessage = {
    id, type: 0, channel_id: channelId,
    author: { id: 'u1', username: 'sam' },
    content: `msg ${id}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    attachments: [], embeds: [],
  };
  return { runId, channelId, messageId: id, message: m };
}

let store: CheckpointStore;
let n = 0;

beforeEach(async () => {
  n += 1;
  store = new CheckpointStore(`pkg-test-${n}`);
  await store.init();
});

describe('packageRun', () => {
  it('produit un zip non vide et un manifeste correct', async () => {
    await store.putRun(run('r1'));
    await store.putChannel(channel('r1', 'c1', 'général'));
    await store.appendMessages([
      message('r1', 'c1', '1'),
      message('r1', 'c1', '2'),
    ]);

    const { blob, manifest } = await packageRun(store, 'r1');

    expect(blob.size).toBeGreaterThan(0);
    const m = manifest as { totals: { messages: number; channels: number } };
    expect(m.totals.messages).toBe(2);
    expect(m.totals.channels).toBe(1);
  });

  it('compte les médias téléchargés dans le manifeste', async () => {
    await store.putRun(run('r2'));
    await store.putChannel(channel('r2', 'c1', 'général'));
    await store.appendMessages([message('r2', 'c1', '1')]);
    const asset: StoredAsset = {
      runId: 'r2', assetId: 'a1', channelId: 'c1',
      url: 'https://cdn/x.png', kind: 'image', filename: 'x.png',
      status: 'done', blob: new Blob(['img-bytes']),
    };
    await store.putAsset(asset);

    const { manifest } = await packageRun(store, 'r2');
    const m = manifest as { totals: { assetsDownloaded: number } };
    expect(m.totals.assetsDownloaded).toBe(1);
  });

  it('découpe un gros salon en partitions', async () => {
    const r = run('r3');
    r.options.partitionSize = 2;
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel('r3', 'c1', 'general'));
    await store.appendMessages([
      message('r3', 'c1', '1'), message('r3', 'c1', '2'),
      message('r3', 'c1', '3'), message('r3', 'c1', '4'),
      message('r3', 'c1', '5'),
    ]);

    const { manifest } = await packageRun(store, 'r3');
    const m = manifest as { channels: { files: string[]; messages: number }[] };
    // 5 messages / 2 → 3 partitions, un fichier JSON chacune.
    expect(m.channels[0]?.files).toHaveLength(3);
    expect(m.channels[0]?.files.some((f) => /\.part1\.json$/.test(f))).toBe(true);
    expect(m.channels[0]?.files.some((f) => /\.part3\.json$/.test(f))).toBe(true);
    expect(m.channels[0]?.messages).toBe(5);
  });

  it('lève une erreur si le run est introuvable', async () => {
    await expect(packageRun(store, 'inexistant')).rejects.toThrow();
  });

  it('préserve les champs Discord inconnus dans le JSON (forward-compat)', async () => {
    await store.putRun(run('rfc'));
    await store.putChannel(channel('rfc', 'c1', 'general'));
    // simule un message contenant un champ Discord futur que Vespry ne type pas.
    const enriched = message('rfc', 'c1', '1');
    (enriched.message as unknown as Record<string, unknown>)['future_discord_field']
      = { kind: 'voice_note_v2', secret: 42 };
    await store.appendMessages([enriched]);

    const { blob } = await packageRun(store, 'rfc');
    const buf = await blob.arrayBuffer();
    // le contenu du zip est binaire, mais la chaîne du JSON apparaît telle quelle
    // dans le flux non compressé (nos JSON sont sans STORED compression).
    const ascii = new TextDecoder().decode(new Uint8Array(buf));
    expect(ascii).toContain('future_discord_field');
    expect(ascii).toContain('voice_note_v2');
  });

  it('mode bulk (fast) — comportement historique préservé', async () => {
    await store.putRun(run('rfast'));
    await store.putChannel(channel('rfast', 'c1', 'général'));
    await store.appendMessages([
      message('rfast', 'c1', '1'),
      message('rfast', 'c1', '2'),
    ]);

    const { blob, manifest } = await packageRun(store, 'rfast', {
      profile: profileForTier('fast'),
    });
    expect(blob.size).toBeGreaterThan(0);
    const m = manifest as { totals: { messages: number } };
    expect(m.totals.messages).toBe(2);

    // En mode bulk le JSON contient bien le tableau `messages` au sens classique.
    const ascii = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(ascii).toContain('"messages"');
    expect(ascii).toContain('"msg 1"');
  });

  it('mode streaming (low) — exporte 1 000 messages sans tout charger', async () => {
    // Profil `low` : `bufferMessagesPerPage = 0` ; le packager clampe à un
    // plancher interne pour ne pas saturer le pipeline conflux. On vérifie
    // que le chemin streaming traite un salon dont les messages dépassent
    // largement la taille d'un fichier d'export courant, et que le JSON
    // produit est intègre. 1 000 messages × 4 formats reste rapide en
    // fake-indexeddb (Chromium natif est ordre de grandeur plus rapide).
    const N = 1_000;
    await store.putRun(run('rbig'));
    await store.putChannel(channel('rbig', 'c1', 'général'));
    for (let i = 0; i < N; i += 500) {
      const batch: StoredMessage[] = [];
      for (let j = 0; j < 500 && i + j < N; j += 1) {
        const id = String(i + j + 1).padStart(7, '0');
        batch.push(message('rbig', 'c1', id));
      }
      await store.appendMessages(batch);
    }

    const { blob, manifest } = await packageRun(store, 'rbig', {
      profile: profileForTier('low'),
    });
    expect(blob.size).toBeGreaterThan(0);
    const m = manifest as { totals: { messages: number } };
    expect(m.totals.messages).toBe(N);

    // Le JSON streamé contient bien le compteur et les bornes du salon.
    const ascii = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(ascii).toContain(`"messageCount": ${N}`);
    expect(ascii).toContain('"msg 0000001"');
    expect(ascii).toContain(`"msg ${String(N).padStart(7, '0')}"`);
  }, 60_000);

  it('mode streaming respecte le partitionnement utilisateur', async () => {
    const r = run('rstreampart');
    r.options.partitionSize = 2;
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel('rstreampart', 'c1', 'general'));
    await store.appendMessages([
      message('rstreampart', 'c1', '1'),
      message('rstreampart', 'c1', '2'),
      message('rstreampart', 'c1', '3'),
      message('rstreampart', 'c1', '4'),
      message('rstreampart', 'c1', '5'),
    ]);

    const { manifest } = await packageRun(store, 'rstreampart', {
      profile: profileForTier('low'),
    });
    const m = manifest as { channels: { files: string[]; messages: number }[] };
    expect(m.channels[0]?.files).toHaveLength(3);
    expect(m.channels[0]?.files.some((f) => /\.part1\.json$/.test(f))).toBe(true);
    expect(m.channels[0]?.files.some((f) => /\.part3\.json$/.test(f))).toBe(true);
    expect(m.channels[0]?.messages).toBe(5);
  });

  it('chiffrement AES — zipPassword renseigné produit un zip déchiffrable', async () => {
    const { BlobReader, ZipReader } = await import('@zip.js/zip.js');

    const r = run('renc');
    r.options.zipPassword = 'correct-horse-battery-staple';
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel('renc', 'c1', 'general'));
    await store.appendMessages([
      message('renc', 'c1', '1'),
      message('renc', 'c1', '2'),
    ]);

    const { blob, manifest } = await packageRun(store, 'renc');

    // Le manifest reflète bien le drapeau encrypted, SANS exposer le mdp.
    const m = manifest as { encrypted: boolean; options: Record<string, unknown> };
    expect(m.encrypted).toBe(true);
    expect(m.options['zipPassword']).toBeUndefined();

    // Le zip extérieur (wrapper AES) est lisible sans mot de passe — il
    // contient UNE entrée unique chiffrée. La lecture du contenu de cette
    // entrée exige le bon mot de passe.
    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    expect(entries).toHaveLength(1);
    const inner = entries[0];
    expect(inner?.encrypted).toBe(true);
    await reader.close();

    // Mauvais mot de passe → la lecture échoue. On accède via `getData` qui
    // est défini sur les entrées fichier (pas répertoire) — le wrapper
    // n'ajoute qu'une entrée fichier, donc cette voie est sûre.
    const wrongReader = new ZipReader(new BlobReader(blob), { password: 'wrong' });
    const wrongEntries = await wrongReader.getEntries();
    const wrongInner = wrongEntries[0];
    const { BlobWriter } = await import('@zip.js/zip.js');
    await expect(async () => {
      const getData = (wrongInner as { getData?: (w: unknown) => Promise<unknown> }).getData;
      if (!getData) throw new Error('entry has no getData (DirectoryEntry?)');
      await getData(new BlobWriter());
    }).rejects.toBeDefined();
    await wrongReader.close();
  });

  it('chiffrement AES — pas de mdp → comportement non chiffré', async () => {
    await store.putRun(run('rclear'));
    await store.putChannel(channel('rclear', 'c1', 'general'));
    await store.appendMessages([message('rclear', 'c1', '1')]);

    const { blob, manifest } = await packageRun(store, 'rclear');
    const m = manifest as { encrypted: boolean };
    expect(m.encrypted).toBe(false);
    // Le contenu du zip non chiffré est lisible directement — un message
    // apparaît tel quel dans le flux (STORED = pas de compression sur JSON).
    const ascii = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(ascii).toContain('"msg 1"');
  });
});

describe('buildJsonEnvelope', () => {
  /**
   * Couvre le shape de l'enveloppe JSON agent-ready (audit B+C 2026-05-18).
   * On vérifie que tous les champs promis dans PRIVACY.md / CHANGELOG sont
   * présents, que le typeName est résolu depuis l'enum, et que les champs
   * Discord d'origine sont conservés (forward-compat).
   */
  it('produit l\'enveloppe complète avec $schema, vespryVersion, guild, channel, typeName', () => {
    const env = buildJsonEnvelope({
      guildId: 'g1',
      guildName: 'Mon Serveur',
      channel: { id: 'c1', name: 'général', type: 0 },
      messages: [{ id: 'm1', type: 19, content: 'hello' }],
    });
    expect(env['$schema']).toBeTypeOf('string');
    expect(env['vespryVersion']).toBeTypeOf('string');
    expect(env['exportedAt']).toBeTypeOf('string');
    expect(env['guild']).toEqual({ id: 'g1', name: 'Mon Serveur' });
    expect(env['channel']).toEqual({
      id: 'c1', name: 'général', type: 0, typeName: 'GUILD_TEXT',
    });
    expect(env['messageCount']).toBe(1);
  });

  it('résout typeName depuis MESSAGE_TYPE_NAMES (19 → REPLY)', () => {
    const env = buildJsonEnvelope({
      guildId: 'g1', guildName: 'G',
      channel: { id: 'c1', name: 'c', type: 0 },
      messages: [
        { type: 0, id: 'm1' },
        { type: 19, id: 'm2' },
        { type: 21, id: 'm3' },
      ],
    });
    const msgs = env['messages'] as { typeName: string }[];
    expect(msgs[0]!.typeName).toBe('DEFAULT');
    expect(msgs[1]!.typeName).toBe('REPLY');
    expect(msgs[2]!.typeName).toBe('THREAD_STARTER_MESSAGE');
  });

  it('annote typeName UNKNOWN_X pour un type Discord inconnu (forward-compat)', () => {
    const env = buildJsonEnvelope({
      guildId: 'g1', guildName: 'G',
      channel: { id: 'c1', name: 'c', type: 999 },
      messages: [{ type: 9999, id: 'm1' }],
    });
    const ch = env['channel'] as { typeName: string };
    const msg = (env['messages'] as { typeName: string }[])[0]!;
    expect(ch.typeName).toBe('UNKNOWN_999');
    expect(msg.typeName).toBe('UNKNOWN_9999');
  });

  it('inclut `part` quand l\'export est partitionné, l\'omet sinon', () => {
    const partitioned = buildJsonEnvelope({
      guildId: 'g1', guildName: 'G',
      channel: { id: 'c1', name: 'c', type: 0 },
      part: { index: 1, total: 3 },
      messages: [],
    });
    expect(partitioned['part']).toEqual({ index: 1, total: 3 });
    const monolith = buildJsonEnvelope({
      guildId: 'g1', guildName: 'G',
      channel: { id: 'c1', name: 'c', type: 0 },
      messages: [],
    });
    expect('part' in monolith).toBe(false);
  });

  it('préserve les champs Discord d\'origine (forward-compat, on AJOUTE typeName)', () => {
    const env = buildJsonEnvelope({
      guildId: 'g1', guildName: 'G',
      channel: { id: 'c1', name: 'c', type: 0 },
      messages: [{
        id: 'm1',
        type: 0,
        content: 'hello',
        // Champs Discord arbitraires — doivent traverser intacts.
        edited_timestamp: '2026-01-02T00:00:00Z',
        pinned: true,
        future_discord_field: 'unknown',
      }],
    });
    const msg = (env['messages'] as Record<string, unknown>[])[0]!;
    expect(msg['content']).toBe('hello');
    expect(msg['edited_timestamp']).toBe('2026-01-02T00:00:00Z');
    expect(msg['pinned']).toBe(true);
    expect(msg['future_discord_field']).toBe('unknown');
    expect(msg['typeName']).toBe('DEFAULT'); // ajouté en plus
  });
});

/**
 * Homonymes dans le zip (relecture du 06/11/2026). Les captures collées dans
 * Discord s'appellent toutes `image.png`, et deux catégories ont souvent
 * chacune leur salon « général » : sans dédoublonnage, deux entrées du zip
 * portaient le même chemin et l'une écrasait l'autre à la décompression.
 */
describe('packageRun — noms homonymes', () => {
  async function entryNames(blob: Blob): Promise<string[]> {
    const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(blob));
    const names = (await reader.getEntries()).map((e) => e.filename);
    await reader.close();
    return names;
  }

  it('deux pièces jointes `image.png` du même salon : deux fichiers distincts, chacun référencé', async () => {
    const r = run('rdup');
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel('rdup', 'c1', 'general'));
    const m1 = message('rdup', 'c1', '1');
    const m2 = message('rdup', 'c1', '2');
    m1.message.attachments = [{ id: 'a1', filename: 'image.png', url: 'https://cdn/a1/image.png', proxy_url: 'https://cdn/a1/image.png', size: 1 }];
    m2.message.attachments = [{ id: 'a2', filename: 'image.png', url: 'https://cdn/a2/image.png', proxy_url: 'https://cdn/a2/image.png', size: 1 }];
    await store.appendMessages([m1, m2]);
    for (const [id, url] of [['a1', 'https://cdn/a1/image.png'], ['a2', 'https://cdn/a2/image.png']] as const) {
      await store.putAsset({
        runId: 'rdup', assetId: id, channelId: 'c1', url, kind: 'image',
        filename: 'image.png', status: 'done', blob: new Blob([id]),
      });
    }

    const { blob } = await packageRun(store, 'rdup', { profile: profileForTier('fast') });
    const names = await entryNames(blob);
    const media = names.filter((n) => n.startsWith('media/'));
    expect(media).toHaveLength(2);
    expect(new Set(media).size).toBe(2);
    expect(new Set(names).size).toBe(names.length);

    // Chaque message pointe vers SON fichier.
    const ascii = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    for (const path of media) expect(ascii).toContain(`"localPath": "${path}"`);
  });

  it.each(['fast', 'low'] as const)('deux salons « general » (%s) : deux fichiers JSON distincts', async (tier) => {
    const r = run(`rsal-${tier}`);
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel(r.id, 'c1', 'general'));
    await store.putChannel(channel(r.id, 'c2', 'general'));
    await store.putChannel(channel(r.id, 'c3', 'General')); // FS insensibles à la casse
    await store.appendMessages([message(r.id, 'c1', '1'), message(r.id, 'c2', '2'), message(r.id, 'c3', '3')]);

    const { blob, manifest } = await packageRun(store, r.id, { profile: profileForTier(tier) });
    const json = (await entryNames(blob)).filter((n) => n.startsWith('json/'));
    expect(json).toHaveLength(3);
    expect(new Set(json.map((n) => n.toLowerCase())).size).toBe(3);
    const files = (manifest as { channels: { files: string[] }[] }).channels.flatMap((c) => c.files);
    expect(new Set(files.map((f) => f.toLowerCase())).size).toBe(3);
  });

  it('contrôle positif : des noms distincts restent inchangés', async () => {
    const r = run('rpos');
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel('rpos', 'c1', 'annonces'));
    await store.putChannel(channel('rpos', 'c2', 'croquis'));
    await store.appendMessages([message('rpos', 'c1', '1'), message('rpos', 'c2', '2')]);
    const { blob } = await packageRun(store, 'rpos', { profile: profileForTier('fast') });
    const json = (await entryNames(blob)).filter((n) => n.startsWith('json/')).sort();
    expect(json).toEqual(['json/annonces.json', 'json/croquis.json']);
  });
});

describe('ZipNameAllocator', () => {
  it('premier venu garde son nom, les suivants prennent -2, -3 avant l\'extension', () => {
    const a = new ZipNameAllocator();
    expect(a.claim('media/general/image.png')).toBe('media/general/image.png');
    expect(a.claim('media/general/image.png')).toBe('media/general/image-2.png');
    expect(a.claim('media/general/Image.PNG')).toBe('media/general/Image-3.PNG');
  });
  it('sans extension à garder : suffixe en fin de nom (nom de salon pointé)', () => {
    const a = new ZipNameAllocator();
    expect(a.claim('general.croquis', false)).toBe('general.croquis');
    expect(a.claim('general.croquis', false)).toBe('general.croquis-2');
  });
  it('un point dans un dossier n\'est pas une extension', () => {
    const a = new ZipNameAllocator();
    a.claim('media/a.b/fichier');
    expect(a.claim('media/a.b/fichier')).toBe('media/a.b/fichier-2');
  });
  it('un suffixe déjà pris est sauté', () => {
    const a = new ZipNameAllocator();
    a.claim('x/image-2.png');
    a.claim('x/image.png');
    expect(a.claim('x/image.png')).toBe('x/image-3.png');
  });
});

/**
 * INDEX.md (relecture du 06/11/2026) : il était écrit en français en dur
 * pour toutes les langues. Il passe désormais par `t()` (clés `idx.*`) ; les
 * tests tournent en anglais (`navigator.language` = en-US), donc on y lit
 * l'anglais — et plus un mot de français.
 */
describe('packageRun — INDEX.md', () => {
  async function readIndex(blob: Blob): Promise<string> {
    const { BlobReader, TextWriter, ZipReader } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(blob));
    const entry = (await reader.getEntries()).find((e) => e.filename === 'INDEX.md');
    if (!entry || entry.directory) throw new Error('INDEX.md absent du zip');
    const text = await entry.getData(new TextWriter());
    await reader.close();
    return text;
  }

  it('est rédigé via t() : ni français en dur, ni clé brute', async () => {
    await store.putRun(run('ridx'));
    await store.putChannel(channel('ridx', 'c1', 'general'));
    await store.appendMessages([message('ridx', 'c1', '1'), message('ridx', 'c1', '2')]);
    const { blob } = await packageRun(store, 'ridx', { profile: profileForTier('fast') });
    const index = await readIndex(blob);

    expect(index).toContain('# Discord export — Groupe Test');
    expect(index).toContain('- Channels: **1**');
    expect(index).toContain('- Messages: **2**');
    expect(index).toContain('| Channel | Messages | Media | Files |');
    // Le contrat du format reste lisible tel quel.
    for (const token of ['`json/<channel>.json`', '`localPath`', '`message_reference`', '`manifest.json`']) {
      expect(index).toContain(token);
    }
    // Renvoi vers le schéma complet, avec son lien.
    expect(index).toContain(
      '[`docs/SCHEMA.md`](https://github.com/atelier-sam/vespry/blob/main/docs/SCHEMA.md)',
    );
    // Contrôle négatif : plus de français en dur, et aucune clé non résolue.
    expect(index).not.toMatch(/Comment lire|Médias téléchargés|Fichiers|Salons/);
    expect(index).not.toMatch(/\bidx\./);
    expect(index).not.toMatch(/\{(guild|url)\}/);
  });

  it('liste chaque salon et ses fichiers dans le tableau', async () => {
    const r = run('ridx2');
    r.options.formats = ['json'];
    await store.putRun(r);
    await store.putChannel(channel('ridx2', 'c1', 'annonces'));
    await store.appendMessages([message('ridx2', 'c1', '1')]);
    const { blob } = await packageRun(store, 'ridx2', { profile: profileForTier('fast') });
    const index = await readIndex(blob);
    expect(index).toContain('| annonces | 1 | 0 | `json/annonces.json` |');
  });
});
