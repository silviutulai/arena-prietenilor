'use strict';

const $ = (s) => document.querySelector(s);

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

const GAME_LABEL = { ttt: 'X și 0', tttq: 'X și 0 Quiz', c4: '4 în linie', hangman: 'Spânzurătoarea', quiz: 'Quiz' };
const TIERS = ['Ușor', 'Ușor', 'Mediu', 'Mediu', 'Dificil', 'Dificil', 'Greu', 'Greu', 'Foarte greu', 'Foarte greu'];

const S = {
  token: localStorage.getItem('arena_token'),
  me: null,
  socket: null,
  lobby: [],
  match: null,
  quiz: null,
  quizzes: [],
  tab: 'play',
  outgoing: new Map(),
  incoming: [],
  dismissedQuiz: null,
  quizDeadline: 0,
  myAnswers: {},
  inviteRequired: false,
  users: [],
  created: null, // { name, password, isNew } — ultimul cont creat / resetat, ca să-l trimiți prietenului
  editor: null // { id|null, title, level, seconds, text }
};

// ---------- Utilitare ----------
async function api(path, body, method) {
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Ceva n-a mers. Încearcă din nou.'), { status: res.status });
  return data;
}

function toast(msg, kind) {
  const t = el('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4300);
}

const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function weekRange(key) {
  const end = new Date(key + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmtDay(key)} – ${fmtDay(end.toISOString().slice(0, 10))}`;
}

function meter(level) {
  const bars = [];
  for (let i = 1; i <= 10; i++) bars.push(el('i', { class: i <= level ? 'on' : '' }));
  return el('span', { class: 'meter t' + Math.ceil(level / 2), 'aria-label': `Nivel ${level} din 10` }, bars);
}

function levelTag(level) {
  return el('span', { class: 'level t' + Math.ceil(level / 2) }, meter(level), el('span', {}, `${level} · ${TIERS[level - 1]}`));
}

// ---------- Autentificare ----------
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  $('#codeWrap').classList.toggle('hidden', !S.inviteRequired);
  const cfg = S.config || {};
  $('#registerBtn').classList.toggle('hidden', !cfg.signupOpen);
  if (cfg.firstAccount) {
    $('#loginBtn').classList.add('hidden');
    $('#registerBtn').classList.add('primary');
    $('#registerBtn').textContent = 'Creează contul de administrator';
    $('#authNote').textContent = 'Primul cont creat devine administrator. Apoi poți face conturi pentru prieteni.';
  } else if (!cfg.signupOpen) {
    $('#authNote').textContent = 'Numele și parola le primești de la administrator.';
  }
  $('#authName').focus();
}

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || 'login';
  const name = $('#authName').value.trim();
  const password = $('#authPass').value;
  $('#authError').textContent = '';
  if (!name || !password) {
    $('#authError').textContent = 'Scrie numele și parola.';
    return;
  }
  try {
    const data = await api('/api/' + mode, { name, password, code: $('#authCode').value });
    S.token = data.token;
    localStorage.setItem('arena_token', data.token);
    S.me = (await api('/api/me')).user;
    startApp();
  } catch (err) {
    $('#authError').textContent = err.message;
  }
});

$('#meName').addEventListener('click', () => {
  const cur = el('input', { type: 'password', autocomplete: 'current-password' });
  const next = el('input', { type: 'password', autocomplete: 'new-password' });
  const msg = el('p', { class: 'error' });
  $('#modalBox').replaceChildren(
    el('h2', {}, 'Schimbă parola'),
    el('label', {}, 'Parola actuală', cur),
    el('label', {}, 'Parola nouă', next),
    msg,
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: async () => {
        try {
          await api('/api/me/password', { current: cur.value, password: next.value });
          closeModal();
          toast('Parola a fost schimbată.');
        } catch (e) { msg.textContent = e.message; }
      } }, 'Salvează'),
      el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunță')));
  $('#modal').classList.remove('hidden');
  cur.focus();
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/api/logout', {}); } catch { /* nimic */ }
  localStorage.removeItem('arena_token');
  location.reload();
});

// ---------- Aplicația ----------
async function loadQuizzes() {
  try {
    S.quizzes = (await api('/api/quizzes')).quizzes;
    if (currentView() === 'play') renderQuizSection();
    if (currentView() === 'admin' && !S.editor) renderAdmin();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function startApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#meName').textContent = S.me.name;
  $('#adminTab').classList.toggle('hidden', !S.me.isAdmin);
  loadQuizzes();

  const s = io({ auth: { token: S.token } });
  S.socket = s;
  s.on('connect', () => $('#conn').classList.add('hidden'));
  s.on('disconnect', () => $('#conn').classList.remove('hidden'));
  s.on('connect_error', (e) => {
    if (e.message === 'unauthorized') {
      localStorage.removeItem('arena_token');
      location.reload();
    }
  });
  s.on('lobby', (list) => { S.lobby = list; if (currentView() === 'play') renderPlayers(); });
  s.on('match', (m) => {
    const isNew = !S.match || S.match.id !== m.id;
    S.match = m;
    if (m.state && m.state.pending) S.matchDeadline = Date.now() + m.state.pending.remainingMs;
    S.outgoing.clear();
    S.incoming = [];
    closeModal();
    render(isNew);
  });
  s.on('matchClosed', () => { S.match = null; render(); });
  s.on('quiz', (q) => {
    S.quiz = q;
    if (q && q.phase === 'question') S.quizDeadline = Date.now() + q.remainingMs;
    if (currentView() !== 'admin') render();
  });
  s.on('quizInvite', ({ from, title }) => {
    if (!S.match) toast(`${from} a pornit quizul „${title}”. Intră din Joacă.`);
  });
  s.on('quizzesChanged', loadQuizzes);
  s.on('challenged', (c) => { S.incoming.push(c); showIncoming(); });
  s.on('challengeSent', (c) => { S.outgoing.set(c.id, c); renderOutgoing(); });
  s.on('challengeGone', ({ id, reason, by }) => {
    if (S.outgoing.delete(id)) {
      renderOutgoing();
      if (reason === 'declined') toast(`${by} a refuzat provocarea.`);
      if (reason === 'expired') toast('Provocarea a expirat.');
    }
    const before = S.incoming.length;
    S.incoming = S.incoming.filter((c) => c.id !== id);
    if (S.incoming.length !== before) showIncoming();
  });
  s.on('errorMsg', (m) => toast(m, 'error'));
  s.on('leaderboardChanged', () => { if (currentView() === 'board') loadBoard(); });

  document.querySelectorAll('#tabs .tab').forEach((b) => b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    document.querySelectorAll('#tabs .tab').forEach((x) => x.classList.toggle('active', x === b));
    if (S.tab === 'board') loadBoard();
    if (S.tab === 'admin') loadUsers();
    render();
  }));
  render();
}

function myQuiz() {
  const q = S.quiz;
  return q && S.me && q.players.some((p) => p.id === S.me.id) && S.dismissedQuiz !== q.id ? q : null;
}

function currentView() {
  if (S.match) return 'match';
  if (myQuiz()) return 'quiz';
  return S.tab;
}

function render(fresh) {
  const view = currentView();
  for (const v of ['play', 'board', 'admin', 'match', 'quiz']) $('#view-' + v).classList.toggle('hidden', v !== view);
  $('#tabs').classList.toggle('hidden', view === 'match' || view === 'quiz');
  if (view === 'match') renderMatch(fresh);
  else if (view === 'quiz') renderQuiz();
  else if (view === 'play') { renderQuizSection(); renderOutgoing(); renderPlayers(); }
  else if (view === 'admin') renderAdmin();
}

// ---------- Lobby ----------
function renderPlayers() {
  const box = $('#players');
  const others = S.lobby.filter((p) => p.id !== S.me.id);
  $('#onlineCount').textContent = others.length ? `${others.length} ${others.length === 1 ? 'prieten' : 'prieteni'}` : '';
  if (!others.length) {
    box.replaceChildren(el('p', { class: 'muted empty' }, 'Niciun prieten online acum. Trimite-le linkul ca să intre și ei.'));
    return;
  }
  box.replaceChildren(...others.map((p) => el('div', { class: 'player' },
    el('div', { class: 'player-name' },
      el('span', { class: 'avatar' }, p.name.slice(0, 1).toLocaleUpperCase('ro-RO')),
      el('span', {}, p.name),
      p.busy ? el('span', { class: 'tag' }, 'joacă') : null),
    el('div', { class: 'player-actions' },
      ['ttt', 'tttq', 'c4', 'hangman'].map((g) => el('button', {
        class: 'btn small soft',
        disabled: p.busy,
        title: `Provoacă-l pe ${p.name} la ${GAME_LABEL[g]}`,
        onclick: () => S.socket.emit('challenge', { to: p.id, game: g })
      }, GAME_LABEL[g])))
  )));
}

function renderQuizSection() {
  const q = S.quiz;
  const box = $('#quizSection');
  if (q && q.phase === 'lobby') {
    const host = q.players.find((p) => p.id === q.hostId);
    box.replaceChildren(el('div', { class: 'panel invite' },
      el('div', {},
        el('p', { class: 'eyebrow' }, `${host ? host.name : 'Cineva'} te așteaptă la quiz`),
        el('h2', {}, q.title),
        el('div', { class: 'invite-meta' }, levelTag(q.level), el('span', { class: 'muted small' }, `${q.players.length} în sală`))),
      el('button', { class: 'btn primary', onclick: () => { S.dismissedQuiz = null; S.socket.emit('quizJoin'); } }, 'Intră în quiz')));
    return;
  }
  if (q && q.phase !== 'finished') {
    box.replaceChildren(el('div', { class: 'panel invite' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Quiz în desfășurare'),
        el('h2', {}, q.title),
        el('p', { class: 'muted small' }, `Întrebarea ${q.index + 1} din ${q.total}. Poți porni altul după ce se termină.`))));
    return;
  }
  box.replaceChildren(el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Quiz pentru toată gașca'), el('span', { class: 'muted small hide-sm' }, 'Alege nivelul')),
    S.quizzes.length
      ? el('div', { class: 'quiz-list' }, S.quizzes.map((z) => el('button', {
        class: 'quiz-row',
        onclick: () => S.socket.emit('quizCreate', { quizId: z.id })
      },
      el('span', { class: 'qr-level' }, levelTag(z.level)),
      el('span', { class: 'qr-title' }, z.title),
      el('span', { class: 'qr-meta muted small' }, `${z.count} întrebări · ${z.seconds} s`),
      el('span', { class: 'qr-go' }, 'Pornește'))))
      : el('p', { class: 'muted empty' }, 'Niciun quiz încă.')));
}

function renderOutgoing() {
  const box = $('#outgoing');
  if (!S.outgoing.size) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(...[...S.outgoing.values()].map((c) => el('div', { class: 'player' },
    el('span', {}, `Aștepți răspunsul lui ${c.to.name} la ${c.gameName}…`),
    el('button', { class: 'btn small ghost', onclick: () => S.socket.emit('cancelChallenge', { id: c.id }) }, 'Anulează'))));
}

function showIncoming() {
  const c = S.incoming[0];
  if (!c) return closeModal();
  $('#modalBox').replaceChildren(
    el('p', { class: 'eyebrow' }, 'Provocare nouă'),
    el('h2', {}, `${c.from.name} te provoacă la ${c.gameName}`),
    el('p', { class: 'muted small' }, 'Ai 30 de secunde să răspunzi.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => S.socket.emit('challengeReply', { id: c.id, accept: true }) }, 'Accept'),
      el('button', { class: 'btn', onclick: () => {
        S.socket.emit('challengeReply', { id: c.id, accept: false });
        S.incoming.shift();
        showIncoming();
      } }, 'Refuz')));
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

// ---------- Meci 1 contra 1 ----------
function chip(m, i) {
  const p = m.players[i];
  const isTurn = !m.over && m.turn === i;
  let mark;
  if (m.game === 'ttt' || m.game === 'tttq') mark = el('span', { class: 'mark m' + i }, i === 0 ? 'X' : 'O');
  else if (m.game === 'c4') mark = el('span', { class: 'disc p' + i });
  else mark = el('span', { class: 'score-pill' }, m.state.scores[i]);
  return el('div', { class: 'chip' + (isTurn ? ' turn' : '') + (m.away.includes(p.id) ? ' away' : '') },
    mark, el('span', {}, p.id === S.me.id ? 'Tu' : p.name));
}

function statusText(m, me, opp) {
  const reasons = { resign: ` ${opp.name} a abandonat.`, abandon: ` ${opp.name} s-a deconectat.` };
  if (m.over) {
    if (m.over.draw) return ['Remiză. Primiți câte 1 punct.', 'draw'];
    if (m.over.winner === me) return [`Ai câștigat! +3 puncte.${reasons[m.over.reason] || ''}`, 'win'];
    return [m.over.reason === 'normal' ? `A câștigat ${opp.name}.` : 'Ai abandonat meciul.', 'loss'];
  }
  if (m.away.includes(opp.id)) return [`${opp.name} s-a deconectat. Are 30 de secunde să revină.`, 'wait'];
  if (m.game === 'tttq' && m.state.pending) {
    return m.state.pending.by === me ? ['Răspunde corect ca să-ți pui semnul', 'mine'] : [`${opp.name} răspunde la întrebare…`, 'wait'];
  }
  if (m.turn === me) {
    if (m.game === 'tttq') return ['Alege o căsuță', 'mine'];
    if (m.game === 'hangman' && m.state.last && m.state.last.by === me && m.state.last.hits) return ['Bună! Mai alegi o literă.', 'mine'];
    return ['Rândul tău', 'mine'];
  }
  return [`Mută ${opp.name}…`, 'wait'];
}

function renderMatch(fresh) {
  const m = S.match;
  const me = m.players.findIndex((p) => p.id === S.me.id);
  const opp = m.players[1 - me];
  const myTurn = !m.over && m.turn === me;
  const [status, cls] = statusText(m, me, opp);
  clearInterval(matchTick);
  const board = { ttt: tttBoard, tttq: tttqBoard, c4: c4Board, hangman: hangBoard }[m.game](m, myTurn, fresh);

  let actions;
  if (!m.over) {
    actions = [el('button', { class: 'btn ghost', onclick: () => { if (confirm('Sigur abandonezi? Adversarul primește victoria.')) S.socket.emit('resign'); } }, 'Abandonează')];
  } else {
    const iWant = m.rematch.includes(S.me.id);
    const theyWant = m.rematch.includes(opp.id);
    actions = [
      m.left.length
        ? el('p', { class: 'muted' }, `${opp.name} a ieșit din meci.`)
        : el('button', { class: 'btn primary', disabled: iWant, onclick: () => S.socket.emit('rematch') },
          iWant ? 'Aștepți revanșa…' : theyWant ? `${opp.name} vrea revanșă. Joacă din nou` : 'Revanșă'),
      el('button', { class: 'btn', onclick: () => S.socket.emit('leaveMatch') }, 'Înapoi')
    ];
  }

  $('#view-match').replaceChildren(el('div', { class: 'stage ' + m.game },
    el('p', { class: 'eyebrow center' }, m.gameName),
    el('div', { class: 'versus' }, chip(m, 0), el('span', { class: 'vs' }, 'vs'), chip(m, 1)),
    el('p', { class: 'status ' + cls, role: 'status' }, status),
    board,
    el('div', { class: 'row center' }, actions)));
}

let matchTick = null;

function tttqBoard(m, myTurn) {
  const st = m.state;
  const me = m.players.findIndex((p) => p.id === S.me.id);
  const pd = st.pending;
  const sym = (i) => (i === 0 ? 'X' : 'O');
  const grid = el('div', { class: 'ttt-grid' }, st.board.map((c, i) => {
    const isPending = pd && pd.cell === i;
    return el('button', {
      class: 'ttt-cell' + (c !== null ? ' m' + c : '') + (isPending ? ' pending m' + pd.by : '') +
        (st.winLine && st.winLine.includes(i) ? ' win' : '') + (st.last === i ? ' last' : ''),
      disabled: !myTurn || c !== null || Boolean(pd),
      'aria-label': c === null ? `Căsuța ${i + 1}, liberă` : `Căsuța ${i + 1}, ${sym(c)}`,
      onclick: () => S.socket.emit('move', { cell: i })
    }, c !== null ? sym(c) : isPending ? '?' : '');
  }));

  let card = null;
  if (pd && !m.over) {
    const mine = pd.by === me;
    card = el('div', { class: 'qcard' },
      el('div', { class: 'timer' }, el('span', { id: 'mtimer' })),
      el('p', { class: 'qcard-q' }, pd.text),
      el('div', { class: 'options' }, pd.options.map((opt, i) => el('button', {
        class: 'opt',
        disabled: !mine,
        onclick: (e) => { e.currentTarget.classList.add('picked'); document.querySelectorAll('.qcard .opt').forEach((b) => { b.disabled = true; }); S.socket.emit('move', { answer: i }); }
      }, el('span', { class: 'opt-letter' }, 'ABCD'[i]), el('span', {}, opt)))),
      mine ? null : el('p', { class: 'muted small center' }, `Doar ${m.players[pd.by].name} poate răspunde acum.`));
  } else if (st.lastAnswer) {
    const la = st.lastAnswer;
    const who = la.by === me ? 'Tu' : m.players[la.by].name;
    card = el('div', { class: 'qcard result ' + (la.ok ? 'ok' : 'bad') },
      el('p', { class: 'qcard-verdict' }, la.ok
        ? `${who}: corect! ${sym(la.by)} pe căsuța ${la.cell + 1}.`
        : `${who}: ${la.picked === null ? 'timpul a expirat' : 'greșit'}. Rândul trece mai departe.`),
      el('p', { class: 'muted small' }, la.text, ' ', el('b', {}, la.right)));
  } else {
    card = el('p', { class: 'muted small center' }, 'Alege o căsuță, apoi răspunde la întrebare. Răspuns corect: îți pui semnul. Greșit: pierzi rândul.');
  }

  if (pd && !m.over) {
    setTimeout(() => {
      const fill = $('#mtimer');
      if (!fill) return;
      const update = () => {
        const left = Math.max(0, S.matchDeadline - Date.now());
        fill.style.width = (100 * left / pd.durationMs) + '%';
        fill.classList.toggle('low', left < 5000);
      };
      update();
      matchTick = setInterval(update, 100);
    });
  }
  return el('div', { class: 'tttq-wrap' + (pd && !m.over ? ' asking' : '') }, grid, card);
}

function tttBoard(m, myTurn) {
  const st = m.state;
  return el('div', { class: 'ttt-grid' }, st.board.map((c, i) => el('button', {
    class: 'ttt-cell' + (c !== null ? ' m' + c : '') + (st.winLine && st.winLine.includes(i) ? ' win' : '') + (st.last === i ? ' last' : ''),
    disabled: !myTurn || c !== null,
    'aria-label': c === null ? `Căsuța ${i + 1}, liberă` : `Căsuța ${i + 1}, ${c === 0 ? 'X' : 'O'}`,
    onclick: () => S.socket.emit('move', { cell: i })
  }, c === null ? '' : c === 0 ? 'X' : 'O')));
}

function c4Board(m, myTurn) {
  const st = m.state;
  const win = new Set((st.winLine || []).map(([r, c]) => r + ':' + c));
  const cols = [];
  for (let c = 0; c < 7; c++) {
    const full = st.board[0][c] !== null;
    cols.push(el('button', {
      class: 'c4-col',
      disabled: !myTurn || full,
      'aria-label': `Coloana ${c + 1}`,
      onclick: () => S.socket.emit('move', { col: c })
    }, st.board.map((row, r) => {
      const v = row[c];
      const isLast = st.last && st.last[0] === r && st.last[1] === c;
      return el('span', {
        class: 'c4-slot' + (v !== null ? ' p' + v : '') + (isLast ? ' drop' : '') + (win.has(r + ':' + c) ? ' win' : ''),
        style: isLast ? `--rows:${r + 1}` : null
      });
    })));
  }
  return el('div', { class: 'c4-board' }, cols);
}

function hangBoard(m, myTurn) {
  const st = m.state;
  const lives = [];
  for (let i = 0; i < st.maxWrong; i++) lives.push(el('i', { class: i < st.wrong ? 'lost' : '' }));
  let lastText = null;
  if (st.last) {
    const who = st.last.by === m.players.findIndex((p) => p.id === S.me.id) ? 'Tu' : m.players[st.last.by].name;
    lastText = st.last.hits
      ? `${who}: „${st.last.letter}” apare de ${st.last.hits} ${st.last.hits === 1 ? 'dată' : 'ori'}.`
      : `${who}: „${st.last.letter}” nu e în cuvânt.`;
  }
  return el('div', { class: 'hang' },
    el('div', { class: 'hang-word' + (st.done ? ' done' : '') }, [...st.word].map((ch) => el('span', { class: ch === '_' ? 'blank' : '' }, ch === '_' ? '' : ch))),
    el('div', { class: 'lives', 'aria-label': `Greșeli: ${st.wrong} din ${st.maxWrong}` }, lives, el('span', { class: 'muted small' }, `${st.wrong}/${st.maxWrong} greșeli`)),
    lastText ? el('p', { class: 'muted small center' }, lastText) : null,
    el('div', { class: 'keys' }, st.alphabet.map((L) => {
      const used = st.guessed.includes(L);
      const hit = used && st.word.includes(L);
      return el('button', {
        class: 'key' + (used ? (hit ? ' hit' : ' miss') : ''),
        disabled: !myTurn || used,
        onclick: () => S.socket.emit('move', { letter: L })
      }, L);
    })),
    el('p', { class: 'muted small center' }, 'Literă bună: 1 punct pentru fiecare apariție și mai alegi o dată. Cine completează cuvântul ia +2.'));
}

// ---------- Quiz ----------
let quizTick = null;

function renderQuiz() {
  const q = myQuiz();
  const box = $('#view-quiz');
  clearInterval(quizTick);
  const isHost = q.hostId === S.me.id;
  const players = [...q.players].sort((a, b) => b.score - a.score);
  const leave = el('button', { class: 'btn ghost', onclick: () => { S.socket.emit('quizLeave'); S.dismissedQuiz = q.id; render(); } }, 'Ieși din quiz');
  const head = el('div', { class: 'quiz-head' }, el('h2', {}, q.title), levelTag(q.level));

  if (q.phase === 'lobby') {
    const host = q.players.find((p) => p.id === q.hostId);
    box.replaceChildren(el('div', { class: 'panel' },
      el('p', { class: 'eyebrow' }, 'Sala de așteptare'),
      head,
      el('p', { class: 'muted small' }, `${q.total} întrebări`),
      el('ul', { class: 'pills' }, q.players.map((p) => el('li', {}, el('span', { class: 'avatar sm' }, p.name.slice(0, 1).toLocaleUpperCase('ro-RO')), p.name, p.id === q.hostId ? el('span', { class: 'muted small' }, 'organizator') : null))),
      isHost
        ? el('p', { class: 'muted' }, q.players.length < 2 ? 'Așteaptă să intre cel puțin încă un prieten.' : 'Toată lumea e gata? Pornește când vrei.')
        : el('p', { class: 'muted' }, `Așteptăm ca ${host ? host.name : 'organizatorul'} să pornească quizul.`),
      el('div', { class: 'row' },
        isHost ? el('button', { class: 'btn primary', disabled: q.players.length < 2, onclick: () => S.socket.emit('quizStart') }, 'Pornește quizul') : null,
        leave)));
    return;
  }

  if (q.phase === 'finished') {
    box.replaceChildren(el('div', { class: 'panel' },
      el('p', { class: 'eyebrow' }, 'Rezultate'),
      head,
      el('ol', { class: 'ranking' }, q.ranking.map((r) => el('li', { class: r.id === S.me.id ? 'me' : '' },
        el('span', { class: 'rank' }, r.rank),
        el('span', { class: 'rname' }, r.name, el('small', { class: 'muted' }, `${r.correct}/${q.total} corecte · ${r.score} p`)),
        el('span', { class: 'rpts' }, `+${r.points}`)))),
      el('p', { class: 'muted small' }, 'Punctele din dreapta intră în clasamentul săptămânii.'),
      el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => { S.dismissedQuiz = q.id; render(); } }, 'Înapoi'))));
    return;
  }

  const key = q.id + ':' + q.index;
  const mine = S.myAnswers[key];
  const reveal = q.phase === 'reveal';
  const meP = q.players.find((p) => p.id === S.me.id);

  const options = q.question.options.map((opt, i) => {
    let cls = 'opt';
    if (mine === i) cls += ' picked';
    if (reveal && i === q.correctIndex) cls += ' right';
    else if (reveal && mine === i) cls += ' wrong';
    return el('button', {
      class: cls,
      disabled: reveal || mine !== undefined,
      onclick: () => { S.myAnswers[key] = i; S.socket.emit('quizAnswer', { choice: i }); renderQuiz(); }
    }, el('span', { class: 'opt-letter' }, 'ABCD'[i]), el('span', {}, opt));
  });

  let feedback = el('p', { class: 'status wait' }, ' ');
  if (reveal) {
    feedback = meP && meP.gained
      ? el('p', { class: 'status win' }, `Corect! +${meP.gained}`)
      : el('p', { class: 'status loss' }, mine === undefined ? 'N-ai răspuns la timp.' : 'Greșit.');
  } else if (mine !== undefined) {
    feedback = el('p', { class: 'status wait' }, 'Răspuns trimis. Așteptăm și restul…');
  }

  box.replaceChildren(el('div', { class: 'stage quiz-live' },
    el('div', { class: 'quiz-top' },
      el('span', {}, el('b', {}, q.index + 1), ` / ${q.total}`),
      el('span', { class: 'muted' }, q.title),
      el('span', { class: 'muted' }, `${q.players.filter((p) => p.answered).length}/${q.players.length} au răspuns`)),
    el('div', { class: 'timer' }, el('span', { id: 'qtimer' })),
    el('h2', { class: 'question' }, q.question.text),
    el('div', { class: 'options' }, options),
    feedback,
    el('ol', { class: 'pills scores' }, players.map((p) => el('li', { class: p.id === S.me.id ? 'me' : '' },
      el('span', {}, p.name), el('b', {}, p.score), reveal && p.gained ? el('span', { class: 'gain' }, `+${p.gained}`) : null))),
    el('div', { class: 'row center' }, leave)));

  const fill = $('#qtimer');
  const update = () => {
    const left = reveal ? 0 : Math.max(0, S.quizDeadline - Date.now());
    fill.style.width = (100 * left / q.durationMs) + '%';
    fill.classList.toggle('low', left < 5000);
  };
  update();
  if (!reveal) quizTick = setInterval(update, 100);
}

// ---------- Administrare quizuri ----------
function parseQuizText(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length);
  const questions = [];
  const errors = [];
  const clean = (l) => l.replace(/^[*\-–•]\s*/, '');
  blocks.forEach((lines, i) => {
    const q = lines[0].replace(/^\d+[.)]\s*/, '');
    const answers = lines.slice(1);
    const correct = answers.filter((l) => l.startsWith('*'));
    if (answers.length < 2 || answers.length > 4) errors.push(`Întrebarea ${i + 1}: are ${answers.length} răspunsuri (trebuie între 2 și 4).`);
    else if (correct.length !== 1) errors.push(`Întrebarea ${i + 1}: marchează exact un răspuns corect cu *.`);
    else questions.push({ q, a: [clean(correct[0]), ...answers.filter((l) => !l.startsWith('*')).map(clean)] });
  });
  return { questions, errors };
}

const quizToText = (questions) => questions.map((x) => [x.q, '* ' + x.a[0], ...x.a.slice(1).map((w) => '- ' + w)].join('\n')).join('\n\n');

const EXAMPLE = `Care este capitala Italiei?
* Roma
- Milano
- Napoli
- Torino

Câte picioare are o albină?
* 6
- 4
- 8`;

// ---------- Administrare jucători ----------
const PW_WORDS = ['soare', 'munte', 'pisica', 'vulpe', 'zmeu', 'nor', 'rachete', 'lup', 'stea', 'luna', 'tren', 'brad', 'cires', 'delfin', 'tigru', 'vant', 'castel', 'dragon', 'fulger', 'comoara'];
function genPassword() {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  return PW_WORDS[r[0] % PW_WORDS.length] + (10 + (r[1] % 90));
}

async function loadUsers() {
  try {
    S.users = (await api('/api/users')).users;
    if (currentView() === 'admin' && !S.editor) renderAdmin();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function credentialsText(c) {
  return `Salut, ${c.name}! Intră pe ${location.origin} și joacă cu noi.\nNume: ${c.name}\nParolă: ${c.password}`;
}

async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    toast('Copiat. Acum îl poți lipi în mesaj.');
  } catch {
    toast('Nu am putut copia automat. Selectează textul și copiază-l.', 'error');
  }
}

function playersPanel() {
  const name = el('input', { placeholder: 'ex. Andrei', maxlength: 20, autocomplete: 'off' });
  const pass = el('input', { value: genPassword(), autocomplete: 'off' });
  const create = async () => {
    try {
      const { user } = await api('/api/users', { name: name.value, password: pass.value });
      S.created = { name: user.name, password: pass.value, isNew: true };
      await loadUsers();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const resetPass = async (u) => {
    const pw = prompt(`Parola nouă pentru ${u.name}:`, genPassword());
    if (!pw) return;
    try {
      await api(`/api/users/${u.id}/password`, { password: pw }, 'PUT');
      S.created = { name: u.name, password: pw, isNew: false };
      renderAdmin();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async (u) => {
    if (!confirm(`Ștergi contul lui ${u.name}? Se șterg și punctele lui din clasament.`)) return;
    try {
      await api(`/api/users/${u.id}`, null, 'DELETE');
      toast(`Contul lui ${u.name} a fost șters.`);
      await loadUsers();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const c = S.created;
  return el('div', { class: 'panel' },
    el('div', { class: 'panel-head' }, el('h2', {}, 'Jucători'), el('span', { class: 'muted small' }, `${S.users.length} conturi`)),
    el('div', { class: 'new-user' },
      el('label', {}, 'Nume', name),
      el('label', {}, 'Parolă',
        el('div', { class: 'input-row' }, pass, el('button', { class: 'btn small soft', type: 'button', onclick: () => { pass.value = genPassword(); } }, 'Alta'))),
      el('button', { class: 'btn primary', onclick: create }, 'Creează contul')),
    c ? el('div', { class: 'cred' },
      el('p', { class: 'eyebrow' }, c.isNew ? `Contul lui ${c.name} e gata. Trimite-i asta în privat:` : `Parola lui ${c.name} a fost schimbată. Trimite-i-o în privat:`),
      el('pre', {}, credentialsText(c)),
      el('div', { class: 'row' },
        el('button', { class: 'btn small primary', onclick: () => copyText(credentialsText(c)) }, 'Copiază mesajul'),
        el('button', { class: 'btn small ghost', onclick: () => { S.created = null; renderAdmin(); } }, 'Închide'))) : null,
    el('div', { class: 'user-list' }, S.users.map((u) => el('div', { class: 'player' },
      el('div', { class: 'player-name' },
        el('span', { class: 'avatar' }, u.name.slice(0, 1).toLocaleUpperCase('ro-RO')),
        el('span', {}, u.name),
        u.isAdmin ? el('span', { class: 'tag' }, 'admin') : null,
        u.online ? el('span', { class: 'tag on' }, 'online') : null),
      u.id === S.me.id ? el('span', { class: 'muted small' }, 'tu') : el('div', { class: 'player-actions' },
        el('button', { class: 'btn small soft', onclick: () => resetPass(u) }, 'Parolă nouă'),
        el('button', { class: 'btn small ghost danger', onclick: () => remove(u) }, 'Șterge'))))),
    el('p', { class: 'muted small rules' }, 'Prietenii nu își pot face singuri cont. Fiecare își poate schimba parola apăsând pe numele lui, sus.'));
}

function renderAdmin() {
  if (S.editor) return renderEditor();
  const box = $('#view-admin');
  box.replaceChildren(playersPanel(), el('div', { class: 'panel' },
    el('div', { class: 'panel-head' },
      el('h2', {}, 'Quizuri'),
      el('button', { class: 'btn primary small', onclick: () => { S.editor = { id: null, title: '', level: 5, seconds: 20, text: '' }; renderAdmin(); } }, 'Quiz nou')),
    el('div', { class: 'quiz-list' }, S.quizzes.map((z) => el('div', { class: 'quiz-row static' },
      el('span', { class: 'qr-level' }, levelTag(z.level)),
      el('span', { class: 'qr-title' }, z.title, z.custom ? null : el('span', { class: 'tag' }, 'inclus')),
      el('span', { class: 'qr-meta muted small' }, `${z.count} întrebări · ${z.seconds} s`),
      el('span', { class: 'qr-actions' },
        z.custom
          ? [el('button', { class: 'btn small soft', onclick: () => openEditor(z.id, false) }, 'Editează'),
            el('button', { class: 'btn small ghost danger', onclick: () => deleteQuiz(z) }, 'Șterge')]
          : el('button', { class: 'btn small soft', onclick: () => openEditor(z.id, true) }, 'Copiază'))))),
    el('p', { class: 'muted small rules' }, 'Quizurile incluse nu se pot modifica de aici, dar le poți copia ca punct de plecare.')));
}

async function openEditor(id, asCopy) {
  try {
    const { quiz } = await api('/api/quizzes/' + encodeURIComponent(id));
    S.editor = {
      id: asCopy ? null : id,
      title: asCopy ? quiz.title + ' (copie)' : quiz.title,
      level: quiz.level,
      seconds: quiz.seconds,
      text: quizToText(quiz.questions)
    };
    renderAdmin();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteQuiz(z) {
  if (!confirm(`Ștergi quizul „${z.title}”?`)) return;
  try {
    await api('/api/quizzes/' + encodeURIComponent(z.id), null, 'DELETE');
    toast('Quiz șters.');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderEditor() {
  const ed = S.editor;
  const box = $('#view-admin');
  const levelSel = el('select', { id: 'edLevel', onchange: (e) => { ed.level = Number(e.target.value); } },
    TIERS.map((t, i) => el('option', { value: i + 1, selected: ed.level === i + 1 }, `${i + 1} · ${t}`)));
  const secSel = el('select', { id: 'edSec', onchange: (e) => { ed.seconds = Number(e.target.value); } },
    [10, 15, 20, 25, 30, 45, 60].map((s) => el('option', { value: s, selected: ed.seconds === s }, `${s} secunde`)));
  const title = el('input', { id: 'edTitle', value: ed.title, maxlength: 60, placeholder: 'ex. Istoria României', oninput: (e) => { ed.title = e.target.value; } });
  const report = el('div', { class: 'parse-report' });
  const area = el('textarea', { id: 'edText', rows: 16, spellcheck: 'false', placeholder: EXAMPLE, oninput: (e) => { ed.text = e.target.value; check(); } });
  area.value = ed.text;

  function check() {
    const { questions, errors } = parseQuizText(ed.text);
    report.replaceChildren(...[
      el('p', { class: questions.length && !errors.length ? 'ok' : 'muted' }, `${questions.length} ${questions.length === 1 ? 'întrebare validă' : 'întrebări valide'}`),
      ...errors.slice(0, 5).map((x) => el('p', { class: 'error' }, x)),
      errors.length > 5 ? el('p', { class: 'error' }, `…și încă ${errors.length - 5} probleme.`) : null
    ].filter(Boolean));
    return { questions, errors };
  }

  async function save() {
    const { questions, errors } = check();
    if (errors.length) return toast('Corectează întâi întrebările marcate cu roșu.', 'error');
    if (!questions.length) return toast('Adaugă cel puțin o întrebare.', 'error');
    const body = { title: ed.title, level: ed.level, seconds: ed.seconds, questions };
    try {
      if (ed.id) await api('/api/quizzes/' + encodeURIComponent(ed.id), body, 'PUT');
      else await api('/api/quizzes', body);
      toast('Quiz salvat.');
      S.editor = null;
      await loadQuizzes();
      renderAdmin();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  box.replaceChildren(el('div', { class: 'panel editor' },
    el('div', { class: 'panel-head' }, el('h2', {}, ed.id ? 'Editează quizul' : 'Quiz nou')),
    el('div', { class: 'form-grid' },
      el('label', { class: 'span2' }, 'Titlu', title),
      el('label', {}, 'Dificultate', levelSel),
      el('label', {}, 'Timp pe întrebare', secSel)),
    el('label', {}, 'Întrebări', area),
    el('div', { class: 'help muted small' },
      el('p', {}, 'Scrie fiecare întrebare pe un rând, apoi răspunsurile dedesubt, câte unul pe rând (2–4). Pune * în fața răspunsului corect. Lasă un rând liber între întrebări. Ordinea răspunsurilor se amestecă automat în joc.')),
    report,
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: save }, 'Salvează quizul'),
      el('button', { class: 'btn ghost', onclick: () => { S.editor = null; renderAdmin(); } }, 'Renunță'))));
  check();
}

// ---------- Clasament ----------
async function loadBoard() {
  try {
    renderBoard(await api('/api/leaderboard'));
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderBoard(d) {
  $('#weekRange').textContent = weekRange(d.weekKey);
  const table = $('#boardTable');
  if (!d.rows.length) {
    table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'muted empty' }, 'Încă nu s-a jucat nimic săptămâna asta.'))));
  } else {
    table.replaceChildren(
      el('thead', {}, el('tr', {},
        el('th', {}, ''), el('th', {}, 'Jucător'), el('th', { class: 'num' }, 'Puncte'),
        el('th', { class: 'num', title: 'Victorii / remize / înfrângeri' }, 'V–R–Î'),
        ['ttt', 'tttq', 'c4', 'hangman', 'quiz'].map((g) => el('th', { class: 'num' }, GAME_LABEL[g])))),
      el('tbody', {}, d.rows.map((r, i) => el('tr', { class: r.name === S.me.name ? 'me' : '' },
        el('td', { class: 'pos' }, i < 3 ? el('span', { class: 'medal m' + i }, i + 1) : i + 1),
        el('td', { class: 'who' }, r.name),
        el('td', { class: 'num pts' }, r.points),
        el('td', { class: 'num muted' }, `${r.wins}–${r.draws}–${r.losses}`),
        ['ttt', 'tttq', 'c4', 'hangman', 'quiz'].map((g) => el('td', { class: 'num muted' }, r[g])))))
    );
  }
  $('#history').replaceChildren(...(d.history.length
    ? d.history.map((w) => el('li', {}, el('span', { class: 'muted' }, weekRange(w.weekKey)), el('span', { class: 'who' }, w.name), el('b', {}, `${w.points} p`)))
    : [el('li', { class: 'muted' }, 'Câștigătorii apar aici după prima săptămână.')]));
}

// ---------- Pornire ----------
(async function init() {
  try {
    S.config = await api('/api/config');
    S.inviteRequired = S.config.inviteRequired;
  } catch { /* nimic */ }
  if (S.token) {
    try {
      S.me = (await api('/api/me')).user;
      return startApp();
    } catch {
      localStorage.removeItem('arena_token');
      S.token = null;
    }
  }
  showAuth();
})();
