# Privacy policy — Vespry

**Last updated: 6 November 2026** (version 1.1.0).
Version française : [PRIVACY.md](PRIVACY.md) (the French version prevails in
case of discrepancy).

Vespry is a browser extension (Chrome, Edge, Firefox) that exports the user's
Discord conversation history into a `.zip` file saved on their own computer.

This policy explains what data Vespry handles, where it goes, and what is
never sent anywhere.

## Publisher

- **Publisher**: Samuel Muselet (L'Atelier de Sam)
- **Contact**: [GitHub issues](https://github.com/atelier-sam/vespry/issues);
  for a security issue, use the repository's
  [private report](https://github.com/atelier-sam/vespry/security/advisories/new)
  (visible to the publisher only).
- **Source code**: https://github.com/atelier-sam/vespry (MIT)

## Principle: your data stays on your computer

Messages, media and exports never leave your computer. Vespry has no server
that receives them. No tracking pixel, no analytics script, no cookie set by
Vespry.

## Data handled, and where it stays

| Data | From | Where it stays | Why | How long |
|---|---|---|---|---|
| Discord session token | Read from the Discord page you opened | `chrome.storage.local` (your browser profile, readable by Vespry only) | Detect that you signed back in. The requests themselves are sent by the Discord client in your tab, with its own session (see Network, 1). | Until "Reset Vespry" or uninstall |
| Exported messages | Discord API, through your tab | IndexedDB (your browser), then the downloaded `.zip` | Resume an interrupted export, then build the archive | Until you delete the export from the history, "Reset Vespry" or uninstall |
| Media (images, videos, audio, files) | Discord CDN (signed links) | IndexedDB, then the `.zip` | Include media in the archive | Same |
| Archive password (optional) | Typed by you | IndexedDB, **during the export only** | Resume the export after an interruption and encrypt the archive at the end | **Erased as soon as the encrypted archive is built.** An encrypted archive is then never rebuilt unencrypted: run the export again |
| Preferences (theme, Advanced mode, pace, file name template, schedule, telemetry choice) | Your settings | `chrome.storage.local` | Keep them between sessions | Until "Reset Vespry" or uninstall |

## Network traffic (the only traffic)

### 1. Discord

Every request to the Discord API is sent **from your discord.com tab, by the
Discord client itself**: same origin, same cookies, same headers as when you
browse. The extension never calls the Discord API directly (a code test
forbids it). Media are then downloaded from the Discord CDN
(`cdn.discordapp.com`, `media.discordapp.net`) through their signed links,
without any token.

Vespry never sends your token to any server.

### 2. Stripe (only if you donate)

The **Support Vespry** button opens a Stripe Checkout payment page. Vespry
never sees your card: Stripe collects it directly. If you do not donate,
nothing is sent to Stripe. Stripe's policy: https://stripe.com/privacy

If you choose to appear on the supporters wall, your nickname and message
are shown publicly. Otherwise your donation is anonymous.

### 3. Format report (optional, off by default)

In Advanced mode, you can allow Vespry to report that it met a Discord API
field it cannot display yet. The message sent to the Vespry service contains
strictly:

```json
{
  "version": "1.1.0",
  "locale": "en-US",
  "fields": ["message.voice_notes_v2", "..."]
}
```

**Never sent**: the token, any message content, any user, server or channel
identifier, any name, any installation identifier. The service does not
store your IP address; it opens one public GitHub issue per new combination
of fields, to prioritise updates. Code: `src/engine/schema-report.ts`
(extension) and `donor-service/src/schema-reports.ts` (service).

### 4. Supporters wall and credits

When the panel opens, Vespry reads:

- `https://vespry-donors.sam-muselet.workers.dev/donors`: the public list of
  supporters (nickname and message of those who chose to appear);
- `https://raw.githubusercontent.com/atelier-sam/vespry/main/credits.json`:
  the donation service address and the contributors list, so they can be
  updated without a new release. If it fails, Vespry uses its built-in copy.

These two reads carry no Discord data and no Vespry identifier. Like any web
request, they expose your IP address and browser (User-Agent) to Cloudflare
and GitHub. The donation service logs neither IP nor identifier.

### 5. Version check

Installed from a store (Chrome Web Store, Edge, Firefox), Vespry makes no
check: the store updates it. Installed by hand (developer mode), it queries
`https://api.github.com/repos/atelier-sam/vespry/releases/latest` when you
open the extension menu, to know whether a newer version exists. Anonymous
request, no Discord data. If it fails, nothing is shown.

### 6. Report a problem (only if you click)

"Report a problem" opens a **public** GitHub issue form in your browser,
pre-filled. Nothing is sent until you click "Submit" in GitHub yourself. The
report contains the Vespry version, your browser, your language and the
task's technical log; before opening the form, Vespry **masks** server and
channel names, Discord identifiers, links and e-mail addresses. It never
contains your token or the content of your messages. Read it before sending.

## Your rights (GDPR)

Vespry processes no personal data on its servers, except the nickname and
message of supporters who chose to appear on the public wall.

- **Local data**: you have full control. Delete an export from the history
  in the extension menu, erase everything with "Reset Vespry" (same menu),
  or uninstall the extension.
- **Supporters wall**: ask for your name or message to be removed or hidden
  through a [GitHub issue](https://github.com/atelier-sam/vespry/issues).
- **Payment**: Stripe keeps payment data according to its own legal
  obligations.

## Cookies

Vespry sets no cookie. Cloudflare (in front of the donation service) and
GitHub may set their technical protection cookies during the reads in § 4;
Vespry does not read them.

## Security

- Open, auditable source code.
- Security issue: use the
  [private report](https://github.com/atelier-sam/vespry/security/advisories/new),
  not a public issue.
- Optional AES-256 encryption of the exported archive.

## Changes

Any change to this policy is published in the repository (`PRIVACY.md`,
full git history) and noted in `CHANGELOG.md`.

## Discord

Exporting your history with a user account goes beyond Discord's terms of
service (https://discord.com/terms), and Discord has been sanctioning this
use since March 2026. Vespry reduces the risk (requests sent by your tab,
human pace, full stop at the first refusal) but cannot remove it: the
warning shown before the first export says so. Discord's official export
(Settings → Data & Privacy → Request all of my data) remains the risk-free
way.

Vespry is not affiliated with Discord Inc. "Discord" is a trademark of
Discord Inc.
