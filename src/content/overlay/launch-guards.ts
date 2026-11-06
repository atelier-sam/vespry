/**
 * Décisions de l'overlay sorties du composant pour être testées sans DOM.
 *
 * Toutes deux viennent de l'essai réel du 06/11/2026 sur un compte Discord :
 * le rythme Discret (une requête à la fois, des secondes entre deux) a élargi
 * des fenêtres de course qui passaient inaperçues quand tout répondait en
 * quelques dizaines de millisecondes.
 */

/**
 * Jeton « dernière demande gagne ». Changer de serveur pendant que la liste
 * du précédent charge encore : sa réponse arrivait APRÈS et remplaçait la
 * liste du nouveau serveur. L'utilisateur cochait un salon de l'ancien
 * serveur sous l'en-tête du nouveau, et « Lancer » ne créait aucune tâche.
 */
export interface LatestGate {
  /** Ouvre une nouvelle demande ; les précédentes deviennent périmées. */
  begin(): number;
  /** Cette demande est-elle toujours la dernière ouverte ? */
  isCurrent(token: number): boolean;
}

export function createLatestGate(): LatestGate {
  let seq = 0;
  return {
    begin: () => ++seq,
    isCurrent: (token) => token === seq,
  };
}

export type LaunchStep = 'tos' | 'enqueue' | 'estimate' | 'nothing';

/** En dessous, on n'estime pas : l'estimation coûte une recherche par salon. */
export const ESTIMATE_FROM_CHANNELS = 3;

/**
 * Étape suivante du bouton « Lancer ».
 *
 * `tosConfirmed` : l'utilisateur vient de confirmer la modale d'avertissement
 * pour CE lancement. Avant, la confirmation appelait directement l'envoi en
 * file et sautait l'avertissement « gros export » au tout premier export,
 * celui où il compte le plus.
 */
export function nextLaunchStep(s: {
  tosAcked: boolean;
  tosConfirmed: boolean;
  largeRunAcked: boolean;
  pickedCount: number;
}): LaunchStep {
  if (!s.tosAcked && !s.tosConfirmed) return 'tos';
  if (s.pickedCount === 0) return 'nothing';
  if (s.largeRunAcked || s.pickedCount < ESTIMATE_FROM_CHANNELS) return 'enqueue';
  return 'estimate';
}
