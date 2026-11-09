/**
 * Types minimaux des modules Node utilisés par les tests D1 (vitest tourne
 * sous Node, le Worker non). Pas de @types/node : il ferait croire au code
 * du Worker que `process`, `Buffer`… existent au runtime Cloudflare.
 */
interface ImportMeta {
  readonly url: string;
}
declare module 'node:sqlite' {
  interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
