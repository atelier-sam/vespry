# Politique de confidentialité — Vespry

**Dernière mise à jour : 6 novembre 2026** (version 1.1.0).
English version: [PRIVACY.en.md](PRIVACY.en.md).

Vespry est une extension de navigateur (Chrome, Edge, Firefox) qui exporte
l'historique des conversations Discord de l'utilisateur dans un fichier
`.zip` enregistré sur sa machine.

Cette politique dit quelles données Vespry traite, où elles vont, et ce qui
n'est envoyé nulle part.

## Éditeur

- **Éditeur** : Samuel Muselet (L'Atelier de Sam)
- **Contact** : [issues GitHub](https://github.com/atelier-sam/vespry/issues) ;
  pour une faille de sécurité, le
  [signalement privé](https://github.com/atelier-sam/vespry/security/advisories/new)
  du dépôt (visible de l'éditeur seul).
- **Code source** : https://github.com/atelier-sam/vespry (MIT)

## Principe : tes données restent sur ta machine

Les messages, les médias et les exports ne quittent jamais ton ordinateur.
Vespry n'a aucun serveur qui les reçoit. Aucun pixel de suivi, aucun script
d'analyse, aucun cookie posé par Vespry.

## Données traitées, et où elles restent

| Donnée | D'où | Où elle reste | Pourquoi | Combien de temps |
|---|---|---|---|---|
| Jeton de session Discord | Lu dans la page Discord que tu as ouverte | `chrome.storage.local` (ton profil de navigateur, lisible par Vespry seul) | Détecter que tu t'es reconnecté. Les requêtes, elles, sont émises par le client Discord de ton onglet, avec sa propre session (cf. Sorties réseau, 1). | Jusqu'à « Réinitialiser Vespry » ou la désinstallation |
| Messages exportés | API Discord, par ton onglet | IndexedDB (ton navigateur), puis le `.zip` téléchargé | Reprendre un export interrompu, puis fabriquer l'archive | Jusqu'à la suppression de l'export dans l'historique, « Réinitialiser Vespry » ou la désinstallation |
| Médias (images, vidéos, audio, fichiers) | CDN Discord (liens signés) | IndexedDB, puis le `.zip` | Inclure les médias dans l'archive | Idem |
| Mot de passe de l'archive (optionnel) | Saisi par toi | IndexedDB, **pendant l'export seulement** | Pouvoir reprendre l'export après une coupure et chiffrer l'archive à la fin | **Effacé dès l'archive chiffrée fabriquée.** Une archive chiffrée n'est ensuite jamais refaite en clair : il faut relancer l'export |
| Préférences (thème, mode Avancé, rythme, modèle de nom de fichier, planning, choix de télémétrie) | Tes réglages | `chrome.storage.local` | Les retrouver d'une session à l'autre | Jusqu'à « Réinitialiser Vespry » ou la désinstallation |

## Sorties réseau (les seules)

### 1. Discord

Toutes les requêtes vers l'API Discord sont émises **depuis ton onglet
discord.com, par le client Discord lui-même** : même origine, mêmes cookies,
mêmes en-têtes que quand tu navigues. L'extension n'appelle jamais l'API
Discord directement (un test du code l'interdit). Les médias sont ensuite
téléchargés depuis le CDN Discord (`cdn.discordapp.com`,
`media.discordapp.net`) par leurs liens signés, sans jeton.

Vespry ne transmet ton jeton à aucun serveur.

### 2. Stripe (seulement si tu fais un don)

Le bouton **Soutenir Vespry** ouvre une page de paiement Stripe Checkout.
Vespry ne voit jamais ta carte : Stripe la collecte directement. Si tu ne
donnes pas, rien n'est envoyé à Stripe. Politique de Stripe :
https://stripe.com/fr/privacy

Si tu choisis d'apparaître sur le mur des soutiens, ton pseudo et ton
message sont affichés publiquement. Sinon, ton don est anonyme.

### 3. Signalement de format (optionnel, désactivé par défaut)

Dans le mode Avancé, tu peux autoriser Vespry à signaler qu'il a rencontré
un champ de l'API Discord qu'il ne sait pas encore afficher. Le message
envoyé au service Vespry contient strictement :

```json
{
  "version": "1.1.0",
  "locale": "fr-FR",
  "fields": ["message.voice_notes_v2", "..."]
}
```

**Jamais envoyé** : le jeton, un contenu de message, un identifiant
d'utilisateur, de serveur ou de salon, un nom, un identifiant
d'installation. Le service n'enregistre pas ton adresse IP ; il ouvre une
issue GitHub publique par nouvelle combinaison de champs, pour prioriser les
mises à jour. Code : `src/engine/schema-report.ts` (extension) et
`donor-service/src/schema-reports.ts` (service).

### 4. Mur des soutiens et crédits

À l'ouverture du panneau, Vespry lit :

- `https://vespry-donors.sam-muselet.workers.dev/donors` : la liste publique
  des soutiens (pseudo et message de ceux qui ont choisi d'apparaître) ;
- `https://raw.githubusercontent.com/atelier-sam/vespry/main/credits.json` :
  l'adresse du service de dons et la liste des contributeurs, pour les
  mettre à jour sans nouvelle version. En cas d'échec, Vespry utilise la
  copie intégrée.

Ces deux lectures ne portent aucune donnée Discord ni aucun identifiant
Vespry. Comme toute requête web, elles exposent ton adresse IP et ton
navigateur (User-Agent) à Cloudflare et à GitHub. Le service de dons ne
journalise ni IP ni identifiant.

### 5. Vérification de version

Installé depuis un store (Chrome Web Store, Edge, Firefox), Vespry ne fait
aucune vérification : le store le met à jour. Installé à la main (mode
développeur), il interroge à l'ouverture du menu
`https://api.github.com/repos/atelier-sam/vespry/releases/latest` pour savoir
si une nouvelle version existe. Requête anonyme, sans aucune donnée Discord.
En cas d'échec, rien ne s'affiche.

### 6. Signaler un problème (seulement si tu cliques)

« Signaler un problème » ouvre dans ton navigateur un formulaire de ticket
GitHub **public**, pré-rempli. Rien n'est envoyé tant que tu ne cliques pas
toi-même sur « Submit » dans GitHub. Le rapport contient la version de
Vespry, ton navigateur, ta langue et le journal technique de la tâche ;
avant d'ouvrir le formulaire, Vespry y **masque** les noms de serveur et de
salons, les identifiants Discord, les liens et les adresses e-mail. Il ne
contient jamais ton jeton ni le contenu de tes messages. Relis-le avant de
l'envoyer.

## Tes droits (RGPD)

Vespry ne traite aucune donnée personnelle sur ses serveurs, sauf le pseudo
et le message des soutiens qui ont choisi d'apparaître sur le mur public.

- **Données locales** : tu en as le contrôle complet. Supprime un export
  depuis l'historique du menu de l'extension, ou efface tout avec
  « Réinitialiser Vespry » (même menu), ou désinstalle l'extension.
- **Mur des soutiens** : demande la suppression ou le masquage de ton nom ou
  de ton message par une [issue GitHub](https://github.com/atelier-sam/vespry/issues).
- **Paiement** : Stripe conserve les données du paiement selon ses propres
  obligations légales.

## Cookies

Vespry ne dépose aucun cookie. Cloudflare (devant le service de dons) et
GitHub peuvent poser leurs cookies techniques de protection lors des
lectures du § 4 ; Vespry ne les lit pas.

## Sécurité

- Code source ouvert et auditable.
- Faille de sécurité : utilise le
  [signalement privé](https://github.com/atelier-sam/vespry/security/advisories/new),
  pas une issue publique.
- Chiffrement AES-256 optionnel de l'archive exportée.

## Modifications

Toute modification de cette politique est publiée dans le dépôt
(`PRIVACY.md`, historique git complet) et signalée dans `CHANGELOG.md`.

## Discord

Exporter son historique avec un compte utilisateur sort des conditions
d'utilisation de Discord (https://discord.com/terms), et Discord sanctionne
cet usage depuis mars 2026. Vespry réduit ce risque (requêtes émises par
ton onglet, rythme humain, arrêt au premier refus) mais ne peut pas le
supprimer : l'avertissement affiché avant le premier export le dit.
L'export officiel de Discord (Paramètres → Données et confidentialité →
Demander mes données) reste la voie sans risque.

Vespry n'est pas affilié à Discord Inc. « Discord » est une marque de
Discord Inc.
