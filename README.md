<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/hero-en-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/brand/hero-en-light.png">
  <img src="docs/brand/hero-en-dark.png" alt="Vespry, the crash-proof Discord history exporter" width="100%">
</picture>

<br/>

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-coming_soon-7b6cf0?logo=googlechrome&logoColor=white)](#-install)
[![Microsoft Edge Add-ons](https://img.shields.io/badge/Edge_Add--ons-coming_soon-7b6cf0?logo=microsoftedge&logoColor=white)](#-install)
[![Firefox Add-ons](https://img.shields.io/badge/Firefox_Add--ons-coming_soon-7b6cf0?logo=firefoxbrowser&logoColor=white)](#-install)
<br/>
[![Latest release](https://img.shields.io/github/package-json/v/atelier-sam/vespry?label=version&color=ec6a93)](https://github.com/atelier-sam/vespry/releases/latest)
[![CI](https://github.com/atelier-sam/vespry/actions/workflows/ci.yml/badge.svg)](https://github.com/atelier-sam/vespry/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](tsconfig.json)

**[Install](#-install)** · **[Features](#-features)** · **[Discreet mode](#️-discreet-mode)** · **[Privacy](#-privacy)** · **[Support Vespry 💜](#-support-vespry)** · **[Français](README.fr.md)**

</div>

<br/>

> [!TIP]
> **Vespry is free and has no ads, no account, no tracking.** It is built and
> maintained by one person. If it saved a server's history for you,
> [**a coffee helps keep it going**](https://vespry-donors.sam-muselet.workers.dev/donate) ☕

<br/>

## 🦉 Why Vespry

Discord's official data export only contains the messages you wrote yourself:
not the rest of the conversation, and attachments only as links. To keep a
whole channel or server you need a third-party tool, and on a large server the
export can run for hours. A closed tab, a crash or a network drop should not
send you back to zero.

Vespry saves as it goes:

- Every batch of messages is written to disk (IndexedDB) as it arrives.
- If the export stops (tab closed, crash, network loss), it resumes from the
  last saved point instead of starting over.
- Close the Discord tab and the export pauses, then picks up by itself the
  next time Discord is open.

The result is a local `.zip` archive, readable by a person as well as by an
AI agent, that stays on your computer.

<br/>

## 🕵️ Discreet mode

Since March 2026, users of export tools have reported account sanctions after
exporting their history: forced logout, temporary restriction, and in some
cases suspension ([DiscordChatExporter #1497](https://github.com/Tyrrrz/DiscordChatExporter/issues/1497),
[Discrub #14](https://github.com/pratherbytecraft/discrub/issues/14)). Discord has published nothing specific about export
tools, but its rules forbid automating a user account. One likely signal:
requests that do not look like the Discord client (without its headers and
cookies), sent fast and in parallel.

What Vespry does instead:

- **Requests leave from your discord.com tab**, with the Discord client's own
  headers and cookies. The extension itself never calls the Discord API.
- **Human pace by default**: one channel at a time, 1.5 to 3.5 s between reads,
  a pause of about ten minutes every 40 to 50 minutes, a per-session request
  cap. A Normal mode, twice as fast, sits behind a warning.
- **Stops at the first signal**: verification, refusal, protection page or
  "slow down", the export pauses and tells you why. No burst of retries.
- **Fewer requests**: the message count is done once, in series, and reused at
  launch.

This lowers the risk, it does not remove it: no tool can promise your account
won't be sanctioned. Vespry says so before your first export, in your language.

<br/>

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🛡️ Crash-proof
Resumes after an interruption, writes to disk in batches, restarts on its own
when Discord reopens. This is the core of the project, and it is covered by
tests.

</td>
<td width="50%" valign="top">

### 🔒 100% local
No Vespry server ever sees your messages. Optional AES-256 encryption of the
zip; the password is erased as soon as the archive is built.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🤖 Agent-ready
Structured JSON with a documented schema (`$schema`, `typeName`, `localPath`),
ready to hand to an AI agent or a notes app. Full format:
[docs/SCHEMA.md](docs/SCHEMA.md).

</td>
<td width="50%" valign="top">

### 🗓️ Scheduled backups
Recurring incremental backup of a server, daily or weekly. It runs as soon as
a Discord tab is open and notifies you.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎨 Four formats
JSON, HTML (Discord-style), CSV and TXT, several at once in a single pass.
Avatars, emojis, videos and audio stored locally.

</td>
<td width="50%" valign="top">

### 🌍 15 languages
English, French, German, Spanish, Italian, Portuguese, Dutch, Polish, Finnish,
Turkish, Russian, Japanese, Korean, Chinese and Hindi.

</td>
</tr>
</table>

<details>
<summary><strong>Every feature in detail</strong></summary>

<br/>

**Discord-like interface**: your servers and direct messages on the left, a
message preview in the middle (rendered markdown, quoted replies, reactions,
stickers, embeds, inline media), settings on the right. Dark or light theme.
**Simple** mode by default, **Advanced** one click away.

**Multi-channel selection + date range**: tick as many channels as you want and
set a time window; the queue handles each channel in turn.

**Pick messages one by one**: tick messages in the preview; they join the
selection on the right. Works together with filters.

**Boolean filters**: period, author, keyword, mention, pinned, has image /
video / sound / sticker / embed / link. Zones combine with **AND** or **OR**,
and each can be **inverted** (NOT).

**Incremental export**: a new export only fetches messages posted since the
last one. The date of the last export is shown.

**AES-256 encryption**: the password is never sent anywhere, kept only for the
duration of the export (to resume after an interruption), then erased. Strength
meter, and a clear warning: a forgotten password means an unrecoverable zip.

**File name templates**: `{guildName}-{date}.zip`, `{datetime}-{guildName}.zip`,
with a live preview.

**Large channel splitting**: 5,000 / 10,000 / 25,000 messages per file instead
of one unmanageable file.

**Bulk delete**: triple safeguard (selection required, confirmation dialog,
typing the confirmation word in your language). One message every 3 to 6 s in
Discreet pace, stops at Discord's first refusal. Idempotent.

**Export queue**: progress per task, live log, percentage badge on the toolbar
icon. Interrupted exports resume.

**Guided tour** on first launch, replayable from the popup. **Reset** button
that erases all local Vespry data.

</details>

<br/>

## 📸 Screenshots

<table>
<tr>
<td width="50%"><img src="docs/screenshots/en/overlay.png" alt="Vespry panel open over Discord, a channel preview in the middle"><br/><sub><b>Preview</b>: servers, channels, messages</sub></td>
<td width="50%"><img src="docs/screenshots/en/advanced.png" alt="Advanced mode with author and keyword selection zones"><br/><sub><b>Advanced mode</b>: AND / OR / NOT zones, formats, media</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/en/export-done.png" alt="Finished export with message, image, video and reaction counts"><br/><sub><b>Export queue</b>: live log and totals</sub></td>
<td width="50%"><img src="docs/screenshots/en/html-export.png" alt="HTML export rendered like Discord"><br/><sub><b>HTML export</b>: a browsable archive, Discord-style</sub></td>
</tr>
</table>

<sub>Screenshots use a demo server with made-up data: no real server is shown.</sub>

<br/>

## 📊 Vespry compared

| | Vespry | [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter) | [Discrub](https://github.com/pratherbytecraft/discrub) | [Discord History Tracker](https://github.com/chylex/Discord-History-Tracker) |
|---|:--:|:--:|:--:|:--:|
| Type | browser extension | desktop app, CLI | extension, web app | desktop app + script in the Discord tab |
| Resumes after an interruption | ✅ | ❌ | ✅ | partial |
| Requests sent from your Discord tab | ✅ | ❌ | ❌ | ✅ reads what the client loads |
| Built-in pacing, stops at Discord's first refusal | ✅ | ❌ retries | partial | ❌ |
| Incremental export (new messages only) | ✅ automatic | manual (`--after`) | manual (date range) | ✅ |
| Several formats in one export | ✅ | ❌ | ❌ | — |
| Formats | JSON, HTML, CSV, TXT | JSON, HTML, CSV, TXT | JSON, HTML, CSV, TXT | SQLite + HTML viewer |
| Large channel splitting | ✅ | ✅ | ✅ | — |
| Filters with AND / OR / NOT | ✅ | ✅ text syntax | OR only | — |
| `has:` filters (image, video, sticker…) | ✅ | ✅ no sticker | ✅ | — |
| Servers, forums, threads, DMs, groups | ✅ | ✅ | ✅ | partial |
| Media download | ✅ | ✅ | ✅ | ✅ |
| Preview before export | ✅ | ❌ | ✅ | — |
| Scheduled backups | ✅ built in | with cron / Task Scheduler | ❌ | — |
| AES-256 zip encryption | ✅ | ❌ | ❌ | — |
| File name templates | ✅ | ✅ | ❌ | — |
| Bulk message delete | ✅ | ❌ | ✅ | — |
| Interface languages | 15 | 5 (app), English (CLI) | 2 | — |
| Free | ✅ | ✅ | ✅ (paid extras) | ✅ |
| License | MIT | MIT | source available, all rights reserved | MIT |
| Telemetry | none (format report opt-in, off) | none | none | — |

<sub>Checked on 8 November 2026 against DiscordChatExporter 2.48, Discrub 2.2.8
and Discord History Tracker v47.4, from their documentation and source code.
— means not applicable or not checked. Freemium exporters on the Chrome Web
Store were left out: the ones we checked cap the free tier (a daily quota, or
50 to 100 messages) and call the Discord API themselves with your token.
Spotted a mistake? [Open an issue](https://github.com/atelier-sam/vespry/issues).</sub>

<br/>

## 🚀 Install

**From the stores** (recommended, automatic updates): Chrome Web Store,
Microsoft Edge Add-ons and Firefox Add-ons listings are on their way. The
badges at the top will link to them as soon as each store approves Vespry.

**By hand, in the meantime**: download the latest
[release](https://github.com/atelier-sam/vespry/releases/latest).

<table>
<tr>
<td valign="top" width="50%">

**Chrome · Edge · Brave · Opera · Arc**

1. Download `vespry-<version>.zip` and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked** → pick the unzipped folder.
4. Open Discord and sign in: the **Vespry** button appears at the top right.

</td>
<td valign="top" width="50%">

**Firefox**

1. Download `vespry_discord_export-<version>.zip`.
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on** → pick the zip.
4. Open Discord and sign in.

</td>
</tr>
</table>

A hand-installed Vespry tells you when a new release is out; a store install is
updated by the store and makes no such check.

<br/>

## 💜 Support Vespry

Vespry is free, open source and ad-free, and will stay that way. Donations pay
for the time it takes to keep Vespry working as Discord changes. Pick an
amount: you land on a Stripe payment page, no account needed.

<p align="center">
  <a href="https://vespry-donors.sam-muselet.workers.dev/donate?amount=3"><img src="docs/brand/donate-en-3.png" alt="Donate €3, a coffee" height="58"></a>
  <a href="https://vespry-donors.sam-muselet.workers.dev/donate?amount=5"><img src="docs/brand/donate-en-5.png" alt="Donate €5, an owl" height="58"></a>
  <a href="https://vespry-donors.sam-muselet.workers.dev/donate?amount=10"><img src="docs/brand/donate-en-10.png" alt="Donate €10, patron" height="58"></a>
  <a href="https://vespry-donors.sam-muselet.workers.dev/donate"><img src="docs/brand/donate-en-custom.png" alt="Donate a custom amount" height="58"></a>
</p>

You choose whether to appear on the **supporters wall** shown in the extension,
with a name and a short message, or to stay anonymous. The very first supporter
earns the "First Light" badge. Not in a position to give? A ⭐ on this repository
or a word to a friend helps too.

<br/>

## 📦 The exported file

The export is a self-contained `.zip`:

- messages in the formats you chose, **one file per channel**;
- **downloaded media**, sorted into folders;
- an `INDEX.md` that explains the content, and a machine-readable
  `manifest.json`;
- *(optional)* **AES-256** encryption when you set a password.

Layout, file naming and every JSON field: [docs/SCHEMA.md](docs/SCHEMA.md).

<br/>

## 🔐 Privacy

**Vespry runs entirely in your browser.** Your conversations, media and exports
live in your browser storage, then in the `.zip` you download. Nothing goes
through a Vespry server.

**The only outgoing traffic, all of it explicit:**

| Traffic | When | What leaves |
|---|---|---|
| **Discord API** | always | sent from your discord.com tab, by the Discord client |
| **Discord CDN** | export media | download through signed links, no token |
| **Stripe** | donation only | nothing unless you donate |
| **Donation service** | supporters wall | read-only, public supporters |
| **GitHub** | credits, version check (manual installs only) | IP / User-Agent (anonymous requests) |
| **Format report** | **opt-in, OFF** | only the *names* of new Discord fields |
| **Report a problem** | if you click | public GitHub form, pre-filled and **masked** (server and channel names, IDs, links, e-mails); nothing leaves until you click "Submit" |

No analytics, no pixel, no tracker. Full details in
[`PRIVACY.en.md`](PRIVACY.en.md) ([français](PRIVACY.md)).

<br/>

## 🌍 Translations

🇬🇧 English · 🇫🇷 Français · 🇩🇪 Deutsch · 🇪🇸 Español · 🇮🇹 Italiano ·
🇵🇹 Português · 🇳🇱 Nederlands · 🇵🇱 Polski · 🇫🇮 Suomi · 🇹🇷 Türkçe ·
🇷🇺 Русский · 🇯🇵 日本語 · 🇰🇷 한국어 · 🇨🇳 中文 · 🇮🇳 हिन्दी

Spotted a clumsy sentence, or want a new language? Strings live in
[`src/locales/`](src/locales), one JSON file per language: open an
[issue](https://github.com/atelier-sam/vespry/issues) or a pull request.

<br/>

## 🛠️ Development

```bash
npm install
npm run dev              # watch build + HMR (Chrome)
npm run build            # Chrome production build -> dist/
npm run build:firefox    # Firefox production build -> dist-firefox/
npm run test             # unit tests (vitest)
npm run typecheck        # type checking
npm run firefox:lint     # web-ext lint for AMO
```

TypeScript strict, Manifest V3, Vite, Preact. The export engine is covered by
unit tests: resuming an interrupted export, streaming AES-256, idempotent
deletion, and a guard that forbids any Discord API call outside the tab.
Architecture notes: [`CLAUDE.md`](CLAUDE.md).

<br/>

## 💬 Contact

- 💡 **Suggest an idea**: [GitHub Discussions](https://github.com/atelier-sam/vespry/discussions/new?category=ideas)
- 🐛 **Report a bug**: [GitHub Issues](https://github.com/atelier-sam/vespry/issues), or "Report a problem" in the extension
- 🔒 **Security issue**: [private report](https://github.com/atelier-sam/vespry/security/advisories/new), see [SECURITY.md](SECURITY.md)

<br/>

## ⚠️ Disclaimer

Automating a Discord user account goes against Discord's terms of service, and
since March 2026 users have reported account sanctions after exporting their
history. [Discreet mode](#️-discreet-mode) lowers that risk without removing it.
This tool is provided as is; use it on your own data, at your own risk. Before
your first export, Vespry shows this warning in your language and asks you to
accept it. Discord's official export (Settings → Data & Privacy → Request Data)
carries no risk for your account, but it only contains your own messages.

Vespry is not affiliated with Discord Inc. "Discord" and its logo are
trademarks of Discord Inc.

<br/>

## 📄 License

[MIT](LICENSE). The Discord API client (`src/engine/discord-api.ts`) derives from
[Discrub Classic](https://github.com/pratherbytecraft/discrub-ext) (MIT,
© Prather Bytecraft). "Discrub" is a trademark of Prather Bytecraft; Vespry is
not affiliated with it.

<div align="center">

<br/>

**© 2026 Samuel Muselet · [L'Atelier de Sam](https://atelier-sam.fr)**

<sub>made with passion 🦉</sub>

</div>
