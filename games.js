'use strict';
// Logica jocurilor 1 contra 1.
// move() întoarce: un text (eroare), { next: index } (rândul următor), { winner: index } sau { draw: true }.

const WORDS = require('./words');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const ttt = {
  name: 'X și 0',
  init() {
    return { board: Array(9).fill(null), winLine: null, last: null };
  },
  move(st, p, payload) {
    const cell = payload.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return 'Mutare invalidă';
    if (st.board[cell] !== null) return 'Căsuța e deja ocupată';
    st.board[cell] = p;
    st.last = cell;
    for (const line of TTT_LINES) {
      if (line.every((i) => st.board[i] === p)) {
        st.winLine = line;
        return { winner: p };
      }
    }
    if (st.board.every((c) => c !== null)) return { draw: true };
    return { next: 1 - p };
  },
  view: (st) => st
};

// X și 0 Quiz: alegi o căsuță, apare o întrebare. Răspuns corect = îți pui semnul. Greșit sau timp expirat = pierzi rândul.
const QUESTION_MS = 20_000;

function tttWinCheck(st, p) {
  for (const line of TTT_LINES) {
    if (line.every((i) => st.board[i] === p)) {
      st.winLine = line;
      return { winner: p };
    }
  }
  if (st.board.every((c) => c !== null)) return { draw: true };
  return null;
}

function tttqResolve(st, p, choice) {
  const pd = st.pending;
  st.pending = null;
  const ok = choice === pd.correct;
  st.lastAnswer = { by: p, cell: pd.cell, ok, text: pd.text, right: pd.options[pd.correct], picked: choice == null ? null : pd.options[choice] };
  if (ok) {
    st.board[pd.cell] = p;
    st.last = pd.cell;
    const end = tttWinCheck(st, p);
    if (end) return end;
  }
  return { next: 1 - p };
}

const tttq = {
  name: 'X și 0 Quiz',
  init() {
    return { board: Array(9).fill(null), winLine: null, last: null, pending: null, lastAnswer: null, used: [] };
  },
  move(st, p, payload, ctx) {
    if (payload.cell !== undefined) {
      if (st.pending) return 'Răspunde întâi la întrebare.';
      const cell = payload.cell;
      if (!Number.isInteger(cell) || cell < 0 || cell > 8) return 'Mutare invalidă';
      if (st.board[cell] !== null) return 'Căsuța e deja ocupată';
      const q = ctx.randomQuestion(st.used);
      if (!q) return 'Nu există întrebări disponibile.';
      st.used.push(q.key);
      st.pending = { cell, by: p, text: q.text, options: q.options, correct: q.correct, deadline: Date.now() + QUESTION_MS };
      return { next: p, timerMs: QUESTION_MS };
    }
    if (payload.answer !== undefined) {
      if (!st.pending) return 'Alege întâi o căsuță.';
      const choice = payload.answer;
      if (!Number.isInteger(choice) || choice < 0 || choice >= st.pending.options.length) return 'Răspuns invalid';
      return tttqResolve(st, p, choice);
    }
    return 'Mutare invalidă';
  },
  timeout(st, p) {
    return st.pending ? tttqResolve(st, p, null) : null;
  },
  view(st) {
    const pending = st.pending && {
      cell: st.pending.cell, by: st.pending.by, text: st.pending.text, options: st.pending.options,
      remainingMs: Math.max(0, st.pending.deadline - Date.now()), durationMs: QUESTION_MS
    };
    return { board: st.board, winLine: st.winLine, last: st.last, lastAnswer: st.lastAnswer, pending };
  }
};

const ROWS = 6;
const COLS = 7;

const c4 = {
  name: '4 în linie',
  init() {
    return { board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)), last: null, winLine: null };
  },
  move(st, p, payload) {
    const col = payload.col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return 'Coloană invalidă';
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (st.board[r][col] === null) { row = r; break; }
    }
    if (row < 0) return 'Coloana e plină';
    st.board[row][col] = p;
    st.last = [row, col];
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [[row, col]];
      for (const s of [1, -1]) {
        let r = row + dr * s;
        let c = col + dc * s;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && st.board[r][c] === p) {
          cells.push([r, c]);
          r += dr * s;
          c += dc * s;
        }
      }
      if (cells.length >= 4) {
        st.winLine = cells;
        return { winner: p };
      }
    }
    if (st.board[0].every((c) => c !== null)) return { draw: true };
    return { next: 1 - p };
  },
  view: (st) => st
};

// Spânzurătoarea în doi: același cuvânt, ghiciți pe rând.
// Literă bună = 1 punct pentru fiecare apariție și mai încerci o dată.
// Literă greșită = rândul trece la celălalt. Cine completează cuvântul primește +2.
// După 8 greșeli în total jocul se oprește. Câștigă cine are mai multe puncte.
const ALPHABET = [...'AĂÂBCDEFGHIÎJKLMNOPQRSȘTȚUVWXYZ'];

function hangFinish(st) {
  st.done = true;
  if (st.scores[0] === st.scores[1]) return { draw: true };
  return { winner: st.scores[0] > st.scores[1] ? 0 : 1 };
}

const hangman = {
  name: 'Spânzurătoarea',
  init() {
    return { word: pick(WORDS).toLocaleUpperCase('ro-RO'), guessed: [], wrong: 0, maxWrong: 8, scores: [0, 0], last: null, done: false, solvedBy: null };
  },
  move(st, p, payload) {
    if (typeof payload.letter !== 'string') return 'Literă invalidă';
    const letter = payload.letter.toLocaleUpperCase('ro-RO');
    if (!ALPHABET.includes(letter)) return 'Literă invalidă';
    if (st.guessed.includes(letter)) return 'Litera a fost deja încercată';
    st.guessed.push(letter);
    const count = [...st.word].filter((ch) => ch === letter).length;
    st.last = { by: p, letter, hits: count };
    if (count > 0) {
      st.scores[p] += count;
      if ([...st.word].every((ch) => st.guessed.includes(ch))) {
        st.scores[p] += 2;
        st.solvedBy = p;
        return hangFinish(st);
      }
      return { next: p };
    }
    st.wrong++;
    if (st.wrong >= st.maxWrong) return hangFinish(st);
    return { next: 1 - p };
  },
  view(st) {
    const shown = st.done ? st.word : [...st.word].map((ch) => (st.guessed.includes(ch) ? ch : '_')).join('');
    return { word: shown, guessed: st.guessed, wrong: st.wrong, maxWrong: st.maxWrong, scores: st.scores, last: st.last, done: st.done, solvedBy: st.solvedBy, alphabet: ALPHABET };
  }
};

module.exports = { GAMES: { ttt, tttq, c4, hangman } };
