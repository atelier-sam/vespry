/**
 * Page de don publique — `GET /donate`, envoyée par `POST /donate`.
 *
 * Pourquoi : jusqu'ici on ne pouvait donner que depuis l'extension. Le
 * bouton « Sponsor » du dépôt GitHub et le README ont besoin d'une adresse
 * qui marche dans un navigateur ordinaire. Le parcours est celui de la
 * modale de l'extension (mêmes montants, mêmes textes traduits, même mur),
 * pour que le don arrive au même endroit.
 *
 * Fonctionne sans JavaScript : le formulaire est un POST classique, le
 * Worker crée la session Stripe et redirige (303). Le petit script ne fait
 * que mettre à jour le libellé du bouton et masquer les champs du mur.
 */
import type { DonorFeed } from './donors';
import { pickLocale, strings, type Locale } from './i18n';
import { MAX_MESSAGE, MAX_NAME } from './moderation';
import { SHARED_STRINGS, type SharedStrings } from './page-strings.generated';
import { validAmount } from './stripe';

/** Dépôt public : lien « retour » des pages servies depuis le web. */
export const PROJECT_URL = 'https://github.com/atelier-sam/vespry';

/** Montants proposés, identiques à la modale de l'extension (Overlay.tsx). */
export const PRESETS: readonly { cents: number; label: keyof SharedStrings; glyph: string }[] = [
  { cents: 300, label: 'tierS', glyph: '☕' },
  { cents: 500, label: 'tierM', glyph: '🦉' },
  { cents: 1000, label: 'tierL', glyph: '✨' },
];
export const DEFAULT_CENTS = 500;

/** Nombre de soutiens récents montrés sous le formulaire. */
const RECENT_SHOWN = 6;

/** Icône de l'extension (hibou pixel, 128 px), embarquée pour rester autonome. */
const OWL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAACTElEQVR4nOzdMUoDQRSA4YmksrQMWAjiCcRG8Aa5QForwVJsrG3EUrCy9QK5gWAjnkAEC8HSMpWgN9gHPoaZ3f//2pUw4M+DeQZ3XhpbP379loTlajErDY39/FtFaAYAZwBwBgBnAHAGAGcAcPNSWXRPPr9Ylpqfn71nj/38EScAnAHAGQCcAcAZAJwBwBkAXHoPkL0nnxxelYzo87N/r+/9/Nk9gRMAzgDgDADOAOAMAM4A4AwALrxDtr7n0z29Xg8+v7tdDz6P9gROADgDgDMAOAOAMwA4A4AzALiZ9/xxy+4JnABwBgBnAHAGAGcAcAYAZwBw1f8/wP3DQdH/nZ2+lZqcAHAGAGcAcAYAZwBwBgBnAHDV9wCR7Z39UtPm+71k9H6+LCcAnAHAGQCcAcAZAJwBwBkAXPM9QGRv93jw+cfnc2mp9/NFnABwBgBnAHAGAGcAcAYAZwBw3e8Ber9H936+iBMAzgDgDADOAOAMAM4A4AwArvkeoPb34n9eLkvG5uimTJkTAM4A4AwAzgDgDADOAOAMAK777wNkzSd+j89yAsAZAJwBwBkAnAHAGQCcAcDNoh+o/V5B+vsEovcBZN8LuFwtBn/HTgA4A4AzADgDgDMAOAOAMwC4cA8QcU8wrPU9P+IEgDMAOAOAMwA4A4AzADgDgEvvASK19wS9a33PjzgB4AwAzgDgDADOAOAMAM4A4KrvASLRnmDqat/zI04AOAOAMwA4A4AzADgDgDMAuOZ7ALXlBIAzADgDgDMAOAOAMwA4A4D7AwAA//9ncm9kAAAABklEQVQDAA+0ga4/oAoRAAAAAElFTkSuQmCC';

/** Formulaire de don lu et validé. */
export interface DonateForm {
  amountCents: number;
  isPublic: boolean;
  donorName: string | null;
  message: string | null;
}

/** Textes de la page : partagés avec l'extension + propres au web. */
function texts(locale: Locale): SharedStrings & ReturnType<typeof strings> {
  return { ...SHARED_STRINGS[locale], ...strings(locale) };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Montant formaté dans la langue de la page : « 5 € », « €5 », « 5,50 € ». */
export function formatEur(cents: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Montant présélectionné par l'adresse : `/donate?amount=10` (en euros, plus
 * lisible dans un lien de README). Tout autre valeur → montant par défaut.
 */
export function presetFromQuery(url: URL): number {
  const raw = url.searchParams.get('amount');
  if (!raw || !/^\d{1,4}$/.test(raw)) return DEFAULT_CENTS;
  const cents = Number(raw) * 100;
  return validAmount(cents) ? cents : DEFAULT_CENTS;
}

/** Texte optionnel d'un champ, coupé à `max`, `null` si vide. */
function optional(value: string | File | null, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Lit le formulaire envoyé par la page. Un montant libre (« 7,50 », « 12 € »)
 * l'emporte sur le montant proposé. `null` si le montant est hors plage :
 * l'appelant réaffiche la page avec un message.
 */
export function parseDonateForm(form: FormData): DonateForm | null {
  const custom = form.get('custom');
  let cents: number;
  if (typeof custom === 'string' && custom.trim().length > 0) {
    const cleaned = custom.replace(/[\s€]/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    cents = Math.round(Number(cleaned) * 100);
  } else {
    cents = Number(form.get('amount'));
  }
  if (!validAmount(cents)) return null;
  const isPublic = form.get('public') === 'on';
  return {
    amountCents: cents,
    isPublic,
    donorName: isPublic ? optional(form.get('name'), MAX_NAME) : null,
    message: isPublic ? optional(form.get('message'), MAX_MESSAGE) : null,
  };
}

/** Ligne « 14 soutiens » ou, sans soutien, l'invitation à être le premier. */
function wallLine(feed: DonorFeed | null, s: SharedStrings): string {
  if (!feed || feed.total === 0) return escapeHtml(s.firstHook);
  const word = feed.total === 1 ? s.supporterOne : s.supporters;
  return `<b>${feed.total}</b> ${escapeHtml(word)}`;
}

function recentList(feed: DonorFeed | null, s: SharedStrings): string {
  const recent = (feed?.recent ?? []).slice(0, RECENT_SHOWN);
  if (recent.length === 0) return '';
  const items = recent
    .map((d) => {
      const who = d.name
        ? escapeHtml(s.thanks.replace('{name}', d.name))
        : escapeHtml(s.thanksAnon);
      const msg = d.message ? `<q>${escapeHtml(d.message)}</q>` : '';
      return `<li><span class="who">${who}</span>${msg}</li>`;
    })
    .join('');
  return `<ul class="wall">${items}</ul>`;
}

/** La page de don, dans la langue du navigateur. */
export function donatePage(
  req: Request,
  feed: DonorFeed | null,
  opts: { selectedCents: number; error?: boolean },
): string {
  const locale = pickLocale(req.headers.get('Accept-Language'));
  const s = texts(locale);
  const presetSelected = PRESETS.some((p) => p.cents === opts.selectedCents);
  const customValue = presetSelected ? '' : String(opts.selectedCents / 100);
  const payLabel = s.pay.replace('{amount}', formatEur(opts.selectedCents, locale));

  const chips = PRESETS.map((p) => {
    const checked = p.cents === opts.selectedCents ? ' checked' : '';
    return `<label class="chip">
        <input type="radio" name="amount" value="${p.cents}" data-label="${escapeHtml(formatEur(p.cents, locale))}"${checked}>
        <span><i>${p.glyph}</i><b>${escapeHtml(formatEur(p.cents, locale))}</b><small>${escapeHtml(s[p.label])}</small></span>
      </label>`;
  }).join('');

  const payTemplate = escapeHtml(s.pay);
  // Repli sans Intl côté navigateur : seuls les chiffres sont remplacés,
  // l'espace avant « € » reste (« {n} € », « €{n} »).
  const customFmt = escapeHtml(formatEur(100, locale).replace(/\d+/, '{n}'));

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(s.title)}</title>
<meta name="description" content="${escapeHtml(s.intro)}">
<link rel="icon" href="data:image/png;base64,${OWL_PNG}">
<style>
  :root { color-scheme: dark; --ink:#ece8f6; --muted:#a49cbd; --line:rgba(255,255,255,.1); --accent:#ec6a93; --violet:#7b6cf0; }
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 32px 16px;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink);
    background:
      radial-gradient(60% 50% at 20% 12%, rgba(108,92,224,.5), transparent 70%),
      radial-gradient(55% 45% at 85% 90%, rgba(236,106,147,.35), transparent 70%),
      #130f1f;
  }
  main { width: 100%; max-width: 440px; }
  .card { background: rgba(28,22,44,.78); border: 1px solid var(--line); border-radius: 20px; padding: 30px 28px 24px;
    box-shadow: 0 30px 80px rgba(0,0,0,.45); backdrop-filter: blur(10px); }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  header img { width: 52px; height: 52px; image-rendering: pixelated; }
  h1 { font-size: 23px; font-weight: 800; letter-spacing: -.01em; }
  .intro { color: #cfc8e4; margin-bottom: 18px; }
  .count { font-size: 13.5px; color: var(--muted); margin-bottom: 18px; padding: 10px 12px; border-radius: 12px;
    background: rgba(123,108,240,.12); border: 1px solid rgba(123,108,240,.25); }
  .count b { color: var(--ink); font-size: 15px; }
  .chips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
  .chip input { position: absolute; opacity: 0; pointer-events: none; }
  .chip span { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 6px; border-radius: 14px;
    border: 1px solid var(--line); background: rgba(255,255,255,.03); cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
  .chip span:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.25); }
  .chip i { font-style: normal; font-size: 20px; }
  .chip b { font-size: 17px; }
  .chip small { color: var(--muted); font-size: 12px; text-align: center; }
  .chip input:checked + span { border-color: var(--accent); background: rgba(236,106,147,.14); box-shadow: 0 0 0 1px var(--accent) inset; }
  .chip input:focus-visible + span { outline: 2px solid var(--violet); outline-offset: 2px; }
  input[type=text], input[type=number], textarea { width: 100%; font: inherit; color: var(--ink); background: rgba(0,0,0,.25);
    border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
  input:focus, textarea:focus { outline: 2px solid var(--violet); outline-offset: 1px; }
  textarea { resize: vertical; min-height: 64px; }
  .custom { margin-bottom: 16px; }
  .toggle { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; cursor: pointer; font-size: 14px; }
  .toggle input { width: 18px; height: 18px; accent-color: var(--accent); }
  .who-fields { display: grid; gap: 8px; margin-bottom: 18px; }
  .who-fields.off { display: none; }
  button { width: 100%; border: 0; border-radius: 14px; padding: 14px; font: inherit; font-weight: 700; font-size: 16px; color: #fff; cursor: pointer;
    background: linear-gradient(135deg, var(--accent), #b45ae0); box-shadow: 0 10px 30px rgba(236,106,147,.35); transition: transform .15s, filter .15s; }
  button:hover { transform: translateY(-1px); filter: brightness(1.06); }
  button:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .secured { text-align: center; color: var(--muted); font-size: 12.5px; margin-top: 10px; }
  .error { background: rgba(239,123,110,.14); border: 1px solid rgba(239,123,110,.4); color: #ffd2cb; border-radius: 12px; padding: 10px 12px; margin-bottom: 14px; font-size: 14px; }
  .wall { list-style: none; padding: 0; margin: 18px 0 0; display: grid; gap: 8px; }
  .wall li { font-size: 13.5px; padding: 9px 12px; border-radius: 12px; background: rgba(255,255,255,.03); border: 1px solid var(--line); }
  .wall .who { font-weight: 600; }
  .wall q { display: block; color: var(--muted); margin-top: 2px; }
  footer { text-align: center; margin-top: 16px; font-size: 13px; }
  footer a { color: var(--muted); }
</style>
</head>
<body>
<main>
  <div class="card">
    <header>
      <img src="data:image/png;base64,${OWL_PNG}" alt="" width="52" height="52">
      <h1>${escapeHtml(s.title)}</h1>
    </header>
    <p class="intro">${escapeHtml(s.intro)}</p>
    <div class="count">${wallLine(feed, s)}</div>
    ${opts.error ? `<div class="error" role="alert">${escapeHtml(s.error)}</div>` : ''}
    <form method="post" action="/donate">
      <div class="chips" role="radiogroup">${chips}</div>
      <div class="custom">
        <input type="text" inputmode="decimal" name="custom" value="${escapeHtml(customValue)}" placeholder="${escapeHtml(s.custom)} (€)" aria-label="${escapeHtml(s.custom)}" autocomplete="off">
      </div>
      <label class="toggle"><input type="checkbox" name="public" checked> ${escapeHtml(s.showName)}</label>
      <div class="who-fields">
        <input type="text" name="name" maxlength="${MAX_NAME}" placeholder="${escapeHtml(s.namePh)}" aria-label="${escapeHtml(s.namePh)}" autocomplete="nickname">
        <textarea name="message" maxlength="${MAX_MESSAGE}" placeholder="${escapeHtml(s.msgPh)}" aria-label="${escapeHtml(s.msgPh)}"></textarea>
      </div>
      <button type="submit" data-template="${payTemplate}" data-custom="${customFmt}">${escapeHtml(payLabel)}</button>
      <p class="secured">🔒 ${escapeHtml(s.secured)}</p>
    </form>
    ${recentList(feed, s)}
  </div>
  <footer><a href="${PROJECT_URL}">${escapeHtml(s.back)} ↗</a></footer>
</main>
<script>
(function () {
  var form = document.querySelector('form');
  var btn = form.querySelector('button');
  var custom = form.querySelector('input[name=custom]');
  var pub = form.querySelector('input[name=public]');
  var who = form.querySelector('.who-fields');
  // Montant libre mis en forme comme les puces (« 7,50 € », « €7.50 »).
  function pretty(v) {
    var c = v.replace(/[\\s€]/g, '').replace(',', '.');
    if (/^\\d+(\\.\\d{1,2})?$/.test(c) && window.Intl) {
      var n = Number(c);
      return new Intl.NumberFormat(document.documentElement.lang, { style: 'currency', currency: 'EUR',
        minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(n);
    }
    return btn.dataset.custom.replace('{n}', v);
  }
  function label(text) { btn.textContent = btn.dataset.template.replace('{amount}', text); }
  function refresh() {
    var v = custom.value.trim();
    if (v) { label(pretty(v)); return; }
    var r = form.querySelector('input[name=amount]:checked');
    if (r) label(r.dataset.label);
  }
  form.querySelectorAll('input[name=amount]').forEach(function (r) {
    r.addEventListener('change', function () { custom.value = ''; refresh(); });
  });
  custom.addEventListener('input', function () {
    if (custom.value.trim()) form.querySelectorAll('input[name=amount]').forEach(function (r) { r.checked = false; });
    refresh();
  });
  pub.addEventListener('change', function () { who.classList.toggle('off', !pub.checked); });
})();
</script>
</body>
</html>`;
}
