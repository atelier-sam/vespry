/**
 * Projets qu'on peut soutenir par ce service.
 *
 * Pourquoi une liste fermée : le libellé du projet s'affiche sur la page de
 * paiement Stripe et l'adresse de retour reçoit le donateur après paiement.
 * Les accepter tels que le client les envoie permettrait de faire payer
 * « Soutien à n'importe quoi » au nom de L'Atelier de Sam, ou de renvoyer le
 * donateur vers un site tiers. Seuls les projets inscrits ici passent.
 *
 * Ajouter un projet = ajouter une entrée. Sans `returnUrl`, le donateur revient
 * sur les pages de ce service (celles de Vespry).
 */

export interface Project {
  /** Identifiant court, envoyé par le client (`project`) et stocké en base. */
  id: string;
  /** Nom du produit sur la page de paiement Stripe. */
  label: string;
  /**
   * Page du projet où revenir après paiement, en https. Le service y ajoute
   * `donation=ok` ou `donation=cancel`.
   */
  returnUrl?: string;
}

/** Projet pris quand le client n'en précise aucun (extension, page /donate). */
export const VESPRY: Project = { id: 'vespry', label: 'Soutien à Vespry' };
export const DEFAULT_PROJECT = VESPRY.id;

export const PROJECTS: Readonly<Record<string, Project>> = {
  vespry: VESPRY,
};

/** Forme d'un identifiant de projet, pour ce qui vient de la base ou de Stripe. */
const PROJECT_ID = /^[a-z0-9-]{1,32}$/;

/**
 * Projet demandé par un client. Absent ou vide → projet par défaut ;
 * inconnu → null (la requête doit être refusée).
 */
export function resolveProject(
  raw: unknown,
  registry: Readonly<Record<string, Project>> = PROJECTS,
): Project | null {
  if (raw === undefined || raw === null || raw === '') {
    return registry[DEFAULT_PROJECT] ?? null;
  }
  if (typeof raw !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(registry, raw) ? (registry[raw] ?? null) : null;
}

/**
 * Projet inscrit dans les métadonnées d'un paiement déjà fait. Le paiement est
 * réel, on ne le refuse donc jamais : un identifiant bien formé est gardé tel
 * quel (même s'il a quitté la liste depuis), sinon c'est le projet par défaut.
 */
export function projectOfPayment(raw: unknown): string {
  return typeof raw === 'string' && PROJECT_ID.test(raw) ? raw : DEFAULT_PROJECT;
}
