/**
 * Constantes partagées par les deux mondes du content script (MAIN et
 * ISOLATED). Fichier sans effet de bord : l'importer depuis ISOLATED ne doit
 * pas embarquer le code MAIN de `rest-bridge.ts`.
 */
export const REST_HANDSHAKE_SOURCE = 'vespry-rest-handshake' as const;

/** Annonce d'un onglet Discord prêt à émettre (content script → moteur). */
export const DISCORD_TAB_READY = 'discord-tab-ready' as const;
