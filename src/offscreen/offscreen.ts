/**
 * Document offscreen — héberge le moteur d'export.
 *
 * Contexte invisible, persistant, indépendant des onglets : l'export tourne
 * même si l'onglet Discord est fermé. Reçoit les commandes (relayées par le
 * service worker) et diffuse l'état à chaque changement.
 */
import { VespryController } from '../content/overlay/controller';
import { installGlobalHandlers } from '../diagnostics';
import { loadCredits } from '../credits';
import { createCheckout, fetchDonorFeed } from '../donors';
import {
  isExecEnvelope,
  type CommandResponse,
  type EnqueueExtras,
  type StateBroadcast,
  type VespryCommand,
} from '../messaging';
import { SCHEDULE_NO_TAB } from '../engine/scheduled-pending';

installGlobalHandlers('offscreen');

const controller = new VespryController();

/** Diffuse l'état courant (capté par le service worker et les vues). */
function broadcast(): void {
  const msg: StateBroadcast = { kind: 'vespry-state', state: controller.toState() };
  chrome.runtime.sendMessage(msg).catch(() => {
    /* aucun récepteur — sans gravité */
  });
}

controller.subscribe(broadcast);
void controller.init().then(broadcast);

async function handle(command: VespryCommand): Promise<CommandResponse> {
  switch (command.cmd) {
    case 'get-state':
      return { ok: true, state: controller.toState() };
    case 'load-channels':
      return { ok: true, channels: await controller.loadChannels(command.guildId) };
    case 'estimate': {
      const est = await controller.estimateMessages(command.guildId, command.channelIds);
      return { ok: true, estimatedTotal: est.total, estimateStop: est.stop };
    }
    case 'list-runs':
      return { ok: true, runs: await controller.listRuns() };
    case 'delete-run':
      await controller.deleteRun(command.runId);
      return { ok: true };
    case 'enqueue': {
      const extras: EnqueueExtras = {
        includeThreads: command.includeThreads,
        zones: command.zones,
        zoneMode: command.zoneMode,
        partitionSize: command.partitionSize,
        formats: command.formats,
      };
      if (command.includeReactionUsers) extras.includeReactionUsers = true;
      if (command.incremental) extras.incremental = true;
      // Phase 4 — propagation du mot de passe AES (jamais persisté côté UI ;
      // copié dans ExportRun.options le temps du run uniquement).
      if (command.zipPassword) extras.zipPassword = command.zipPassword;
      await controller.enqueue(command.guild, command.channels, command.media, extras);
      return { ok: true, state: controller.toState() };
    }
    case 'resume':
      controller.resume(command.runId);
      return { ok: true };
    case 'download':
      controller.downloadZip(command.runId, command.filename);
      return { ok: true };
    case 'preview':
      return {
        ok: true,
        messages: await controller.previewChannel(command.channelId, command.before),
      };
    case 'get-donors': {
      // Le fetch du mur des soutiens passe ICI (offscreen) : la CSP de
      // discord.com bloquerait un fetch tiers depuis l'overlay.
      const credits = await loadCredits();
      return { ok: true, donors: await fetchDonorFeed(credits.donorApiUrl) };
    }
    case 'checkout': {
      // Création de la session Stripe Checkout — fetch tiers, donc ICI.
      const credits = await loadCredits();
      const url = await createCheckout(credits.donorApiUrl, {
        amountCents: command.amountCents,
        donorName: command.donorName ?? null,
        message: command.message ?? null,
        isPublic: command.isPublic,
      });
      return url ? { ok: true, checkoutUrl: url } : { ok: true };
    }
    case 'scheduled-export-fire': {
      // Réveil par `chrome.alarms`. Sans onglet Discord ouvert, rien ne part :
      // l'hôte met le planifié en attente et le relance à l'ouverture d'un
      // onglet (`discord-tab-ready`). Les requêtes ne partent QUE de la page.
      const outcome = await controller.fireScheduledExport(command.guildId, command.guildName);
      if (outcome === 'queued') return { ok: true, state: controller.toState() };
      return {
        ok: false,
        error: outcome === 'no-tab' ? SCHEDULE_NO_TAB : 'aucun salon accessible — Discord déconnecté ?',
      };
    }
    case 'purge': {
      // Phase 2 — suppression de messages. Le moteur de purge tourne ICI
      // (offscreen), à côté du moteur d'export. Renvoie l'id local de la
      // purge pour que l'overlay puisse suivre la progression via toState().
      const purgeRunId = await controller.purgeMessages(
        command.guild,
        command.channelId,
        command.channelName,
        command.messageIds,
      );
      return { ok: true, purgeRunId, state: controller.toState() };
    }
    case 'discord-tab-ready':
      await controller.onDiscordTabReady();
      return { ok: true };
    case 'set-pace':
      controller.setPace(command.mode);
      return { ok: true, state: controller.toState() };
    case 'clear-halt':
      controller.clearHalt();
      return { ok: true, state: controller.toState() };
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExecEnvelope(message)) return undefined;
  handle(message.command)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ ok: false, error: String(e) }));
  return true; // réponse asynchrone
});
