'use strict';
// Verifică dacă un răspuns ghicește cuvântul, acceptând forme apropiate:
// „floare” = „flori” = „o floare” = „florile” = „Floarea”; „masă” = „mese”; „câine” = „caini”.
// Întoarce 2 (corect), 1 (aproape) sau 0 (greșit).

const STOP = new Set([
  'o', 'un', 'una', 'unu', 'niste', 'doi', 'doua', 'trei', 'pe', 'la', 'cu', 'de', 'in', 'din', 'si', 'sau',
  'a', 'al', 'ale', 'ai', 'cel', 'cea', 'cei', 'cele', 'lui', 'ei', 'mai', 'foarte', 'e', 'este', 'sunt', 'cred', 'ca'
]);
const SUFFIXES = ['urile', 'ilor', 'elor', 'ului', 'uri', 'ele', 'ile', 'ul', 'le', 'lui', 'ii', 'ea', 'a', 'e', 'i', 'u'];

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const contentWords = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

function stem(w) {
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 3 && w.endsWith(s)) return w.slice(0, -s.length);
  }
  return w;
}

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const skeleton = (w) => w[0] + w.slice(1).replace(/[aeiou]/g, '');

function wordMatch(t, g) {
  if (t === g) return 2;
  // formă articulată a unui cuvânt scurt: om–omul, pom–pomii
  const [short, long] = t.length <= g.length ? [t, g] : [g, t];
  if (long.startsWith(short) && SUFFIXES.includes(long.slice(short.length))) return 2;
  const st = stem(t);
  const sg = stem(g);
  if (st === sg) return 2;
  const L = Math.max(st.length, sg.length);
  const d = lev(st, sg);
  const tol = L >= 7 ? 2 : L >= 4 ? 1 : 0;
  if (d <= tol) return 2;
  // alternanța a/e din română: masă–mese, fată–fete
  if (st.length === sg.length && d === 1) {
    const i = [...st].findIndex((ch, k) => ch !== sg[k]);
    if ('ae'.includes(st[i]) && 'ae'.includes(sg[i])) return 2;
  }
  // oa/o, ea/e: floare–flori, seară–seri
  if (st.length >= 3 && sg.length >= 3 && t.slice(0, 2) === g.slice(0, 2) && skeleton(st) === skeleton(sg) && Math.abs(st.length - sg.length) <= 2) return 2;
  if (d <= tol + 1 && L >= 4 && st[0] === sg[0]) return 1; // „aproape”: doar o literă-două diferență
  return 0;
}

function checkGuess(target, guess) {
  const tw = contentWords(target);
  const gw = contentWords(guess);
  if (!gw.length) return 0;
  if (!tw.length) return norm(target) === norm(guess) ? 2 : 0;
  // și varianta lipită: „mingedefotbal”
  if (norm(guess).replace(/ /g, '') === norm(target).replace(/ /g, '')) return 2;
  let full = 0;
  let partial = 0;
  for (const t of tw) {
    let best = 0;
    for (const g of gw) best = Math.max(best, wordMatch(t, g));
    if (best === 2) full++;
    if (best >= 1) partial++;
  }
  if (full === tw.length) return 2;
  if (partial >= Math.ceil(tw.length / 2)) return 1;
  return 0;
}

module.exports = { checkGuess, norm };
