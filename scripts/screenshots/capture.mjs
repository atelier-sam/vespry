#!/usr/bin/env node
/**
 * Génère les captures d'écran du store en rendant le VRAI overlay Vespry
 * avec des données synthétiques (cf. harness.tsx). Aucune session Discord,
 * aucun serveur privé visible — fidèle au pixel, zéro fuite.
 *
 * Pipeline : build Vite du harnais → serveur statique → Playwright
 * (1280×800, fr-FR, reduced-motion) qui pilote chaque état et capture.
 *
 * Usage : node scripts/screenshots/capture.mjs [fr-FR|en-US] [dossier-de-sortie]
 *   La langue pilote l'interface du harnais (navigator.language).
 *   PLAYWRIGHT_CHROME=<chemin> force le binaire Chromium si celui de
 *   Playwright n'est pas installé.
 * Sortie : <dossier>/{overlay,advanced,multi-select,export-done,html-export}.png
 *   (défaut : docs/screenshots/<langue courte>/)
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const distDir = join(here, 'dist');
const locale = process.argv[2] ?? 'fr-FR';
const outDir = resolve(process.argv[3] ?? join(root, 'docs', 'screenshots', locale.slice(0, 2)));
await mkdir(outDir, { recursive: true });
// Libellés cliqués, lus dans la langue capturée (jamais en dur).
const L = JSON.parse(await readFile(join(root, 'src', 'locales', `${locale.slice(0, 2)}.json`), 'utf8'));
const label = (key) => L[key].replace(/\s*▾$/, '');

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
// Version affichée dans l'en-tête : VESPRY_VERSION (ex. la release à
// venir), sinon celle de package.json.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = process.env.VESPRY_VERSION || pkg.version;
const base = `http://localhost:${port}/harness.html?v=${encodeURIComponent(version)}`;

// `--lang` : la langue de l'UI Chromium pilote le format des champs
// <input type="date"> (jj/mm/aaaa en français, mm/dd/yyyy en anglais).
const browser = await chromium.launch({
  // Sur macOS, Chromium ignore --lang pour le format des dates : il suit
  // AppleLanguages. Pour une capture dans une autre langue que celle du Mac :
  //   defaults write com.google.chrome.for.testing AppleLanguages '(en-US)'
  //   … capture …
  //   defaults delete com.google.chrome.for.testing AppleLanguages
  args: [`--lang=${locale}`],
  executablePath: process.env.PLAYWRIGHT_CHROME || undefined,
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2, // captures nettes ; le store accepte le 2×
  locale,
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
await page.locator('.v-side .v-modeswitch span', { hasText: label('overlay.mode_advanced') }).click();
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
// Le harnais nomme « général » ou « general » selon la langue de la démo.
const general = locale.startsWith('fr') ? 'général' : 'general';
for (const name of ['vespry', general, 'roadmap', 'design']) {
  await page.locator('.v-crow', { hasText: name }).first().locator('.v-cbx').click();
}
await page.waitForTimeout(300);
await shoot('multi-select');

// 4. export-done.png — file d'export avec un run terminé, détails dépliés.
await fresh();
await page.locator('.v-task .v-exp', { hasText: label('queue.details_show') }).first().click();
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
console.log(`\nCaptures écrites dans ${outDir} (1280×800)`);
