/**
 * Diagnostic & remontée d'erreurs.
 *
 * - Capture les erreurs non gérées dans un buffer circulaire (par contexte).
 * - Assemble un rapport technique (version, navigateur, OS, logs récents).
 * - Ouvre une issue GitHub sur le formulaire `bug.yml` (champ `report`
 *   prérempli, longueur bornée), ou copie le rapport si le dépôt n'est pas
 *   configuré. Le rapport est en anglais : l'issue est publique et lue par tous.
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
    recordEvent('error', `${context}: unhandled rejection — ${String(ev.reason)}`);
  });
}

/** Séparateurs que le journal d'export écrit après un nom de salon (`formatLog`, 15 langues). */
const CHANNEL_END = ['…', ' · ', ' — '] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Masque ce qui identifie l'utilisateur dans une ligne de rapport. Une même
 * instance sert tout un rapport : un salon garde le même alias d'une ligne à
 * l'autre (`#channel-1`), pour que le journal reste lisible.
 *
 * Chaque passe remplace ce qu'elle trouve par un JETON opaque (caractères
 * d'usage privé), rendu seulement à la fin : une passe suivante ne peut donc
 * pas réinterpréter ce qu'une précédente a écrit. Revue Codex du 09/11/2026 :
 * un serveur nommé `https` changeait `https://…` en `[server]://…` avant la
 * passe des liens, qui ne le reconnaissait plus et laissait le lien en clair.
 */
export class ReportRedactor {
  private readonly names: string[];
  /** Salons connus, en une expression construite une fois (`null` : aucun). */
  private readonly knownChannels: RegExp | null;
  private readonly channels = new Map<string, string>();

  /**
   * `names` : noms à masquer partout (le nom du serveur, en pratique).
   * `channelNames` : noms EXACTS des salons de la tâche, quand on les a : un
   * nom qui contient lui-même un séparateur (`Dossier — Alice Martin`) est
   * alors masqué en entier, sans dépendre de la passe de repli.
   */
  constructor(names: readonly string[] = [], channelNames: readonly string[] = []) {
    // Trop court, un nom masquerait des morceaux de mots ordinaires.
    this.names = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))]
      .sort((a, b) => b.length - a.length);
    const exact = [...new Set(channelNames.filter((n) => n.trim().length > 0))]
      .sort((a, b) => b.length - a.length);
    this.knownChannels = exact.length === 0
      ? null
      : new RegExp(
        `(?<=^|\\s)#(${exact.map(escapeRegExp).join('|')})(?=${CHANNEL_END.map(escapeRegExp).join('|')}|$)`,
        'gu',
      );
  }

  private alias(channel: string): string {
    let a = this.channels.get(channel);
    if (!a) {
      a = `channel-${this.channels.size + 1}`;
      this.channels.set(channel, a);
    }
    return a;
  }

  line(input: string): string {
    const tokens: string[] = [];
    const token = (text: string): string => {
      tokens.push(text);
      return `\uE000${String.fromCharCode(0xe100 + tokens.length - 1)}\uE001`;
    };
    // Une entrée ne peut pas fabriquer un jeton.
    let s = input.replace(/[\uE000\uE001]/gu, '\uFFFD');

    // 1. Salons connus, nom exact, à la place où le journal les écrit.
    if (this.knownChannels) {
      s = s.replace(this.knownChannels, (_m, name: string) => token(`#${this.alias(name)}`));
    }
    // 2. Repli pour un salon inconnu : `#` en début de mot (les titres Markdown
    //    `### Journal` restent), nom jusqu'au DERNIER séparateur de la ligne,
    //    sinon jusqu'à la fin. Un nom qui contient un séparateur est ainsi
    //    masqué en entier ; au pire on masque aussi un compteur, jamais l'inverse.
    s = s.replace(/(?<=^|\s)#(?![#\s])(.+)$/gu, (_m, rest: string) => {
      let cut = -1;
      let sep = '';
      for (const end of CHANNEL_END) {
        const i = rest.lastIndexOf(end);
        if (i > cut) {
          cut = i;
          sep = end;
        }
      }
      const name = cut > 0 ? rest.slice(0, cut) : rest;
      const tail = cut > 0 ? rest.slice(cut + sep.length) : '';
      return token(`#${this.alias(name)}`) + (cut > 0 ? sep + tail : '');
    });
    // 3. Liens http(s) jusqu'au prochain blanc ou guillemet : une parenthèse
    //    ou un crochet peut faire partie du chemin (revue Codex, 09/11/2026).
    //    Les chemins chrome-extension:// et moz-extension:// des piles restent.
    s = s.replace(/\bhttps?:\/\/[^\s'"`<>]+/giu, () => token('<link>'));
    s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, () => token('<e-mail>'));
    // 4. Nom du serveur, partout.
    for (const n of this.names) s = s.split(n).join(token('[server]'));
    // 5. Identifiants Discord (snowflakes, 17 à 20 chiffres).
    s = s.replace(/(?<!\d)\d{17,20}(?!\d)/gu, '<id>');
    return s.replace(/\uE000([\uE100-\uEFFF])\uE001/gu, (_m, c: string) => tokens[c.charCodeAt(0) - 0xe100] ?? '');
  }
}

/**
 * Rapport déjà masqué, en morceaux : la troncature (`buildIssueUrl`) retire
 * des lignes du journal sans re-masquer, ce qui garde les alias de salon
 * stables entre le rapport complet (presse-papier) et le rapport coupé (URL).
 */
export interface RedactedReport {
  summary: string;
  environment: string[];
  log: string[];
  errors: string[];
  unknowns: string[];
}

/**
 * Remplace toute moitié isolée de paire UTF-16 par U+FFFD. Une telle moitié
 * (un `slice` qui coupe un emoji, ex. `url.slice(0, 80)` dans `discord-api.ts`)
 * fait lever `encodeURIComponent` : dans le chemin des rapports d'erreur, ce
 * serait une exception pendant la gestion d'une exception. (`toWellFormed` est
 * ES2024, le `lib` du projet s'arrête à ES2023.)
 */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, '�');
}

/** Coupe sur des caractères entiers (jamais au milieu d'une paire UTF-16). */
function cut(text: string, max: number, mark = '…'): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join('') + mark;
}

/** Un résumé vient parfois d'un message d'erreur : borné, il ne peut pas manger le budget de l'URL. */
const SUMMARY_MAX = 300;

/** Rassemble et masque tout ce qui part dans le rapport. */
export function collectReport(
  summary: string,
  extraLines: string[] = [],
  redactor: ReportRedactor = new ReportRedactor(),
): RedactedReport {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  // Une ligne de journal peut contenir des retours à la ligne (pile d'erreur) :
  // on découpe AVANT de masquer, puisque le masquage travaille ligne par ligne.
  const red = (xs: readonly string[]): string[] =>
    xs.flatMap((x) => wellFormed(x).split('\n')).map((l) => redactor.line(l));
  return {
    summary: cut(redactor.line(wellFormed(summary).replace(/\s+/gu, ' ').trim()), SUMMARY_MAX),
    environment: red([
      `Vespry: v${getVersion()}`,
      `Browser: ${navigator.userAgent}`,
      `Platform: ${nav.userAgentData?.platform ?? 'unknown'}`,
      `Language: ${navigator.language}`,
    ]),
    log: red(extraLines),
    errors: red(events),
    unknowns: red(getDetectedUnknowns()),
  };
}

const FOOTER =
  '_Generated by Vespry. Contains no Discord token and no message content; server and channel names, IDs, links'
  + ' and e-mails are masked. Read it before sending: the issue is public._';

/** Ce qui a été retiré pour faire tenir le rapport dans une URL. */
export interface Trim {
  log: number;
  errors: number;
  unknowns: number;
  /** Le rapport complet est dans le presse-papier : la notice dit de le coller. */
  copied: boolean;
}

const NO_TRIM: Trim = { log: 0, errors: 0, unknowns: 0, copied: false };

/** Lignes retirées par le début (les plus anciennes), remplacées par une ligne qui le dit. */
function withoutOldest(lines: readonly string[], dropped: number, what: string, copied: boolean): string[] {
  if (dropped <= 0) return [...lines];
  const where = copied
    ? 'the full report is in your clipboard: paste it here in place of this one'
    : 'report too long for a link';
  return [`… ${dropped} earlier ${what} removed (${where}) …`, ...lines.slice(dropped)];
}

/**
 * Texte Markdown du rapport. Les retraits ne touchent que l'INTÉRIEUR des
 * sections : en-tête, clôtures ``` et pied restent toujours entiers (une
 * clôture ouverte avalerait les champs que le formulaire ajoute après).
 */
export function renderReport(r: RedactedReport, trim: Trim = NO_TRIM): string {
  const lines = [
    `**Summary:** ${r.summary}`,
    '',
    '### Environment',
    ...r.environment.map((l) => `- ${l}`),
    '',
    '### Log',
    '```',
    ...(r.log.length > 0 ? withoutOldest(r.log, trim.log, 'log lines', trim.copied) : ['(no task log)']),
    '```',
  ];
  if (r.errors.length > 0) {
    lines.push('', '### Captured errors', '```', ...withoutOldest(r.errors, trim.errors, 'error lines', trim.copied), '```');
  }
  // Champs Discord inconnus : signal qu'une évolution de l'API a peut-être eu
  // lieu et que Vespry pourrait avoir besoin d'une mise à jour.
  if (r.unknowns.length > 0) {
    lines.push(
      '',
      '### Unknown Discord fields',
      'Vespry does not render these fields but keeps them in the exported JSON. Discord probably changed its API:',
      '```',
      ...withoutOldest(r.unknowns, trim.unknowns, 'fields', trim.copied),
      '```',
    );
  }
  lines.push('', FOOTER);
  return lines.join('\n');
}

/**
 * Assemble un rapport Markdown complet. `extraLines` = lignes spécifiques (ex.
 * le journal d'une tâche d'export échouée).
 */
export function buildReport(
  summary: string,
  extraLines: string[] = [],
  redactor: ReportRedactor = new ReportRedactor(),
): string {
  return renderReport(collectReport(summary, extraLines, redactor));
}

/**
 * Contrat avec `.github/ISSUE_TEMPLATE/bug.yml` (vérifié par
 * `issue-form.test.ts`). Le nom du fichier et les `id` des champs sont FIGÉS
 * dans chaque version publiée sur les stores : les renommer dans le dépôt
 * casserait le préremplissage de toutes les installations existantes.
 */
export const ISSUE_FORM = { file: 'bug.yml', report: 'report', version: 'version' } as const;

/**
 * Longueur maximale de l'URL d'issue. Mesuré le 09/11/2026 par curl sur
 * `github.com/<dépôt>/issues/new?template=bug.yml&…` : jusqu'à ~6 900
 * caractères → page ou redirection de connexion ; ~7 300 → erreur 500 ;
 * ≥ 9 000 → 414. La limite porte sur la longueur de l'URL, pas sur la densité
 * d'encodage. 5 000 garde ~2 000 de marge.
 */
export const ISSUE_URL_MAX = 5000;
/** GitHub plafonne le titre à 256 ; 120 suffit et laisse le budget au rapport. */
const TITLE_MAX = 120;
/** Planchers : une pile d'erreur vaut souvent plus que 200 lignes de journal. */
const LOG_FLOOR = 15;
const ERRORS_FLOOR = 10;

/**
 * Plus petit `k` de [0, n] pour lequel `ok(k)` est vrai, `ok` étant monotone
 * (retirer plus de lignes raccourcit toujours le texte). `null` si même `n` échoue.
 */
function smallest(n: number, ok: (k: number) => boolean): number | null {
  if (!ok(n)) return null;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * URL d'une nouvelle issue sur le formulaire `bug.yml`, champ `report`
 * prérempli, au plus `maxLength` caractères. Le rapport est DÉJÀ masqué
 * (`collectReport`) : on ne fait qu'en retirer des lignes, si bien que l'URL
 * est une sous-séquence du rapport complet et que les alias de salon sont les
 * mêmes que dans le presse-papier.
 *
 * Ordre des retraits, toujours les lignes les plus anciennes d'abord :
 * journal jusqu'à LOG_FLOOR, erreurs jusqu'à ERRORS_FLOOR, reste du journal,
 * reste des erreurs, champs inconnus. Dernier recours (budget absurde) : coupe
 * du texte brut sur des caractères entiers, jamais de l'URL encodée.
 */
export function buildIssueUrl(
  repo: string,
  title: string,
  report: RedactedReport,
  options: { maxLength?: number; copied?: boolean; version?: string } = {},
): { url: string; truncated: boolean } {
  const maxLength = options.maxLength ?? ISSUE_URL_MAX;
  const copied = options.copied ?? false;
  const version = options.version ? `&${ISSUE_FORM.version}=${encodeURIComponent(options.version)}` : '';
  const head =
    `https://github.com/${repo}/issues/new?template=${ISSUE_FORM.file}`
    + `&title=${encodeURIComponent(cut(wellFormed(title), TITLE_MAX))}${version}&${ISSUE_FORM.report}=`;
  const len = (t: Trim): number => head.length + encodeURIComponent(renderReport(report, t)).length;
  const fits = (t: Trim): boolean => len(t) <= maxLength;
  const done = (t: Trim, truncated: boolean): { url: string; truncated: boolean } => ({
    url: head + encodeURIComponent(renderReport(report, t)),
    truncated,
  });

  let t: Trim = { ...NO_TRIM, copied };
  if (fits(t)) return done({ ...t, copied: false }, false);
  const L = report.log.length;
  const E = report.errors.length;
  const U = report.unknowns.length;
  const steps: Array<[keyof Omit<Trim, 'copied'>, number]> = [
    ['log', Math.max(0, L - LOG_FLOOR)],
    ['errors', Math.max(0, E - ERRORS_FLOOR)],
    ['log', L],
    ['errors', E],
    ['unknowns', U],
  ];
  for (const [key, upTo] of steps) {
    const from = t[key];
    if (upTo <= from) continue;
    const k = smallest(upTo - from, (d) => fits({ ...t, [key]: from + d }));
    if (k !== null) return done({ ...t, [key]: from + k }, true);
    t = { ...t, [key]: upTo };
  }
  // Dernier recours : couper le texte brut (budget plus petit que l'en-tête du rapport).
  const bare = renderReport(report, t);
  const chars = Array.from(bare).length;
  const keep = smallest(chars, (d) => head.length + encodeURIComponent(cut(bare, chars - d)).length <= maxLength);
  return { url: head + encodeURIComponent(cut(bare, chars - (keep ?? chars))), truncated: true };
}

export type ReportOutcome = 'issue' | 'issue-truncated' | 'clipboard';

/**
 * Copie bornée à 1 s : `window.open` doit partir pendant l'activation
 * transitoire du clic (~5 s), qu'une copie bloquée ne doit pas consommer.
 */
async function copy(text: string): Promise<boolean> {
  try {
    return await Promise.race([
      navigator.clipboard.writeText(text).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
  } catch {
    return false;
  }
}

/**
 * Ouvre une issue GitHub sur le formulaire `bug.yml`, champ `report` prérempli.
 *
 * Le rapport COMPLET est toujours copié dans le presse-papier, AVANT d'ouvrir
 * l'onglet : une fois l'onglet ouvert, la page d'origine perd le focus et
 * `clipboard.writeText` est refusé. C'est aussi la seule parade si GitHub
 * cesse de préremplir le champ (déjà arrivé, cf. community/discussions/15477) :
 * la description du champ dit de coller. Un rapport trop long pour l'URL est
 * raccourci, et la ligne de notice ne parle du presse-papier que si la copie a
 * réellement réussi.
 *
 * Ne lève jamais : une erreur ici surviendrait pendant la gestion d'une autre
 * (ErrorBoundary). En cas d'échec de construction, on retombe sur la copie seule.
 */
export async function reportProblem(
  summary: string,
  extraLines: string[] = [],
  /** Noms à masquer en plus des règles générales (nom du serveur). */
  names: readonly string[] = [],
  /** Noms exacts des salons de la tâche (cf. `ReportRedactor`). */
  channelNames: readonly string[] = [],
): Promise<ReportOutcome> {
  let full = '';
  try {
    const redactor = new ReportRedactor(names, channelNames);
    const report = collectReport(summary, extraLines, redactor);
    full = renderReport(report);
    const copied = await copy(full);
    if (!GITHUB_REPO) return 'clipboard';
    const { url, truncated } = buildIssueUrl(GITHUB_REPO, `[bug] ${report.summary}`, report, {
      copied,
      version: getVersion(),
    });
    window.open(url, '_blank', 'noopener');
    return truncated && copied ? 'issue-truncated' : 'issue';
  } catch (e) {
    recordEvent('error', `reportProblem: ${String(e)}`);
    if (full) await copy(full);
    return 'clipboard';
  }
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
    // Le modèle `.github/DISCUSSION_TEMPLATE/ideas.yml` ignore `body=` : on
    // préremplit son champ `version`.
    + `&version=${encodeURIComponent(getVersion())}`;
  window.open(url, '_blank', 'noopener');
}
