/**
 * Un mur par projet soutenu (09/11/2026).
 *
 * Ce qui est protégé : seul un projet de la liste fermée peut s'afficher sur
 * la page de paiement ; chaque projet compte ses soutiens et ses paliers à
 * part ; ce qui existait (extension, page /donate, soutiens déjà reçus) reste
 * rangé sous Vespry sans rien changer côté client.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index';
import { getFeed, insertDonor, type NewDonor } from '../src/donors';
import { hmacSha256Hex } from '../src/hmac';
import {
  DEFAULT_PROJECT,
  PROJECTS,
  projectOfPayment,
  resolveProject,
  resolveReturnUrl,
  returnOrigins,
  type Project,
} from '../src/projects';
import { checkoutSessionBody, parseStripeEvent } from '../src/stripe';
import { freshDb, readSql, sqliteD1 } from './d1-sqlite';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const donor = (project: string, n: number, extra: Partial<NewDonor> = {}): NewDonor => ({
  source: 'stripe',
  externalId: `stripe:${project}:${n}`,
  name: `${project}-${n}`,
  message: null,
  isPublic: true,
  createdAt: 1_000 + n,
  project,
  ...extra,
});

describe('resolveProject', () => {
  it('absent ou vide : Vespry, pour l\'extension et la page /donate', () => {
    expect(resolveProject(undefined)?.id).toBe('vespry');
    expect(resolveProject(null)?.id).toBe('vespry');
    expect(resolveProject('')?.id).toBe('vespry');
  });

  it('projet inscrit : accepté avec son libellé', () => {
    expect(resolveProject('vespry')).toEqual({ id: 'vespry', label: 'Soutien à Vespry' });
  });

  it('inconnu, mauvais type ou clé héritée de l\'objet : refusé', () => {
    expect(resolveProject('n-importe-quoi')).toBeNull();
    expect(resolveProject(42)).toBeNull();
    expect(resolveProject(['vespry'])).toBeNull();
    expect(resolveProject('constructor')).toBeNull();
    expect(resolveProject('__proto__')).toBeNull();
    expect(resolveProject('toString')).toBeNull();
  });

  it('suit la liste qu\'on lui donne (ajouter un projet = une entrée)', () => {
    const registry: Record<string, Project> = {
      vespry: { id: 'vespry', label: 'Soutien à Vespry' },
      atelier: { id: 'atelier', label: "Soutien à L'Atelier de Sam" },
    };
    expect(resolveProject('atelier', registry)?.label).toBe("Soutien à L'Atelier de Sam");
  });
});

describe('pot de l\'atelier (code.atelier-sam.fr, 09/11/2026)', () => {
  it('inscrit, avec son libellé et sa page de retour en https', () => {
    const a = resolveProject('atelier');
    expect(a).toEqual({ id: 'atelier', label: "Soutien à L'Atelier de Sam", returnUrl: 'https://code.atelier-sam.fr/' });
  });

  it('le donateur revient à la racine de l\'établi, état en paramètre', () => {
    const project = resolveProject('atelier') as Project;
    const p = new URLSearchParams(checkoutSessionBody({
      amountCents: 500, donorName: null, message: null, isPublic: false, origin: 'https://w.test', project,
    }));
    expect(p.get('success_url')).toBe('https://code.atelier-sam.fr/?donation=ok');
    expect(p.get('cancel_url')).toBe('https://code.atelier-sam.fr/?donation=cancel');
    expect(p.get('metadata[project]')).toBe('atelier');
  });

  it('toute page de retour inscrite est en https et se lit comme une URL', () => {
    for (const p of Object.values(PROJECTS)) {
      if (p.returnUrl) expect(new URL(p.returnUrl).protocol).toBe('https:');
    }
  });
});

describe('page de retour demandée par le client', () => {
  it('absente ou vide : rien à changer', () => {
    expect(resolveReturnUrl(undefined)).toBeUndefined();
    expect(resolveReturnUrl(null)).toBeUndefined();
    expect(resolveReturnUrl('')).toBeUndefined();
  });

  it('origines permises = celles des projets inscrits, et seulement elles', () => {
    expect([...returnOrigins()]).toEqual(['https://code.atelier-sam.fr']);
  });

  it('sur l\'établi : acceptée, chemin, requête et fragment gardés', () => {
    expect(resolveReturnUrl('https://code.atelier-sam.fr/')).toBe('https://code.atelier-sam.fr/');
    expect(resolveReturnUrl('https://code.atelier-sam.fr/projets/vespry?x=1#soutenir'))
      .toBe('https://code.atelier-sam.fr/projets/vespry?x=1#soutenir');
    // Port par défaut explicite : même origine.
    expect(resolveReturnUrl('https://code.atelier-sam.fr:443/')).toBe('https://code.atelier-sam.fr/');
  });

  it('refusée hors de la liste : autre site, sous-domaine, port, http, identifiants, forme', () => {
    for (const bad of [
      'https://evil.example/',
      'https://code.atelier-sam.fr.evil.example/',
      'https://x.code.atelier-sam.fr/',
      'https://atelier-sam.fr/',
      'https://code.atelier-sam.fr:8443/',
      'http://code.atelier-sam.fr/',
      'https://user@code.atelier-sam.fr/',
      'https://user:pw@code.atelier-sam.fr/',
      'javascript:alert(1)',
      '//code.atelier-sam.fr/',
      '/relatif',
      'pas une url',
      `https://code.atelier-sam.fr/${'a'.repeat(2048)}`,
      42,
      ['https://code.atelier-sam.fr/'],
    ]) {
      expect(resolveReturnUrl(bad), String(bad).slice(0, 60)).toBeNull();
    }
  });

  it('un don à Vespry parti de l\'établi y revient, fragment APRÈS l\'état', () => {
    const p = new URLSearchParams(checkoutSessionBody({
      amountCents: 300, donorName: null, message: null, isPublic: false, origin: 'https://w.test',
      returnUrl: 'https://code.atelier-sam.fr/?p=vespry#soutenir',
    }));
    expect(p.get('metadata[project]')).toBe('vespry');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('Soutien à Vespry');
    expect(p.get('success_url')).toBe('https://code.atelier-sam.fr/?p=vespry&donation=ok#soutenir');
    expect(p.get('cancel_url')).toBe('https://code.atelier-sam.fr/?p=vespry&donation=cancel#soutenir');
  });
});

describe('projectOfPayment', () => {
  it('garde un identifiant bien formé, même sorti de la liste depuis', () => {
    expect(projectOfPayment('vespry')).toBe('vespry');
    expect(projectOfPayment('ancien-projet')).toBe('ancien-projet');
  });
  it('paiement d\'avant le multi-projets ou métadonnée abîmée : Vespry', () => {
    expect(projectOfPayment(undefined)).toBe(DEFAULT_PROJECT);
    expect(projectOfPayment('Pas Bon!')).toBe(DEFAULT_PROJECT);
    expect(projectOfPayment('x'.repeat(33))).toBe(DEFAULT_PROJECT);
  });
});

describe('session Stripe d\'un projet', () => {
  const base = { amountCents: 500, donorName: null, message: null, isPublic: false, origin: 'https://w.test' };

  it('sans projet : libellé et métadonnée de Vespry, retours inchangés', () => {
    const p = new URLSearchParams(checkoutSessionBody(base));
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('Soutien à Vespry');
    expect(p.get('metadata[project]')).toBe('vespry');
    expect(p.get('cancel_url')).toBe('https://w.test/checkout/cancel');
  });

  it('projet avec page de retour : le donateur y revient, état en paramètre', () => {
    const project: Project = { id: 'atelier', label: "Soutien à L'Atelier de Sam", returnUrl: 'https://atelier-sam.fr/dev?lang=fr' };
    const p = new URLSearchParams(checkoutSessionBody({ ...base, via: 'web', project }));
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe("Soutien à L'Atelier de Sam");
    expect(p.get('metadata[project]')).toBe('atelier');
    expect(p.get('success_url')).toBe('https://atelier-sam.fr/dev?lang=fr&donation=ok');
    expect(p.get('cancel_url')).toBe('https://atelier-sam.fr/dev?lang=fr&donation=cancel');
  });

  it('le webhook relit le projet du paiement', () => {
    const ev = (metadata: unknown) => JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', metadata } },
    });
    expect(parseStripeEvent(ev({ project: 'atelier' }))?.project).toBe('atelier');
    expect(parseStripeEvent(ev({}))?.project).toBe('vespry');
  });
});

describe('mur par projet (SQL réel)', () => {
  it('chaque projet compte ses soutiens, ses rangs et ses paliers à part', async () => {
    const { d1 } = freshDb();
    for (let i = 1; i <= 3; i++) await insertDonor(d1, donor('vespry', i));
    for (let i = 1; i <= 2; i++) await insertDonor(d1, donor('atelier', i));
    await insertDonor(d1, donor('vespry', 4));

    const v = await getFeed(d1, 'vespry');
    expect(v.total).toBe(4);
    expect(v.recent.map((d) => d.name)).toEqual(['vespry-4', 'vespry-3', 'vespry-2', 'vespry-1']);
    expect(v.recent.map((d) => d.seq)).toEqual([4, 3, 2, 1]);
    expect(v.recent.at(-1)?.milestone).toBe('m.first');

    const a = await getFeed(d1, 'atelier');
    expect(a.total).toBe(2);
    // Contrôle positif : le 1er soutien de l'atelier est aussi un « premier », bien
    // que son seq global soit 4.
    expect(a.recent.map((d) => [d.name, d.seq, d.milestone])).toEqual([
      ['atelier-2', 2, null],
      ['atelier-1', 1, 'm.first'],
    ]);
    expect(await getFeed(d1, 'personne')).toMatchObject({ total: 0, recent: [] });
  });

  it('un soutien masqué sort du mur sans renuméroter les autres', async () => {
    const { raw, d1 } = freshDb();
    for (let i = 1; i <= 3; i++) await insertDonor(d1, donor('vespry', i));
    raw.exec("UPDATE donors SET hidden = 1 WHERE name = 'vespry-2'");
    const v = await getFeed(d1, 'vespry');
    expect(v.total).toBe(2);
    expect(v.recent.map((d) => [d.name, d.seq])).toEqual([['vespry-3', 3], ['vespry-1', 1]]);
  });

  it('un rejeu de webhook ne compte pas deux fois', async () => {
    const { d1 } = freshDb();
    await insertDonor(d1, donor('vespry', 1));
    await insertDonor(d1, donor('vespry', 1));
    expect((await getFeed(d1, 'vespry')).total).toBe(1);
  });

  it('migration d\'une base d\'avant : les soutiens existants restent sur le mur de Vespry', async () => {
    const raw = new DatabaseSync(':memory:');
    // Table telle que créée par schema.sql avant le 09/11/2026.
    raw.exec(`CREATE TABLE donors (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
      external_id TEXT NOT NULL UNIQUE, name TEXT, message TEXT,
      is_public INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL)`);
    raw.exec("INSERT INTO donors (source, external_id, name, is_public, created_at) VALUES ('stripe', 'stripe:old', 'Ancien', 1, 5)");
    raw.exec(readSql('migrations/0001_donors_project.sql'));
    const d1 = sqliteD1(raw);
    await insertDonor(d1, donor('atelier', 1));
    expect((await getFeed(d1, 'vespry')).recent.map((d) => d.name)).toEqual(['Ancien']);
    expect((await getFeed(d1, 'atelier')).recent.map((d) => d.name)).toEqual(['atelier-1']);
  });
});

describe('routes', () => {
  const env = (d1: D1Database, extra: Record<string, unknown> = {}) =>
    ({ DB: d1, STRIPE_SECRET_KEY: 'sk_test_factice', STRIPE_WEBHOOK_SECRET: 'whsec_t', ...extra }) as never;

  it('POST /checkout projet inconnu : 400, Stripe jamais appelé', async () => {
    const stripe = vi.fn();
    vi.stubGlobal('fetch', stripe);
    const res = await worker.fetch(new Request('https://x.test/checkout', {
      method: 'POST',
      body: JSON.stringify({ amountCents: 300, project: 'inconnu' }),
    }), env(freshDb().d1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown project' });
    expect(stripe).not.toHaveBeenCalled();
  });

  it('contrôle positif : POST /checkout sans projet, comme l\'extension, part pour Vespry', async () => {
    const stripe = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_2' })));
    vi.stubGlobal('fetch', stripe);
    const res = await worker.fetch(new Request('https://x.test/checkout', {
      method: 'POST',
      body: JSON.stringify({ amountCents: 300 }),
    }), env(freshDb().d1));
    expect(res.status).toBe(200);
    const body = new URLSearchParams(String((stripe.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get('metadata[project]')).toBe('vespry');
  });

  it('POST /checkout page de retour hors liste : 400, Stripe jamais appelé', async () => {
    const stripe = vi.fn();
    vi.stubGlobal('fetch', stripe);
    const res = await worker.fetch(new Request('https://x.test/checkout', {
      method: 'POST',
      body: JSON.stringify({ amountCents: 300, project: 'vespry', returnUrl: 'https://evil.example/' }),
    }), env(freshDb().d1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid returnUrl' });
    expect(stripe).not.toHaveBeenCalled();
  });

  it('contrôle positif : POST /checkout depuis l\'établi, Vespry et atelier reviennent sur l\'établi', async () => {
    const stripe = vi.fn(async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_3' })));
    vi.stubGlobal('fetch', stripe);
    const sent = async (payload: Record<string, unknown>) => {
      const res = await worker.fetch(new Request('https://x.test/checkout', {
        method: 'POST',
        body: JSON.stringify({ amountCents: 300, ...payload }),
      }), env(freshDb().d1));
      expect(res.status).toBe(200);
      const calls = stripe.mock.calls as unknown as [string, RequestInit][];
      return new URLSearchParams(String(calls.at(-1)?.[1].body));
    };
    const v = await sent({ project: 'vespry', returnUrl: 'https://code.atelier-sam.fr/', fleche: 'autre' });
    expect([v.get('metadata[project]'), v.get('success_url')]).toEqual(['vespry', 'https://code.atelier-sam.fr/?donation=ok']);
    // `fleche` est ignoré : rien n'en part chez Stripe.
    expect([...v.keys()].some((k) => k.includes('fleche'))).toBe(false);
    const a = await sent({ project: 'atelier' });
    expect([a.get('metadata[project]'), a.get('cancel_url')]).toEqual(['atelier', 'https://code.atelier-sam.fr/?donation=cancel']);
  });

  it('GET /donors : projet inconnu refusé, défaut = Vespry', async () => {
    const { d1 } = freshDb();
    await insertDonor(d1, donor('vespry', 1));
    await insertDonor(d1, donor('atelier', 1));
    const bad = await worker.fetch(new Request('https://x.test/donors?project=inconnu'), env(d1));
    expect(bad.status).toBe(400);
    const ok = await worker.fetch(new Request('https://x.test/donors'), env(d1));
    expect(((await ok.json()) as { recent: { name: string }[] }).recent.map((d) => d.name)).toEqual(['vespry-1']);
  });

  it('webhook Stripe signé : le soutien est rangé dans le projet du paiement', async () => {
    const { d1 } = freshDb();
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_9', payment_status: 'paid', metadata: { project: 'atelier', isPublic: 'true', donorName: 'Zoé' } } },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = await hmacSha256Hex('whsec_t', `${t}.${body}`);
    const res = await worker.fetch(new Request('https://x.test/stripe/webhook', {
      method: 'POST', body, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` },
    }), env(d1));
    expect(res.status).toBe(200);
    expect((await getFeed(d1, 'atelier')).recent.map((d) => d.name)).toEqual(['Zoé']);
    expect((await getFeed(d1, 'vespry')).total).toBe(0);
  });
});

describe('liste des projets', () => {
  it('chaque projet a un identifiant conforme et un retour en https', async () => {
    const { PROJECTS } = await import('../src/projects');
    for (const [key, p] of Object.entries(PROJECTS)) {
      expect(p.id).toBe(key);
      expect(projectOfPayment(p.id)).toBe(p.id);
      if (p.returnUrl) expect(new URL(p.returnUrl).protocol).toBe('https:');
    }
  });
});
