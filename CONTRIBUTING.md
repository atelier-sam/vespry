# Contributing to Vespry

Thanks for helping. Vespry is maintained by [L'Atelier de Sam](https://atelier-sam.fr), a small repair shop in
Poitiers, France; replies may take a few days.

## Where things go

| You want to… | Go to |
|---|---|
| Report a bug | [New issue → Bug report](https://github.com/atelier-sam/vespry/issues/new?template=bug.yml). The *Report a problem* button in Vespry fills it for you, with private names already masked. |
| Suggest a feature | [Discussions → Ideas](https://github.com/atelier-sam/vespry/discussions/new?category=ideas) |
| Report a vulnerability | Privately, see [SECURITY.md](SECURITY.md) |
| Translate | Locale files live in `src/locales/*.json`; a pull request is welcome. |

## Development

Requirements: Node 24 (what CI runs; 22 works) and npm 10+.

```bash
npm ci
npm test            # vitest
npm run typecheck   # tsc, strict
npm run build       # Chrome / Edge → dist/
npm run build:firefox
npm run firefox:lint
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode), or `dist-firefox/` through
`about:debugging` in Firefox.

## Rules a pull request must respect

- **No direct call to Discord's API outside `src/content/rest-bridge.ts`.** Every request goes through the bridge, which
  paces requests and handles rate limits. This is what keeps users' accounts safe.
- Nothing leaves the user's machine: no analytics, no remote logging, no new network destination without discussion.
- TypeScript strict, no `any` added. New behaviour comes with tests; `npm test` and `npm run typecheck` pass.
- Tests use fake identifiers only (`src/no-real-ids.test.ts` enforces it).
- A new user-visible string is added to every file in `src/locales/` (the parity test checks it).

## How pull requests land

The repository on GitHub is a mirror of the maintainer's own forge. Pull requests are reviewed here, then merged
upstream with your commits and authorship kept; when the mirror updates, GitHub marks your pull request as merged.
Maintainer steps: [docs/maintaining.md](docs/maintaining.md).

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
