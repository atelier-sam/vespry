# Pré-vol publication — Vespry 1.0.0

Checklist consolidée de la première mise en ligne sur les trois stores.
Détail par store : `chrome.md`, `edge.md`, `firefox.md`. Ce fichier est la
**source de vérité unique** de l'état de préparation.

## 1. Santé du code — ✅ vérifié 2026-06-07

| Vérif | Commande | État |
|---|---|---|
| Types stricts | `npm run typecheck` | ✅ 0 erreur |
| Tests unitaires | `npm run test` | ✅ 173/173 |
| Build Chrome | `npm run build` → `dist/` | ✅ |
| Build Firefox | `npm run build:firefox` → `dist-firefox/` | ✅ |
| Lint AMO | `npm run firefox:lint` | ✅ 0 erreur, 0 notice, 2 warnings (libs) |
| TODO/FIXME résiduels | `grep -rn TODO src/` | ✅ aucun |
| Migration org `atelier-sam` | `git grep ateliersam86` | ✅ aucun résidu |

Version : celle de `package.json` du commit livré (`CHANGELOG.md` à jour).
Pour une nouvelle version : `node scripts/stamp-version.mjs X.Y.Z`, commit,
tag `vX.Y.Z` — voir §5.

## 2. Artefacts à soumettre

Produits par `bash scripts/build-artifacts.sh` dans `release/<version>/`
(gitignoré). Le script bâtit le COMMIT (HEAD, arbre propre exigé), pas l'arbre
de travail : il extrait `git archive`, fait `npm ci`, rejoue les portes (tsc,
tests, builds Chrome et Firefox, `web-ext lint` sans erreur), empaquette, puis
vérifie la version du manifeste et écrit `SHA256SUMS` avec le sha du commit.
Pas de GitHub Actions sur ce chemin (Gitea d'abord, cf. §5).

| Store | Artefact |
|---|---|
| Chrome Web Store **et** Edge | `vespry-<v>.zip` |
| Mozilla AMO | `vespry_discord_export-<v>.zip` |
| AMO — code source (exigé MV3) | `vespry-source-<v>.zip` (le zip même dont le build est sorti) |

Avant upload, vérifier dans chaque zip : `manifest.json` à la racine,
`manifest_version: 3`, icônes 16/48/128 présentes (la version est vérifiée par
le script).

## 3. Métadonnées de fiche — prêtes à coller

- **Nom** : `Vespry — Discord Export` (vient du manifest).
- **Description courte** : champ `description` du manifest.
- **Description longue** : sections « Vespry » + « Fonctionnalités » +
  « face aux autres outils » du `README.md`.
- **Justifications de permissions** : tableaux dans `chrome.md` / `edge.md`.
- **Déclaration données** : cocher uniquement *Authentication information* +
  *Personal communications* (cohérent sur les 3 stores).
- **Politique de confidentialité (URL)** :
  `https://github.com/atelier-sam/vespry/blob/main/PRIVACY.en.md` (la version française `PRIVACY.md` fait foi)
  (⚠️ ancre GitHub avec tiret initial car le titre porte un emoji).
- **Notes reviewers** : blocs prêts dans `chrome.md` (§ Avis aux reviewers) et
  `edge.md` (§ 7 Notes for certification).

## 4. Captures d'écran — ✅ générées (1280×800)

Produites **sans session Discord réelle** (zéro fuite de serveurs privés) :
un harnais (`scripts/screenshots/`) rend le **vrai** overlay et le **vrai**
moteur `toHtml` avec des données synthétiques (cast Sora / Kitsune / Tanuki),
capturés en 2× puis rééchantillonnés en 1280×800 exact.

```sh
VESPRY_VERSION=1.1.0 node scripts/screenshots/capture.mjs en-US   # -> docs/screenshots/en/
VESPRY_VERSION=1.1.0 node scripts/screenshots/capture.mjs fr-FR   # -> docs/screenshots/fr/
node scripts/screenshots/gen-logo.mjs                             # logo-300 (tuile Edge)
```

Sur un Mac en français, la capture anglaise montre les champs de date en
jj/mm/aaaa : passer le Chromium de test en anglais le temps de la capture
(commande en tête de `capture.mjs`). `PLAYWRIGHT_CHROME=<chemin>` force le
binaire si celui de Playwright manque.

Dans `docs/screenshots/en/` et `fr/` : `overlay.png`, `advanced.png`,
`multi-select.png`, `export-done.png`, `html-export.png` (la démo et
l'interface suivent la langue ; mur des soutiens vide, comme en vrai).
`docs/screenshots/logo-300.png` : tuile Edge 300×300.

## 5. Mise en ligne — actions de Sam (externes)

1. **Release Gitea** : tag annoté `vX.Y.Z` poussé (Gitea + miroir GitHub),
   Release créée par l'API Gitea avec les zips de `release/<v>/` et
   `SHA256SUMS` en pièces jointes. `release.yml` (GitHub Actions) reste sur le
   miroir mais n'est plus sur le chemin : on n'attend pas sa sortie.
2. **Chrome Web Store** — compte dev (5 $ une fois), upload `vespry-1.0.0.zip`,
   coller les métadonnées §3, soumettre. Review 2-7 j.
3. **Microsoft Edge** — compte Partner Center (gratuit), **même zip**, logo
   300×300, justifications par permission, soumettre. Review 1-3 j.
4. **Mozilla AMO** — compte dev (gratuit), upload du zip Firefox **+ zip
   source**, métadonnées, soumettre. Review 1-3 j.
5. **donor-service** — vérifier que le Worker
   `https://vespry-donors.sam-muselet.workers.dev` répond (optionnel ; le
   footer « Mur des soutiens » échoue proprement sinon).

## 6. Après publication

- Renseigner les URLs des fiches store dans le `README.md` (boutons
  d'installation).
- Mettre en place l'upload automatisé CWS (API + OAuth) dans la CI une fois le
  compte dev créé — cf. `chrome.md` § Mises à jour ultérieures.
