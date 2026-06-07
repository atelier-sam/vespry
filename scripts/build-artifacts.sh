#!/usr/bin/env bash
#
# Produit les trois artefacts soumissibles aux stores, à partir de l'état
# courant du repo. Version lue depuis package.json (source unique).
#
#   - vespry-<v>.zip                         → Chrome Web Store + Microsoft Edge
#   - web-ext-artifacts/vespry_..._<v>.zip   → Mozilla AMO
#   - vespry-source-<v>.zip                  → AMO (code source exigé en MV3)
#
# Tous gitignorés (*.zip) : livrables locaux à uploader, pas des fichiers du
# repo. Usage : bash scripts/build-artifacts.sh
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
echo "▸ Vespry $VERSION — génération des artefacts"

# 1. Chrome / Edge — build dist/ puis zip à plat (manifest.json à la racine).
echo "▸ build Chrome…"
npm run build >/dev/null
rm -f "vespry-$VERSION.zip"
( cd dist && zip -qr "../vespry-$VERSION.zip" . )
echo "  ✓ vespry-$VERSION.zip"

# 2. Firefox / AMO — build dist-firefox/ puis paquet web-ext signé-able.
echo "▸ build Firefox…"
npm run build:firefox >/dev/null
npm run firefox:package >/dev/null
echo "  ✓ web-ext-artifacts/vespry_discord_export-$VERSION.zip"

# 3. Code source pour AMO (review MV3). HEAD = état commité uniquement.
echo "▸ archive source…"
rm -f "vespry-source-$VERSION.zip"
git archive --format=zip -o "vespry-source-$VERSION.zip" HEAD
echo "  ✓ vespry-source-$VERSION.zip"

echo
echo "Vérif manifest dans le zip Chrome :"
unzip -p "vespry-$VERSION.zip" manifest.json | grep -E '"(manifest_version|version|name)"'
echo
echo "Artefacts prêts à uploader."
