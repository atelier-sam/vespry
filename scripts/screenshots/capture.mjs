#!/usr/bin/env node
/**
 * Génère les captures d'écran du store en rendant le VRAI overlay Vespry
 * avec des données synthétiques (cf. harness.tsx). Aucune session Discord,
 * aucun serveur privé visible — fidèle au pixel, zéro fuite.
 *
 * Pipeline : build Vite du harnais → serveur statique → Playwright
 * (1280×800, fr-FR, reduced-motion) qui pilote chaque état et capture.
 *
 * Usage : node scripts/screenshots/capture.mjs
 * Sortie : docs/screenshots/{overlay,advanced,multi-select,export-done}.png
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const distDir = join(here, 'dist');
const outDir = join(root, 'docs', 'screenshots');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

console.log('▸ build du harnais…');
execSync('npx vite build --config scripts/screenshots/vite.config.ts', {
  cwd: root, stdio: 'inherit',
});

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0];
    const rel = url === '/' ? '/harness.html' : url;
    const buf = await readFile(join(distDir, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}/harness.html`;

// `--lang=fr-FR` : la langue de l'UI Chromium pilote le format des
// champs <input type="date"> (jj/mm/aaaa au lieu de mm/dd/yyyy).
const browser = await chromium.launch({ args: ['--lang=fr-FR'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2, // captures nettes ; le store accepte le 2×
  locale: 'fr-FR',
  reducedMotion: 'reduce', // fige bokeh + transitions → captures stables
  colorScheme: 'dark',
});
const page = await ctx.newPage();

/** Charge une page fraîche (état interne de l'overlay remis à zéro). */
async function fresh() {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 15_000 });
  await page.waitForSelector('#vespry-overlay-host', { state: 'attached' });
  // overlay monté + premier serveur auto-sélectionné → salons chargés.
  await page.waitForSelector('.v-crow', { timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

async function shoot(name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('  ✓', `${name}.png`);
}

// 1. overlay.png — vue principale, un salon ouvert (aperçu de messages).
await fresh();
await page.locator('.v-crow', { hasText: 'vespry' }).first().click();
await page.waitForSelector('.v-msg', { timeout: 10_000 });
await page.waitForTimeout(400);
await shoot('overlay');

// 2. advanced.png — mode Avancé + filtres actifs (zones générées).
await fresh();
await page.locator('.v-crow', { hasText: 'vespry' }).first().click();
await page.waitForSelector('.v-msg', { timeout: 10_000 });
await page.locator('.v-side .v-modeswitch span', { hasText: 'Avancé' }).click();
const inputs = page.locator('.v-filter-inputs .v-input');
await inputs.nth(0).fill('Kitsune');
await inputs.nth(1).fill('backup');
// Remonte le panneau en haut : saisir dans un champ bas l'avait fait défiler,
// masquant les chips « ZONES DE SÉLECTION » générées (le cœur du mode avancé).
await page.evaluate(() => {
  const sb = document.getElementById('vespry-overlay-host')
    ?.shadowRoot?.querySelector('.v-side-body');
  if (sb) sb.scrollTop = 0;
});
await page.waitForTimeout(300);
await shoot('advanced');

// 3. multi-select.png — plusieurs salons cochés + un salon ouvert en aperçu.
await fresh();
await page.locator('.v-crow', { hasText: 'vespry' }).first().click(); // focus → aperçu
await page.waitForSelector('.v-msg', { timeout: 10_000 });
for (const name of ['vespry', 'général', 'roadmap', 'design']) {
  await page.locator('.v-crow', { hasText: name }).first().locator('.v-cbx').click();
}
await page.waitForTimeout(300);
await shoot('multi-select');

// 4. export-done.png — file d'export avec un run terminé, détails dépliés.
await fresh();
await page.locator('.v-task .v-exp', { hasText: 'Détails' }).first().click();
await page.waitForSelector('.v-stats', { timeout: 5_000 });
await page.waitForTimeout(300);
await shoot('export-done');

// 5. html-export.png — rendu HTML d'export (vrai moteur toHtml, données synthétiques).
await page.goto(`http://localhost:${port}/export-harness.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__exportReady === true, { timeout: 15_000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await shoot('html-export');

await browser.close();
server.close();

// Le store exige 1280×800 EXACT (capture en 2× pour la netteté → on
// rééchantillonne en 1280×800, ratio 1.6 préservé, sans distorsion).
console.log('▸ rééchantillonnage 2× → 1280×800…');
for (const name of ['overlay', 'advanced', 'multi-select', 'export-done', 'html-export']) {
  execSync(`sips -z 800 1280 "${join(outDir, `${name}.png`)}"`, { stdio: 'ignore' });
}
console.log('\nCaptures écrites dans docs/screenshots/ (1280×800)');
