/**
 * Harnais de capture du rendu HTML d'export.
 *
 * Utilise le VRAI moteur `toHtml` avec une conversation 100 % synthétique
 * (cast Sora / Kitsune / Tanuki + un embed) — donc le rendu est fidèle au
 * pixel à ce qu'un utilisateur obtient dans son archive, sans donnée privée.
 * Playwright (`capture.mjs`) ouvre cette page et capture html-export.png.
 */
import { toHtml, type ExportContext, type ExportLabels } from '../../src/engine/exporters';
import type { RawMessage, RawUser } from '../../src/engine/types';

const LABELS_FR: ExportLabels = {
  messages: 'messages', edited: 'modifié', replyTo: 'en réponse à',
  attachment: 'pièce jointe', sticker: 'sticker', embed: 'embed',
  reactions: 'réactions', systemLabel: 'système',
  systemMessage: (type) => `message système (type ${type})`,
  exportedBy: 'exporté avec Vespry', poll: 'sondage',
  pollVotes: (n) => `${n} votes`,
  mentions: { user: '@membre', role: '@rôle', channel: '#salon' },
};

function user(id: string, name: string, bot = false): RawUser {
  return { id, username: name, global_name: name, discriminator: '0', avatar: null, bot };
}
const SORA = user('1', 'Sora', true);
const KITSUNE = user('2', 'Kitsune', true);
const TANUKI = user('3', 'Tanuki', true);

const T = '2026-05-20T';
function msg(o: Partial<RawMessage> & { id: string; author: RawUser; content: string; timestamp: string }): RawMessage {
  return { type: 0, channel_id: '1505933366229340160', attachments: [], embeds: [], ...o };
}
const messages: RawMessage[] = [
  msg({ id: '10', author: SORA, timestamp: `${T}09:02:00Z`,
    content: "Salut l'équipe 👋 On lance la **sauvegarde du serveur** avant la migration. Quelqu'un a déjà testé `Vespry` pour l'export ?" }),
  msg({ id: '11', author: KITSUNE, timestamp: `${T}09:03:12Z`,
    content: "Oui ! Export increvable, ça reprend tout seul si l'onglet plante. J'ai exporté 40 000 messages hier sans souci 🚀",
    reactions: [{ count: 3, emoji: { id: null, name: '🔥' } }, { count: 2, emoji: { id: null, name: '👍' } }] }),
  msg({ id: '12', author: TANUKI, timestamp: `${T}09:04:30Z`,
    content: "Et le JSON est *propre*, parfait pour le donner à un agent. La structure :\n```json\n{ \"guild\": \"…\", \"channel\": { \"type\": 0 }, \"messages\": [ … ] }\n```",
    referenced_message: msg({ id: '11', author: KITSUNE, timestamp: `${T}09:03:12Z`, content: "Export increvable, ça reprend tout seul…" }),
    message_reference: { message_id: '11', channel_id: '1505933366229340160' } }),
  msg({ id: '13', author: SORA, timestamp: `${T}09:06:00Z`,
    content: "Top. Je programme un **backup hebdomadaire** alors, comme ça on a toujours une copie fraîche. Chiffré en AES-256 🔒",
    embeds: [{
      title: 'Vespry — Export Discord',
      description: 'Crash-proof · agent-ready · 100 % local',
      url: 'https://github.com/atelier-sam/vespry',
      color: 0x6c5ce0,
      fields: [
        { name: 'Formats', value: 'JSON · HTML · CSV · TXT', inline: true },
        { name: 'Langues', value: '15', inline: true },
      ],
    }],
  }),
  msg({ id: '14', author: KITSUNE, timestamp: `${T}09:07:45Z`,
    content: "Parfait 🦊 Et le rendu HTML est lisible direct, façon Discord. On garde une vraie archive consultable.",
    reactions: [{ count: 4, emoji: { id: null, name: '💜' } }] }),
];

const ctx: ExportContext = {
  guildName: 'Studio Kitsune',
  guildId: '0',
  channelName: 'vespry',
  channel: { id: '1505933366229340160', name: 'vespry', type: 0 },
  urlToPath: new Map(),
  labels: LABELS_FR,
};

// `toHtml` renvoie un document HTML complet et autonome (CSS inline). On
// remplace la page courante par ce document pour la capture.
const html = toHtml(ctx, messages);
document.open();
document.write(html);
document.close();
(window as unknown as { __exportReady: boolean }).__exportReady = true;
