'use strict';

// ============ Utilitare ============
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

const GAMES = {
  ttt: { name: 'X și 0', emoji: '❌', color: '#FF6B5B', desc: 'Clasicul de la ore', mode: 'duel' },
  tttq: { name: 'X și 0 Quiz', emoji: '🧠', color: '#7C5CFF', desc: 'Răspunzi corect, pui semnul', mode: 'duel' },
  c4: { name: '4 în linie', emoji: '🔴', color: '#FFB800', desc: 'Aliniază patru piese', mode: 'duel' },
  hangman: { name: 'Spânzurătoarea', emoji: '🔤', color: '#16B97A', desc: 'Ghiciți cuvântul pe rând', mode: 'duel' },
  battleship: { name: 'Bătălia navală', emoji: '🚢', color: '#2D9CFF', desc: 'Scufundă-i flota', mode: 'duel' },
  quiz: { name: 'Quiz', emoji: '🎯', color: '#FF8A3D', desc: '10 niveluri, toți odată', mode: 'group' },
  funny: { name: 'Cel mai amuzant', emoji: '😂', color: '#FF4FA0', desc: '3–10 jucători', mode: 'group' },
  funny18: { name: 'Cel mai amuzant 18+', emoji: '🌶️', color: '#E0245E', desc: 'Doar pentru adulți', mode: 'group' }
};
const BOARD_GAMES = ['ttt', 'tttq', 'c4', 'hangman', 'battleship', 'quiz', 'funny'];
const TIERS = ['Ușor', 'Ușor', 'Mediu', 'Mediu', 'Dificil', 'Dificil', 'Greu', 'Greu', 'Foarte greu', 'Foarte greu'];

const S = {
  token: localStorage.getItem('arena_token'),
  me: null,
  config: {},
  socket: null,
  players: {},
  lobby: [],
  match: null,
  quiz: null,
  party: null,
  quizzes: [],
  tab: 'play',
  outgoing: new Map(),
  incoming: [],
  dismissedQuiz: null,
  dismissedParty: null,
  myAnswers: {},
  partyDraft: '',
  partyDraftKey: '',
  confettiKey: '',
  vote: null,
  board: null,
  openRow: null,
  users: [],
  created: null,
  editor: null,
  lastView: null
};

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
  setTimeout(() => t.classList.add('out'), 3600);
  setTimeout(() => t.remove(), 4100);
}

function confetti(amount = 90) {
  const box = $('#confetti');
  const colors = ['#FF5FA2', '#FFC93C', '#2ED3A0', '#3DB2FF', '#7C5CFF', '#FF6B5B'];
  for (let i = 0; i < amount; i++) {
    const p = el('i', {
      style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};` +
        `animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * 0.4}s;` +
        `--x:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720}deg;` +
        `width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 10}px`
    });
    box.append(p);
    setTimeout(() => p.remove(), 3800);
  }
}

const fmtDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', timeZone: 'UTC' });
function weekRange(key) {
  const end = new Date(key + 'T00:00:00Z');
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmtDay(key)} – ${fmtDay(end.toISOString().slice(0, 10))}`;
}

const nameOf = (id) => S.players[id]?.name ?? '?';
const mascotCfgOf = (id) => S.players[id]?.mascot || (S.me && id === S.me.id ? S.me.mascot : null) || Mascot.fallback(id);
function mascot(id, size = 'md', extra = '') {
  const s = el('span', { class: `mascot ${size} ${extra}` });
  s.innerHTML = Mascot.svg(mascotCfgOf(id));
  return s;
}
function mascotFromCfg(cfg, size = 'md', extra = '') {
  const s = el('span', { class: `mascot ${size} ${extra}` });
  s.innerHTML = Mascot.svg(cfg);
  return s;
}

// Bare de timp: un singur cronometru global actualizează toate elementele cu data-end.
function timerBar(end, dur) {
  return el('div', { class: 'timer' }, el('span', { class: 'bar', 'data-end': end, 'data-dur': dur }));
}
const secs = (end) => el('span', { class: 'secs', 'data-secs': end }, Math.ceil(Math.max(0, end - Date.now()) / 1000));
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll('[data-end]').forEach((b) => {
    const left = Math.max(0, Number(b.dataset.end) - now);
    b.style.width = (100 * left / Number(b.dataset.dur)) + '%';
    b.classList.toggle('low', left < 5000);
  });
  document.querySelectorAll('[data-secs]').forEach((s) => {
    const left = Math.max(0, Number(s.dataset.secs) - now);
    s.textContent = Math.ceil(left / 1000);
    s.classList.toggle('low', left < 5000);
  });
}, 100);

function meter(level) {
  const bars = [];
  for (let i = 1; i <= 10; i++) bars.push(el('i', { class: i <= level ? 'on' : '' }));
  return el('span', { class: 'meter t' + Math.ceil(level / 2), 'aria-label': `Nivel ${level} din 10` }, bars);
}
const levelTag = (level) => el('span', { class: 'level t' + Math.ceil(level / 2) }, meter(level), el('span', {}, `${level} · ${TIERS[level - 1]}`));

// ============ Foi de jos și ferestre ============
function openSheet(...nodes) {
  $('#sheetBox').replaceChildren(el('div', { class: 'sheet-handle' }), ...nodes);
  $('#sheet').classList.remove('hidden');
}
function closeSheet() { $('#sheet').classList.add('hidden'); }
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

function openModal(...nodes) {
  $('#modalBox').replaceChildren(...nodes);
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

function confirm18(onYes) {
  openModal(
    el('div', { class: 'modal-emoji' }, '🌶️'),
    el('h2', {}, 'Doar pentru adulți'),
    el('p', { class: 'muted' }, 'Întrebările sunt vulgare și cu umor pentru adulți. Intri doar dacă ai peste 18 ani.'),
    el('div', { class: 'stack' },
      el('button', { class: 'btn danger-fill big', onclick: () => { closeModal(); onYes(); } }, 'Am peste 18 ani'),
      el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunț')));
}

// ============ Autentificare ============
function showScreen(id) {
  for (const s of ['auth', 'builder', 'app']) $('#' + s).classList.toggle('hidden', s !== id);
}

function showAuth() {
  showScreen('auth');
  const row = $('#authMascots');
  row.replaceChildren(...[0, 1, 2, 3, 4].map((i) => mascotFromCfg(Mascot.random(), 'md', 'bob d' + i)));
  const cfg = S.config;
  $('#codeWrap').classList.toggle('hidden', !cfg.inviteRequired);
  $('#registerBtn').classList.toggle('hidden', !cfg.signupOpen);
  if (cfg.firstAccount) {
    $('#loginBtn').classList.add('hidden');
    $('#registerBtn').classList.add('primary');
    $('#registerBtn').textContent = 'Creează contul de administrator';
    $('#authNote').textContent = 'Primul cont creat devine administrator. Apoi faci conturi pentru prieteni.';
  } else if (!cfg.signupOpen) {
    $('#authNote').textContent = 'Numele și parola le primești de la administrator.';
  }
}

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = e.submitter?.dataset.mode || (S.config.firstAccount ? 'register' : 'login');
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
    afterLogin();
  } catch (err) {
    $('#authError').textContent = err.message;
    $('#authForm').classList.remove('shake');
    void $('#authForm').offsetWidth;
    $('#authForm').classList.add('shake');
  }
});

function afterLogin() {
  if (!S.me.mascot) showBuilder(true);
  else startApp();
}

async function logout() {
  try { await api('/api/logout', {}); } catch { /* nimic */ }
  localStorage.removeItem('arena_token');
  location.reload();
}

// ============ Constructorul de mascote ============
function showBuilder(first) {
  showScreen('builder');
  let cfg = { ...(S.me.mascot || Mascot.random()) };
  let cat = 'b';
  const CATS = [['b', 'Formă'], ['c', 'Culoare'], ['e', 'Ochi'], ['m', 'Gură'], ['a', 'Accesoriu']];
  const box = $('#builder');

  function draw(wiggle) {
    const preview = mascotFromCfg(cfg, 'xl', 'bob' + (wiggle ? ' wiggle' : ''));
    const options = [];
    for (let i = 0; i < Mascot.COUNTS[cat]; i++) {
      const sel = cfg[cat] === i;
      const pick = () => { cfg = { ...cfg, [cat]: i }; draw(true); };
      if (cat === 'c') {
        options.push(el('button', { class: 'swatch' + (sel ? ' sel' : ''), style: `--sw:${Mascot.COLORS[i]}`, 'aria-label': `Culoarea ${i + 1}`, onclick: pick }));
      } else {
        options.push(el('button', { class: 'opt-tile' + (sel ? ' sel' : ''), onclick: pick, title: Mascot.NAMES[cat][i] },
          mascotFromCfg({ ...cfg, [cat]: i }, 'sm'), el('span', {}, Mascot.NAMES[cat][i])));
      }
    }
    box.replaceChildren(el('div', { class: 'builder' },
      el('p', { class: 'eyebrow center' }, first ? `Salut, ${S.me.name}! 👋` : 'Mascota ta'),
      el('h1', { class: 'center' }, first ? 'Construiește-ți mascota' : 'Schimbă mascota'),
      el('div', { class: 'preview' }, preview),
      el('div', { class: 'cat-tabs' }, CATS.map(([k, label]) => el('button', { class: 'chip-tab' + (cat === k ? ' active' : ''), onclick: () => { cat = k; draw(); } }, label))),
      el('div', { class: cat === 'c' ? 'swatches' : 'opt-grid' }, options),
      el('div', { class: 'builder-actions' },
        el('button', { class: 'btn big', onclick: () => { cfg = Mascot.random(); draw(true); } }, '🎲 Aleatoriu'),
        el('button', { class: 'btn primary big', onclick: save }, first ? 'Gata, intru!' : 'Salvează')),
      first ? null : el('button', { class: 'btn ghost', onclick: () => { showScreen('app'); render(); } }, 'Renunță')));
  }

  async function save() {
    try {
      const { mascot: saved } = await api('/api/me/mascot', { mascot: cfg });
      S.me.mascot = saved;
      if (S.players[S.me.id]) S.players[S.me.id].mascot = saved;
      confetti(60);
      if (first) startApp();
      else { showScreen('app'); render(); toast('Mascota a fost salvată!'); }
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  draw();
}

// ============ Pornirea aplicației ============
async function loadPlayers() {
  try {
    const { players } = await api('/api/players');
    S.players = Object.fromEntries(players.map((p) => [p.id, p]));
  } catch { /* nimic */ }
}

async function loadQuizzes() {
  try { S.quizzes = (await api('/api/quizzes')).quizzes; } catch { /* nimic */ }
}

async function startApp() {
  showScreen('app');
  await Promise.all([loadPlayers(), loadQuizzes()]);
  updateNavMascot();

  const s = io({ auth: { token: S.token } });
  S.socket = s;
  s.on('connect', () => $('#conn').classList.add('hidden'));
  s.on('disconnect', () => $('#conn').classList.remove('hidden'));
  s.on('connect_error', (e) => {
    if (e.message === 'unauthorized') { localStorage.removeItem('arena_token'); location.reload(); }
  });
  s.on('lobby', (list) => { S.lobby = list; refresh('play'); });
  s.on('match', (m) => {
    const isNew = !S.match || S.match.id !== m.id;
    const wasOver = S.match && S.match.id === m.id && S.match.over;
    S.match = m;
    S.outgoing.clear();
    S.incoming = [];
    closeModal();
    closeSheet();
    if (m.over && !wasOver && m.over.winner !== undefined && m.players[m.over.winner].id === S.me.id) confetti();
    render(isNew);
  });
  s.on('matchClosed', () => { S.match = null; render(); });
  s.on('quiz', (q) => {
    S.quiz = q;
    if (q && q.phase === 'question') S.quizEnd = Date.now() + q.remainingMs;
    refresh('quiz', 'play');
  });
  s.on('party', (p) => {
    const prev = S.party;
    S.party = p;
    if (p && p.remainingMs !== undefined) S.partyEnd = Date.now() + p.remainingMs;
    if (p && p.phase === 'result' && myParty()) {
      const key = p.id + ':' + p.index;
      if (S.confettiKey !== key && p.results.some((r) => r.winner && r.authorId === S.me.id)) { S.confettiKey = key; confetti(); }
    }
    if (p && p.phase === 'finished' && prev && prev.phase !== 'finished' && myParty() && p.ranking[0]?.id === S.me.id) confetti(140);
    refresh('party', 'play');
  });
  s.on('quizInvite', ({ from, title }) => { if (!S.match) toast(`🎯 ${from} a pornit quizul „${title}”!`); });
  s.on('partyInvite', ({ from, adult }) => { if (!S.match) toast(`${adult ? '🌶️' : '😂'} ${from} te cheamă la „Cel mai amuzant${adult ? ' 18+' : ''}”!`); });
  s.on('quizzesChanged', async () => { await loadQuizzes(); refresh('play'); });
  s.on('playersChanged', async () => { await loadPlayers(); updateNavMascot(); refresh('play', 'vote', 'board', 'me'); });
  s.on('challenged', (c) => { S.incoming.push(c); showIncoming(); });
  s.on('challengeSent', (c) => { S.outgoing.set(c.id, c); refresh('play'); });
  s.on('challengeGone', ({ id, reason, by }) => {
    if (S.outgoing.delete(id)) {
      refresh('play');
      if (reason === 'declined') toast(`${by} a refuzat provocarea. 😢`);
      if (reason === 'expired') toast('Provocarea a expirat.');
    }
    const before = S.incoming.length;
    S.incoming = S.incoming.filter((c) => c.id !== id);
    if (S.incoming.length !== before) showIncoming();
  });
  s.on('errorMsg', (m) => toast(m, 'error'));
  s.on('leaderboardChanged', () => { if (currentView() === 'board') loadBoard(); });
  s.on('boardReset', () => toast('🧹 Clasamentul săptămânii a fost resetat.'));
  s.on('voteCount', ({ voters }) => { if (S.vote) { S.vote.voters = voters; refresh('vote'); } });

  document.querySelectorAll('#nav .nav-btn').forEach((b) => b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    S.editor = null;
    if (S.tab === 'board') loadBoard();
    if (S.tab === 'vote') loadVote();
    if (S.tab === 'me' && S.me.isAdmin) loadUsers();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
  render();
  checkAward();
}

function updateNavMascot() {
  const n = $('#navMe');
  n.replaceChildren(mascot(S.me.id, 'xs'));
}

async function checkAward() {
  try {
    const { award } = await api('/api/award');
    if (!award) return;
    const names = award.winners.map((w) => w.name).join(' și ');
    const iWon = award.winners.some((w) => w.id === S.me.id);
    openModal(
      el('p', { class: 'eyebrow center' }, `Săptămâna ${weekRange(award.weekKey)}`),
      el('h2', { class: 'center' }, '🏆 Jucătorul săptămânii'),
      el('div', { class: 'award-row' }, award.winners.map((w) => el('div', { class: 'award-who' },
        el('div', { class: 'crown-wrap' }, el('span', { class: 'crown' }, '👑'), mascot(w.id, 'xl', 'bob')),
        el('b', {}, w.name),
        el('span', { class: 'muted small' }, `${w.votes} ${w.votes === 1 ? 'vot' : 'voturi'}`)))),
      el('p', { class: 'center' }, iWon ? 'Ești TU! Gașca te-a votat. 🥳' : `Felicitări, ${names}!`),
      el('button', { class: 'btn primary big', onclick: async () => {
        closeModal();
        try { await api('/api/award/seen', { weekKey: award.weekKey }); } catch { /* nimic */ }
      } }, 'Bravo! 🎉'));
    setTimeout(() => confetti(150), 250);
  } catch { /* nimic */ }
}

// ============ Randare ============
function myQuiz() {
  const q = S.quiz;
  return q && q.players.some((p) => p.id === S.me.id) && S.dismissedQuiz !== q.id ? q : null;
}
function myParty() {
  const p = S.party;
  return p && p.players.some((x) => x.id === S.me.id) && S.dismissedParty !== p.id ? p : null;
}
function currentView() {
  if (S.match) return 'match';
  if (myQuiz()) return 'quiz';
  if (myParty()) return 'party';
  return S.tab;
}

// Re-randează doar dacă ecranul curent e afectat (ca să nu pierzi ce scrii).
function refresh(...views) {
  const v = currentView();
  if (v !== S.lastView || views.includes(v)) render();
}

function render(fresh) {
  const view = currentView();
  const main = $('#main');
  // păstrăm valorile din câmpurile marcate cu data-keep și focusul
  const kept = {};
  main.querySelectorAll('[data-keep]').forEach((i) => { kept[i.id] = i.value; });
  const active = document.activeElement && main.contains(document.activeElement) ? document.activeElement.id : null;
  const caret = active ? document.activeElement.selectionStart : null;

  $('#nav').classList.toggle('hidden', ['match', 'quiz', 'party'].includes(view));
  document.querySelectorAll('#nav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
  const builders = { play: renderPlay, vote: renderVote, board: renderBoard, me: renderMe, match: renderMatch, quiz: renderQuiz, party: renderParty };
  const node = builders[view](fresh);
  const wrap = el('div', { class: 'view' + (view !== S.lastView ? ' enter' : '') }, node);
  main.replaceChildren(wrap);
  S.lastView = view;

  for (const [id, val] of Object.entries(kept)) {
    const i = document.getElementById(id);
    if (i && i.dataset.keep !== undefined) i.value = val;
  }
  if (active) {
    const a = document.getElementById(active);
    if (a) {
      a.focus();
      if (caret !== null && a.setSelectionRange) try { a.setSelectionRange(caret, caret); } catch { /* nimic */ }
    }
  }
}

// ============ Joacă ============
function renderPlay() {
  const others = S.lobby.filter((p) => p.id !== S.me.id);
  const free = others.filter((p) => !p.busy);
  const q = S.quiz;
  const p = S.party;

  const banners = [];
  if (p && p.phase === 'lobby' && !myParty()) {
    const host = p.players.find((x) => x.id === p.hostId);
    banners.push(el('button', { class: 'banner-card pink' + (p.adult ? ' spicy' : ''), onclick: () => {
      const join = () => { S.dismissedParty = null; S.socket.emit('partyJoin', { confirm18: true }); };
      if (p.adult) confirm18(join); else join();
    } },
    el('span', { class: 'bc-emoji' }, p.adult ? '🌶️' : '😂'),
    el('span', { class: 'bc-text' }, el('b', {}, `Cel mai amuzant${p.adult ? ' 18+' : ''}`), el('span', {}, `${host ? host.name : 'Cineva'} te așteaptă · ${p.players.length}/10`)),
    el('span', { class: 'bc-go' }, 'Intră')));
  } else if (p && p.phase !== 'finished' && !myParty()) {
    banners.push(el('div', { class: 'banner-card muted-card' }, el('span', { class: 'bc-emoji' }, p.adult ? '🌶️' : '😂'),
      el('span', { class: 'bc-text' }, el('b', {}, 'Cel mai amuzant e în desfășurare'), el('span', {}, `Întrebarea ${p.index + 1} din ${p.total}`))));
  }
  if (q && q.phase === 'lobby' && !myQuiz()) {
    const host = q.players.find((x) => x.id === q.hostId);
    banners.push(el('button', { class: 'banner-card orange', onclick: () => { S.dismissedQuiz = null; S.socket.emit('quizJoin'); } },
      el('span', { class: 'bc-emoji' }, '🎯'),
      el('span', { class: 'bc-text' }, el('b', {}, q.title), el('span', {}, `${host ? host.name : 'Cineva'} te așteaptă la quiz`)),
      el('span', { class: 'bc-go' }, 'Intră')));
  } else if (q && q.phase !== 'finished' && !myQuiz()) {
    banners.push(el('div', { class: 'banner-card muted-card' }, el('span', { class: 'bc-emoji' }, '🎯'),
      el('span', { class: 'bc-text' }, el('b', {}, `Quiz în desfășurare: ${q.title}`), el('span', {}, `Întrebarea ${q.index + 1} din ${q.total}`))));
  }

  const gameCard = (id, i) => {
    const g = GAMES[id];
    return el('button', { class: 'game-card', style: `--gc:${g.color};--i:${i}`, onclick: () => pickGame(id) },
      el('span', { class: 'gc-emoji' }, g.emoji),
      el('span', { class: 'gc-name' }, g.name),
      el('span', { class: 'gc-desc' }, g.desc));
  };

  return el('div', { class: 'page' },
    el('header', { class: 'hello' },
      mascot(S.me.id, 'lg', 'bob'),
      el('div', {},
        el('p', { class: 'eyebrow' }, others.length ? `${others.length} ${others.length === 1 ? 'prieten online' : 'prieteni online'}` : 'Niciun prieten online'),
        el('h1', {}, `Salut, ${S.me.name}!`))),
    banners,
    S.outgoing.size ? el('div', { class: 'card waiting' }, [...S.outgoing.values()].map((c) => el('div', { class: 'wait-row' },
      mascot(c.to.id, 'sm', 'bob'),
      el('span', { class: 'grow' }, `Aștepți răspunsul lui ${c.to.name}… `, el('span', { class: 'muted' }, c.gameName)),
      el('button', { class: 'btn small ghost', onclick: () => S.socket.emit('cancelChallenge', { id: c.id }) }, 'Anulează')))) : null,
    el('section', {},
      el('h2', { class: 'section-title' }, 'Online acum'),
      others.length
        ? el('div', { class: 'friends' }, others.map((f) => el('div', { class: 'friend' + (f.busy ? ' busy' : '') },
          el('span', { class: 'friend-m' }, mascot(f.id, 'md', 'bob'), el('i', { class: 'dot' })),
          el('span', { class: 'friend-n' }, f.name),
          f.busy ? el('span', { class: 'friend-s' }, 'joacă') : null)))
        : el('p', { class: 'muted empty-note' }, 'Trimite-le linkul ca să intre și ei. 😉')),
    el('section', {},
      el('h2', { class: 'section-title' }, '1 la 1'),
      el('div', { class: 'game-grid' }, ['ttt', 'tttq', 'c4', 'hangman', 'battleship'].map(gameCard))),
    el('section', {},
      el('h2', { class: 'section-title' }, 'Cu toată gașca'),
      el('div', { class: 'game-grid' }, ['quiz', 'funny', 'funny18'].map((id, i) => gameCard(id, i + 5)))),
    free.length === 0 && others.length ? el('p', { class: 'muted small center' }, 'Toți prietenii online sunt într-un joc acum.') : null);
}

function pickGame(id) {
  const g = GAMES[id];
  if (g.mode === 'duel') {
    const free = S.lobby.filter((p) => p.id !== S.me.id && !p.busy);
    openSheet(
      el('div', { class: 'sheet-head' }, el('span', { class: 'sheet-emoji' }, g.emoji), el('div', {}, el('h2', {}, g.name), el('p', { class: 'muted small' }, 'Pe cine provoci?'))),
      free.length
        ? el('div', { class: 'pick-list' }, free.map((f) => el('button', { class: 'pick', onclick: () => { S.socket.emit('challenge', { to: f.id, game: id }); closeSheet(); } },
          mascot(f.id, 'md'), el('span', { class: 'grow' }, f.name), el('span', { class: 'pick-go' }, 'Provoacă ⚔️'))))
        : el('p', { class: 'muted empty-note' }, 'Niciun prieten liber acum. Încearcă puțin mai târziu.'));
    return;
  }
  if (id === 'quiz') {
    openSheet(
      el('div', { class: 'sheet-head' }, el('span', { class: 'sheet-emoji' }, '🎯'), el('div', {}, el('h2', {}, 'Alege quizul'), el('p', { class: 'muted small' }, 'Toți cei online primesc invitația'))),
      el('div', { class: 'pick-list' }, S.quizzes.map((z) => el('button', { class: 'pick quiz-pick', onclick: () => { S.socket.emit('quizCreate', { quizId: z.id }); closeSheet(); } },
        el('span', { class: 'grow' }, el('b', {}, z.title), el('span', { class: 'muted small block' }, `${z.count} întrebări · ${z.seconds} s`)),
        levelTag(z.level)))));
    return;
  }
  if (id === 'funny') return S.socket.emit('partyCreate', { adult: false });
  if (id === 'funny18') return confirm18(() => S.socket.emit('partyCreate', { adult: true, confirm18: true }));
}

function showIncoming() {
  const c = S.incoming[0];
  if (!c) return closeModal();
  const g = GAMES[c.game] || {};
  openModal(
    el('div', { class: 'versus-big' }, mascot(c.from.id, 'lg', 'bob'), el('span', { class: 'vs-badge' }, 'VS'), mascot(S.me.id, 'lg', 'bob d2')),
    el('h2', { class: 'center' }, `${c.from.name} te provoacă!`),
    el('p', { class: 'center muted' }, `${g.emoji || ''} ${c.gameName} · ai 30 de secunde`),
    el('div', { class: 'stack' },
      el('button', { class: 'btn primary big', onclick: () => S.socket.emit('challengeReply', { id: c.id, accept: true }) }, 'Accept ⚔️'),
      el('button', { class: 'btn ghost', onclick: () => {
        S.socket.emit('challengeReply', { id: c.id, accept: false });
        S.incoming.shift();
        showIncoming();
      } }, 'Nu acum')));
}

// ============ Meci 1 la 1 ============
function chip(m, i) {
  const p = m.players[i];
  const isTurn = !m.over && m.turn === i && !(m.game === 'battleship' && m.state.phase === 'setup');
  let mark = null;
  if (m.game === 'ttt' || m.game === 'tttq') mark = el('span', { class: 'mark m' + i }, i === 0 ? 'X' : 'O');
  else if (m.game === 'c4') mark = el('span', { class: 'disc p' + i });
  else if (m.game === 'hangman') mark = el('span', { class: 'score-pill' }, m.state.scores[i]);
  else if (m.game === 'battleship') mark = el('span', { class: 'score-pill' }, `${(i === m.players.findIndex((x) => x.id === S.me.id) ? m.state.myLeft : m.state.enemyLeft).length}🚢`);
  return el('div', { class: 'player-chip' + (isTurn ? ' turn' : '') + (m.away.includes(p.id) ? ' away' : '') },
    mascot(p.id, 'sm', isTurn ? 'bob' : ''),
    el('span', { class: 'pc-name' }, p.id === S.me.id ? 'Tu' : p.name),
    mark);
}

function statusText(m, me, opp) {
  const reasons = { resign: ` ${opp.name} a abandonat.`, abandon: ` ${opp.name} s-a deconectat.` };
  if (m.over) {
    if (m.over.draw) return ['Remiză! Câte 1 punct. 🤝', 'draw'];
    if (m.over.winner === me) return [`Ai câștigat! +3 puncte 🎉${reasons[m.over.reason] || ''}`, 'win'];
    return [m.over.reason === 'normal' ? `A câștigat ${opp.name}. Revanșă? 😤` : 'Ai abandonat meciul.', 'loss'];
  }
  if (m.away.includes(opp.id)) return [`${opp.name} s-a deconectat. Are 30 de secunde să revină.`, 'wait'];
  const st = m.state;
  if (m.game === 'battleship' && st.phase === 'setup') {
    if (st.ready[me]) return [st.ready[1 - me] ? 'Începe lupta!' : `Aștepți ca ${opp.name} să-și așeze flota…`, 'wait'];
    return ['Așază-ți flota și apasă Gata', 'mine'];
  }
  if (m.game === 'tttq' && st.pending) {
    return st.pending.by === me ? ['Răspunde corect ca să-ți pui semnul!', 'mine'] : [`${opp.name} răspunde la întrebare…`, 'wait'];
  }
  if (m.turn === me) {
    if (m.game === 'tttq') return ['Alege o căsuță', 'mine'];
    if (m.game === 'battleship' && st.last && st.last.by === me && st.last.hit) return [st.last.sunk ? 'Ai scufundat o navă! Mai trage! 💥' : 'Lovit! Mai trage o dată! 🎯', 'mine'];
    if (m.game === 'battleship') return ['Rândul tău: alege ținta', 'mine'];
    if (m.game === 'hangman' && st.last && st.last.by === me && st.last.hits) return ['Bravo! Mai alegi o literă.', 'mine'];
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
  const g = GAMES[m.game] || {};
  const board = { ttt: tttBoard, tttq: tttqBoard, c4: c4Board, hangman: hangBoard, battleship: bsBoard }[m.game](m, myTurn, fresh);

  let actions;
  if (!m.over) {
    actions = [el('button', { class: 'btn ghost small', onclick: () => {
      openModal(el('h2', {}, 'Abandonezi?'), el('p', { class: 'muted' }, `${opp.name} primește victoria.`),
        el('div', { class: 'stack' }, el('button', { class: 'btn danger-fill big', onclick: () => { closeModal(); S.socket.emit('resign'); } }, 'Da, abandonez'),
          el('button', { class: 'btn ghost', onclick: closeModal }, 'Joc mai departe')));
    } }, '🏳️ Abandonează')];
  } else {
    const iWant = m.rematch.includes(S.me.id);
    const theyWant = m.rematch.includes(opp.id);
    actions = [
      m.left.length
        ? el('p', { class: 'muted' }, `${opp.name} a ieșit din meci.`)
        : el('button', { class: 'btn primary big' + (theyWant && !iWant ? ' pulse' : ''), disabled: iWant, onclick: () => S.socket.emit('rematch') },
          iWant ? 'Aștepți revanșa…' : theyWant ? `${opp.name} vrea revanșă! 🔁` : 'Revanșă 🔁'),
      el('button', { class: 'btn', onclick: () => S.socket.emit('leaveMatch') }, 'Înapoi')
    ];
  }

  return el('div', { class: 'stage ' + m.game, style: `--gc:${g.color}` },
    el('div', { class: 'stage-top' }, el('span', { class: 'stage-title' }, `${g.emoji || ''} ${m.gameName}`)),
    el('div', { class: 'versus' }, chip(m, 0), el('span', { class: 'vs' }, 'vs'), chip(m, 1)),
    el('p', { class: 'status ' + cls, role: 'status' }, status),
    board,
    el('div', { class: 'stack center-x' }, actions));
}

const sym = (i) => (i === 0 ? 'X' : 'O');

function tttBoard(m, myTurn) {
  const st = m.state;
  return el('div', { class: 'ttt-grid' }, st.board.map((c, i) => el('button', {
    class: 'ttt-cell' + (c !== null ? ' m' + c : '') + (st.winLine && st.winLine.includes(i) ? ' win' : '') + (st.last === i ? ' last' : ''),
    disabled: !myTurn || c !== null,
    'aria-label': c === null ? `Căsuța ${i + 1}, liberă` : `Căsuța ${i + 1}, ${sym(c)}`,
    onclick: () => S.socket.emit('move', { cell: i })
  }, c === null ? '' : sym(c))));
}

function tttqBoard(m, myTurn) {
  const st = m.state;
  const me = m.players.findIndex((p) => p.id === S.me.id);
  const pd = st.pending;
  const grid = el('div', { class: 'ttt-grid' }, st.board.map((c, i) => {
    const isPending = pd && pd.cell === i;
    return el('button', {
      class: 'ttt-cell' + (c !== null ? ' m' + c : '') + (isPending ? ' pending' : '') +
        (st.winLine && st.winLine.includes(i) ? ' win' : '') + (st.last === i ? ' last' : ''),
      disabled: !myTurn || c !== null || Boolean(pd),
      onclick: () => S.socket.emit('move', { cell: i })
    }, c !== null ? sym(c) : isPending ? '?' : '');
  }));
  let card;
  if (pd && !m.over) {
    const mine = pd.by === me;
    const end = Date.now() + pd.remainingMs;
    card = el('div', { class: 'qcard pop' },
      el('div', { class: 'qcard-top' }, timerBar(end, pd.durationMs), secs(end)),
      el('p', { class: 'qcard-q' }, pd.text),
      el('div', { class: 'answers' }, pd.options.map((opt, i) => el('button', {
        class: 'ans a' + i,
        disabled: !mine,
        onclick: (e) => {
          document.querySelectorAll('.qcard .ans').forEach((b) => { b.disabled = true; });
          e.currentTarget.classList.add('picked');
          S.socket.emit('move', { answer: i });
        }
      }, el('span', { class: 'ans-l' }, 'ABCD'[i]), el('span', {}, opt)))),
      mine ? null : el('p', { class: 'muted small center' }, `Doar ${m.players[pd.by].name} poate răspunde acum.`));
  } else if (st.lastAnswer) {
    const la = st.lastAnswer;
    const who = la.by === me ? 'Tu' : m.players[la.by].name;
    card = el('div', { class: 'qcard result ' + (la.ok ? 'ok' : 'bad') },
      el('p', { class: 'qcard-verdict' }, la.ok ? `✅ ${who}: corect! ${sym(la.by)} pe tablă.` : `❌ ${who}: ${la.picked === null ? 'timpul a expirat' : 'greșit'}.`),
      el('p', { class: 'muted small' }, la.text, ' → ', el('b', {}, la.right)));
  } else {
    card = el('p', { class: 'muted small center hint' }, 'Alege o căsuță, apoi răspunde. Corect: îți pui semnul. Greșit: pierzi rândul.');
  }
  return el('div', { class: 'tttq-wrap' + (pd && !m.over ? ' asking' : '') }, grid, card);
}

function c4Board(m, myTurn) {
  const st = m.state;
  const win = new Set((st.winLine || []).map(([r, c]) => r + ':' + c));
  const cols = [];
  for (let c = 0; c < 7; c++) {
    cols.push(el('button', {
      class: 'c4-col', disabled: !myTurn || st.board[0][c] !== null, 'aria-label': `Coloana ${c + 1}`,
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
  for (let i = 0; i < st.maxWrong; i++) lives.push(el('i', { class: i < st.wrong ? 'lost' : '' }, i < st.wrong ? '💔' : '❤️'));
  let lastText = null;
  if (st.last) {
    const who = st.last.by === m.players.findIndex((p) => p.id === S.me.id) ? 'Tu' : m.players[st.last.by].name;
    lastText = st.last.hits ? `${who}: „${st.last.letter}” apare de ${st.last.hits} ${st.last.hits === 1 ? 'dată' : 'ori'}! ✨` : `${who}: „${st.last.letter}” nu e în cuvânt.`;
  }
  return el('div', { class: 'hang' },
    el('div', { class: 'hang-word' + (st.done ? ' done' : '') }, [...st.word].map((ch, i) => el('span', { class: ch === '_' ? 'blank' : 'shown', style: `--i:${i}` }, ch === '_' ? '' : ch))),
    el('div', { class: 'lives' }, lives),
    lastText ? el('p', { class: 'muted small center' }, lastText) : null,
    el('div', { class: 'keys' }, st.alphabet.map((L) => {
      const used = st.guessed.includes(L);
      const hit = used && st.word.includes(L);
      return el('button', { class: 'key' + (used ? (hit ? ' hit' : ' miss') : ''), disabled: !myTurn || used, onclick: () => S.socket.emit('move', { letter: L }) }, L);
    })));
}

function bsGrid(st, kind, myTurn) {
  const n = st.size;
  const cells = [];
  const sunkSet = new Set((kind === 'target' ? st.enemySunk.flat() : st.myShips.filter((s) => s.sunk).flatMap((s) => s.cells)));
  const shipSet = new Set(kind === 'target' ? (st.enemyShips || []).flat() : st.myShips.flatMap((s) => s.cells));
  const shots = kind === 'target' ? st.outgoing : st.incoming;
  const me = S.match.players.findIndex((p) => p.id === S.me.id);
  for (let i = 0; i < n * n; i++) {
    const shot = shots[i];
    const isLast = st.last && st.last.idx === i && ((kind === 'target') === (st.last.by === me));
    let cls = 'bs-cell';
    if (shipSet.has(i)) cls += kind === 'target' ? ' ghost' : ' ship';
    if (sunkSet.has(i)) cls += ' sunk';
    if (shot === 'hit') cls += ' hit';
    if (shot === 'miss') cls += ' miss';
    if (isLast) cls += ' last';
    const clickable = kind === 'target' && myTurn && st.phase === 'play' && shot === null && !S.match.over;
    cells.push(el(clickable ? 'button' : 'span', {
      class: cls,
      onclick: clickable ? () => S.socket.emit('move', { shot: i }) : null,
      'aria-label': clickable ? `Trage în ${'ABCDEFGH'[Math.floor(i / n)]}${(i % n) + 1}` : null
    }, shot === 'hit' ? (sunkSet.has(i) ? '🔥' : '💥') : shot === 'miss' ? '•' : ''));
  }
  return el('div', { class: 'bs-grid ' + kind + (myTurn && kind === 'target' && st.phase === 'play' ? ' armed' : ''), style: `--n:${n}` }, cells);
}

function fleetRow(lengths, label) {
  return el('div', { class: 'fleet' }, el('span', { class: 'muted small' }, label),
    lengths.length ? lengths.map((len) => el('span', { class: 'fleet-ship' }, Array.from({ length: len }, () => el('i')))) : el('span', { class: 'small' }, 'nimic 💀'));
}

function bsBoard(m, myTurn) {
  const st = m.state;
  const me = m.players.findIndex((p) => p.id === S.me.id);
  if (st.phase === 'setup') {
    const ready = st.ready[me];
    return el('div', { class: 'bs-wrap' },
      el('p', { class: 'board-label' }, 'Flota ta'),
      bsGrid(st, 'mine', false),
      el('div', { class: 'row center-x' },
        el('button', { class: 'btn big', disabled: ready, onclick: () => S.socket.emit('move', { action: 'shuffle' }) }, '🔀 Amestecă'),
        el('button', { class: 'btn primary big', disabled: ready, onclick: () => S.socket.emit('move', { action: 'ready' }) }, ready ? 'Gata ✓' : 'Gata!')),
      el('p', { class: 'muted small center hint' }, 'Navele se așază singure. Amestecă până îți place așezarea. Lovitură = mai tragi o dată.'));
  }
  return el('div', { class: 'bs-wrap' },
    el('p', { class: 'board-label' }, '🎯 Ținta'),
    bsGrid(st, 'target', myTurn),
    fleetRow(st.enemyLeft, 'Mai are:'),
    el('details', { class: 'my-fleet', open: true },
      el('summary', {}, '🛡️ Flota ta'),
      bsGrid(st, 'mine', false),
      fleetRow(st.myLeft, 'Mai ai:')));
}

// ============ Quiz ============
function renderQuiz() {
  const q = myQuiz();
  const isHost = q.hostId === S.me.id;
  const leave = el('button', { class: 'btn ghost small', onclick: () => { S.socket.emit('quizLeave'); S.dismissedQuiz = q.id; render(); } }, 'Ieși');
  const top = el('div', { class: 'room-top' }, el('span', { class: 'room-title' }, '🎯 ', q.title), levelTag(q.level));

  if (q.phase === 'lobby') {
    const host = q.players.find((p) => p.id === q.hostId);
    return el('div', { class: 'stage' }, top,
      el('div', { class: 'card center' },
        el('p', { class: 'eyebrow' }, 'Sala de așteptare'),
        el('div', { class: 'crowd' }, q.players.map((p, i) => el('div', { class: 'crowd-p', style: `--i:${i}` }, mascot(p.id, 'md', 'bob d' + (i % 5)), el('span', {}, p.name)))),
        el('p', { class: 'muted' }, isHost ? (q.players.length < 2 ? 'Așteaptă să mai intre cineva…' : 'Toată lumea e aici? Dă drumul!') : `Așteptăm ca ${host ? host.name : 'organizatorul'} să pornească.`),
        el('p', { class: 'muted small' }, `${q.total} întrebări`)),
      el('div', { class: 'stack center-x' },
        isHost ? el('button', { class: 'btn primary big', disabled: q.players.length < 2, onclick: () => S.socket.emit('quizStart') }, 'Pornește quizul 🚀') : null,
        leave));
  }

  if (q.phase === 'finished') {
    return el('div', { class: 'stage' }, top,
      el('h2', { class: 'center' }, '🏁 Rezultate'),
      rankingList(q.ranking.map((r) => ({ ...r, sub: `${r.correct}/${q.total} corecte · ${r.score} p` }))),
      el('p', { class: 'muted small center' }, 'Punctele verzi intră în clasamentul săptămânii.'),
      el('button', { class: 'btn primary big', onclick: () => { S.dismissedQuiz = q.id; render(); } }, 'Înapoi'));
  }

  const key = q.id + ':' + q.index;
  const mine = S.myAnswers[key];
  const reveal = q.phase === 'reveal';
  const meP = q.players.find((p) => p.id === S.me.id);
  const end = reveal ? Date.now() : S.quizEnd;
  let feedback = null;
  if (reveal) feedback = meP && meP.gained ? el('p', { class: 'status win pop' }, `Corect! +${meP.gained} ✨`) : el('p', { class: 'status loss pop' }, mine === undefined ? 'N-ai răspuns la timp ⏰' : 'Greșit 😬');
  else if (mine !== undefined) feedback = el('p', { class: 'status wait' }, 'Trimis! Așteptăm și restul…');

  return el('div', { class: 'stage' },
    el('div', { class: 'room-top' }, el('span', { class: 'room-title' }, `${q.index + 1}`, el('span', { class: 'muted' }, ` / ${q.total}`)), secs(end), leave),
    timerBar(end, q.durationMs),
    el('div', { class: 'question-card pop' }, q.question.text),
    el('div', { class: 'answers' }, q.question.options.map((opt, i) => {
      let cls = 'ans a' + i;
      if (mine === i) cls += ' picked';
      if (reveal) cls += i === q.correctIndex ? ' right' : ' faded';
      return el('button', { class: cls, disabled: reveal || mine !== undefined, onclick: () => { S.myAnswers[key] = i; S.socket.emit('quizAnswer', { choice: i }); render(); } },
        el('span', { class: 'ans-l' }, reveal && i === q.correctIndex ? '✓' : 'ABCD'[i]), el('span', {}, opt));
    })),
    feedback,
    el('div', { class: 'mini-scores' }, [...q.players].sort((a, b) => b.score - a.score).map((p) => el('div', { class: 'ms' + (p.id === S.me.id ? ' me' : '') + (p.answered ? ' done' : '') },
      mascot(p.id, 'xs'), el('span', {}, p.score), reveal && p.gained ? el('b', { class: 'gain' }, `+${p.gained}`) : null))));
}

function rankingList(rows) {
  return el('ol', { class: 'ranking' }, rows.map((r, i) => el('li', { class: (r.id === S.me.id ? 'me ' : '') + (r.rank === 1 ? 'first' : ''), style: `--i:${i}` },
    el('span', { class: 'rank' }, r.rank === 1 ? '👑' : r.rank),
    mascot(r.id, 'sm', r.rank === 1 ? 'bob' : ''),
    el('span', { class: 'rname' }, r.name, el('small', { class: 'muted' }, r.sub)),
    el('span', { class: 'rpts' }, `+${r.points}`))));
}

// ============ Cine e cel mai amuzant ============
function renderParty() {
  const p = myParty();
  const isHost = p.hostId === S.me.id;
  const title = p.adult ? '🌶️ Cel mai amuzant 18+' : '😂 Cel mai amuzant';
  const leave = el('button', { class: 'btn ghost small', onclick: () => { S.socket.emit('partyLeave'); S.dismissedParty = p.id; render(); } }, 'Ieși');
  const endBtn = isHost && ['answer', 'vote', 'result'].includes(p.phase)
    ? el('button', { class: 'btn ghost small', onclick: () => {
      openModal(el('h2', {}, 'Închei jocul acum?'), el('p', { class: 'muted' }, 'Se calculează clasamentul cu voturile de până acum.'),
        el('div', { class: 'stack' }, el('button', { class: 'btn primary big', onclick: () => { closeModal(); S.socket.emit('partyEnd'); } }, 'Da, închei'),
          el('button', { class: 'btn ghost', onclick: closeModal }, 'Mai jucăm')));
    } }, 'Închei') : null;

  if (p.phase === 'lobby') {
    const slots = [];
    for (let i = 0; i < 10; i++) {
      const pl = p.players[i];
      slots.push(pl
        ? el('div', { class: 'crowd-p', style: `--i:${i}` }, mascot(pl.id, 'md', 'bob d' + (i % 5)), el('span', {}, pl.name, pl.id === p.hostId ? ' ⭐' : ''))
        : el('div', { class: 'crowd-p empty' }, el('span', { class: 'slot' }, '?'), el('span', {}, 'liber')));
    }
    return el('div', { class: 'stage party' + (p.adult ? ' spicy' : '') },
      el('div', { class: 'room-top' }, el('span', { class: 'room-title' }, title), leave),
      el('div', { class: 'card center' },
        el('p', { class: 'eyebrow' }, `Sala de așteptare · ${p.players.length}/10`),
        el('div', { class: 'crowd ten' }, slots),
        el('p', { class: 'muted small' }, `${p.total} întrebări haioase. Toți scrieți câte un răspuns, apoi votați anonim cel mai amuzant răspuns. Nu te poți vota pe tine.`)),
      isHost
        ? el('button', { class: 'btn primary big', disabled: p.players.length < 3, onclick: () => S.socket.emit('partyStart') }, p.players.length < 3 ? `Mai trebuie ${3 - p.players.length} ${3 - p.players.length === 1 ? 'jucător' : 'jucători'}` : 'Pornește jocul 🎉')
        : el('p', { class: 'muted center' }, 'Așteptăm ca organizatorul să pornească jocul…'));
  }

  if (p.phase === 'finished') {
    return el('div', { class: 'stage party' + (p.adult ? ' spicy' : '') },
      el('div', { class: 'room-top' }, el('span', { class: 'room-title' }, title)),
      el('h2', { class: 'center' }, '🏆 Cel mai amuzant din gașcă'),
      p.ranking[0] ? el('div', { class: 'champion' }, el('span', { class: 'crown' }, '👑'), mascot(p.ranking[0].id, 'xl', 'bob'), el('b', {}, p.ranking[0].name)) : null,
      rankingList(p.ranking.map((r) => ({ ...r, sub: `${r.score} ${r.score === 1 ? 'vot' : 'voturi'} · ${r.rounds} ${r.rounds === 1 ? 'rundă câștigată' : 'runde câștigate'}` }))),
      el('button', { class: 'btn primary big', onclick: () => { S.dismissedParty = p.id; render(); } }, 'Înapoi'));
  }

  const end = S.partyEnd;
  const head = el('div', { class: 'room-top' }, el('span', { class: 'room-title' }, `${p.index + 1}`, el('span', { class: 'muted' }, ` / ${p.total}`)), secs(end), el('span', { class: 'row-tight' }, endBtn, leave));
  const prompt = el('div', { class: 'prompt-card pop' }, el('span', { class: 'prompt-emoji' }, p.adult ? '🌶️' : '🎤'), p.prompt);
  const roster = el('div', { class: 'mini-scores' }, p.players.map((x) => el('div', { class: 'ms' + (x.id === S.me.id ? ' me' : '') + ((p.phase === 'answer' ? x.answered : x.voted) ? ' done' : '') },
    mascot(x.id, 'xs'), el('span', {}, x.score))));

  if (p.phase === 'answer') {
    const key = p.id + ':' + p.index;
    if (S.partyDraftKey !== key) { S.partyDraftKey = key; S.partyDraft = ''; }
    if (p.myAnswer) {
      return el('div', { class: 'stage party' + (p.adult ? ' spicy' : '') }, head, timerBar(end, p.durationMs), prompt,
        el('div', { class: 'bubble mine pop' }, p.myAnswer),
        el('p', { class: 'status wait' }, `Trimis! ✓ Așteptăm restul (${p.players.filter((x) => x.answered).length}/${p.players.length})`),
        roster);
    }
    const ta = el('textarea', { id: 'partyInput', maxlength: 140, rows: 3, placeholder: 'Scrie cel mai amuzant răspuns…', oninput: (e) => { S.partyDraft = e.target.value; counter.textContent = `${e.target.value.length}/140`; } });
    ta.value = S.partyDraft;
    const counter = el('span', { class: 'muted small' }, `${S.partyDraft.length}/140`);
    const send = () => {
      const text = ta.value.trim();
      if (!text) return toast('Scrie ceva întâi. 😄');
      S.socket.emit('partyAnswer', { text });
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    return el('div', { class: 'stage party' + (p.adult ? ' spicy' : '') }, head, timerBar(end, p.durationMs), prompt,
      el('div', { class: 'answer-box' }, ta, el('div', { class: 'row space' }, counter, el('button', { class: 'btn primary', onclick: send }, 'Trimite 🚀'))),
      roster);
  }

  if (p.phase === 'vote') {
    return el('div', { class: 'stage party' + (p.adult ? ' spicy' : '') }, head, timerBar(end, p.durationMs), prompt,
      el('p', { class: 'eyebrow center' }, p.myVote ? 'Ai votat ✓' : 'Votează cel mai amuzant răspuns'),
      el('div', { class: 'ballot' }, p.ballot.map((b, i) => el('button', {
        class: 'bubble' + (b.mine ? ' mine' : '') + (p.myVote === b.key ? ' voted' : ''),
        style: `--i:${i}`,
        disabled: b.mine || Boolean(p.myVote),
        onclick: () => S.socket.emit('partyVote', { key: b.key })
      }, b.text, b.mine ? el('span', { class: 'bubble-tag' }, 'al tău') : null, p.myVote === b.key ? el('span', { class: 'bubble-tag' }, '❤️ votul tău') : null))),
      roster);
  }

  // result
  const max = Math.max(1, ...p.results.map((r) => r.votes));
  return el('div', { class: 'stage party' + (p.adult ? ' spicy' : '') }, head, timerBar(end, p.durationMs), prompt,
    p.results.length < 2 ? el('p', { class: 'muted center' }, 'Prea puține răspunsuri runda asta. 🤷') : null,
    el('div', { class: 'results' }, p.results.map((r, i) => el('div', { class: 'result' + (r.winner ? ' winner' : ''), style: `--i:${i}` },
      el('div', { class: 'result-head' }, mascot(r.authorId, 'sm', r.winner ? 'bob' : ''), el('b', {}, r.name), r.winner ? el('span', { class: 'crown-s' }, '👑') : null,
        el('span', { class: 'votes' }, `${r.votes} ${r.votes === 1 ? 'vot' : 'voturi'}`)),
      el('p', { class: 'result-text' }, r.text),
      el('div', { class: 'vote-bar' }, el('span', { style: `width:${(100 * r.votes) / max}%` }))))),
    roster);
}

// ============ Vot: jucătorul săptămânii ============
async function loadVote() {
  try {
    S.vote = await api('/api/vote');
    refresh('vote');
  } catch (e) { toast(e.message, 'error'); }
}

function renderVote() {
  const v = S.vote;
  if (!v) return el('div', { class: 'page' }, el('p', { class: 'muted center' }, 'Se încarcă…'));
  const candidates = Object.values(S.players).filter((p) => p.id !== S.me.id).sort((a, b) => a.name.localeCompare(b.name, 'ro'));
  const last = v.history[0];
  const vote = async (id) => {
    try {
      await api('/api/vote', { targetId: id });
      v.myVote = id;
      render();
      toast(`Ai votat pentru ${nameOf(id)}. Rămâne secret! 🤫`);
    } catch (e) { toast(e.message, 'error'); }
  };
  return el('div', { class: 'page' },
    el('header', { class: 'page-head' }, el('span', { class: 'big-emoji' }, '🗳️'),
      el('div', {}, el('h1', {}, 'Jucătorul săptămânii'), el('p', { class: 'muted' }, 'Vot secret. Câștigătorul se anunță luni, în aplicație.'))),
    last ? el('div', { class: 'card last-winner' },
      el('div', { class: 'crown-wrap' }, el('span', { class: 'crown' }, '👑'), last.winners.map((w) => mascot(w.id, 'lg', 'bob'))),
      el('div', {}, el('p', { class: 'eyebrow' }, `Săptămâna trecută (${weekRange(last.weekKey)})`),
        el('h2', {}, last.winners.map((w) => w.name).join(' și ')),
        el('p', { class: 'muted small' }, `${last.winners[0].votes} ${last.winners[0].votes === 1 ? 'vot' : 'voturi'}`))) : null,
    el('div', { class: 'card' },
      el('div', { class: 'row space' }, el('b', {}, `Săptămâna ${weekRange(v.weekKey)}`), el('span', { class: 'muted small' }, `${v.voters} din ${v.total} au votat`)),
      el('div', { class: 'progress' }, el('span', { style: `width:${v.total ? (100 * v.voters) / v.total : 0}%` })),
      el('p', { class: 'muted small' }, v.myVote ? `Votul tău: ${nameOf(v.myVote)}. Îl poți schimba până duminică seara.` : 'Atinge mascota celui pe care îl votezi.')),
    candidates.length
      ? el('div', { class: 'cand-grid' }, candidates.map((c, i) => el('button', { class: 'cand' + (v.myVote === c.id ? ' sel' : ''), style: `--i:${i}`, onclick: () => vote(c.id) },
        mascot(c.id, 'lg', v.myVote === c.id ? 'bob' : ''), el('span', {}, c.name), v.myVote === c.id ? el('span', { class: 'cand-check' }, '✓') : null)))
      : el('p', { class: 'muted center' }, 'Încă nu ai pe cine vota.'),
    v.history.length > 1 ? el('section', {}, el('h2', { class: 'section-title' }, 'Câștigători anteriori'),
      el('div', { class: 'card list' }, v.history.slice(1).map((h) => el('div', { class: 'list-row' },
        el('span', { class: 'muted small grow' }, weekRange(h.weekKey)), h.winners.map((w) => mascot(w.id, 'xs')), el('b', {}, h.winners.map((w) => w.name).join(', ')))))) : null);
}

// ============ Clasament ============
async function loadBoard() {
  try {
    S.board = await api('/api/leaderboard');
    refresh('board');
  } catch (e) { toast(e.message, 'error'); }
}

function renderBoard() {
  const d = S.board;
  if (!d) return el('div', { class: 'page' }, el('p', { class: 'muted center' }, 'Se încarcă…'));
  const rows = d.rows;
  const podiumOrder = [1, 0, 2].filter((i) => rows[i]);
  const resetBtn = S.me.isAdmin ? el('button', { class: 'btn ghost small danger', onclick: () => {
    openModal(el('div', { class: 'modal-emoji' }, '🧹'), el('h2', {}, 'Resetezi clasamentul?'),
      el('p', { class: 'muted' }, 'Se șterg toate punctele din săptămâna asta, pentru toată lumea. Nu se poate anula.'),
      el('div', { class: 'stack' },
        el('button', { class: 'btn danger-fill big', onclick: async () => {
          closeModal();
          try { await api('/api/admin/reset-board', {}); loadBoard(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Da, resetează'),
        el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunță')));
  } }, '🧹 Resetează clasamentul') : null;

  return el('div', { class: 'page' },
    el('header', { class: 'page-head' }, el('span', { class: 'big-emoji' }, '🏆'),
      el('div', {}, el('h1', {}, 'Clasament'), el('p', { class: 'muted' }, `Săptămâna ${weekRange(d.weekKey)}`))),
    rows.length ? el('div', { class: 'podium' }, podiumOrder.map((i) => el('div', { class: 'pod p' + (i + 1) },
      el('div', { class: 'pod-who' }, i === 0 ? el('span', { class: 'crown' }, '👑') : null, mascot(rows[i].id, i === 0 ? 'lg' : 'md', 'bob d' + i), el('b', {}, rows[i].name), el('span', { class: 'pod-pts' }, `${rows[i].points} p`)),
      el('div', { class: 'pod-block' }, i + 1)))) : el('div', { class: 'card center' }, el('p', { class: 'big-emoji' }, '🦗'), el('p', { class: 'muted' }, 'Încă nu s-a jucat nimic săptămâna asta. Fii primul!')),
    rows.length ? el('div', { class: 'card list' }, rows.map((r, i) => {
      const open = S.openRow === r.id;
      return el('div', { class: 'board-row' + (r.id === S.me.id ? ' me' : '') + (open ? ' open' : '') },
        el('button', { class: 'br-main', onclick: () => { S.openRow = open ? null : r.id; render(); } },
          el('span', { class: 'br-pos' }, i + 1), mascot(r.id, 'sm'),
          el('span', { class: 'grow br-name' }, r.name, el('small', { class: 'muted' }, `${r.wins}V · ${r.draws}R · ${r.losses}Î`)),
          el('span', { class: 'br-pts' }, r.points), el('span', { class: 'br-chev' }, open ? '▴' : '▾')),
        open ? el('div', { class: 'br-detail' }, BOARD_GAMES.map((g) => el('span', { class: 'gchip', style: `--gc:${GAMES[g].color}` }, `${GAMES[g].emoji} ${GAMES[g].name}`, el('b', {}, r[g] || 0)))) : null);
    })) : null,
    el('p', { class: 'muted small center' }, 'Victorie 3 p · Remiză 1 p · La jocurile de grup: locul 1 = 3 p, locul 2 = 2 p, locul 3 = 1 p.'),
    d.history.length ? el('section', {}, el('h2', { class: 'section-title' }, 'Campionii săptămânilor trecute'),
      el('div', { class: 'card list' }, d.history.map((w) => el('div', { class: 'list-row' }, el('span', { class: 'muted small grow' }, weekRange(w.weekKey)), mascot(w.id, 'xs'), el('b', {}, w.name), el('span', { class: 'muted small' }, `${w.points} p`))))) : null,
    resetBtn ? el('div', { class: 'center-x' }, resetBtn) : null);
}

// ============ Eu (profil + admin) ============
function renderMe() {
  if (S.editor) return renderEditor();
  return el('div', { class: 'page' },
    el('div', { class: 'card profile center' },
      mascot(S.me.id, 'xl', 'bob'),
      el('h1', {}, S.me.name),
      S.me.isAdmin ? el('span', { class: 'tag accent' }, '⭐ administrator') : null,
      el('div', { class: 'stack' },
        el('button', { class: 'btn primary', onclick: () => showBuilder(false) }, '🎨 Schimbă mascota'),
        el('button', { class: 'btn', onclick: changePassword }, '🔑 Schimbă parola'),
        el('button', { class: 'btn ghost', onclick: logout }, 'Ieși din cont'))),
    S.me.isAdmin ? [playersPanel(), quizzesPanel()] : null);
}

function changePassword() {
  const cur = el('input', { type: 'password', autocomplete: 'current-password' });
  const next = el('input', { type: 'password', autocomplete: 'new-password' });
  const msg = el('p', { class: 'error' });
  openModal(el('h2', {}, '🔑 Schimbă parola'), el('label', {}, 'Parola actuală', cur), el('label', {}, 'Parola nouă', next), msg,
    el('div', { class: 'stack' },
      el('button', { class: 'btn primary big', onclick: async () => {
        try { await api('/api/me/password', { current: cur.value, password: next.value }); closeModal(); toast('Parola a fost schimbată.'); } catch (e) { msg.textContent = e.message; }
      } }, 'Salvează'),
      el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunță')));
}

// --- Admin: jucători ---
const PW_WORDS = ['soare', 'munte', 'pisica', 'vulpe', 'zmeu', 'nor', 'racheta', 'lup', 'stea', 'luna', 'tren', 'brad', 'cires', 'delfin', 'tigru', 'vant', 'castel', 'dragon', 'fulger', 'comoara'];
function genPassword() {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  return PW_WORDS[r[0] % PW_WORDS.length] + (10 + (r[1] % 90));
}

async function loadUsers() {
  try {
    S.users = (await api('/api/users')).users;
    refresh('me');
  } catch (e) { toast(e.message, 'error'); }
}

const credentialsText = (c) => `Salut, ${c.name}! 🎮 Intră pe ${location.origin} și joacă cu noi.\nNume: ${c.name}\nParolă: ${c.password}\nLa prima intrare îți faci mascota!`;

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('Copiat! Acum îl lipești în mesaj.'); } catch { toast('Nu am putut copia automat. Selectează textul și copiază-l.', 'error'); }
}

function playersPanel() {
  const create = async () => {
    const name = $('#nuName').value;
    const pw = $('#nuPass').value;
    try {
      const { user } = await api('/api/users', { name, password: pw });
      S.created = { name: user.name, password: pw, isNew: true };
      $('#nuName').value = '';
      $('#nuPass').value = genPassword();
      await loadPlayers();
      await loadUsers();
      render();
    } catch (e) { toast(e.message, 'error'); }
  };
  const resetPass = (u) => {
    const input = el('input', { value: genPassword() });
    openModal(el('h2', {}, `Parolă nouă pentru ${u.name}`), el('label', {}, 'Parola', input), el('p', { class: 'muted small' }, 'Va fi delogat de pe toate dispozitivele.'),
      el('div', { class: 'stack' },
        el('button', { class: 'btn primary big', onclick: async () => {
          try {
            await api(`/api/users/${u.id}/password`, { password: input.value }, 'PUT');
            closeModal();
            S.created = { name: u.name, password: input.value, isNew: false };
            render();
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Salvează'),
        el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunță')));
  };
  const remove = (u) => {
    openModal(el('h2', {}, `Ștergi contul lui ${u.name}?`), el('p', { class: 'muted' }, 'Se șterg și punctele lui din clasament.'),
      el('div', { class: 'stack' },
        el('button', { class: 'btn danger-fill big', onclick: async () => {
          closeModal();
          try { await api(`/api/users/${u.id}`, null, 'DELETE'); toast(`Contul lui ${u.name} a fost șters.`); await loadUsers(); } catch (e) { toast(e.message, 'error'); }
        } }, 'Șterge'),
        el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunță')));
  };
  const c = S.created;
  const passInput = el('input', { id: 'nuPass', 'data-keep': '', autocomplete: 'off' });
  passInput.value = genPassword();
  return el('section', {},
    el('h2', { class: 'section-title' }, `👥 Jucători (${S.users.length})`),
    el('div', { class: 'card' },
      el('label', {}, 'Nume', el('input', { id: 'nuName', 'data-keep': '', placeholder: 'ex. Andrei', maxlength: 20, autocomplete: 'off' })),
      el('label', {}, 'Parolă', el('div', { class: 'input-row' }, passInput, el('button', { class: 'btn small', type: 'button', onclick: () => { $('#nuPass').value = genPassword(); } }, '🎲'))),
      el('button', { class: 'btn primary big mt', onclick: create }, 'Creează contul'),
      c ? el('div', { class: 'cred pop' },
        el('p', { class: 'eyebrow' }, c.isNew ? `Contul lui ${c.name} e gata! Trimite-i asta în privat:` : `Parola lui ${c.name} s-a schimbat. Trimite-i-o în privat:`),
        el('pre', {}, credentialsText(c)),
        el('div', { class: 'row' },
          el('button', { class: 'btn small primary', onclick: () => copyText(credentialsText(c)) }, '📋 Copiază mesajul'),
          el('button', { class: 'btn small ghost', onclick: () => { S.created = null; render(); } }, 'Închide'))) : null),
    el('div', { class: 'card list' }, S.users.map((u) => el('div', { class: 'list-row' },
      mascot(u.id, 'sm'),
      el('span', { class: 'grow' }, el('b', {}, u.name), u.isAdmin ? el('span', { class: 'tag accent' }, 'admin') : null, u.online ? el('span', { class: 'tag on' }, 'online') : null),
      u.id === S.me.id ? el('span', { class: 'muted small' }, 'tu') : [
        el('button', { class: 'btn small', onclick: () => resetPass(u) }, '🔑'),
        el('button', { class: 'btn small ghost danger', onclick: () => remove(u) }, '🗑️')]))));
}

// --- Admin: quizuri ---
function quizzesPanel() {
  return el('section', {},
    el('div', { class: 'row space' }, el('h2', { class: 'section-title' }, '🎯 Quizuri'),
      el('button', { class: 'btn primary small', onclick: () => { S.editor = { id: null, title: '', level: 5, seconds: 20, text: '' }; render(); } }, '+ Quiz nou')),
    el('div', { class: 'card list' }, S.quizzes.map((z) => el('div', { class: 'list-row' },
      el('span', { class: 'grow' }, el('b', {}, z.title), el('span', { class: 'block' }, levelTag(z.level), el('span', { class: 'muted small' }, ` · ${z.count} întrebări`))),
      z.custom
        ? [el('button', { class: 'btn small', onclick: () => openEditor(z.id, false) }, '✏️'), el('button', { class: 'btn small ghost danger', onclick: () => deleteQuiz(z) }, '🗑️')]
        : el('button', { class: 'btn small', onclick: () => openEditor(z.id, true) }, 'Copiază')))));
}

function parseQuizText(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
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
const EXAMPLE = 'Care este capitala Italiei?\n* Roma\n- Milano\n- Napoli\n- Torino\n\nCâte picioare are o albină?\n* 6\n- 4\n- 8';

async function openEditor(id, asCopy) {
  try {
    const { quiz } = await api('/api/quizzes/' + encodeURIComponent(id));
    S.editor = { id: asCopy ? null : id, title: asCopy ? quiz.title + ' (copie)' : quiz.title, level: quiz.level, seconds: quiz.seconds, text: quizToText(quiz.questions) };
    render();
  } catch (e) { toast(e.message, 'error'); }
}

function deleteQuiz(z) {
  openModal(el('h2', {}, `Ștergi quizul „${z.title}”?`),
    el('div', { class: 'stack' },
      el('button', { class: 'btn danger-fill big', onclick: async () => {
        closeModal();
        try { await api('/api/quizzes/' + encodeURIComponent(z.id), null, 'DELETE'); await loadQuizzes(); render(); toast('Quiz șters.'); } catch (e) { toast(e.message, 'error'); }
      } }, 'Șterge'),
      el('button', { class: 'btn ghost', onclick: closeModal }, 'Renunță')));
}

function renderEditor() {
  const ed = S.editor;
  const report = el('div', { class: 'parse-report' });
  const check = () => {
    const { questions, errors } = parseQuizText(ed.text);
    report.replaceChildren(...[
      el('p', { class: questions.length && !errors.length ? 'ok' : 'muted' }, `${questions.length} ${questions.length === 1 ? 'întrebare validă' : 'întrebări valide'}`),
      ...errors.slice(0, 5).map((x) => el('p', { class: 'error' }, x)),
      errors.length > 5 ? el('p', { class: 'error' }, `…și încă ${errors.length - 5} probleme.`) : null
    ].filter(Boolean));
    return { questions, errors };
  };
  const area = el('textarea', { id: 'edText', rows: 14, spellcheck: 'false', placeholder: EXAMPLE, oninput: (e) => { ed.text = e.target.value; check(); } });
  area.value = ed.text;
  const save = async () => {
    const { questions, errors } = check();
    if (errors.length) return toast('Corectează întâi întrebările marcate cu roșu.', 'error');
    if (!questions.length) return toast('Adaugă cel puțin o întrebare.', 'error');
    const body = { title: ed.title, level: ed.level, seconds: ed.seconds, questions };
    try {
      if (ed.id) await api('/api/quizzes/' + encodeURIComponent(ed.id), body, 'PUT');
      else await api('/api/quizzes', body);
      toast('Quiz salvat! 🎉');
      S.editor = null;
      await loadQuizzes();
      render();
    } catch (e) { toast(e.message, 'error'); }
  };
  const node = el('div', { class: 'page' },
    el('header', { class: 'page-head' }, el('span', { class: 'big-emoji' }, '✏️'), el('h1', {}, ed.id ? 'Editează quizul' : 'Quiz nou')),
    el('div', { class: 'card' },
      el('label', {}, 'Titlu', el('input', { value: ed.title, maxlength: 60, placeholder: 'ex. Despre gașca noastră', oninput: (e) => { ed.title = e.target.value; } })),
      el('div', { class: 'two' },
        el('label', {}, 'Dificultate', el('select', { onchange: (e) => { ed.level = Number(e.target.value); } }, TIERS.map((t, i) => el('option', { value: i + 1, selected: ed.level === i + 1 }, `${i + 1} · ${t}`)))),
        el('label', {}, 'Timp', el('select', { onchange: (e) => { ed.seconds = Number(e.target.value); } }, [10, 15, 20, 25, 30, 45, 60].map((s) => el('option', { value: s, selected: ed.seconds === s }, `${s} secunde`))))),
      el('label', {}, 'Întrebări', area),
      el('p', { class: 'muted small' }, 'O întrebare pe un rând, apoi 2–4 răspunsuri dedesubt. Pune * în fața celui corect. Lasă un rând liber între întrebări.'),
      report,
      el('div', { class: 'stack' }, el('button', { class: 'btn primary big', onclick: save }, 'Salvează quizul'), el('button', { class: 'btn ghost', onclick: () => { S.editor = null; render(); } }, 'Renunță'))));
  check();
  return node;
}

// ============ Pornire ============
(async function init() {
  try { S.config = await api('/api/config'); } catch { /* nimic */ }
  if (S.token) {
    try {
      S.me = (await api('/api/me')).user;
      return afterLogin();
    } catch {
      localStorage.removeItem('arena_token');
      S.token = null;
    }
  }
  showAuth();
})();
