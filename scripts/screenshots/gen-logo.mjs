#!/usr/bin/env node
/**
 * Génère le logo 300×300 pour la fiche Microsoft Edge (le store recommande
 * 300×300 ; l'icône d'extension est en 128×128). Réutilise la mascotte
 * hibou pixel-art (identique à scripts/gen-icons.mjs) centrée sur le fond
 * crépuscule de la marque. Vectoriel → net.
 *
 * Usage : node scripts/screenshots/gen-logo.mjs
 * Sortie : docs/screenshots/logo-300.png
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', '..', 'docs', 'screenshots');

const PAL = { o: '#1F1A33', b: '#5D4EAE', f: '#F4EBD4', w: '#FEFDF8', p: '#1F1A33', k: '#F0B54A' };
const RIM = '#B3A6E6';
const HEAD = [
  '...oo....oo...',
  '..obbo..obbo..',
  '.obbbbbbbbbbo.',
  'obbbbbbbbbbbbo',
  'obffffffffffbo',
  'obfwwwffwwwfbo',
  'obfwpwffwpwfbo',
  'obfwwwffwwwfbo',
  'obffffkkffffbo',
  'obffffffffffbo',
  '.obffffffffbo.',
  '..obffffffbo..',
  '...obbbbbbo...',
];
const H = HEAD.length;
const W = HEAD[0].length;
const filled = (x, y) => x >= 0 && x < W && y >= 0 && y < H && HEAD[y][x] !== '.';
const rim = [];
for (let y = -1; y <= H; y += 1) {
  for (let x = -1; x <= W; x += 1) {
    if (filled(x, y)) continue;
    if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) rim.push({ x, y });
  }
}
function svg() {
  let rects = '';
  for (const { x, y } of rim) rects += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${RIM}"/>`;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const c = HEAD[y][x];
      if (c === '.') continue;
      rects += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${PAL[c]}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 300, height: 300 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.setContent(
  `<!doctype html><meta charset="utf-8">`
  + `<style>html,body{margin:0}`
  + `.tile{width:300px;height:300px;display:flex;align-items:center;justify-content:center;`
  + `background:`
  + `radial-gradient(60% 55% at 24% 18%, rgba(108,92,224,.55), transparent 72%),`
  + `radial-gradient(58% 50% at 82% 86%, rgba(236,106,147,.42), transparent 72%),`
  + `#16111f;}`
  + `svg{width:188px;height:188px;display:block;image-rendering:pixelated;`
  + `filter:drop-shadow(0 8px 22px rgba(0,0,0,.45));}`
  + `</style>`
  + `<div class="tile">${svg()}</div>`,
);
await page.screenshot({ path: join(outDir, 'logo-300.png'), clip: { x: 0, y: 0, width: 300, height: 300 } });
console.log('✓ docs/screenshots/logo-300.png');
await browser.close();
