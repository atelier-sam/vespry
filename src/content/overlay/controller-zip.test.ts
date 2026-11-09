/**
 * Paquet d'une tâche terminée, après redémarrage (essai réel du 06/11/2026).
 *
 * Le zip ne vit qu'en mémoire. Les tâches reconstruites au démarrage
 * restaient « Préparation de l'archive… » pour toujours, sans bouton ; et le
 * mot de passe d'une archive chiffrée restait en clair dans IndexedDB, contre
 * ce que promet l'interface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VespryController } from './controller';
import { CheckpointStore } from '../../engine/checkpoint-store';
import { ALL_MEDIA, type ExportRun } from '../../engine/checkpoint-types';
import { FakeTransport, instantPacer, ok } from '../../engine/test-fakes';
import { t } from '../../ui/i18n';
import type { TransportRequest, TransportResponse } from '../../engine/transport';

const ME = { id: '123456789012345678', username: 'moi' };

function route(req: TransportRequest): TransportResponse {
  if (req.path === '/users/@me') return ok(ME);
  return ok([]);
}

let seq = 0;

/** Un run terminé dans le checkpoint, comme laissé par une session précédente. */
async function seedCompletedRun(password?: string): Promise<string> {
  seq += 1;
  const id = `run_zip_${seq}_${Math.random().toString(36).slice(2, 8)}`;
  const store = new CheckpointStore();
  await store.init();
  const run: ExportRun = {
    id,
    guildId: '1100000000000000001',
    guildName: 'Groupe Test',
    status: 'completed',
    options: {
      includeThreads: false,
      media: ALL_MEDIA,
      zones: [],
      zoneMode: 'any',
      formats: ['json'],
      ...(password ? { zipPassword: password } : {}),
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await store.putRun(run);
  await store.putChannel({
    runId: id, channelId: '1100000000000000002', name: 'général', category: null, type: 0,
    status: 'done', cursor: null, messageCount: 1,
  });
  await store.appendMessages([{
    runId: id,
    channelId: '1100000000000000002',
    messageId: '1100000000000000003',
    message: {
      id: '1100000000000000003', type: 0, channel_id: '1100000000000000002',
      author: { id: 'u1', username: 'sam' }, content: 'bonjour',
      timestamp: '2026-09-05T12:34:00.000Z', attachments: [], embeds: [],
    },
  }]);
  return id;
}

/** Contrôleur « au redémarrage » : il reconstruit sa file depuis le checkpoint. */
async function restartedController(download = vi.fn(async () => {})) {
  const c = new VespryController({
    transport: new FakeTransport([], route),
    pacer: instantPacer(),
    requestToken: async () => 'jeton',
    requestPace: async () => null,
    download,
    reportSchema: async () => {},
  });
  await c.init();
  return { c, download };
}

const view = (c: VespryController, runId: string) =>
  c.toState().queue.find((q) => q.runId === runId);

afterEach(() => {
  vi.useRealTimers();
});

describe('tâche terminée reconstruite au démarrage', () => {
  it('le bouton est offert, et le clic refait le paquet puis le télécharge', async () => {
    const runId = await seedCompletedRun();
    const { c, download } = await restartedController();
    const before = view(c, runId);
    expect(before?.zipReady).toBe(false);
    expect(before?.zipPacking).toBe(false);
    expect(before?.zipUnavailable).toBe(false);

    await c.downloadZip(runId);

    expect(download).toHaveBeenCalledTimes(1);
    const [url, filename] = download.mock.calls[0] as unknown as [string, string];
    expect(url).toMatch(/^blob:/);
    expect(filename).toBe('vespry-Groupe_Test.zip');
    expect(view(c, runId)?.zipReady).toBe(true);
  });

  it('pendant la fabrication, l\'état dit « en préparation » (pas de bouton)', async () => {
    const runId = await seedCompletedRun();
    const { c } = await restartedController();
    const pending = c.downloadZip(runId);
    expect(view(c, runId)?.zipPacking).toBe(true);
    await pending;
    expect(view(c, runId)?.zipPacking).toBe(false);
  });

  it('deux clics rapprochés : un seul paquet fabriqué', async () => {
    const runId = await seedCompletedRun();
    const { c, download } = await restartedController();
    const spy = vi.spyOn(c.store, 'getChannels');
    await Promise.all([c.downloadZip(runId), c.downloadZip(runId)]);
    // packageRun lit les salons une fois ; un second paquet les relirait.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('une panne du téléchargement est journalisée, sans rejet', async () => {
    const runId = await seedCompletedRun();
    const { c } = await restartedController(vi.fn(async () => { throw new Error('downloads refusé'); }));
    await expect(c.downloadZip(runId)).resolves.toBeUndefined();
    // Le journal est dans la langue de l'interface : on compare à la clé, pas à un texte français.
    const line = t('log.download_failed', { error: 'Error: downloads refusé' });
    expect(view(c, runId)?.log.some((l) => l.endsWith(line))).toBe(true);
  });
});

describe('archive chiffrée : le mot de passe ne reste pas dans le checkpoint', () => {
  it('effacé après la première fabrication, drapeau `encrypted` posé', async () => {
    const runId = await seedCompletedRun('correct-horse-battery-staple');
    const { c, download } = await restartedController();
    await c.downloadZip(runId);
    expect(download).toHaveBeenCalledTimes(1);
    const stored = await c.store.getRun(runId);
    expect(stored?.options.zipPassword).toBeUndefined();
    expect(stored?.options.encrypted).toBe(true);
  });

  it('après redémarrage : refus de refaire le paquet EN CLAIR, l\'UI le dit', async () => {
    const runId = await seedCompletedRun('correct-horse-battery-staple');
    const first = await restartedController();
    await first.c.downloadZip(runId);

    const { c, download } = await restartedController();
    await c.downloadZip(runId);
    expect(download).not.toHaveBeenCalled();
    const v = view(c, runId);
    expect(v?.zipUnavailable).toBe(true);
    expect(v?.zipReady).toBe(false);
    expect(v?.log.some((l) => l.includes(t('queue.zip_unavailable')))).toBe(true);
  });

  it('contrôle positif : sans mot de passe, le paquet se refait à chaque redémarrage', async () => {
    const runId = await seedCompletedRun();
    await (await restartedController()).c.downloadZip(runId);
    const { c, download } = await restartedController();
    await c.downloadZip(runId);
    expect(download).toHaveBeenCalledTimes(1);
    expect(view(c, runId)?.zipUnavailable).toBe(false);
  });
});
