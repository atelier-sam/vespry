/**
 * Harnais de captures d'écran pour le store.
 *
 * Monte le VRAI overlay Vespry (`openOverlay`) avec un contrôleur factice
 * alimenté par des données 100 % synthétiques (cast Sora / Kitsune / Tanuki,
 * déjà utilisé pour la démo HTML). Aucune session Discord, aucun serveur
 * privé, aucun appel réseau de données : le rendu est fidèle au pixel à ce
 * qu'un utilisateur voit, sans fuite.
 *
 * Le backdrop de l'overlay étant OPAQUE (`.v-backdrop` masque entièrement la
 * page), il n'y a pas besoin de reconstituer Discord derrière — la capture
 * montre exactement l'expérience réelle.
 *
 * Piloté ensuite par Playwright (`capture.mjs`), qui clique/saisit pour
 * atteindre chaque état (focus salon, filtres, multi-sélection, export
 * terminé) puis capture en 1280×800.
 */
import { openOverlay } from '../../src/content/overlay/mount';
import type { RawChannel, RawGuild, RawMessage, RawUser } from '../../src/engine/types';
import { ChannelType } from '../../src/engine/types';
import type { QueueItemView } from '../../src/messaging';
import type { DonorFeed } from '../../src/donors';

/* ── Cast synthétique ─────────────────────────────────────────────────── */

function user(id: string, name: string, bot = false): RawUser {
  return { id, username: name, global_name: name, discriminator: '0', avatar: null, bot };
}
const SORA = user('100000000000000001', 'Sora', true);
const KITSUNE = user('100000000000000002', 'Kitsune', true);
const TANUKI = user('100000000000000003', 'Tanuki', true);

/* ── Serveurs (sans icône → monogramme 2 lettres, zéro réseau) ─────────── */

const GUILDS: RawGuild[] = [
  { id: '200000000000000001', name: 'Studio Kitsune', icon: null },
  { id: '200000000000000002', name: 'Les Trailers', icon: null },
  { id: '200000000000000003', name: 'WWOOF Sverige', icon: null },
  { id: '200000000000000004', name: 'Atelier Dev', icon: null },
  { id: '200000000000000005', name: 'Photo & Drone', icon: null },
];

/* ── Salons du serveur actif (catégories + salons texte) ──────────────── */

function chan(
  id: string,
  name: string,
  position: number,
  type: ChannelType = ChannelType.GUILD_TEXT,
  parent_id: string | null = null,
): RawChannel {
  return { id, type, name, position, parent_id, guild_id: '200000000000000001' };
}

const CHANNELS_BY_GUILD: Record<string, RawChannel[]> = {
  '200000000000000001': [
    chan('300000000000000000', 'annonces', 0, ChannelType.GUILD_ANNOUNCEMENT),
    chan('310000000000000000', 'AGENTS', 1, ChannelType.GUILD_CATEGORY),
    chan('300000000000000001', 'vespry', 2, ChannelType.GUILD_TEXT, '310000000000000000'),
    chan('300000000000000002', 'général', 3, ChannelType.GUILD_TEXT, '310000000000000000'),
    chan('300000000000000003', 'sora-logs', 4, ChannelType.GUILD_TEXT, '310000000000000000'),
    chan('320000000000000000', 'PROJETS', 5, ChannelType.GUILD_CATEGORY),
    chan('300000000000000004', 'roadmap', 6, ChannelType.GUILD_TEXT, '320000000000000000'),
    chan('300000000000000005', 'design', 7, ChannelType.GUILD_TEXT, '320000000000000000'),
    chan('300000000000000006', 'releases', 8, ChannelType.GUILD_TEXT, '320000000000000000'),
  ],
};
function channelsFor(guildId: string): RawChannel[] {
  return CHANNELS_BY_GUILD[guildId] ?? CHANNELS_BY_GUILD['200000000000000001']!;
}

/* ── Conversation d'aperçu (markdown, réaction, réponse, code, emoji) ──── */

const T = '2026-05-20T';
function msg(o: Partial<RawMessage> & { id: string; author: RawUser; content: string; timestamp: string }): RawMessage {
  return { type: 0, channel_id: '300000000000000001', attachments: [], embeds: [], ...o };
}
const PREVIEW: RawMessage[] = [
  msg({ id: '400000000000000010', author: SORA, timestamp: `${T}09:02:00Z`,
    content: "Salut l'équipe 👋 On lance la **sauvegarde du serveur** avant la migration. Quelqu'un a déjà testé `Vespry` ?" }),
  msg({ id: '400000000000000011', author: KITSUNE, timestamp: `${T}09:03:12Z`,
    content: "Oui ! Export increvable, ça reprend tout seul si l'onglet plante. J'ai sorti 40 000 messages hier sans souci 🚀",
    reactions: [{ count: 4, emoji: { id: null, name: '🔥' } }, { count: 2, emoji: { id: null, name: '👍' } }] }),
  msg({ id: '400000000000000012', author: TANUKI, timestamp: `${T}09:04:30Z`,
    content: "Et le JSON est *propre*, parfait pour le donner à un agent. La structure :\n```json\n{ \"guild\": \"…\", \"channel\": { \"type\": 0 }, \"messages\": [ … ] }\n```",
    message_reference: { message_id: '400000000000000011', channel_id: '300000000000000001' },
    referenced_message: msg({ id: '400000000000000011', author: KITSUNE, timestamp: `${T}09:03:12Z`, content: "Export increvable, ça reprend tout seul…" }) }),
  msg({ id: '400000000000000013', author: SORA, timestamp: `${T}09:06:10Z`,
    content: "Parfait. On garde aussi les **images** et les **vocaux** ? L'archive doit rester lisible hors-ligne.",
    reactions: [{ count: 3, emoji: { id: null, name: '✅' } }] }),
  msg({ id: '400000000000000014', author: KITSUNE, timestamp: `${T}09:07:45Z`,
    content: "Oui, médias inline + emojis custom. Et on chiffre le zip (AES-256) avant de l'envoyer à l'archive. 🔒" }),
  msg({ id: '400000000000000015', author: TANUKI, timestamp: `${T}09:09:20Z`,
    content: "Top. Je programme un **backup hebdo** du serveur, comme ça on n'y pense plus. Vespry gère la planification.",
    reactions: [{ count: 5, emoji: { id: null, name: '🦊' } }, { count: 2, emoji: { id: null, name: '🙌' } }] }),
];

/* ── Mur des soutiens (synthétique, pour animer le footer) ────────────── */

const DAY = 86_400_000;
const NOW = Date.parse('2026-06-07T12:00:00Z');
const DONORS: DonorFeed = {
  total: 14,
  weekCount: 3,
  nextMilestone: { key: 'm.twentyfive', seq: 25, remaining: 11 },
  recent: [
    { seq: 14, source: 'stripe', name: 'Camille', message: 'Merci, ça m\'a sauvé une archive entière !', createdAt: NOW - 1 * DAY, milestone: null },
    { seq: 13, source: 'github', name: 'Léa', message: null, createdAt: NOW - 2 * DAY, milestone: null },
    { seq: 12, source: 'kofi', name: 'Dywan', message: 'Pépite open source 💜', createdAt: NOW - 3 * DAY, milestone: null },
    { seq: 10, source: 'stripe', name: 'Marin', message: null, createdAt: NOW - 6 * DAY, milestone: 'm.ten' },
    { seq: 9, source: 'github', name: null, message: null, createdAt: NOW - 9 * DAY, milestone: null },
  ],
};

/* ── File d'export : un run TERMINÉ (pour export-done) ────────────────── */

const QUEUE: QueueItemView[] = [
  {
    runId: 'run_demo_done',
    guildName: 'Studio Kitsune',
    status: 'completed',
    triggeredBy: 'user',
    channelsTotal: 9,
    channelsDone: 9,
    messages: 12_480,
    estimatedMessages: 12_480,
    assetsByKind: { image: 312, video: 18, audio: 24, file: 41 },
    reactions: 1_894,
    log: [
      '09:10:02  → #vespry…',
      '09:10:04  #vespry · +100 msg',
      '09:10:09  #vespry · ↓ 12 image(s)',
      '09:10:21  ✓ #vespry — 1 204 msg',
      '09:11:33  → #général…',
      '09:13:50  ✓ #général — 6 902 msg',
      '09:15:12  ✓ #roadmap — 4 374 msg',
      '09:15:40  📦 Paquet prêt — 184.6 Mo',
    ],
    zipReady: true,
  },
];

/* ── Scène « discret » (?scene=discret) : run arrêté net par Discord ────
 * Sert aux captures de revue du chantier export discret (capture-discret.mjs),
 * jamais aux captures du store (capture.mjs charge la page sans paramètre). */

const SCENE = new URLSearchParams(location.search).get('scene');
if (SCENE === 'discret') {
  QUEUE.unshift({
    runId: 'run_demo_stopped',
    guildName: 'Les Trailers',
    status: 'paused',
    triggeredBy: 'user',
    channelsTotal: 6,
    channelsDone: 2,
    messages: 3_120,
    estimatedMessages: 9_400,
    assetsByKind: { image: 88, video: 3, audio: 0, file: 9 },
    reactions: 0,
    log: [
      '10:02:11  → #sorties…',
      '10:04:40  ✓ #sorties — 1 902 msg',
      '10:05:02  → #matos…',
      '10:06:31  ⏸ Discord a refusé une requête (vérification ou blocage)',
    ],
    zipReady: false,
    stopReason: 'refused',
  });
}

/* ── Contrôleur factice : même surface que RemoteController ────────────── */

const noop = (): void => {};
const listeners = new Set<() => void>();
const FakeController = {
  ready: true,
  error: null as string | null,
  guilds: GUILDS,
  queue: QUEUE,
  purgeQueue: [] as unknown[],
  pace: 'discreet' as 'discreet' | 'normal',
  async setPace(mode: 'discreet' | 'normal'): Promise<boolean> {
    FakeController.pace = mode;
    for (const l of listeners) l();
    return true;
  },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  async init(): Promise<void> {},
  async loadChannels(guildId: string): Promise<RawChannel[]> { return channelsFor(guildId); },
  async estimate(): Promise<number | null> { return 12_480; },
  async listRuns(): Promise<unknown[]> { return []; },
  async deleteRun(): Promise<void> {},
  async preview(): Promise<RawMessage[]> { return PREVIEW.slice().reverse(); },
  async enqueue(): Promise<void> {},
  async getDonors(): Promise<DonorFeed | null> { return DONORS; },
  async startCheckout(): Promise<string | null> { return null; },
  resume: noop,
  downloadZip: noop,
  async purge(): Promise<string | null> { return null; },
  destroy: noop,
};

/* ── Montage ──────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
openOverlay(FakeController as any);
// Signal pour Playwright : l'overlay est monté.
(window as unknown as { __harnessReady: boolean }).__harnessReady = true;
