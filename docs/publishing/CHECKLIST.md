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

Version figée : **1.0.0** (`package.json`, `CHANGELOG.md`). En release, la
version vient du tag GitHub via `scripts/stamp-version.mjs` — voir §5.

## 2. Artefacts à soumettre

Produits par `scripts/build-artifacts.sh` (ou à la main, cf. ci-dessous).
Tous gitignorés (`*.zip`) — ce sont des livrables locaux à uploader, pas des
fichiers du repo.

| Store | Artefact | Build |
|---|---|---|
| Chrome Web Store **et** Edge | `vespry-1.0.0.zip` | `npm run build` puis `cd dist && zip -r ../vespry-1.0.0.zip .` |
| Mozilla AMO | `web-ext-artifacts/vespry_discord_export-1.0.0.zip` | `npm run build:firefox && npm run firefox:package` |
| AMO — code source (exigé MV3) | `vespry-source-1.0.0.zip` | `git archive --format=zip -o vespry-source-1.0.0.zip HEAD` |

Avant upload, vérifier dans chaque zip : `manifest.json` à la racine,
`manifest_version: 3`, `version: 1.0.0`, icônes 16/48/128 présentes.

## 3. Métadonnées de fiche — prêtes à coller

- **Nom** : `Vespry — Discord Export` (vient du manifest).
- **Description courte** : champ `description` du manifest.
- **Description longue** : sections « Vespry » + « Fonctionnalités » +
  « face aux autres outils » du `README.md`.
- **Justifications de permissions** : tableaux dans `chrome.md` / `edge.md`.
- **Déclaration données** : cocher uniquement *Authentication information* +
  *Personal communications* (cohérent sur les 3 stores).
- **Politique de confidentialité (URL)** :
  `https://github.com/atelier-sam/vespry#-confidentialité`
  (⚠️ ancre GitHub avec tiret initial car le titre porte un emoji).
- **Notes reviewers** : blocs prêts dans `chrome.md` (§ Avis aux reviewers) et
  `edge.md` (§ 7 Notes for certification).

## 4. Captures d'écran — ⏳ à produire

`docs/screenshots/` ne contient pour l'instant que `popup.png`. Les fiches
réclament 5-6 captures **1280×800**. Elles sont générées **sans session
Discord réelle** (zéro fuite de serveurs privés) par un harnais qui rend le
vrai overlay avec des données synthétiques (cast Sora / Kitsune / Tanuki,
déjà utilisé pour la démo HTML) :

```sh
node scripts/store-screenshots.mjs   # → docs/screenshots/*.png
```

Cibles : `overlay.png`, `advanced.png`, `multi-select.png`,
`html-export.png`, `export-done.png`. Logo Edge 300×300 :
`docs/screenshots/logo-300.png`.

## 5. Mise en ligne — actions de Sam (externes)

1. **Tag de release GitHub** `v1.0.0` → la CI (`release.yml`) build, stampe la
   version et attache `vespry-1.0.0.zip` à la release.
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
