/**
 * Page de don publique (`/donate`) et retours Stripe depuis le web.
 *
 * Pourquoi : on ne pouvait donner que depuis l'extension ; le README et le
 * bouton Sponsor de GitHub ont besoin d'une adresse qui marche dans un
 * navigateur ordinaire, et qui mène au même mur.
 *
 * La fraîcheur des textes générés depuis les traductions de l'extension est
 * vérifiée côté extension (src/locales/donor-page-strings.test.ts), qui a
 * accès à Node.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { donatePage, parseDonateForm, presetFromQuery } from '../src/donate-page';
import type { DonorFeed } from '../src/donors';
import { MAX_NAME } from '../src/moderation';
import { cancelPage, successPage } from '../src/pages';
import { checkoutSessionBody } from '../src/stripe';

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const req = (url: string, init?: RequestInit, lang = 'en') =>
  new Request(url, { ...init, headers: { 'Accept-Language': lang, ...(init?.headers ?? {}) } });

/** Base D1 factice : en panne, pour vérifier que la page tient sans le mur. */
const brokenDb = {
  prepare: () => { throw new Error('D1 indisponible'); },
} as unknown as D1Database;

function env(extra: Record<string, unknown> = {}) {
  return { DB: brokenDb, STRIPE_SECRET_KEY: 'sk_test_factice', ...extra } as never;
}

const FEED: DonorFeed = {
  total: 2,
  weekCount: 2,
  nextMilestone: null,
  recent: [
    { seq: 2, source: 'stripe', name: '<script>alert(1)</script>', message: 'Merci <b>!</b>', createdAt: 0, milestone: null },
    { seq: 1, source: 'stripe', name: null, message: null, createdAt: 0, milestone: 'm.first' },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseDonateForm', () => {
  it('montant proposé', () => {
    expect(parseDonateForm(form({ amount: '300' }))?.amountCents).toBe(300);
  });
  it.each([
    ['7,50', 750],
    ['12 €', 1200],
    ['1000', 100_000],
  ])('montant libre « %s » → %i centimes, prioritaire', (custom, cents) => {
    expect(parseDonateForm(form({ amount: '300', custom }))?.amountCents).toBe(cents);
  });
  it.each(['abc', '0,50', '2000', '1.234', '-5'])('montant refusé : « %s »', (custom) => {
    expect(parseDonateForm(form({ custom }))).toBeNull();
  });
  it('mur : nom et mot gardés si public, effacés sinon', () => {
    const pub = parseDonateForm(form({ amount: '500', public: 'on', name: ' Léa ', message: 'Merci' }));
    expect(pub).toEqual({ amountCents: 500, isPublic: true, donorName: 'Léa', message: 'Merci' });
    const anon = parseDonateForm(form({ amount: '500', name: 'Léa', message: 'Merci' }));
    expect(anon).toEqual({ amountCents: 500, isPublic: false, donorName: null, message: null });
  });
  it('nom coupé à la longueur maximale', () => {
    const r = parseDonateForm(form({ amount: '500', public: 'on', name: 'x'.repeat(MAX_NAME + 20) }));
    expect(r?.donorName).toHaveLength(MAX_NAME);
  });
});

describe('presetFromQuery', () => {
  it.each([
    ['', 500],
    ['?amount=3', 300],
    ['?amount=25', 2500],
    ['?amount=0', 500],
    ['?amount=5000', 500],
    ['?amount=abc', 500],
  ])('%s → %i', (q, cents) => {
    expect(presetFromQuery(new URL(`https://x.test/donate${q}`))).toBe(cents);
  });
});

describe('donatePage', () => {
  it('échappe les noms et messages du mur (contrôle : la balise n\'apparaît jamais brute)', () => {
    const html = donatePage(req('https://x.test/donate'), FEED, { selectedCents: 500 });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<b>!</b>');
    expect(html).toContain('<b>2</b> supporters');
  });
  it('sans soutien : l\'invitation à être le premier', () => {
    const html = donatePage(req('https://x.test/donate'), null, { selectedCents: 500 });
    expect(html).toContain('Be the very first to support Vespry');
  });
  it('dans la langue du navigateur, montant formaté', () => {
    const html = donatePage(req('https://x.test/donate', undefined, 'fr-FR,fr;q=0.9'), null, { selectedCents: 1000 });
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Soutenir Vespry');
    expect(html).toMatch(/value="1000" data-label="10\s€" checked/u);
  });
  it('montant libre présélectionné quand il n\'est pas proposé', () => {
    const html = donatePage(req('https://x.test/donate'), null, { selectedCents: 2500 });
    expect(html).toContain('name="custom" value="25"');
    expect(html).not.toMatch(/ checked>\s*<span><i>/);
  });
  // Le script est écrit dans un gabarit TypeScript, qui avale un antislash
  // simple : `\d` y devient `d` et la regex du montant libre ne reconnaît
  // plus rien (bug vu le 08/11/2026, bouton « 7,50€ » au lieu de « 7,50 € »).
  it('le script reçoit ses regex intactes, et le repli garde l\'espace avant €', () => {
    const html = donatePage(req('https://x.test/donate', undefined, 'fr-FR'), null, { selectedCents: 500 });
    expect(html).toContain(String.raw`/^\d+(\.\d{1,2})?$/`);
    expect(html).toContain(String.raw`/[\s€]/g`);
    expect(html).toMatch(/data-custom="\{n\}\s€"/u);
  });
});

describe('worker — routes /donate', () => {
  it('GET /donate : page HTML, même si le mur est en panne', async () => {
    const res = await worker.fetch(req('https://x.test/donate?amount=3'), env());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toMatch(/value="300" data-label="€3" checked/);
  });

  it('POST /donate valide : session Stripe créée en mode web, redirection 303', async () => {
    const stripe = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' })));
    vi.stubGlobal('fetch', stripe);
    const res = await worker.fetch(req('https://x.test/donate', {
      method: 'POST',
      body: form({ amount: '500', public: 'on', name: 'Léa', message: 'Merci' }),
    }), env());
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    const body = new URLSearchParams(String((stripe.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('500');
    expect(body.get('metadata[donorName]')).toBe('Léa');
    expect(body.get('success_url')).toContain('&via=web');
    expect(body.get('cancel_url')).toBe('https://x.test/checkout/cancel?via=web');
  });

  it('POST /donate montant invalide : 400, page réaffichée avec le message, Stripe jamais appelé', async () => {
    const stripe = vi.fn();
    vi.stubGlobal('fetch', stripe);
    const res = await worker.fetch(req('https://x.test/donate', { method: 'POST', body: form({ custom: '0,10' }) }), env());
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('role="alert"');
    expect(stripe).not.toHaveBeenCalled();
  });

  it('POST /donate, Stripe refuse : 502 et page réaffichée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    const res = await worker.fetch(req('https://x.test/donate', { method: 'POST', body: form({ amount: '300' }) }), env());
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('role="alert"');
  });

  it('POST /donate sans clé Stripe : 503', async () => {
    const res = await worker.fetch(
      req('https://x.test/donate', { method: 'POST', body: form({ amount: '300' }) }),
      env({ STRIPE_SECRET_KEY: undefined }),
    );
    expect(res.status).toBe(503);
  });
});

describe('pages de retour', () => {
  it('depuis le web : lien de retour, pas de fermeture automatique', () => {
    const ok = successPage(req('https://x.test/checkout/success?session_id=cs_1&via=web'));
    expect(ok).toContain('https://github.com/atelier-sam/vespry');
    expect(ok).not.toContain('window.close');
    const ko = cancelPage(req('https://x.test/checkout/cancel?via=web'));
    expect(ko).toContain('href="/donate"');
    expect(ko).not.toContain('window.close');
  });
  it('contrôle positif : depuis l\'extension, la popup se referme et prévient l\'overlay', () => {
    const ok = successPage(req('https://x.test/checkout/success?session_id=cs_1'));
    expect(ok).toContain('window.close');
    expect(ok).toContain('vespry-donation-ok');
  });
  it('checkoutSessionBody sans `via` : URLs de retour inchangées', () => {
    const body = new URLSearchParams(checkoutSessionBody({
      amountCents: 500, donorName: null, message: null, isPublic: false, origin: 'https://x.test',
    }));
    expect(body.get('success_url')).toBe('https://x.test/checkout/success?session_id={CHECKOUT_SESSION_ID}');
    expect(body.get('cancel_url')).toBe('https://x.test/checkout/cancel');
  });
});
