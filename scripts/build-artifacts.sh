#!/usr/bin/env bash
#
# Produit les trois artefacts soumissibles aux stores, à partir d'un COMMIT
# exact (HEAD par défaut), jamais de l'arbre de travail. Version lue depuis
# package.json du commit (source unique).
#
#   - vespry-<v>.zip                         → Chrome Web Store + Microsoft Edge
#   - vespry_discord_export-<v>.zip          → Mozilla AMO
#   - vespry-source-<v>.zip                  → AMO (code source exigé en MV3)
#   - SHA256SUMS                             → empreintes des trois, + sha du commit
#
# Pourquoi un git archive + npm ci : AMO rebâtit l'extension depuis le zip
# source. Bâtir nous-mêmes depuis ce même zip garantit que ce qui est soumis
# EST ce que le relecteur reproduira (l'ancienne version bâtissait l'arbre de
# travail, modifications non commitées comprises, mais archivait HEAD).
#
# Remplace la CI GitHub Actions (`release.yml`, conservée sur le miroir mais
# non bloquante) : les portes se jouent ici, en local, sur le commit exact.
#
# Usage : bash scripts/build-artifacts.sh [<commit>]   → artefacts dans release/<v>/
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"
REV="${1:-HEAD}"
SHA="$(git rev-parse --verify "$REV^{commit}")"

if [ "$REV" = "HEAD" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "✗ arbre de travail modifié : commite d'abord (les artefacts viennent du commit, pas de l'arbre)." >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Source exacte du commit — c'est aussi le zip source pour AMO.
git archive --format=zip -o "$WORK/source.zip" "$SHA"
mkdir "$WORK/src"
( cd "$WORK/src" && unzip -q ../source.zip )
VERSION="$(node -p "require('$WORK/src/package.json').version")"
OUT="$REPO/release/$VERSION"
echo "▸ Vespry $VERSION — commit ${SHA:0:12}"

# 2. Dépendances du lockfile, sans scripts d'installation (aucun n'est requis
#    au build ; esbuild prend son binaire de plateforme en dépendance optionnelle).
echo "▸ npm ci…"
( cd "$WORK/src" && npm ci --ignore-scripts --no-audit --no-fund >/dev/null )

# 3. Portes, sur ce même arbre extrait.
echo "▸ portes : tsc, tests, builds, lint Firefox…"
( cd "$WORK/src" \
  && npm run typecheck >/dev/null \
  && npx vitest run >/dev/null \
  && npm run build >/dev/null \
  && npm run build:firefox >/dev/null \
  && npx web-ext lint --source-dir=dist-firefox --output=json > "$WORK/lint.json" ) \
  || { echo "✗ une porte a échoué" >&2; exit 1; }
node -e "const l=require('$WORK/lint.json'); if (l.errors.length) { console.error('✗ web-ext lint :', l.errors.length, 'erreur(s)'); process.exit(1); } console.log('  lint Firefox : 0 erreur,', l.warnings.length, 'avertissement(s)')"

# 4. Empaquetage.
rm -rf "$OUT"; mkdir -p "$OUT"
( cd "$WORK/src/dist" && zip -qrX "$OUT/vespry-$VERSION.zip" . )
( cd "$WORK/src" && npx web-ext build --source-dir=dist-firefox --artifacts-dir="$OUT" --overwrite-dest >/dev/null )
cp "$WORK/source.zip" "$OUT/vespry-source-$VERSION.zip"

# 5. Contrôles : version du manifeste = version du paquet, empreintes.
for z in "vespry-$VERSION.zip" "vespry_discord_export-$VERSION.zip"; do
  v="$(unzip -p "$OUT/$z" manifest.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")"
  [ "$v" = "$VERSION" ] || { echo "✗ $z : manifeste en $v, attendu $VERSION" >&2; exit 1; }
done
( cd "$OUT" && { echo "# commit $SHA"; shasum -a 256 ./*.zip; } > SHA256SUMS )

echo "  ✓ $OUT"
cat "$OUT/SHA256SUMS"
