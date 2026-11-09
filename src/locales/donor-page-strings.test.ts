/**
 * La page de don publique du service (`donor-service/src/donate-page.ts`)
 * reprend les textes de la modale de don de l'extension. Ils sont copiés par
 * `donor-service/scripts/gen-page-strings.mjs` dans un fichier généré : ce
 * test rougit si une traduction a changé sans que la copie suive.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('textes de la page de don publique', () => {
  it('donor-service/src/page-strings.generated.ts est à jour avec src/locales', () => {
    const script = join(__dirname, '..', '..', 'donor-service', 'scripts', 'gen-page-strings.mjs');
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
