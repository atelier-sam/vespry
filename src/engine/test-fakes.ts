/**
 * Doublures de test partagées : transport scripté et Pacer sans attente.
 * Importé uniquement par des fichiers `*.test.ts`.
 */
import { Pacer, type PacerDeps, type PaceMode } from './pacer';
import type { DiscordTransport, TransportRequest, TransportResponse } from './transport';

/** Pacer qui n'attend jamais (horloge qui avance d'1 ms par lecture). */
export function instantPacer(mode: PaceMode = 'discreet'): Pacer {
  let t = 0;
  const deps: PacerDeps = {
    now: () => (t += 1),
    sleep: async () => {},
    random: () => 0,
  };
  return new Pacer(mode, deps);
}

export type Scripted = TransportResponse | Error | ((req: TransportRequest) => TransportResponse | Error);

/** Transport qui rejoue des réponses, et note chaque requête reçue. */
export class FakeTransport implements DiscordTransport {
  readonly calls: TransportRequest[] = [];
  private readonly queue: Scripted[];

  constructor(responses: Scripted[] = [], private readonly fallback?: Scripted) {
    this.queue = [...responses];
  }

  async send(req: TransportRequest): Promise<TransportResponse> {
    this.calls.push(req);
    const next = this.queue.shift() ?? this.fallback;
    if (next === undefined) throw new Error(`FakeTransport : aucune réponse pour ${req.method} ${req.path}`);
    const out = typeof next === 'function' ? next(req) : next;
    if (out instanceof Error) throw out;
    return out;
  }
}

export const ok = (body: unknown, status = 200): TransportResponse => ({ status, body, nonJson: false });
export const status = (code: number, body: unknown = null, extra: Partial<TransportResponse> = {}): TransportResponse => ({
  status: code, body, nonJson: false, ...extra,
});
