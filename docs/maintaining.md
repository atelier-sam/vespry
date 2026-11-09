# Maintaining Vespry

The source of truth is the maintainer's Gitea forge; `github.com/atelier-sam/vespry` is a mirror that receives every
push (second push URL of `origin`). Issues, Discussions and external pull requests live on GitHub.

## Landing an external pull request

```bash
git fetch https://github.com/atelier-sam/vespry.git pull/<N>/head:pr-<N>
git switch -c merge/pr-<N> main
git merge --no-ff pr-<N>          # keeps the contributor's commits and authorship
npm ci && npm test && npm run typecheck && npm run build
```

Then open and merge the pull request on Gitea, and push `main`. Once the mirror has the contributor's commits, GitHub
marks the pull request as merged on its own. Never squash an external pull request: GitHub would only see it as closed.

## The mirror can refuse a push

Secret scanning push protection is on for the GitHub repository. If a commit contains something that looks like a
secret (a test fixture, a fake token), Gitea accepts it and GitHub refuses it; the push output says so, and the mirror
stays behind. After each delivery, check that both sides have the same `main`:

```bash
git ls-remote origin main; git ls-remote https://github.com/atelier-sam/vespry.git main
```

Fix the fixture (preferred), or allow it through the link GitHub prints, with a reason.

## Issue form contract

`.github/ISSUE_TEMPLATE/bug.yml` and its field ids (`report`, `version`) are prefilled by every published version of
the extension (`src/diagnostics.ts`, `ISSUE_FORM`). Do not rename them. `src/issue-form.test.ts` checks the contract.
The form must be on the mirror's default branch before a release that uses it ships.

Prefill by URL is a GitHub feature that has regressed before: before each release, open a real *Report a problem*
link and check that the **Vespry report** box is filled.
