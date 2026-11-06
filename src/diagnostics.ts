/**
 * Diagnostic & remontée d'erreurs.
 *
 * - Capture les erreurs non gérées dans un buffer circulaire (par contexte).
 * - Assemble un rapport technique (version, navigateur, OS, logs récents).
 * - Ouvre une issue GitHub pré-remplie, ou copie le rapport si le dépôt n'est
 *   pas encore configuré.
 *
 * IMPORTANT — vie privée : le rapport part dans un ticket GitHub PUBLIC. Il
 * n'inclut jamais le jeton Discord ni le contenu des messages, et TOUT son
 * texte passe par `ReportRedactor` avant d'être ouvert : noms de serveur et
 * de salon, identifiants Discord, liens et adresses e-mail sont masqués.
 * Avant le 06/11/2026, le résumé et le journal d'une tâche échouée y
 * mettaient le nom du serveur et des salons en clair.
 */
import { GITHUB_REPO, getVersion } from './version';
import { getDetectedUnknowns } from './engine/schema-watch';

const MAX_EVENTS = 60;
const events: string[] = [];

/** Ajoute une ligne au buffer de diagnostic. */
export function recordEvent(level: 'info' | 'warn' | 'error', message: string): void {
  events.push(`${new Date().toISOString()} [${level}] ${message}`);
  if (events.length > MAX_EVENTS) events.shift();
}

/** Branche la capture des erreurs non gérées du contexte courant. */
export function installGlobalHandlers(context: string): void {
  self.addEventListener('error', (e) => {
    const ev = e as ErrorEvent;
    recordEvent('error', `${context}: ${ev.message || String(ev.error)}`);
  });
  self.addEventListener('unhandledrejection', (e) => {
    const ev = e as PromiseRejectionEvent;
    recordEvent('error', `${context}: rejet non géré — ${String(ev.reason)}`);
  });
}

/**
 * Assemble un rapport Markdown. `extraLines` = lignes spécifiques (ex. le
 * journal d'une tâche d'export échouée).
 */
/**
 * Masque ce qui identifie l'utilisateur dans une ligne de rapport. Une même
 * instance sert tout un rapport : un salon garde le même alias d'une ligne à
 * l'autre (`#salon-1`), pour que le journal reste lisible.
 */
export class ReportRedactor {
  private readonly names: string[];
  private readonly channels = new Map<string, string>();

  /** `names` : noms à masquer partout (le nom du serveur, en pratique). */
  constructor(names: readonly string[] = []) {
    // Trop court, un nom masquerait des morceaux de mots ordinaires.
    this.names = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))]
      .sort((a, b) => b.length - a.length);
  }

  private alias(channel: string): string {
    let a = this.channels.get(channel);
    if (!a) {
      a = `salon-${this.channels.size + 1}`;
      this.channels.set(channel, a);
    }
    return a;
  }

  line(input: string): string {
    let s = input;
    for (const n of this.names) s = s.split(n).join('[serveur]');
    // Salons : les formes écrites par le journal d'export (`formatLog`) —
    // « → #nom… », « #nom · », « ✓ #nom — ». Un nom de fil peut contenir
    // des espaces : on s'arrête au séparateur, pas à l'espace. Le `#` doit
    // ouvrir un mot : les titres Markdown du rapport (`### Journal`) restent.
    s = s.replace(/(?<=^|\s)#(?![#\s])(.+?)(?=…| · | — |$)/gu, (_m, name: string) => `#${this.alias(name)}`);
    // Liens http(s) (pièces jointes signées, API…) ; les chemins
    // chrome-extension:// et moz-extension:// des piles restent lisibles.
    s = s.replace(/\bhttps?:\/\/[^\s)\]'"`<>]+/giu, '<lien>');
    s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, '<e-mail>');
    // Identifiants Discord (snowflakes, 17 à 20 chiffres).
    s = s.replace(/(?<!\d)\d{17,20}(?!\d)/gu, '<id>');
    return s;
  }
}

export function buildReport(
  summary: string,
  extraLines: string[] = [],
  redactor: ReportRedactor = new ReportRedactor(),
): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const lines = [
    `**Résumé** : ${summary}`,
    '',
    '### Environnement',
    `- Vespry : v${getVersion()}`,
    `- Navigateur : ${navigator.userAgent}`,
    `- Plateforme : ${nav.userAgentData?.platform ?? 'inconnue'}`,
    `- Langue : ${navigator.language}`,
    '',
    '### Journal',
    '```',
    ...(extraLines.length > 0 ? extraLines : ['(aucun journal de tâche)']),
    '```',
  ];
  if (events.length > 0) {
    lines.push('', '### Erreurs captées', '```', ...events, '```');
  }
  // Champs Discord inconnus rencontrés — signal qu'une évolution de l'API
  // a peut-être eu lieu et que Vespry pourrait avoir besoin d'une mise à jour.
  const unknowns = getDetectedUnknowns();
  if (unknowns.length > 0) {
    lines.push(
      '',
      '### Champs Discord inconnus rencontrés',
      'Ces champs ne sont pas rendus par Vespry mais restent préservés dans',
      'le JSON exporté. Une nouvelle évolution de l\'API Discord est probable :',
      '```',
      ...unknowns,
      '```',
    );
  }
  // Le masquage couvre TOUT le texte (résumé, journal, erreurs captées),
  // puis le pied, écrit après coup, dit ce qui a été retiré.
  const body = lines.join('\n').split('\n').map((l) => redactor.line(l));
  body.push(
    '',
    '_Rapport généré par Vespry. Ne contient ni jeton Discord ni contenu de messages ;'
      + ' noms de serveur et de salons, identifiants, liens et e-mails masqués. Relis-le avant de l\'envoyer : le ticket est public._',
  );
  return body.join('\n');
}

/**
 * Ouvre une issue GitHub pré-remplie. Si le dépôt n'est pas encore configuré
 * (`GITHUB_REPO` vide), copie le rapport dans le presse-papier à la place.
 * Renvoie `'issue'` ou `'clipboard'` selon l'action effectuée.
 */
export async function reportProblem(
  summary: string,
  extraLines: string[] = [],
  /** Noms à masquer en plus des règles générales (nom du serveur). */
  names: readonly string[] = [],
): Promise<'issue' | 'clipboard'> {
  const redactor = new ReportRedactor(names);
  const body = buildReport(summary, extraLines, redactor);
  if (GITHUB_REPO) {
    const url =
      `https://github.com/${GITHUB_REPO}/issues/new`
      + `?title=${encodeURIComponent(`[bug] ${redactor.line(summary)}`)}`
      + `&body=${encodeURIComponent(body)}`;
    window.open(url, '_blank', 'noopener');
    return 'issue';
  }
  try {
    await navigator.clipboard.writeText(body);
  } catch {
    /* presse-papier indisponible — sans gravité */
  }
  return 'clipboard';
}

/**
 * Ouvre une discussion GitHub (catégorie « Ideas ») pré-remplie pour que
 * l'utilisateur propose une amélioration. Différent de `reportProblem` :
 *
 *   - Cible Discussions, pas Issues (votes, threading, conversation).
 *   - Aucun rapport technique automatique (env, journal, etc.) — c'est
 *     une suggestion produit, pas un bug. Seule la version est passée
 *     pour aider à savoir quelle release l'a inspirée.
 *   - Le template `.github/DISCUSSION_TEMPLATE/ideas.yml` guide l'utilisateur
 *     vers une description orientée problème, pas solution.
 *
 * Si `GITHUB_REPO` n'est pas configuré, ouvre quand même la page racine
 * du dépôt en fallback (l'utilisateur trouvera Discussions à la main).
 */
export function proposeImprovement(): void {
  if (!GITHUB_REPO) return;
  const url =
    `https://github.com/${GITHUB_REPO}/discussions/new`
    + '?category=ideas'
    + `&body=${encodeURIComponent(`<!-- Version Vespry : ${getVersion()} -->\n\n`)}`;
  window.open(url, '_blank', 'noopener');
}
