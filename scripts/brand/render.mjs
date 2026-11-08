#!/usr/bin/env node
/**
 * Images de marque du README : bannière (sombre + claire) et boutons de don,
 * en anglais et en français. Rendu HTML → PNG par Playwright, en 2× pour la
 * netteté sur écran Retina.
 *
 * Pourquoi des images : le README GitHub n'accepte ni CSS ni script. Une
 * bannière et des boutons dessinés sont le seul moyen d'y mettre un vrai
 * design, et `<picture>` choisit la version claire ou sombre selon le thème
 * du visiteur.
 *
 * Usage : node scripts/brand/render.mjs
 *   PLAYWRIGHT_CHROME=<chemin> force le binaire Chromium.
 * Sortie : docs/brand/{hero-<lang>-<thème>,donate-<lang>-<montant>}.png
 *
 * Sources : icône src/assets/icon-128.png, capture docs/screenshots/<lang>/
 * overlay.png (à refaire d'abord par scripts/screenshots/capture.mjs), libellés
 * des paliers lus dans src/locales (même texte que l'extension).
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const outDir = join(root, 'docs', 'brand');
await mkdir(outDir, { recursive: true });

const dataUrl = async (p) => `data:image/png;base64,${(await readFile(p)).toString('base64')}`;
const icon = await dataUrl(join(root, 'src', 'assets', 'icon-128.png'));

/** Textes de la bannière. Les paliers viennent des locales de l'extension. */
const COPY = {
  en: {
    kicker: 'Discord history exporter',
    title: 'Keep your Discord history.',
    sub: 'Crash-proof exports that resume where they stopped, sent from your own Discord tab at a human pace. 100% local, free forever.',
    chips: ['Resumable', 'Discreet', 'Agent-ready JSON', '15 languages'],
    browsers: 'Chrome · Edge · Firefox',
  },
  fr: {
    kicker: 'Export d’historique Discord',
    title: 'Garde ton historique Discord.',
    sub: 'Des exports increvables qui reprennent là où ils se sont arrêtés, émis depuis ton propre onglet Discord à un rythme humain. 100 % local, gratuit pour toujours.',
    chips: ['Reprise', 'Discret', 'JSON agent-ready', '15 langues'],
    browsers: 'Chrome · Edge · Firefox',
  },
};

const THEMES = {
  dark: {
    bg: `radial-gradient(55% 80% at 12% 10%, rgba(108,92,224,.55), transparent 70%),
         radial-gradient(50% 70% at 92% 95%, rgba(236,106,147,.38), transparent 70%), #130f1f`,
    ink: '#f1edfb', muted: '#b3abcc', kicker: '#c7bdff', chipBg: 'rgba(255,255,255,.06)',
    chipLine: 'rgba(255,255,255,.12)', shot: '0 30px 80px rgba(0,0,0,.55)',
  },
  light: {
    bg: `radial-gradient(55% 80% at 12% 10%, rgba(123,108,240,.28), transparent 70%),
         radial-gradient(50% 70% at 92% 95%, rgba(236,106,147,.22), transparent 70%), #f6f3ff`,
    ink: '#1d1630', muted: '#5b5274', kicker: '#5a48d6', chipBg: 'rgba(255,255,255,.7)',
    chipLine: 'rgba(29,22,48,.12)', shot: '0 30px 70px rgba(42,28,90,.28)',
  },
};

const FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, Roboto, sans-serif`;

function heroHtml(c, th, shot) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 1280px; height: 520px; overflow: hidden; font-family: ${FONT}; background: ${th.bg}; color: ${th.ink}; }
  .wrap { position: relative; height: 100%; padding: 64px 0 0 72px; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 30px; }
  .brand img { width: 52px; height: 52px; image-rendering: pixelated; }
  .brand b { font-size: 26px; font-weight: 800; letter-spacing: -.01em; }
  .kicker { font-size: 14px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${th.kicker}; margin-bottom: 14px; }
  h1 { font-size: 50px; line-height: 1.04; font-weight: 800; letter-spacing: -.025em; max-width: 560px; }
  p { margin-top: 18px; font-size: 18.5px; line-height: 1.5; color: ${th.muted}; max-width: 520px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; max-width: 540px; }
  .chips span { font-size: 14px; font-weight: 600; padding: 7px 13px; border-radius: 999px; background: ${th.chipBg}; border: 1px solid ${th.chipLine}; }
  .browsers { margin-top: 18px; font-size: 14px; font-weight: 600; color: ${th.muted}; }
  .shot { position: absolute; right: -150px; top: 70px; width: 760px; border-radius: 14px; box-shadow: ${th.shot};
          transform: perspective(1600px) rotateY(-14deg) rotateX(4deg); border: 1px solid ${th.chipLine}; }
  </style></head><body><div class="wrap">
    <div class="brand"><img src="${icon}" alt=""><b>Vespry</b></div>
    <div class="kicker">${c.kicker}</div>
    <h1>${c.title}</h1>
    <p>${c.sub}</p>
    <div class="chips">${c.chips.map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="browsers">${c.browsers}</div>
    <img class="shot" src="${shot}" alt="">
  </div></body></html>`;
}

function buttonHtml(emoji, amount, label) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: transparent; }
  body { display: inline-block; padding: 2px; font-family: ${FONT}; }
  /* Pas d'ombre portée : le PNG est transparent et GitHub remplit ce
     transparent de la couleur de page, l'ombre y serait coupée net. */
  .b { display: flex; align-items: center; gap: 12px; height: 60px; padding: 0 22px 0 16px; border-radius: 16px; color: #fff;
       background: linear-gradient(135deg, #ec6a93 0%, #b45ade 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,.25); }
  .e { font-size: 24px; }
  .a { font-size: 21px; font-weight: 800; letter-spacing: -.01em; }
  .l { font-size: 15px; font-weight: 600; opacity: .9; }
  </style></head><body><div class="b"><span class="e">${emoji}</span><span class="a">${amount}</span><span class="l">${label}</span></div></body></html>`;
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME || undefined });
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const lang of ['en', 'fr']) {
  const L = JSON.parse(await readFile(join(root, 'src', 'locales', `${lang}.json`), 'utf8'));
  const shot = await dataUrl(join(root, 'docs', 'screenshots', lang, 'overlay.png'));
  for (const [theme, th] of Object.entries(THEMES)) {
    await page.setViewportSize({ width: 1280, height: 520 });
    await page.setContent(heroHtml(COPY[lang], th, shot), { waitUntil: 'load' });
    await page.screenshot({ path: join(outDir, `hero-${lang}-${theme}.png`) });
    console.log('  ✓', `hero-${lang}-${theme}.png`);
  }
  const eur = (n) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const tiers = [['☕', 3, 'support.tier_s'], ['🦉', 5, 'support.tier_m'], ['✨', 10, 'support.tier_l']];
  for (const [emoji, n, key] of tiers) {
    await page.setViewportSize({ width: 600, height: 120 });
    await page.setContent(buttonHtml(emoji, eur(n), L[key]), { waitUntil: 'load' });
    await page.locator('body').screenshot({ path: join(outDir, `donate-${lang}-${n}.png`), omitBackground: true });
    console.log('  ✓', `donate-${lang}-${n}.png`);
  }
  await page.setViewportSize({ width: 600, height: 120 });
  await page.setContent(buttonHtml('💜', '', L['support.custom']), { waitUntil: 'load' });
  await page.locator('body').screenshot({ path: join(outDir, `donate-${lang}-custom.png`), omitBackground: true });
  console.log('  ✓', `donate-${lang}-custom.png`);
}

await browser.close();
console.log(`\nImages écrites dans ${outDir}`);
