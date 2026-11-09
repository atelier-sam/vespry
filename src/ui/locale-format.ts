/**
 * Formats dépendants de la langue : heures, dates, montants, tailles.
 *
 * Pourquoi un module à part : ces formats étaient écrits en dur en `'fr-FR'`
 * (journal d'export, aperçu, montant du don). Un Américain lisait « 20/05 »
 * pour le 20 mai et « 5 € » à l'envers. Ici chaque fonction reçoit la locale
 * en paramètre (testable sans navigateur) et ne la devine que par défaut.
 *
 * Quelle locale : celle de l'interface (`currentLocale()`), affinée par la
 * région du navigateur quand elle porte sur la MÊME langue. `en-GB` garde
 * donc « 20/05 » alors que `en-US` voit « 05/20 ». Un navigateur en `sv-SE`
 * (langue sans dictionnaire, interface en anglais) reste en `en` : des dates
 * suédoises sous une interface anglaise seraient incohérentes.
 */
import { currentLocale } from './i18n';

/**
 * Locale des formats pour une langue de navigateur et une langue
 * d'interface données. Pure : tout le raisonnement est ici, testé.
 */
export function resolveFormatLocale(
  browserLanguage: string | undefined,
  uiLocale: string,
): string {
  const tag = (browserLanguage ?? '').trim();
  if (!tag) return uiLocale;
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    // Langue PRIMAIRE complète (« fil » ≠ « fi ») : un tag à trois lettres ne
    // doit pas être pris pour la langue à deux lettres qui le préfixe.
    if (canonical && canonical.split('-')[0]?.toLowerCase() === uiLocale) return canonical;
  } catch {
    /* tag invalide : on retombe sur la langue de l'interface */
  }
  return uiLocale;
}

/** Locale des formats de la session courante. */
export function formatLocale(): string {
  const nav = typeof navigator === 'undefined' ? undefined : navigator.language;
  return resolveFormatLocale(nav, currentLocale());
}

/**
 * Heure du journal, sur 24 h : les lignes sont en police fixe, une heure
 * « 4:12:22 PM » les désalignerait. `h23` (et non `hour12: false`) évite le
 * « 24:05:03 » de minuit que certains moteurs produisent en `en-US`.
 */
export function formatClock(date: Date, locale: string = formatLocale()): string {
  return date.toLocaleTimeString(locale, {
    hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

/** Date seule, dans l'ordre de la locale (« 20/05/2026 », « 5/20/2026 »). */
export function formatDate(ms: number, locale: string = formatLocale()): string {
  return new Date(ms).toLocaleDateString(locale);
}

/** Horodatage court d'un message de l'aperçu (jour, mois, heure, minute). */
export function formatMessageTime(ts: string, locale: string = formatLocale()): string {
  return new Date(ts).toLocaleString(locale, {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Montant en euros, symbole compris et bien placé (« 5 € », « €5 », « 5,00 € »).
 * Les montants ronds n'ont pas de décimales ; sinon toujours deux (« 3,50 € »).
 */
export function formatEuros(cents: number, locale: string = formatLocale()): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/**
 * Taille en mégaoctets (décimaux, 10^6) avec l'unité de la langue : « 184,6 Mo »
 * en français, « 184.6 MB » en anglais. L'unité vient d'Intl, pas d'une chaîne.
 */
export function formatMegabytes(bytes: number, locale: string = formatLocale()): string {
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    unitDisplay: 'short',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bytes / 1e6);
}
