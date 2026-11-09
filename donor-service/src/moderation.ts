/**
 * Modération des textes libres fournis par les donateurs (nom + message).
 *
 * Un mur des soutiens affiche du contenu saisi par des inconnus : il faut un
 * garde-fou. Approche volontairement simple et conservatrice — en cas de
 * doute, on retire le texte (le soutien reste compté, sans texte affiché).
 * Sam peut masquer une entrée à la main via l'endpoint admin.
 */

export const MAX_NAME = 48;
export const MAX_MESSAGE = 280;

/**
 * Liste de blocage — insultes et termes haineux évidents (FR + EN). Comparée
 * sur du texte normalisé (minuscules, accents retirés). Volontairement courte
 * et factuelle : à étendre selon les signalements.
 */
const BANNED = [
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'nigger', 'faggot', 'retard',
  'connard', 'connasse', 'salope', 'pute', 'encule', 'enfoire', 'negre',
  'pede', 'tapette', 'bougnoule',
];

const BANNED_RE = new RegExp(`\\b(${BANNED.join('|')})\\b`, 'i');

/**
 * Minuscules + suppression des diacritiques combinants (é → e), pour une
 * comparaison stable avec une liste de blocage en ASCII.
 */
function normalize(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase().normalize('NFD')) {
    const cp = ch.codePointAt(0) ?? 0;
    // U+0300..U+036F : bloc des diacritiques combinants.
    if (cp >= 0x300 && cp <= 0x36f) continue;
    out += ch;
  }
  return out;
}

/**
 * Caractères invisibles retirés à l'écriture (09/11/2026) : formats (\p{Cf} :
 * largeur nulle, contrôles de direction U+202A..U+202E et U+2066..U+2069,
 * BOM, trait d'union conditionnel), contrôles non blancs (\p{Cc}, les blancs
 * étant compactés plus bas), joint de graphème U+034F et remplissages hangûl
 * qui s'affichent vides (U+115F, U+1160, U+3164, U+FFA0).
 *
 * Pourquoi à l'écriture : chaque lecteur du mur (extension, /donate, établi
 * de code.atelier-sam.fr) en est protégé d'un coup, et la liste de blocage
 * voit le texte tel qu'il s'affiche (« f\u200Buck » ne passe plus).
 * Exception : U+200D (ZWJ) ENTRE deux emoji, qui compose 👨‍👩‍👧 ou 🏳️‍🌈.
 */
const INVISIBLE = /[\p{Cf}\p{Cc}\u034F\u115F\u1160\u3164\uFFA0]/gu;
const EMOJI_ZWJ = /(?<=[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F])\u200D(?=\p{Extended_Pictographic})/gu;
/** Caractère privé, jamais saisi par un donateur, qui garde la place d'un ZWJ d'emoji. */
const ZWJ_KEPT = '\uE000';

function stripInvisible(s: string): string {
  return s
    .replace(/\uE000/g, '')
    .replace(EMOJI_ZWJ, ZWJ_KEPT)
    // Les blancs (\t, \n…) sont des \p{Cc} : on les garde ici, compactés ensuite.
    .replace(INVISIBLE, (ch) => (/\s/.test(ch) ? ch : ''))
    .replace(/\uE000/g, '\u200D');
}

/**
 * Nettoie un texte de donateur : retire les invisibles, compacte les espaces,
 * coupe à `max`. Renvoie null si le texte est vide ou si la liste de blocage
 * matche — dans ce cas l'entrée passe au compteur, mais sans ce texte.
 */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  const text = stripInvisible(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
  if (!text) return null;
  if (BANNED_RE.test(normalize(text))) return null;
  return text;
}
