/**
 * Version de l'extension.
 *
 * Source de vérité unique : la version du `manifest.json` que Chrome a chargé
 * (`chrome.runtime.getManifest()`), elle-même lue dans `package.json` au build
 * (`scripts/stamp-version.mjs` pour la changer, `scripts/build-artifacts.sh`
 * pour bâtir les zips depuis le commit exact).
 *
 * `checkForUpdate()` interroge l'API GitHub pour signaler une release plus
 * récente, SEULEMENT pour une installation hors store (voir `isStoreInstall`).
 */

// Dépôt GitHub du projet (owner/repo) — alimente checkForUpdate() et loadCredits().
export const GITHUB_REPO = 'atelier-sam/vespry';

/** Version actuellement exécutée (canonique). */
export function getVersion(): string {
  return chrome.runtime.getManifest().version;
}

/** Compare deux versions semver. true si `a` est plus récente que `b`. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

/**
 * Vrai si l'extension a été installée depuis un store (Chrome Web Store, Edge
 * Add-ons, Firefox AMO).
 *
 * Pourquoi : le store met l'extension à jour seul, mais seulement après sa
 * relecture (2 à 7 jours chez Chrome). Une release GitHub sort avant : sans
 * ce filtre, le menu annonçait pendant des jours une version que la personne
 * ne pouvait pas installer. Le bandeau reste pour les installations
 * manuelles (mode développeur, zip de la release).
 *
 * `management.getSelf` ne demande aucune permission (Chrome comme Firefox).
 * En cas de doute (API absente, erreur), on répond « store » : mieux vaut
 * taire une mise à jour qu'en annoncer une introuvable.
 */
export async function isStoreInstall(): Promise<boolean> {
  try {
    const self = await chrome.management.getSelf();
    return self.installType === 'normal';
  } catch {
    return true;
  }
}

/**
 * Renvoie la version de la dernière release GitHub si elle est plus récente
 * que la version courante, sinon null. L'API GitHub autorise le CORS, donc
 * aucune permission d'hôte n'est requise.
 */
export async function checkForUpdate(): Promise<string | null> {
  if (!GITHUB_REPO) return null;
  if (await isStoreInstall()) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { tag_name?: string };
    const latest = (data.tag_name ?? '').replace(/^v/, '');
    return latest && isNewer(latest, getVersion()) ? latest : null;
  } catch {
    return null;
  }
}
