# vespry-donors — service du mur des soutiens

Cloudflare Worker qui encaisse les dons par **Stripe Checkout**, range les
soutiens dans une base **D1** (SQLite), et expose le flux public consommé par
le footer « Mur des soutiens » de l'extension.

**État au 06/11/2026** : Stripe est le SEUL canal ouvert (compte live, webhook
branché, chemin prouvé en local de bout en bout et en production jusqu'à la
vérification de signature, cf. « Preuves » plus bas). Les routes Ko-Fi et
GitHub Sponsors restent dans le code, testées mais dormantes : aucune page
Ko-Fi ni profil Sponsors n'existe, et l'extension n'en montre aucun lien.

Aucun montant n'est stocké ni exposé. Un soutien n'apparaît avec un nom et un
message que si le donateur a accepté l'affichage public.

## Architecture

```
extension ──(POST /checkout)──▶ Worker ──▶ Stripe Checkout (page de paiement)
                                              │
Stripe ──(webhook checkout.session.completed)─▶ Worker ──▶ D1 (table donors)
                                                              │
extension ◀──────────(GET /donors)── flux public (DonorFeed) ◀┘

(Ko-Fi et GitHub Sponsors : routes dormantes, même table.)
```

| Route | Méthode | Auth | Rôle |
|---|---|---|---|
| `/donors` | GET | — (CORS ouvert) | flux public, cache 60 s ; `?project=<id>` (défaut `vespry`) |
| `/checkout` | POST | — (CORS ouvert) | crée une session Stripe Checkout → `{ url }` ; `project` facultatif |
| `/stripe/webhook` | POST | signature HMAC | ingestion Stripe |
| `/checkout/success` | GET | — | page de retour (don réussi) |
| `/checkout/cancel` | GET | — | page de retour (don annulé) |
| `/kofi/webhook` | POST | `verification_token` | ingestion Ko-Fi |
| `/github/webhook` | POST | HMAC-SHA256 | ingestion GitHub Sponsors |
| `/admin/list` | GET | `ADMIN_SECRET` | liste complète (masqués inclus) |
| `/admin/hide` | POST | `ADMIN_SECRET` | masque une entrée `{ seq }` |

### Un mur par projet (09/11/2026)

Le service encaisse pour plusieurs projets de L'Atelier de Sam, chacun avec son
mur et ses paliers (le « 1er soutien » de chaque projet). La liste est FERMÉE,
dans `src/projects.ts` : le libellé s'affiche sur la page de paiement Stripe et
l'adresse de retour reçoit le donateur, on ne les prend donc jamais du client.

- `POST /checkout` `{ amountCents, project?: "vespry", … }` : projet absent →
  `vespry` (l'extension n'envoie rien) ; inconnu → `400 {"error":"unknown project"}`.
- `GET /donors?project=vespry` : même règle.
- Le webhook relit `metadata.project` du paiement ; un paiement d'avant n'en a
  pas et va sur Vespry.
- Ajouter un projet : une entrée `{ id, label, returnUrl? }`. Avec `returnUrl`
  (https), le donateur y revient avec `donation=ok` ou `donation=cancel` ;
  sans, il revient sur les pages de Vespry.
- Ko-Fi et GitHub Sponsors ne disent pas quel projet est soutenu : rangés sur
  Vespry.

Base créée avant cette date : `migrations/0001_donors_project.sql`, une fois
(appliquée en production le 09/11/2026).

## Déploiement (à faire une fois)

Pré-requis : un compte Cloudflare (offre gratuite suffisante).

```bash
cd donor-service
npm install
npx wrangler login

# 1. Créer la base D1, puis recopier le database_id renvoyé dans wrangler.toml
npx wrangler d1 create vespry-donors

# 2. Appliquer le schéma
npx wrangler d1 execute vespry-donors --remote --file=schema.sql

# 3. Définir les secrets (cf. « Branchement des plateformes » ci-dessous)
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ADMIN_SECRET
# Optionnels — canaux secondaires :
npx wrangler secret put KOFI_VERIFICATION_TOKEN
npx wrangler secret put GITHUB_WEBHOOK_SECRET

# 4. Déployer
npm run deploy
```

Le déploiement affiche l'URL du Worker, par exemple
`https://vespry-donors.<compte>.workers.dev`.

## Branchement des plateformes

### Stripe — canal principal (paiement intégré)
1. Crée le compte Stripe sur ta société, en mode « live ».
2. Branding : Réglages Stripe → personnalise logo + couleur (la page Checkout
   les reprend).
3. **Clé API** : Développeurs → Clés API → copie la clé secrète `sk_live_…`
   → secret `STRIPE_SECRET_KEY`.
4. **Webhook** : Développeurs → Webhooks → ajoute un endpoint
   `https://vespry-donors.<compte>.workers.dev/stripe/webhook`, événement
   `checkout.session.completed`. Copie le secret de signature `whsec_…`
   → secret `STRIPE_WEBHOOK_SECRET`.

### Ko-Fi — canal dormant (non ouvert)
1. Crée la page Ko-Fi, active le mode « donations ».
2. Réglages → **API / Webhooks**.
3. Webhook URL : `https://vespry-donors.<compte>.workers.dev/kofi/webhook`
4. Copie le **Verification Token** affiché → c'est la valeur du secret
   `KOFI_VERIFICATION_TOKEN`.

### GitHub Sponsors — canal dormant (non ouvert)
1. Active GitHub Sponsors sur le compte.
2. Tableau de bord Sponsors → **Webhooks** → *Add webhook*.
3. Payload URL : `https://vespry-donors.<compte>.workers.dev/github/webhook`
4. Content type : `application/json`.
5. Secret : une chaîne aléatoire → c'est la valeur du secret
   `GITHUB_WEBHOOK_SECRET`.

### Extension
Renseigne l'URL du Worker dans `credits.json` du dépôt (champ `donorApiUrl`) :
l'extension affiche alors le mur et le bouton « Soutenir Vespry ». Les champs
`koFiUrl` et `gitHubSponsorsUrl` restent vides tant que ces canaux ne sont pas
ouverts ; renseignés, ils ajoutent un lien « ou » sous le bouton de paiement.
Ne JAMAIS y mettre une URL qui ne mène nulle part (cas du 06/11/2026 : le lien
Sponsors pointait vers un profil jamais activé).

## Modération

`POST /admin/hide` avec l'en-tête `Authorization: Bearer <ADMIN_SECRET>` et le
corps `{ "seq": 42 }` masque une entrée. `GET /admin/list` liste tout.

```bash
curl -X POST https://vespry-donors.<compte>.workers.dev/admin/hide \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"seq": 42}'
```

Un filtre anti-insultes (`src/moderation.ts`) retire automatiquement les noms
et messages problématiques à l'ingestion.

## Développement

```bash
npm test        # tests unitaires + SQL réel du mur (SQLite de Node, Node 22)
npm run typecheck
npm run dev     # Worker local (wrangler dev)
```

### Preuve locale d'un don payé (sans carte, sans toucher la prod)

```bash
# Base locale jetable + secret de webhook ALÉATOIRE (jamais celui de prod)
SP=$(mktemp -d)
npx wrangler d1 execute vespry-donors --local --persist-to "$SP" --file=schema.sql
umask 077; printf 'STRIPE_WEBHOOK_SECRET=whsec_local_%s\n' "$(openssl rand -hex 16)" > .dev.vars
npx wrangler dev --local --persist-to "$SP" --port 8799
# Dans un autre terminal : signer un checkout.session.completed payé avec ce
# secret (HMAC-SHA256 de "<t>.<corps>", en-tête Stripe-Signature t=…,v1=…),
# le POSTer sur /stripe/webhook, puis GET /donors doit le lister.
# Ensuite : rm .dev.vars (gitignoré, mais à ne pas laisser traîner).
```

Mesuré le 06/11/2026 : don payé → 200 et listé ; même événement rejoué → 200,
toujours 1 soutien (dédoublonnage par `stripe:<session>`) ; impayé → ignoré ;
mauvaise signature → 401 ; signature de plus de 5 min → 401.
