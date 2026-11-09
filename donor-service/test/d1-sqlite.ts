/**
 * D1 en mémoire pour les tests : le SQLite de Node derrière l'interface D1
 * dont le Worker se sert (`prepare` → `bind` → `first` / `all` / `run`).
 *
 * Pourquoi : un faux D1 qui renvoie des valeurs écrites à la main ne teste
 * pas le SQL. Ici les requêtes de `donors.ts` s'exécutent pour de vrai sur
 * le schéma de `schema.sql` (fonctions de fenêtre comprises, comme D1).
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function sqliteD1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first<T>() {
          return (db.prepare(sql).get(...args) ?? null) as T | null;
        },
        async all<T>() {
          return { results: db.prepare(sql).all(...args) as T[], success: true };
        },
        async run() {
          db.prepare(sql).run(...args);
          return { success: true };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

/** Base neuve au schéma courant. */
export function freshDb(): { raw: DatabaseSync; d1: D1Database } {
  const raw = new DatabaseSync(':memory:');
  raw.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  return { raw, d1: sqliteD1(raw) };
}

export function readSql(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
}
