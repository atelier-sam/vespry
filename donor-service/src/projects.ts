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
 * sur les pages de ce service (celles de Vespry), sauf si le client demande une
 * page de retour sur le site d'un projet inscrit (`resolveReturnUrl`).
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
  // L'établi de code.atelier-sam.fr (09/11/2026) : tout projet de l'atelier
  // autre que Vespry. La page lit `?donation=ok|cancel` à la racine.
  atelier: {
    id: 'atelier',
    label: "Soutien à L'Atelier de Sam",
    returnUrl: 'https://code.atelier-sam.fr/',
  },
};

/** Longueur maximale d'une page de retour demandée (Stripe accepte 5 000). */
const MAX_RETURN_URL = 2048;

/**
 * Origines où un client peut demander à faire revenir le donateur : celles
 * des pages de retour des projets inscrits, et rien d'autre.
 *
 * Pourquoi déduites de la liste plutôt qu'écrites à part : une seule source.
 * Inscrire un projet avec sa page, c'est déjà dire « ce site est à nous ».
 * Une seconde liste finirait par diverger. Le cas visé : un don à Vespry
 * lancé depuis code.atelier-sam.fr revient sur l'établi, pas sur les pages
 * de ce service.
 */
export function returnOrigins(
  registry: Readonly<Record<string, Project>> = PROJECTS,
): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const p of Object.values(registry)) {
    if (p.returnUrl) origins.add(new URL(p.returnUrl).origin);
  }
  return origins;
}

/**
 * Page de retour demandée par un client (`returnUrl` du corps de /checkout).
 * Absente ou vide → `undefined` (on garde le retour du projet) ; acceptée →
 * l'adresse normalisée ; sinon → `null` (la requête doit être refusée : un
 * retour libre ferait de ce service une redirection ouverte, signée par la
 * page de paiement de la société).
 *
 * Acceptée seulement si : https, sans identifiants, origine EXACTE d'un
 * projet inscrit (ni sous-domaine, ni autre port), longueur bornée.
 */
export function resolveReturnUrl(
  raw: unknown,
  registry: Readonly<Record<string, Project>> = PROJECTS,
): string | null | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string' || raw.length > MAX_RETURN_URL) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  return returnOrigins(registry).has(u.origin) ? u.toString() : null;
}

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
