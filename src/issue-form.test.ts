/**
 * Contrat code ↔ formulaire GitHub. `reportProblem` ouvre
 * `issues/new?template=bug.yml&report=…&version=…` : si le fichier est renommé
 * ou si un `id` change, GitHub ouvre un formulaire vide et le rapport est
 * perdu, sans aucune erreur visible. Ce test lit le vrai fichier du dépôt.
 *
 * Analyse volontairement minimale (pas de dépendance YAML) : le formulaire est
 * une liste plate `- type: … / id: …`, c'est tout ce qu'on vérifie.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ISSUE_FORM } from './diagnostics';

const path = resolve(__dirname, '..', '.github', 'ISSUE_TEMPLATE', ISSUE_FORM.file);
const yml = readFileSync(path, 'utf8');

/** Paires (type, id) des champs, dans l'ordre du fichier. */
function fields(text: string): Array<{ type: string; id: string | null }> {
  return text
    .split(/^ {2}- type: /mu)
    .slice(1)
    .map((block) => ({
      type: block.split('\n')[0]?.trim() ?? '',
      id: /^ {4}id: ([\w-]+)$/mu.exec(block)?.[1] ?? null,
    }));
}

describe(`.github/ISSUE_TEMPLATE/${ISSUE_FORM.file}`, () => {
  const fs = fields(yml);

  it('le champ du rapport est une zone de texte, la version un champ simple (préremplissables)', () => {
    expect(fs).toContainEqual({ type: 'textarea', id: ISSUE_FORM.report });
    expect(fs).toContainEqual({ type: 'input', id: ISSUE_FORM.version });
  });

  it('ids uniques, aucun nom réservé par les paramètres d\'URL de GitHub', () => {
    const ids = fs.map((f) => f.id).filter((x): x is string => x !== null);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reserved of ['title', 'body', 'labels', 'template', 'assignees', 'milestone', 'projects', 'type']) {
      expect(ids).not.toContain(reserved);
    }
  });

  it('étiquette bug posée automatiquement, et le contrôle positif de l\'analyse', () => {
    expect(yml).toMatch(/^labels: \["bug"\]$/mu);
    expect(fs.length).toBeGreaterThanOrEqual(5);
    expect(fs[0]?.type).toBe('markdown');
  });
});
