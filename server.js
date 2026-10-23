'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { createStorage, weekKey } = require('./storage');
const { GAMES } = require('./games');

const PORT = process.env.PORT || 3000;
const INVITE_CODE = (process.env.INVITE_CODE || '').trim();
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === 'true';
const ADMIN_NAMES = (process.env.ADMIN_NAMES || '').split(',').map((n) => n.trim().toLocaleLowerCase('ro-RO')).filter(Boolean);
const GRACE_MS = 30_000;          // cât timp așteptăm un jucător deconectat
const CHALLENGE_MS = 30_000;      // cât timp e valabilă o provocare
const REVEAL_MS = 4_500;
const POINTS = { win: 3, draw: 1, loss: 0 };
const NAME_RE = /^[\p{L}\p{N}_. -]{2,20}$/u;

const newId = () => crypto.randomBytes(6).toString('hex');
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------- Quizuri ----------
// Verifică un quiz (din fișier sau din formularul de admin). Întoarce { quiz } sau { error }.
function cleanQuiz(raw) {
  const title = String(raw?.title || '').trim();
  const level = Number(raw?.level);
  const seconds = Number(raw?.seconds ?? 20);
  if (!title || title.length > 60) return { error: 'Titlul trebuie să aibă între 1 și 60 de caractere.' };
  if (!Number.isInteger(level) || level < 1 || level > 10) return { error: 'Nivelul trebuie să fie între 1 și 10.' };
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 60) return { error: 'Timpul pe întrebare trebuie să fie între 5 și 60 de secunde.' };
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 100) {
    return { error: 'Quizul trebuie să aibă între 1 și 100 de întrebări.' };
  }
  const questions = [];
  for (const [i, item] of raw.questions.entries()) {
    const q = String(item?.q || '').trim();
    const a = Array.isArray(item?.a) ? item.a.map((x) => String(x).trim()).filter(Boolean) : [];
    if (!q || q.length > 300) return { error: `Întrebarea ${i + 1} nu are text (sau e prea lungă).` };
    if (a.length < 2 || a.length > 4) return { error: `Întrebarea ${i + 1} trebuie să aibă între 2 și 4 răspunsuri.` };
    if (a.some((x) => x.length > 120)) return { error: `Întrebarea ${i + 1} are un răspuns prea lung.` };
    if (new Set(a).size !== a.length) return { error: `Întrebarea ${i + 1} are răspunsuri identice.` };
    questions.push({ q, a });
  }
  return { quiz: { title, level, seconds, questions } };
}

function loadBuiltinQuizzes() {
  const dir = path.join(__dirname, 'quizzes');
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const { quiz, error } = cleanQuiz(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      if (error) console.warn(`Quiz ignorat (${file}): ${error}`);
      else out.set('b-' + file.replace(/\.json$/, ''), { ...quiz, custom: false });
    } catch (e) {
      console.warn(`Quiz ignorat (${file}): JSON invalid`);
    }
  }
  return out;
}

async function main() {
  const storage = await createStorage();
  console.log(`Stocare: ${storage.kind}`);

  const builtinQuizzes = loadBuiltinQuizzes();
  const customQuizzes = new Map();
  for (const row of await storage.listQuizzes()) {
    customQuizzes.set('c-' + row.id, { title: row.title, level: row.level, seconds: row.seconds, questions: row.questions, custom: true });
  }
  console.log(`Quizuri: ${builtinQuizzes.size} incluse, ${customQuizzes.size} adăugate de tine`);

  const getQuiz = (id) => builtinQuizzes.get(id) || customQuizzes.get(id);
  const quizCatalog = () => [...builtinQuizzes, ...customQuizzes]
    .map(([id, q]) => ({ id, title: q.title, level: q.level, seconds: q.seconds, count: q.questions.length, custom: q.custom }))
    .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title, 'ro'));

  // Întrebare aleatorie din toate quizurile (pentru X și 0 Quiz), fără repetări în același meci.
  function randomQuestion(used) {
    const pool = [];
    for (const [id, q] of [...builtinQuizzes, ...customQuizzes]) {
      q.questions.forEach((item, i) => {
        const key = id + ':' + i;
        if (!used.includes(key)) pool.push({ key, item });
      });
    }
    if (!pool.length) return null;
    const { key, item } = pool[Math.floor(Math.random() * pool.length)];
    const options = shuffle(item.a);
    return { key, text: item.q, options, correct: options.indexOf(item.a[0]) };
  }
  const gameCtx = { randomQuestion };

  async function isAdmin(user) {
    if (ADMIN_NAMES.length) return ADMIN_NAMES.includes(user.name.toLocaleLowerCase('ro-RO'));
    return user.id === (await storage.firstUserId()); // fără ADMIN_NAMES: primul cont creat e admin
  }

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { pingInterval: 20_000, pingTimeout: 20_000 });
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  const h = (fn) => (req, res) => fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: 'Eroare pe server. Încearcă din nou.' });
  });

  // Limită simplă la încercările greșite de parolă.
  const fails = new Map();
  const tooMany = (ip) => {
    const f = fails.get(ip);
    return f && f.count >= 10 && Date.now() < f.reset;
  };
  const addFail = (ip) => {
    const f = fails.get(ip);
    if (!f || Date.now() > f.reset) fails.set(ip, { count: 1, reset: Date.now() + 10 * 60_000 });
    else f.count++;
  };

  const authUser = (req) => storage.getSessionUser((req.headers.authorization || '').replace(/^Bearer /, ''));

  app.get('/healthz', (req, res) => res.send('ok'));
  // Înscrierea publică e închisă după primul cont (adminul). Restul conturilor le face adminul.
  const signupOpen = async () => ALLOW_SIGNUP || (await storage.firstUserId()) == null;
  app.get('/api/config', h(async (req, res) => {
    const open = await signupOpen();
    res.json({ signupOpen: open, firstAccount: (await storage.firstUserId()) == null, inviteRequired: open && Boolean(INVITE_CODE) });
  }));

  const cleanName = (raw) => String(raw || '').trim().replace(/\s+/g, ' ');
  const nameError = (name) => (NAME_RE.test(name) ? null : 'Numele trebuie să aibă 2–20 de caractere: litere, cifre, spațiu, _ . sau -.');
  const passError = (pw) => (pw.length >= 4 && pw.length <= 100 ? null : 'Parola trebuie să aibă cel puțin 4 caractere.');

  app.post('/api/register', h(async (req, res) => {
    if (!(await signupOpen())) return res.status(403).json({ error: 'Conturile le creează administratorul. Cere-i numele și parola.' });
    const name = cleanName(req.body?.name);
    const password = String(req.body?.password || '');
    if (INVITE_CODE && String(req.body?.code || '').trim() !== INVITE_CODE) {
      return res.status(403).json({ error: 'Codul de invitație nu e corect.' });
    }
    if (!NAME_RE.test(name)) {
      return res.status(400).json({ error: 'Numele trebuie să aibă 2–20 de caractere: litere, cifre, spațiu, _ . sau -.' });
    }
    if (password.length < 4 || password.length > 100) {
      return res.status(400).json({ error: 'Parola trebuie să aibă cel puțin 4 caractere.' });
    }
    if (await storage.getUserByName(name)) return res.status(409).json({ error: 'Numele e deja folosit. Alege altul.' });
    const hash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await storage.createUser(name, hash);
    } catch {
      return res.status(409).json({ error: 'Numele e deja folosit. Alege altul.' });
    }
    const token = await storage.createSession(user.id);
    res.json({ token, user: { id: user.id, name: user.name } });
  }));

  app.post('/api/login', h(async (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json({ error: 'Prea multe încercări. Mai încearcă peste câteva minute.' });
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    const password = String(req.body?.password || '');
    const user = name ? await storage.getUserByName(name) : null;
    if (!user || !(await bcrypt.compare(password, user.pass_hash))) {
      addFail(req.ip);
      return res.status(401).json({ error: 'Nume sau parolă greșită.' });
    }
    const token = await storage.createSession(user.id);
    res.json({ token, user: { id: user.id, name: user.name } });
  }));

  app.post('/api/logout', h(async (req, res) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (token) await storage.deleteSession(token);
    res.json({ ok: true });
  }));

  app.get('/api/me', h(async (req, res) => {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'Nu ești conectat.' });
    res.json({ user: { ...user, isAdmin: await isAdmin(user) } });
  }));

  app.post('/api/me/password', h(async (req, res) => {
    const me = await authUser(req);
    if (!me) return res.status(401).json({ error: 'Nu ești conectat.' });
    const full = await storage.getUserById(me.id);
    if (!(await bcrypt.compare(String(req.body?.current || ''), full.pass_hash))) {
      return res.status(400).json({ error: 'Parola actuală nu e corectă.' });
    }
    const next = String(req.body?.password || '');
    const e = passError(next);
    if (e) return res.status(400).json({ error: e });
    await storage.setPassword(me.id, await bcrypt.hash(next, 10));
    res.json({ ok: true });
  }));

  // ---------- Administrare jucători ----------
  async function adminOnly(req, res) {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: 'Nu ești conectat.' }); return null; }
    if (!(await isAdmin(user))) { res.status(403).json({ error: 'Doar administratorul are acces aici.' }); return null; }
    return user;
  }

  app.get('/api/users', h(async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    const users = await storage.listUsers();
    res.json({ users: await Promise.all(users.map(async (u) => ({ ...u, isAdmin: await isAdmin(u), online: online.has(u.id) }))) });
  }));

  app.post('/api/users', h(async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    const name = cleanName(req.body?.name);
    const password = String(req.body?.password || '');
    const e = nameError(name) || passError(password);
    if (e) return res.status(400).json({ error: e });
    if (await storage.getUserByName(name)) return res.status(409).json({ error: `Există deja un cont cu numele ${name}.` });
    let user;
    try {
      user = await storage.createUser(name, await bcrypt.hash(password, 10));
    } catch {
      return res.status(409).json({ error: `Există deja un cont cu numele ${name}.` });
    }
    res.json({ user: { id: user.id, name: user.name } });
  }));

  app.put('/api/users/:id/password', h(async (req, res) => {
    if (!(await adminOnly(req, res))) return;
    const id = Number(req.params.id);
    const password = String(req.body?.password || '');
    const e = passError(password);
    if (e) return res.status(400).json({ error: e });
    if (!(await storage.setPassword(id, await bcrypt.hash(password, 10)))) return res.status(404).json({ error: 'Contul nu există.' });
    await storage.deleteSessionsOf(id); // îl delogăm de peste tot
    io.in('u:' + id).disconnectSockets(true);
    res.json({ ok: true });
  }));

  app.delete('/api/users/:id', h(async (req, res) => {
    const admin = await adminOnly(req, res);
    if (!admin) return;
    const id = Number(req.params.id);
    if (id === admin.id) return res.status(400).json({ error: 'Nu-ți poți șterge propriul cont.' });
    io.in('u:' + id).disconnectSockets(true);
    if (!(await storage.deleteUser(id))) return res.status(404).json({ error: 'Contul nu există.' });
    io.emit('leaderboardChanged');
    res.json({ ok: true });
  }));

  app.get('/api/quizzes', h(async (req, res) => {
    if (!(await authUser(req))) return res.status(401).json({ error: 'Nu ești conectat.' });
    res.json({ quizzes: quizCatalog() });
  }));

  const requireAdmin = async (req, res) => {
    const user = await authUser(req);
    if (!user) { res.status(401).json({ error: 'Nu ești conectat.' }); return null; }
    if (!(await isAdmin(user))) { res.status(403).json({ error: 'Doar administratorul poate modifica quizurile.' }); return null; }
    return user;
  };

  app.get('/api/quizzes/:id', h(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const q = getQuiz(req.params.id);
    if (!q) return res.status(404).json({ error: 'Quizul nu există.' });
    res.json({ quiz: { id: req.params.id, ...q } });
  }));

  app.post('/api/quizzes', h(async (req, res) => {
    const user = await requireAdmin(req, res);
    if (!user) return;
    const { quiz, error } = cleanQuiz(req.body);
    if (error) return res.status(400).json({ error });
    const id = 'c-' + (await storage.createQuiz(quiz, user.id));
    customQuizzes.set(id, { ...quiz, custom: true });
    io.emit('quizzesChanged');
    res.json({ id });
  }));

  app.put('/api/quizzes/:id', h(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const id = req.params.id;
    if (!customQuizzes.has(id)) return res.status(404).json({ error: 'Poți modifica doar quizurile adăugate de tine.' });
    const { quiz, error } = cleanQuiz(req.body);
    if (error) return res.status(400).json({ error });
    await storage.updateQuiz(Number(id.slice(2)), quiz);
    customQuizzes.set(id, { ...quiz, custom: true });
    io.emit('quizzesChanged');
    res.json({ id });
  }));

  app.delete('/api/quizzes/:id', h(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const id = req.params.id;
    if (!customQuizzes.has(id)) return res.status(404).json({ error: 'Poți șterge doar quizurile adăugate de tine.' });
    await storage.deleteQuiz(Number(id.slice(2)));
    customQuizzes.delete(id);
    io.emit('quizzesChanged');
    res.json({ ok: true });
  }));

  app.get('/api/leaderboard', h(async (req, res) => {
    if (!(await authUser(req))) return res.status(401).json({ error: 'Nu ești conectat.' });
    const wk = weekKey();
    const [rows, winners] = await Promise.all([storage.leaderboard(wk), storage.weekWinners(21)]);
    res.json({ weekKey: wk, rows, history: winners.filter((w) => w.weekKey !== wk).slice(0, 20) });
  }));


  io.use(async (socket, next) => {
    try {
      const u = await storage.getSessionUser(socket.handshake.auth?.token);
      if (!u) return next(new Error('unauthorized'));
      socket.user = { id: u.id, name: u.name };
      next();
    } catch (e) {
      console.error(e);
      next(new Error('server'));
    }
  });

  // ---------- Starea serverului (în memorie) ----------
  const online = new Map();      // userId -> { user, count }
  const awayTimers = new Map();  // userId -> timeout
  const challenges = new Map();  // id -> { id, from, to, game, timer }
  const matches = new Map();     // id -> meci
  const userMatch = new Map();   // userId -> matchId
  let quiz = null;

  const toUser = (uid) => io.to('u:' + uid);
  const matchOf = (uid) => matches.get(userMatch.get(uid));
  const inQuiz = (uid) => Boolean(quiz && quiz.phase !== 'finished' && quiz.players.has(uid));
  const isBusy = (uid) => userMatch.has(uid) || inQuiz(uid);

  function broadcastLobby() {
    const list = [...online.values()]
      .map((o) => ({ id: o.user.id, name: o.user.name, busy: isBusy(o.user.id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ro'));
    io.emit('lobby', list);
  }

  function record(entries, game) {
    Promise.all(entries.map(([user, outcome, points]) => storage.addResult({ userId: user.id, game, outcome, points })))
      .then(() => io.emit('leaderboardChanged'))
      .catch((e) => console.error('Nu am putut salva rezultatul', e));
  }

  // ---------- Provocări ----------
  function cancelChallengesOf(uid) {
    for (const c of [...challenges.values()]) {
      if (c.from.id === uid || c.to.id === uid) {
        clearTimeout(c.timer);
        challenges.delete(c.id);
        toUser(c.from.id).emit('challengeGone', { id: c.id, reason: 'cancelled' });
        toUser(c.to.id).emit('challengeGone', { id: c.id, reason: 'cancelled' });
      }
    }
  }

  // ---------- Meciuri 1 contra 1 ----------
  function matchView(m) {
    return {
      id: m.id,
      game: m.game,
      gameName: GAMES[m.game].name,
      players: m.players.map((p) => ({ id: p.id, name: p.name })),
      turn: m.turn,
      state: GAMES[m.game].view(m.state),
      over: m.over,
      rematch: [...m.rematch],
      away: [...m.away],
      left: [...m.left]
    };
  }

  function sendMatch(m) {
    const view = matchView(m);
    for (const p of m.players) if (!m.left.has(p.id)) toUser(p.id).emit('match', view);
  }

  function startMatch(game, a, b, starter) {
    const m = {
      id: newId(), game, players: [a, b], state: GAMES[game].init(gameCtx), timer: null,
      starter: starter ?? (Math.random() < 0.5 ? 0 : 1),
      over: null, rematch: new Set(), away: new Set(), left: new Set()
    };
    m.turn = m.starter;
    matches.set(m.id, m);
    userMatch.set(a.id, m.id);
    userMatch.set(b.id, m.id);
    sendMatch(m);
    broadcastLobby();
  }

  function finishMatch(m, result, reason) {
    if (m.over) return;
    clearTimeout(m.timer);
    if (result.draw) {
      m.over = { draw: true, reason };
      record(m.players.map((p) => [p, 'draw', POINTS.draw]), m.game);
    } else {
      m.over = { winner: result.winner, reason };
      record([
        [m.players[result.winner], 'win', POINTS.win],
        [m.players[1 - result.winner], 'loss', POINTS.loss]
      ], m.game);
    }
    sendMatch(m);
  }

  function applyResult(m, r) {
    clearTimeout(m.timer);
    if (r.next === undefined) return finishMatch(m, r, 'normal');
    m.turn = r.next;
    if (r.timerMs) {
      const player = m.turn;
      m.timer = setTimeout(() => {
        if (m.over || m.turn !== player || !GAMES[m.game].timeout) return;
        const t = GAMES[m.game].timeout(m.state, player);
        if (t) applyResult(m, t);
      }, r.timerMs);
    }
    sendMatch(m);
  }

  function leaveMatch(uid, reason = 'resign') {
    const m = matchOf(uid);
    if (!m) return;
    if (!m.over) finishMatch(m, { winner: 1 - m.players.findIndex((p) => p.id === uid) }, reason);
    userMatch.delete(uid);
    m.left.add(uid);
    m.rematch.delete(uid);
    toUser(uid).emit('matchClosed', { id: m.id });
    if (m.players.every((p) => m.left.has(p.id))) matches.delete(m.id);
    else sendMatch(m);
    broadcastLobby();
  }

  // ---------- Quiz pentru toți ----------
  function prepareQuestions(def) {
    return shuffle(def.questions).map(({ q, a }) => {
      const options = shuffle(a);
      return { text: q, options, correct: options.indexOf(a[0]) };
    });
  }

  function quizView() {
    if (!quiz) return null;
    const q = quiz.current;
    const v = {
      id: quiz.id,
      phase: quiz.phase,
      title: quiz.title,
      level: quiz.level,
      hostId: quiz.hostId,
      index: quiz.index,
      total: quiz.questions.length,
      players: [...quiz.players.values()].map((p) => ({
        id: p.id, name: p.name, score: p.score, correct: p.correct, gained: p.gained,
        answered: quiz.answers.has(p.id), online: online.has(p.id)
      }))
    };
    if ((quiz.phase === 'question' || quiz.phase === 'reveal') && q) {
      v.question = { text: q.text, options: q.options };
      v.remainingMs = Math.max(0, quiz.deadline - Date.now());
      v.durationMs = quiz.questionMs;
    }
    if (quiz.phase === 'reveal') {
      v.correctIndex = q.correct;
      v.choices = Object.fromEntries([...quiz.answers].map(([id, a]) => [id, a.choice]));
    }
    if (quiz.phase === 'finished') v.ranking = quiz.ranking;
    return v;
  }

  const sendQuiz = () => io.emit('quiz', quizView());

  function nextQuestion() {
    if (!quiz) return;
    quiz.index++;
    if (quiz.index >= quiz.questions.length) return finishQuiz();
    quiz.current = quiz.questions[quiz.index];
    quiz.answers = new Map();
    quiz.phase = 'question';
    quiz.deadline = Date.now() + quiz.questionMs;
    for (const p of quiz.players.values()) p.gained = 0;
    quiz.timer = setTimeout(revealQuestion, quiz.questionMs);
    sendQuiz();
  }

  function revealQuestion() {
    if (!quiz || quiz.phase !== 'question') return;
    clearTimeout(quiz.timer);
    for (const [id, a] of quiz.answers) {
      const p = quiz.players.get(id);
      if (!p || a.choice !== quiz.current.correct) continue;
      const left = Math.max(0, quiz.deadline - a.at);
      p.gained = 100 + Math.round((50 * left) / quiz.questionMs); // răspuns corect + bonus de viteză
      p.score += p.gained;
      p.correct++;
    }
    quiz.phase = 'reveal';
    quiz.timer = setTimeout(nextQuestion, REVEAL_MS);
    sendQuiz();
  }

  function maybeRevealEarly() {
    if (!quiz || quiz.phase !== 'question') return false;
    const active = [...quiz.players.keys()].filter((id) => online.has(id));
    if (active.length && active.every((id) => quiz.answers.has(id))) {
      revealQuestion();
      return true;
    }
    return false;
  }

  function finishQuiz() {
    clearTimeout(quiz.timer);
    quiz.phase = 'finished';
    const list = [...quiz.players.values()].sort((a, b) => b.score - a.score);
    const n = list.length;
    let rank = 0;
    const ranked = list.map((p, i) => {
      if (i === 0 || p.score !== list[i - 1].score) rank = i + 1;
      // Locul 1 = 3 p, locul 2 = 2 p, locul 3 = 1 p. Ultimul loc nu primește puncte.
      const points = rank <= 3 && rank < n ? 4 - rank : 0;
      return { id: p.id, name: p.name, score: p.score, correct: p.correct, rank, points };
    });
    const firsts = ranked.filter((r) => r.rank === 1).length;
    quiz.ranking = ranked;
    if (n >= 2) {
      record(ranked.map((r) => [
        { id: r.id },
        r.rank === 1 ? (firsts > 1 ? 'draw' : 'win') : 'loss',
        r.points
      ]), 'quiz');
    }
    const id = quiz.id;
    quiz.timer = setTimeout(() => {
      if (quiz && quiz.id === id) {
        quiz = null;
        sendQuiz();
      }
    }, 120_000);
    sendQuiz();
    broadcastLobby();
  }

  function quizRemove(uid) {
    if (!quiz || quiz.phase === 'finished' || !quiz.players.has(uid)) return;
    quiz.players.delete(uid);
    if (quiz.players.size === 0) {
      clearTimeout(quiz.timer);
      quiz = null;
    } else {
      if (quiz.hostId === uid) quiz.hostId = quiz.players.keys().next().value;
      maybeRevealEarly();
    }
    sendQuiz();
    broadcastLobby();
  }

  // ---------- Conexiuni ----------
  io.on('connection', (socket) => {
    const u = socket.user;
    const err = (msg) => socket.emit('errorMsg', msg);
    socket.join('u:' + u.id);

    const o = online.get(u.id);
    if (o) o.count++;
    else online.set(u.id, { user: u, count: 1 });

    if (awayTimers.has(u.id)) {
      clearTimeout(awayTimers.get(u.id));
      awayTimers.delete(u.id);
      const m = matchOf(u.id);
      if (m && m.away.delete(u.id)) sendMatch(m);
    }

    socket.emit('hello', { me: u });
    const current = matchOf(u.id);
    if (current) socket.emit('match', matchView(current));
    socket.emit('quiz', quizView());
    broadcastLobby();

    socket.on('challenge', (data) => {
      const { to, game } = data || {};
      if (!GAMES[game]) return err('Joc necunoscut.');
      if (to === u.id) return;
      const target = online.get(to);
      if (!target) return err('Jucătorul nu mai e online.');
      if (isBusy(u.id)) return err('Termină întâi jocul în care ești.');
      if (isBusy(to)) return err(`${target.user.name} e într-un joc acum.`);
      for (const c of challenges.values()) {
        if (c.from.id === u.id && c.to.id === to) return err(`I-ai trimis deja o provocare lui ${target.user.name}.`);
      }
      const c = { id: newId(), from: u, to: target.user, game };
      c.timer = setTimeout(() => {
        if (challenges.delete(c.id)) {
          toUser(u.id).emit('challengeGone', { id: c.id, reason: 'expired' });
          toUser(to).emit('challengeGone', { id: c.id, reason: 'expired' });
        }
      }, CHALLENGE_MS);
      challenges.set(c.id, c);
      toUser(to).emit('challenged', { id: c.id, from: { id: u.id, name: u.name }, game, gameName: GAMES[game].name });
      toUser(u.id).emit('challengeSent', { id: c.id, to: { id: to, name: target.user.name }, game, gameName: GAMES[game].name });
    });

    socket.on('challengeReply', (data) => {
      const { id, accept } = data || {};
      const c = challenges.get(id);
      if (!c || c.to.id !== u.id) return;
      clearTimeout(c.timer);
      challenges.delete(id);
      if (!accept) {
        toUser(c.from.id).emit('challengeGone', { id, reason: 'declined', by: u.name });
        toUser(u.id).emit('challengeGone', { id, reason: 'cancelled' });
        return;
      }
      if (!online.has(c.from.id) || isBusy(c.from.id)) {
        toUser(c.from.id).emit('challengeGone', { id, reason: 'cancelled' });
        return err(`${c.from.name} nu mai e disponibil.`);
      }
      if (isBusy(u.id)) return err('Termină întâi jocul în care ești.');
      cancelChallengesOf(c.from.id);
      cancelChallengesOf(u.id);
      startMatch(c.game, c.from, c.to);
    });

    socket.on('cancelChallenge', (data) => {
      const c = challenges.get(data?.id);
      if (!c || c.from.id !== u.id) return;
      clearTimeout(c.timer);
      challenges.delete(c.id);
      toUser(c.to.id).emit('challengeGone', { id: c.id, reason: 'cancelled' });
      toUser(u.id).emit('challengeGone', { id: c.id, reason: 'cancelled' });
    });

    socket.on('move', (payload) => {
      const m = matchOf(u.id);
      if (!m || m.over) return;
      const idx = m.players.findIndex((p) => p.id === u.id);
      if (m.turn !== idx) return err('Nu e rândul tău.');
      const r = GAMES[m.game].move(m.state, idx, payload && typeof payload === 'object' ? payload : {}, gameCtx);
      if (typeof r === 'string') return err(r);
      applyResult(m, r);
    });

    socket.on('resign', () => {
      const m = matchOf(u.id);
      if (!m || m.over) return;
      finishMatch(m, { winner: 1 - m.players.findIndex((p) => p.id === u.id) }, 'resign');
    });

    socket.on('rematch', () => {
      const m = matchOf(u.id);
      if (!m || !m.over || m.left.size) return;
      m.rematch.add(u.id);
      if (m.rematch.size === 2) {
        matches.delete(m.id);
        for (const p of m.players) userMatch.delete(p.id);
        startMatch(m.game, m.players[0], m.players[1], 1 - m.starter);
      } else {
        sendMatch(m);
      }
    });

    socket.on('leaveMatch', () => leaveMatch(u.id));

    socket.on('quizCreate', (data) => {
      const def = getQuiz(data?.quizId);
      if (!def) return err('Quizul ales nu mai există.');
      if (quiz && quiz.phase !== 'finished') return err('Există deja un quiz. Intră în el!');
      if (userMatch.has(u.id)) return err('Termină întâi jocul în care ești.');
      if (quiz) clearTimeout(quiz.timer);
      quiz = {
        id: newId(), phase: 'lobby', hostId: u.id, players: new Map(), questions: prepareQuestions(def),
        title: def.title, level: def.level, questionMs: def.seconds * 1000,
        index: -1, answers: new Map(), current: null, timer: null, deadline: 0
      };
      quiz.players.set(u.id, { id: u.id, name: u.name, score: 0, correct: 0, gained: 0 });
      cancelChallengesOf(u.id);
      sendQuiz();
      io.except('u:' + u.id).emit('quizInvite', { from: u.name, title: def.title });
      broadcastLobby();
    });

    socket.on('quizJoin', () => {
      if (!quiz || quiz.phase !== 'lobby') return err('Quizul a început deja sau nu mai există.');
      if (userMatch.has(u.id)) return err('Termină întâi jocul în care ești.');
      if (quiz.players.has(u.id)) return;
      quiz.players.set(u.id, { id: u.id, name: u.name, score: 0, correct: 0, gained: 0 });
      cancelChallengesOf(u.id);
      sendQuiz();
      broadcastLobby();
    });

    socket.on('quizLeave', () => quizRemove(u.id));

    socket.on('quizStart', () => {
      if (!quiz || quiz.phase !== 'lobby' || quiz.hostId !== u.id) return;
      if (quiz.players.size < 2) return err('E nevoie de cel puțin 2 jucători.');
      nextQuestion();
      broadcastLobby();
    });

    socket.on('quizAnswer', (data) => {
      const choice = data?.choice;
      if (!quiz || quiz.phase !== 'question' || !quiz.players.has(u.id) || quiz.answers.has(u.id)) return;
      if (!Number.isInteger(choice) || choice < 0 || choice >= quiz.current.options.length) return;
      quiz.answers.set(u.id, { choice, at: Date.now() });
      if (!maybeRevealEarly()) sendQuiz();
    });

    socket.on('disconnect', () => {
      const entry = online.get(u.id);
      if (!entry) return;
      entry.count--;
      if (entry.count > 0) return;
      online.delete(u.id);
      cancelChallengesOf(u.id);
      const m = matchOf(u.id);
      if (m && !m.over) {
        m.away.add(u.id);
        sendMatch(m);
      }
      if (quiz) {
        if (!maybeRevealEarly()) sendQuiz();
      }
      awayTimers.set(u.id, setTimeout(() => {
        awayTimers.delete(u.id);
        leaveMatch(u.id, 'abandon');
        if (quiz && quiz.phase === 'lobby') quizRemove(u.id);
      }, GRACE_MS));
      broadcastLobby();
    });
  });

  server.listen(PORT, () => console.log(`Arena Prietenilor rulează pe http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
