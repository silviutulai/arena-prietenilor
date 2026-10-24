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

// Bătălia navală: tablă 8×8, flotă 4-3-3-2-2. Navele se așază aleatoriu (poți amesteca până îți place).
// Lovitură = mai tragi o dată. Ratare = rândul trece. Câștigă cine scufundă primul toată flota adversă.
const BS = 8;
const FLEET = [4, 3, 3, 2, 2];
const rand = (n) => Math.floor(Math.random() * n);

function placeFleet() {
  for (;;) {
    const occupied = new Set();
    const ships = [];
    let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const horiz = Math.random() < 0.5;
        const r = rand(horiz ? BS : BS - len + 1);
        const c = rand(horiz ? BS - len + 1 : BS);
        const cells = Array.from({ length: len }, (_, i) => (horiz ? r * BS + c + i : (r + i) * BS + c));
        const touches = cells.some((x) => {
          const xr = Math.floor(x / BS);
          const xc = x % BS;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = xr + dr;
              const nc = xc + dc;
              if (nr >= 0 && nr < BS && nc >= 0 && nc < BS && occupied.has(nr * BS + nc)) return true;
            }
          }
          return false;
        });
        if (!touches) {
          cells.forEach((x) => occupied.add(x));
          ships.push({ cells, hits: [] });
          placed = true;
        }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
}

const isSunk = (s) => s.hits.length === s.cells.length;

const battleship = {
  name: 'Bătălia navală',
  init() {
    return { phase: 'setup', ships: [placeFleet(), placeFleet()], shots: [Array(BS * BS).fill(null), Array(BS * BS).fill(null)], ready: [false, false], last: null, done: false };
  },
  anyTurn: (st) => st.phase === 'setup',
  move(st, p, payload) {
    if (st.phase === 'setup') {
      if (payload.action === 'shuffle') {
        if (st.ready[p]) return 'Ai confirmat deja flota.';
        st.ships[p] = placeFleet();
        return { keep: true };
      }
      if (payload.action === 'ready') {
        st.ready[p] = true;
        if (st.ready[0] && st.ready[1]) st.phase = 'play';
        return { keep: true };
      }
      return 'Așteaptă să fie gata amândoi.';
    }
    const idx = payload.shot;
    if (!Number.isInteger(idx) || idx < 0 || idx >= BS * BS) return 'Țintă invalidă';
    if (st.shots[p][idx] !== null) return 'Ai tras deja acolo.';
    const ship = st.ships[1 - p].find((s) => s.cells.includes(idx));
    if (!ship) {
      st.shots[p][idx] = 'miss';
      st.last = { by: p, idx, hit: false, sunk: false };
      return { next: 1 - p };
    }
    st.shots[p][idx] = 'hit';
    ship.hits.push(idx);
    st.last = { by: p, idx, hit: true, sunk: isSunk(ship) };
    if (st.ships[1 - p].every(isSunk)) {
      st.done = true;
      return { winner: p };
    }
    return { next: p };
  },
  view(st, me) {
    if (me !== 0 && me !== 1) me = 0;
    const enemy = st.ships[1 - me];
    return {
      phase: st.phase, size: BS, fleet: FLEET, ready: st.ready, last: st.last, done: st.done,
      myShips: st.ships[me].map((s) => ({ cells: s.cells, sunk: isSunk(s) })),
      incoming: st.shots[1 - me],
      outgoing: st.shots[me],
      enemySunk: enemy.filter(isSunk).map((s) => s.cells),
      enemyShips: st.done ? enemy.map((s) => s.cells) : null,
      enemyLeft: enemy.filter((s) => !isSunk(s)).map((s) => s.cells.length),
      myLeft: st.ships[me].filter((s) => !isSunk(s)).map((s) => s.cells.length)
    };
  }
};

// Jocuri de noroc: amândoi acționează în aceeași rundă; câștigă primul care ajunge la 3 runde.
const WIN_ROUNDS = 3;

const dice = {
  name: 'Zaruri',
  init() {
    return { rolls: [null, null], wins: [0, 0], round: 1, history: [] };
  },
  anyTurn: () => true,
  move(st, p, payload) {
    if (payload.action !== 'roll') return 'Mutare invalidă';
    if (st.rolls[p]) return 'Ai aruncat deja în runda asta.';
    st.rolls[p] = [1 + rand(6), 1 + rand(6)];
    if (st.rolls[0] && st.rolls[1]) {
      const s0 = st.rolls[0][0] + st.rolls[0][1];
      const s1 = st.rolls[1][0] + st.rolls[1][1];
      const w = s0 === s1 ? null : s0 > s1 ? 0 : 1;
      if (w !== null) st.wins[w]++;
      st.history.push({ round: st.round, rolls: st.rolls, winner: w });
      st.rolls = [null, null];
      st.round++;
      if (w !== null && st.wins[w] >= WIN_ROUNDS) return { winner: w };
    }
    return { keep: true };
  },
  view(st, me) {
    if (me !== 0 && me !== 1) me = 0;
    return { wins: st.wins, round: st.round, target: WIN_ROUNDS, history: st.history, myRoll: st.rolls[me], oppRolled: Boolean(st.rolls[1 - me]) };
  }
};

const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const rps = {
  name: 'Piatră, hârtie, foarfecă',
  init() {
    return { picks: [null, null], wins: [0, 0], round: 1, history: [] };
  },
  anyTurn: () => true,
  move(st, p, payload) {
    const c = payload.choice;
    if (!BEATS[c]) return 'Alegere invalidă';
    if (st.picks[p]) return 'Ai ales deja în runda asta.';
    st.picks[p] = c;
    if (st.picks[0] && st.picks[1]) {
      const [a, b] = st.picks;
      const w = a === b ? null : BEATS[a] === b ? 0 : 1;
      if (w !== null) st.wins[w]++;
      st.history.push({ round: st.round, picks: st.picks, winner: w });
      st.picks = [null, null];
      st.round++;
      if (w !== null && st.wins[w] >= WIN_ROUNDS) return { winner: w };
    }
    return { keep: true };
  },
  view(st, me) {
    if (me !== 0 && me !== 1) me = 0;
    return { wins: st.wins, round: st.round, target: WIN_ROUNDS, history: st.history, myPick: st.picks[me], oppPicked: Boolean(st.picks[1 - me]) };
  }
};

module.exports = { GAMES: { ttt, tttq, c4, hangman, battleship, dice, rps } };
