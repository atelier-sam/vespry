/**
 * Régulateur de rythme — SEUL maître de la cadence des requêtes Discord.
 *
 * Pourquoi. Depuis mars 2026, Discord sanctionne les comptes dont l'historique
 * est aspiré à un rythme de robot (« platform manipulation »). Les mainteneurs
 * de DiscordChatExporter et de Discrub constatent que ralentir seul ne suffit
 * pas toujours : il faut aussi réduire le volume et casser la régularité. Ce
 * module applique donc trois règles, pour TOUTES les requêtes (export,
 * pré-comptage, aperçu, suppression) :
 *
 *  1. une seule requête en vol à la fois, toutes sources confondues (file) ;
 *  2. un délai aléatoire avant chaque requête, selon son type ;
 *  3. des pauses longues en horloge murale (toutes les 40-50 min d'activité)
 *     et un plafond de requêtes par session.
 *
 * Deux crans : `discreet` (défaut) et `normal` (plus rapide, avertissement
 * côté UI). Le cran normal garde la file et les pauses : il ne fait que
 * raccourcir les délais.
 *
 * Module pur : horloge, sommeil et hasard sont injectés (tests déterministes).
 */

export type PaceMode = 'discreet' | 'normal';

/** Type de requête — chacun a sa fourchette de délai. */
export type RequestKind = 'read' | 'search' | 'delete';

/** Fourchette `[min, max]` en millisecondes. */
export type MsRange = readonly [number, number];

export interface PaceProfile {
  readonly delays: Readonly<Record<RequestKind, MsRange>>;
  /** Durée d'activité avant une pause longue. */
  readonly activeSpan: MsRange;
  /** Durée de la pause longue. */
  readonly restSpan: MsRange;
  /** Requêtes maximum avant la pause de plafond. */
  readonly sessionBudget: number;
  /** Durée de la pause de plafond. */
  readonly budgetRestMs: number;
}

const MIN = 60_000;

export const PACE_PROFILES: Readonly<Record<PaceMode, PaceProfile>> = {
  discreet: {
    delays: { read: [1_500, 3_500], search: [3_000, 6_000], delete: [3_000, 6_000] },
    activeSpan: [40 * MIN, 50 * MIN],
    restSpan: [8 * MIN, 12 * MIN],
    sessionBudget: 6_000,
    budgetRestMs: 60 * MIN,
  },
  normal: {
    delays: { read: [800, 1_600], search: [1_500, 3_000], delete: [1_500, 3_000] },
    activeSpan: [40 * MIN, 50 * MIN],
    restSpan: [8 * MIN, 12 * MIN],
    sessionBudget: 12_000,
    budgetRestMs: 60 * MIN,
  },
};

/** Ralentissement maximal accumulé après des 429. */
const MAX_SLOWDOWN = 3;
/** Facteur appliqué à chaque 429 accepté. */
const SLOWDOWN_STEP = 1.5;

export interface PacerDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Uniforme dans [0, 1). */
  random(): number;
}

export const realPacerDeps: PacerDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  random: () => Math.random(),
};

/** Ce que l'UI peut afficher. */
export interface PacerSnapshot {
  mode: PaceMode;
  /** Requêtes émises depuis la dernière pause de plafond. */
  requests: number;
  /** Fin de la pause en cours (ms epoch), ou null si aucune pause. */
  restingUntil: number | null;
  /** Facteur de ralentissement courant (1 = nominal). */
  slowdown: number;
}

export class Pacer {
  private mode: PaceMode;
  private readonly deps: PacerDeps;
  /** Queue de la file : chaque `run` s'enchaîne derrière le précédent. */
  private tail: Promise<void> = Promise.resolve();
  private lastRequestAt: number | null = null;
  /** Début de la plage d'activité courante (ms), null avant la 1re requête. */
  private activeSince: number | null = null;
  private activeLimitMs = 0;
  private requests = 0;
  private restingUntil: number | null = null;
  private slowdown = 1;
  /** Aucune émission avant cet instant (ms epoch), cf. `blockFor`. */
  private notBefore = 0;

  constructor(mode: PaceMode = 'discreet', deps: PacerDeps = realPacerDeps) {
    this.mode = mode;
    this.deps = deps;
  }

  get currentMode(): PaceMode {
    return this.mode;
  }

  setMode(mode: PaceMode): void {
    this.mode = mode;
  }

  /**
   * Exécute `fn` à son tour dans la file, après le délai et les pauses dus.
   * Une erreur de `fn` est propagée à l'appelant sans casser la file.
   */
  run<T>(kind: RequestKind, fn: () => Promise<T>): Promise<T> {
    const turn = this.tail.then(async () => {
      await this.waitTurn(kind);
      return fn();
    });
    // La file avance même si `fn` échoue.
    this.tail = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /**
   * Interdit toute émission pendant `ms`, à compter de MAINTENANT, à toutes
   * les requêtes, y compris celles déjà en file. Sert à respecter un
   * `retry_after`. L'ancien `hold()` se rangeait en QUEUE de file : les
   * requêtes déjà en attente passaient devant la pause que Discord venait
   * d'exiger (relecture Codex M3, 06/11/2026).
   */
  blockFor(ms: number): void {
    this.notBefore = Math.max(this.notBefore, this.deps.now() + ms);
  }

  /**
   * Signale un 429 accepté : le reste de la session ralentit (×1,5, plafonné
   * à ×3). Discord vient de dire « trop vite » ; insister au même rythme est
   * exactement la signature à éviter.
   */
  noteRateLimited(): void {
    this.slowdown = Math.min(MAX_SLOWDOWN, this.slowdown * SLOWDOWN_STEP);
  }

  /** Tirage uniforme dans une fourchette — exposé pour le back-off 429. */
  pick(range: MsRange): number {
    const [lo, hi] = range;
    return Math.round(lo + (hi - lo) * this.deps.random());
  }

  snapshot(): PacerSnapshot {
    return {
      mode: this.mode,
      requests: this.requests,
      restingUntil: this.restingUntil,
      slowdown: this.slowdown,
    };
  }

  private profile(): PaceProfile {
    return PACE_PROFILES[this.mode];
  }

  private async rest(ms: number): Promise<void> {
    this.restingUntil = this.deps.now() + ms;
    try {
      await this.deps.sleep(ms);
    } finally {
      this.restingUntil = null;
    }
  }

  private async waitTurn(kind: RequestKind): Promise<void> {
    const p = this.profile();

    // 1. Plafond de session : pause longue, puis compteur remis à zéro.
    if (this.requests >= p.sessionBudget) {
      await this.rest(p.budgetRestMs);
      this.requests = 0;
      this.activeSince = null;
    }

    // 2. Pause d'activité, en horloge murale : un onglet en arrière-plan ou
    //    une machine en veille ne fait pas dériver le compte.
    const now = this.deps.now();
    if (this.activeSince === null) {
      this.activeSince = now;
      this.activeLimitMs = this.pick(p.activeSpan);
    } else if (now - this.activeSince >= this.activeLimitMs) {
      await this.rest(this.pick(p.restSpan));
      this.activeSince = this.deps.now();
      this.activeLimitMs = this.pick(p.activeSpan);
    }

    // 3. Délai aléatoire depuis la requête précédente. Après une longue
    //    inactivité (pause, attente utilisateur) il est déjà écoulé.
    const delay = Math.round(this.pick(p.delays[kind]) * this.slowdown);
    if (this.lastRequestAt !== null) {
      const remaining = this.lastRequestAt + delay - this.deps.now();
      if (remaining > 0) await this.deps.sleep(remaining);
    }

    // 4. Interdiction d'émettre posée par un `retry_after` (`blockFor`),
    //    relue après chaque attente : elle a pu être repoussée entre-temps.
    for (let wait = this.notBefore - this.deps.now(); wait > 0; wait = this.notBefore - this.deps.now()) {
      await this.rest(wait);
    }

    this.lastRequestAt = this.deps.now();
    this.requests += 1;
  }
}
