#!/usr/bin/env node
/**
 * Captures de REVUE du chantier « export discret » : modale d'avertissement,
 * réglage Rythme, avertissement du passage en Normal, modale de suppression,
 * raison d'arrêt sur la carte d'export. Même harnais que les captures du
 * store (vrai overlay, données synthétiques), scène `?scene=discret`.
 *
 * Usage : node scripts/screenshots/capture-discret.mjs <dossier-de-sortie> [fr-FR|en-US]
 * Ne touche PAS docs/screenshots (captures du store).
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const distDir = join(here, 'dist');
const outDir = resolve(process.argv[2] ?? join(root, 'docs', 'screenshots', 'discret'));
const locale = process.argv[3] ?? 'fr-FR';
const fr = locale.startsWith('fr');
await mkdir(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
};

execSync('npx vite build --config scripts/screenshots/vite.config.ts', { cwd: root, stdio: 'ignore' });

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
const base = `http://localhost:${server.address().port}/harness.html?scene=discret`;

// PW_CHANNEL=chrome : utilise le Chrome installé quand le navigateur
// Playwright de la bonne révision n'est pas téléchargé.
const browser = await chromium.launch({
  args: [`--lang=${locale}`],
  ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale,
  reducedMotion: 'reduce', colorScheme: 'dark',
});
const page = await ctx.newPage();
// Les crédits se lisent en direct sur GitHub (main) : on sert la copie de la
// BRANCHE, sinon la capture montrerait l'état publié, pas celui à relire.
const creditsJson = await readFile(new URL('../../credits.json', import.meta.url));
await page.route(/raw\.githubusercontent\.com\/.*\/credits\.json/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: creditsJson }));
const host = () => page.locator('#vespry-overlay-host');
const suffix = fr ? '' : '-en';

async function fresh() {
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__harnessReady === true, { timeout: 15_000 });
  await page.waitForSelector('.v-crow', { timeout: 10_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}
async function shoot(name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(outDir, `${name}${suffix}.png`) });
  console.log('  ✓', `${name}${suffix}.png`);
}
async function advanced() {
  await page.locator('.v-side .v-modeswitch span').nth(1).click();
}
async function scrollSideTo(selector) {
  await page.evaluate((sel) => {
    const sr = document.getElementById('vespry-overlay-host')?.shadowRoot;
    sr?.querySelector(sel)?.scrollIntoView({ block: 'center' });
  }, selector);
  await page.waitForTimeout(250);
}

// 1. Modale d'avertissement au premier export.
await fresh();
await page.locator('.v-crow', { hasText: 'vespry' }).first().locator('.v-cbx').click();
await page.locator('.v-tuto-launch').click();
await page.waitForSelector('.v-modal--tos', { timeout: 5_000 });
await shoot('1-avertissement');

// 2. Réglage Rythme (options avancées), Discret actif.
await fresh();
await advanced();
await scrollSideTo('.v-pace');
await shoot('2-rythme');

// 3. Passage en Normal : encart d'avertissement en ligne.
await page.locator('.v-pace-switch span').nth(1).click();
await page.waitForSelector('.v-pace-warn', { timeout: 5_000 });
await page.evaluate(() => {
  const sr = document.getElementById('vespry-overlay-host')?.shadowRoot;
  sr?.querySelector('.v-pace-warn-actions')?.scrollIntoView({ block: 'end' });
});
await shoot('3-rythme-normal-avertissement');

// Contrôle de comportement (pas seulement une image) : confirmer passe bien
// en Normal et ferme l'encart ; revenir en Discret est immédiat.
await page.locator('.v-pace-warn-actions .v-btn').nth(1).click();
await page.waitForSelector('.v-pace-warn', { state: 'detached', timeout: 5_000 });
const onAfterConfirm = await page.locator('.v-pace-switch span.on').count();
const normalOn = await page.locator('.v-pace-switch span').nth(1).getAttribute('aria-checked');
if (normalOn !== 'true' || onAfterConfirm !== 1) throw new Error('confirmation Normal non appliquée');
await page.locator('.v-pace-switch span').nth(0).click();
await page.waitForTimeout(150);
if (await page.locator('.v-pace-warn').count() !== 0) throw new Error('retour Discret a ouvert un avertissement');
if (await page.locator('.v-pace-switch span').nth(0).getAttribute('aria-checked') !== 'true') {
  throw new Error('retour Discret non appliqué');
}
console.log('  ✓ comportement : Normal après confirmation, Discret immédiat');

// 4. Modale de suppression : risque + rythme.
await fresh();
await advanced();
await page.locator('.v-crow', { hasText: 'vespry' }).first().click();
await page.waitForSelector('.v-msg', { timeout: 10_000 });
await page.locator('.v-msg').nth(0).click();
await page.locator('.v-msg').nth(3).click();
await scrollSideTo('.v-btn-danger');
await page.locator('.v-side .v-btn-danger').click();
await page.waitForSelector('.v-modal-risk', { timeout: 5_000 });
await shoot('4-suppression');

// 5. Carte d'export arrêtée net par Discord : la raison est affichée.
await fresh();
await page.evaluate(() => {
  const sr = document.getElementById('vespry-overlay-host')?.shadowRoot;
  sr?.querySelector('.v-stop-reason')?.scrollIntoView({ block: 'center' });
});
await shoot('5-arret-net');

// 6. Don : la modale Stripe, sans lien de plateforme mort ; 7. panneau
// Soutiens : un seul bouton actif, plus de « Dons bientôt disponibles ».
await fresh();
await page.locator('.v-wall-cta').click();
await page.waitForSelector('.v-modal-pay', { timeout: 5_000 });
if (await page.locator('.v-modal-alt').count()) throw new Error('lien Ko-fi/Sponsors encore affiché');
await shoot('6-don-modale');
await page.locator('.v-modal-wall').click();
await page.waitForSelector('.v-credits', { timeout: 5_000 });
const donate = page.locator('.v-credits .v-donate');
if ((await donate.count()) !== 1 || (await donate.isDisabled())) throw new Error('bouton Soutenir absent ou inactif');
await shoot('7-soutiens');
await donate.click();
await page.waitForSelector('.v-modal-pay', { timeout: 5_000 });

await browser.close();
server.close();
for (const n of ['1-avertissement', '2-rythme', '3-rythme-normal-avertissement', '4-suppression', '5-arret-net', '6-don-modale', '7-soutiens']) {
  execSync(`sips -z 800 1280 "${join(outDir, `${n}${suffix}.png`)}"`, { stdio: 'ignore' });
}
console.log(`Captures dans ${outDir}`);
