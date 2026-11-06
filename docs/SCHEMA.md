# Vespry export format

Every JSON file in a Vespry export points here through its `$schema` field.
This page describes what a `.zip` produced by Vespry contains, so that a
person, a script or an AI agent can read it without guessing.

Source of truth: `src/engine/packager.ts`. If this page and the code
disagree, the code wins; please open an issue.

## Archive layout

Only the folders of the formats and media you selected are present.

```
vespry-<server>.zip
├── INDEX.md              how to read the export + table of channels
├── manifest.json         machine-readable summary (see below)
├── json/<channel>.json   one file per channel, messages in chronological order
├── html/<channel>.html   readable page, open it in a browser
├── csv/<channel>.csv     spreadsheet
├── txt/<channel>.txt     plain text
├── media/<channel>/…     images
├── video/<channel>/…     videos
├── audio/<channel>/…     audio
├── files/<channel>/…     other attachments (documents, archives…)
├── emojis/<channel>/…    custom emojis
└── avatars/<channel>/…   avatars
```

### File names

- `<channel>` is the channel name with every character outside
  `A–Z a–z 0–9 _ - . space` replaced by `_`, cut to 100 characters.
- A thread or forum post is prefixed with its parent channel:
  `general.my-thread.json`.
- Names are unique inside the archive, case ignored (macOS and Windows
  extract onto case-insensitive file systems). When two channels or two
  attachments share a name, the first keeps it and the next ones get `-2`,
  `-3`… before the extension: `image.png`, `image-2.png`. Always follow
  `localPath` (below) rather than rebuilding a path from the original file
  name.
- A channel split into parts (the "messages per file" setting) gives
  `<channel>.part1.json`, `<channel>.part2.json`… one per format.

### Encrypted archives

With a password, the `.zip` holds a single AES-256 encrypted entry,
`export.zip`, which is the archive described above. Any tool that reads AES zip files (7-Zip, The
Unarchiver, `zip.js`) opens it with the password.

## JSON channel file

```json
{
  "$schema": "https://github.com/atelier-sam/vespry/blob/main/docs/SCHEMA.md",
  "vespryVersion": "1.1.0",
  "exportedAt": "2026-11-06T16:00:00.000Z",
  "guild": { "id": "1100000000000000001", "name": "Studio Kitsune" },
  "channel": {
    "id": "1100000000000000002",
    "name": "general",
    "type": 0,
    "typeName": "GUILD_TEXT"
  },
  "messageCount": 2,
  "messages": [ … ],
  "part": { "index": 1, "total": 3 }
}
```

| Field | Type | Meaning |
|---|---|---|
| `$schema` | string | Link to this page. |
| `vespryVersion` | string | Version of Vespry that wrote the file. |
| `exportedAt` | string (ISO 8601, UTC) | When the file was written. |
| `guild.id`, `guild.name` | string | Server, so each file stands on its own. For a direct message, the conversation. |
| `channel.id`, `channel.name` | string | Channel or thread. |
| `channel.type` | number | Discord channel type, as returned by the API. |
| `channel.typeName` | string | Readable name of `channel.type` (table below). `UNKNOWN_<n>` for a type Vespry does not know yet. |
| `messageCount` | number | Number of messages in **this** file. |
| `messages` | array | Messages, oldest first. |
| `part` | object, optional | Present only when the channel was split: `index` (1-based) and `total`. |

### Messages

Each message is the object returned by the Discord API, **unchanged**:
`snake_case` names, numeric `type`, and every field Discord sends, including
those Vespry does not know about yet. Main fields: `id`, `timestamp`,
`edited_timestamp`, `author`, `content`, `attachments`, `embeds`,
`reactions`, `mentions`, `message_reference` (the message being replied to),
`sticker_items`, `thread`. Reference:
<https://discord.com/developers/docs/resources/message#message-object>.

Vespry only **adds** fields, never renames or removes one:

| Added field | Where | Meaning |
|---|---|---|
| `typeName` | each message | Readable name of `type`: `DEFAULT`, `REPLY`, `THREAD_CREATED`, `CHANNEL_PINNED_MESSAGE`… `UNKNOWN_<n>` for an unknown type. |
| `localPath` | `attachments[]` | Path of the downloaded file inside the archive, e.g. `media/general/image-2.png`. |
| `localPath` | `embeds[].thumbnail`, `embeds[].image`, `embeds[].video` | Same, for embed media. |
| `localPath` | `embeds[].author`, `embeds[].footer` | Same, for their `icon_url`. |

`localPath` is absent when the media was not downloaded (type not selected,
link expired, download failed). The original `url` is always kept, but
Discord CDN links are signed and expire after about 24 hours.

### Channel types (`channel.typeName`)

| `type` | `typeName` |
|---|---|
| 0 | `GUILD_TEXT` |
| 1 | `DM` |
| 2 | `GUILD_VOICE` |
| 3 | `GROUP_DM` |
| 4 | `GUILD_CATEGORY` |
| 5 | `GUILD_ANNOUNCEMENT` |
| 10 | `ANNOUNCEMENT_THREAD` |
| 11 | `PUBLIC_THREAD` |
| 12 | `PRIVATE_THREAD` |
| 13 | `GUILD_STAGE_VOICE` |
| 14 | `GUILD_DIRECTORY` |
| 15 | `GUILD_FORUM` |
| 16 | `GUILD_MEDIA` |

## `manifest.json`

```json
{
  "guild": "Studio Kitsune",
  "guildId": "1100000000000000001",
  "exportedAt": "2026-11-06T16:00:00.000Z",
  "options": { "formats": ["json", "html"], "includeThreads": true, … },
  "encrypted": false,
  "totals": {
    "channels": 4,
    "messages": 1234,
    "assetsDownloaded": 87,
    "assetsFailed": 2
  },
  "channels": [
    {
      "name": "general",
      "files": ["json/general.json", "html/general.html"],
      "messages": 1000,
      "media": 80
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `guild`, `guildId` | Server name and id. |
| `exportedAt` | When the archive was built (ISO 8601, UTC). |
| `options` | Export settings as chosen. Never contains the password. |
| `encrypted` | `true` when the archive was protected by a password. |
| `totals.assetsFailed` | Media that could not be downloaded; their messages keep the original `url` and have no `localPath`. |
| `channels[].files` | Files written for this channel, one per format and per part, with their final (de-duplicated) names. |
| `channels[].media` | Media files stored for this channel. |

## CSV

One line per message, comma-separated, CRLF line endings, header:

```
AuthorID,Author,Date,Edited,Content,Attachments,Reactions
```

`Date` is the ISO 8601 timestamp, `Edited` is `yes` or empty, `Content` has
mentions turned into readable names, `Attachments` lists each attachment's path
relative to the CSV file (`../media/general/image.png`), or its original file
name when it was not downloaded, separated by ` | `.

## Stability

Within a major version, fields are only added, never removed or renamed.
`vespryVersion` tells you which version wrote a file.
