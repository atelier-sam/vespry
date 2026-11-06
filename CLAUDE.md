# Vespry — extension Chrome d'export Discord

Extension Manifest V3 qui exporte l'historique de serveurs/conversations Discord
de façon increvable (checkpoint IndexedDB) avec une sortie agent-ready.

## Architecture

Quatre contextes d'exécution, à ne jamais confondre :

- `src/background/service-worker.ts` — éphémère (MV3 le tue). Routage de
  messages + ouverture d'onglets UNIQUEMENT. Aucun travail long ici.
- `src/content/discord-bridge.ts` — content script monde MAIN. Patche fetch/XHR
  pour capter l'en-tête `authorization` et les en-têtes du client, et installe
  `rest-bridge.ts` : le SEUL endroit d'où partent les requêtes vers l'API
  Discord (module REST du client, repli `fetch` même-origine).
- `src/content/content-script.ts` — content script monde ISOLATED. Relais du
  jeton, relais des requêtes REST (`rest-relay.ts`, MessageChannel privé vers
  le monde MAIN) + injection de l'overlay (Shadow DOM).
- `src/offscreen/offscreen.html` + `offscreen.ts` — document offscreen
  invisible. C'est ICI que tourne le moteur d'export et la reprise
  (`VespryController`), jamais dans le service worker. Il n'émet AUCUNE
  requête Discord : il les confie à l'onglet (cf. ci-dessous).

### Chemin d'une requête (export discret, 06/11/2026)

`DiscordApi` → `Pacer.run(kind)` (rythme) → `RelayTransport` →
`chrome.runtime.sendMessage` → SW `relayRestToTab` (`background/tab-relay.ts`)
→ `chrome.tabs.sendMessage` → content script `RestPortClient` → MessageChannel
→ MAIN `rest-bridge`. Sur Firefox, l'event page héberge le contrôleur et
appelle `relayRestToTab` directement. Garde : `no-direct-api.test.ts` refuse
toute URL d'API Discord hors de `rest-bridge.ts`.

Pourquoi : depuis mars 2026 Discord sanctionne les exports par compte
utilisateur ; une requête émise depuis `chrome-extension://`, sans cookies ni
en-têtes du client, est une signature. Ne JAMAIS réintroduire d'appel direct.

Trois invariants du chemin (relecture Codex, 06/11/2026), chacun testé :
- **Verrou d'arrêt** (`DiscordApi.haltedBy`) : un refus de Discord (`auth`,
  `refused`, `blocked`, `rate-limited`) bloque TOUTE requête suivante, de
  toute tâche. Seul un geste de l'utilisateur le lève (`clearHalt`, bouton
  Reprendre). Ne jamais appeler `clearHalt` depuis un chemin automatique.
- **Compte lié** (`bindUser` → `asUser`) : la page refuse d'émettre si sa
  session est celle d'un autre compte (`wrong-account`).
- **Pas de double envoi** : une requête peut-être partie (délai dépassé,
  liaison rompue après remise, module client sans statut) n'est jamais
  rejouée ; elle devient un arrêt.

## Moteur (`src/engine/`)

- `discord-api.ts` — client API Discord. Dérivé de Discrub Classic (MIT).
  N'émet plus rien lui-même : passe par un `DiscordTransport` (`transport.ts`,
  liste blanche des routes) et un `Pacer`.
- `pacer.ts` — SEUL maître de la cadence (file unique, délais aléatoires,
  pauses en horloge murale, plafond de session). Crans `discreet` (défaut) /
  `normal`, réglage persisté sous `vespry.pace`.
- `auth.ts` — capture/stockage du jeton de session.
- `checkpoint-store.ts` — IndexedDB, source de vérité (runs/channels/messages/assets).
- `export-runner.ts` — orchestrateur checkpoint-natif.
- `packager.ts` — génère le paquet agent-ready (JSON, media, INDEX, zip).

## Service de dons (`donor-service/`)

Cloudflare Worker indépendant (sa propre `package.json`, hors build Vite).
Crée les sessions Stripe Checkout (`POST /checkout`), ingère le webhook Stripe
signé, range les soutiens dans D1, et expose `GET /donors`. Stripe est le SEUL
canal ouvert (06/11/2026) ; les routes Ko-Fi / GitHub Sponsors sont dormantes,
et `credits.json` ne doit jamais porter une URL de don qui ne mène nulle part. L'extension consomme ce flux pour le footer « Mur des
soutiens ». Le fetch passe par l'offscreen (la CSP de Discord bloque l'overlay).
Contrat partagé : `donor-service/src/donors.ts` ↔ `src/donors.ts`.

## Règles

- TypeScript strict, pas de `any`. Tests unitaires sur le moteur (vitest).
- Robustesse > vitesse. Tout export doit être resumable.
- Médias téléchargés au fil de l'eau (liens CDN Discord signés, expirent ~24 h).
- Spec autoritative : design doc dans
  `~/.gstack/projects/Dicordscraping/samuelmuselet-unknown-design-20260516-145957.md`.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool.
- Bugs/errors → /investigate
- Code review → /review
- QA → /qa
- Ship → /ship
