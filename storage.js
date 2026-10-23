'use strict';
// Stocarea datelor: Postgres dacă există DATABASE_URL (pe Render), altfel un fișier data.json (pentru teste locale).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GAME_IDS = ['ttt', 'tttq', 'c4', 'hangman', 'battleship', 'quiz', 'funny'];
const OUTCOME_COL = { win: 'wins', draw: 'draws', loss: 'losses' };

// Cheia săptămânii = data zilei de luni (ora României), ex. "2026-10-19".
function weekKey(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  const offset = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get('weekday')];
  const monday = new Date(Date.UTC(+get('year'), +get('month') - 1, +get('day') - offset));
  return monday.toISOString().slice(0, 10);
}

const newToken = () => crypto.randomBytes(24).toString('hex');
const lower = (s) => s.toLocaleLowerCase('ro-RO');
const parseJson = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

async function createStorage() {
  if (process.env.DATABASE_URL) return createPg(process.env.DATABASE_URL);
  return createJson(process.env.DATA_FILE || path.join(__dirname, 'data.json'));
}

async function createPg(url) {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(url);
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS mascot TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS award_seen TEXT;
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game TEXT NOT NULL,
      outcome TEXT NOT NULL,
      points INTEGER NOT NULL,
      week_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS results_week_idx ON results(week_key);
    CREATE TABLE IF NOT EXISTS quizzes (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      level INTEGER NOT NULL,
      seconds INTEGER NOT NULL,
      questions JSONB NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS votes (
      week_key TEXT NOT NULL,
      voter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (week_key, voter_id)
    );
  `);

  const perGame = GAME_IDS.map((g) => `COALESCE(SUM(r.points) FILTER (WHERE r.game = '${g}'), 0)::int AS ${g}`).join(',\n               ');

  return {
    kind: 'postgres',
    // --- conturi ---
    async firstUserId() {
      return (await pool.query('SELECT MIN(id) AS id FROM users')).rows[0].id;
    },
    async getUserByName(name) {
      return (await pool.query('SELECT id, name, pass_hash FROM users WHERE name_lower = $1', [lower(name)])).rows[0] || null;
    },
    async getUserById(id) {
      return (await pool.query('SELECT id, name, pass_hash FROM users WHERE id = $1', [id])).rows[0] || null;
    },
    async createUser(name, hash) {
      const r = await pool.query('INSERT INTO users (name, name_lower, pass_hash) VALUES ($1, $2, $3) RETURNING id, name', [name, lower(name), hash]);
      return r.rows[0];
    },
    async listUsers() {
      const r = await pool.query('SELECT id, name, mascot, created_at AS "createdAt" FROM users ORDER BY name_lower');
      return r.rows.map((u) => ({ ...u, mascot: parseJson(u.mascot) }));
    },
    async setPassword(id, hash) {
      return (await pool.query('UPDATE users SET pass_hash = $2 WHERE id = $1', [id, hash])).rowCount > 0;
    },
    async setMascot(id, mascot) {
      await pool.query('UPDATE users SET mascot = $2 WHERE id = $1', [id, JSON.stringify(mascot)]);
    },
    async deleteUser(id) {
      return (await pool.query('DELETE FROM users WHERE id = $1', [id])).rowCount > 0;
    },
    // --- sesiuni ---
    async createSession(userId) {
      const token = newToken();
      await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
      return token;
    },
    async getSessionUser(token) {
      if (!token || typeof token !== 'string') return null;
      const r = await pool.query('SELECT u.id, u.name, u.mascot FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]);
      const u = r.rows[0];
      return u ? { id: u.id, name: u.name, mascot: parseJson(u.mascot) } : null;
    },
    async deleteSession(token) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    },
    async deleteSessionsOf(id) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    },
    // --- rezultate și clasament ---
    async addResult({ userId, game, outcome, points }) {
      await pool.query('INSERT INTO results (user_id, game, outcome, points, week_key) VALUES ($1, $2, $3, $4, $5)', [userId, game, outcome, points, weekKey()]);
    },
    async resetWeek(wk) {
      await pool.query('DELETE FROM results WHERE week_key = $1', [wk]);
    },
    async leaderboard(wk) {
      const r = await pool.query(`
        SELECT u.id, u.name,
               SUM(r.points)::int AS points,
               COUNT(*)::int AS games,
               COUNT(*) FILTER (WHERE r.outcome = 'win')::int  AS wins,
               COUNT(*) FILTER (WHERE r.outcome = 'draw')::int AS draws,
               COUNT(*) FILTER (WHERE r.outcome = 'loss')::int AS losses,
               ${perGame}
        FROM results r JOIN users u ON u.id = r.user_id
        WHERE r.week_key = $1
        GROUP BY u.id, u.name
        ORDER BY points DESC, wins DESC, u.name`, [wk]);
      return r.rows;
    },
    async weekWinners(limit) {
      const r = await pool.query(`
        SELECT week_key AS "weekKey", id, name, points FROM (
          SELECT r.week_key, u.id, u.name, SUM(r.points)::int AS points,
                 ROW_NUMBER() OVER (PARTITION BY r.week_key ORDER BY SUM(r.points) DESC,
                   SUM(CASE WHEN r.outcome = 'win' THEN 1 ELSE 0 END) DESC, u.name) AS rn
          FROM results r JOIN users u ON u.id = r.user_id
          GROUP BY r.week_key, u.id, u.name
        ) t WHERE rn = 1 ORDER BY week_key DESC LIMIT $1`, [limit]);
      return r.rows;
    },
    // --- vot: jucătorul săptămânii ---
    async castVote(wk, voterId, targetId) {
      await pool.query(`INSERT INTO votes (week_key, voter_id, target_id) VALUES ($1, $2, $3)
        ON CONFLICT (week_key, voter_id) DO UPDATE SET target_id = EXCLUDED.target_id`, [wk, voterId, targetId]);
    },
    async getVote(wk, voterId) {
      return (await pool.query('SELECT target_id FROM votes WHERE week_key = $1 AND voter_id = $2', [wk, voterId])).rows[0]?.target_id ?? null;
    },
    async voterCount(wk) {
      return (await pool.query('SELECT COUNT(*)::int AS n FROM votes WHERE week_key = $1', [wk])).rows[0].n;
    },
    async voteTallies() {
      const r = await pool.query(`SELECT v.week_key AS "weekKey", v.target_id AS id, u.name, COUNT(*)::int AS votes
        FROM votes v JOIN users u ON u.id = v.target_id GROUP BY v.week_key, v.target_id, u.name`);
      return r.rows;
    },
    async getAwardSeen(id) {
      return (await pool.query('SELECT award_seen FROM users WHERE id = $1', [id])).rows[0]?.award_seen ?? null;
    },
    async setAwardSeen(id, wk) {
      await pool.query('UPDATE users SET award_seen = $2 WHERE id = $1', [id, wk]);
    },
    // --- quizuri adăugate de admin ---
    async listQuizzes() {
      return (await pool.query('SELECT id, title, level, seconds, questions FROM quizzes ORDER BY id')).rows;
    },
    async createQuiz({ title, level, seconds, questions }, userId) {
      const r = await pool.query('INSERT INTO quizzes (title, level, seconds, questions, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [title, level, seconds, JSON.stringify(questions), userId]);
      return r.rows[0].id;
    },
    async updateQuiz(id, { title, level, seconds, questions }) {
      return (await pool.query('UPDATE quizzes SET title = $2, level = $3, seconds = $4, questions = $5 WHERE id = $1',
        [id, title, level, seconds, JSON.stringify(questions)])).rowCount > 0;
    },
    async deleteQuiz(id) {
      return (await pool.query('DELETE FROM quizzes WHERE id = $1', [id])).rowCount > 0;
    }
  };
}

function createJson(file) {
  let db = {};
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  db.nextUserId ||= 1;
  db.users ||= [];
  db.sessions ||= {};
  db.results ||= [];
  db.quizzes ||= [];
  db.nextQuizId ||= 1;
  db.votes ||= [];

  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
    }, 200);
  };
  const byId = (id) => db.users.find((u) => u.id === id);

  async function leaderboard(wk) {
    const map = new Map();
    for (const r of db.results) {
      if (r.weekKey !== wk) continue;
      let e = map.get(r.userId);
      if (!e) {
        e = { id: r.userId, name: byId(r.userId)?.name ?? '?', points: 0, games: 0, wins: 0, draws: 0, losses: 0 };
        for (const g of GAME_IDS) e[g] = 0;
        map.set(r.userId, e);
      }
      e.points += r.points;
      e.games++;
      e[OUTCOME_COL[r.outcome]]++;
      e[r.game] = (e[r.game] || 0) + r.points;
    }
    return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  }

  return {
    kind: 'json',
    async firstUserId() { return db.users[0]?.id ?? null; },
    async getUserByName(name) { return db.users.find((u) => u.name_lower === lower(name)) || null; },
    async getUserById(id) { return byId(id) || null; },
    async createUser(name, hash) {
      if (db.users.some((u) => u.name_lower === lower(name))) throw new Error('exists');
      const u = { id: db.nextUserId++, name, name_lower: lower(name), pass_hash: hash, createdAt: new Date().toISOString(), mascot: null, award_seen: null };
      db.users.push(u);
      save();
      return { id: u.id, name: u.name };
    },
    async listUsers() {
      return db.users.map((u) => ({ id: u.id, name: u.name, mascot: u.mascot || null, createdAt: u.createdAt || null }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ro'));
    },
    async setPassword(id, hash) {
      const u = byId(id);
      if (!u) return false;
      u.pass_hash = hash;
      save();
      return true;
    },
    async setMascot(id, mascot) {
      const u = byId(id);
      if (u) { u.mascot = mascot; save(); }
    },
    async deleteUser(id) {
      const before = db.users.length;
      db.users = db.users.filter((u) => u.id !== id);
      db.results = db.results.filter((r) => r.userId !== id);
      db.votes = db.votes.filter((v) => v.voterId !== id && v.targetId !== id);
      for (const [t, uid] of Object.entries(db.sessions)) if (uid === id) delete db.sessions[t];
      save();
      return db.users.length < before;
    },
    async createSession(userId) {
      const token = newToken();
      db.sessions[token] = userId;
      save();
      return token;
    },
    async getSessionUser(token) {
      if (!token || typeof token !== 'string') return null;
      const u = byId(db.sessions[token]);
      return u ? { id: u.id, name: u.name, mascot: u.mascot || null } : null;
    },
    async deleteSession(token) { delete db.sessions[token]; save(); },
    async deleteSessionsOf(id) {
      for (const [t, uid] of Object.entries(db.sessions)) if (uid === id) delete db.sessions[t];
      save();
    },
    async addResult({ userId, game, outcome, points }) {
      db.results.push({ userId, game, outcome, points, weekKey: weekKey(), at: Date.now() });
      save();
    },
    async resetWeek(wk) {
      db.results = db.results.filter((r) => r.weekKey !== wk);
      save();
    },
    leaderboard,
    async weekWinners(limit) {
      const weeks = [...new Set(db.results.map((r) => r.weekKey))].sort().reverse().slice(0, limit);
      const out = [];
      for (const w of weeks) {
        const top = (await leaderboard(w))[0];
        if (top) out.push({ weekKey: w, id: top.id, name: top.name, points: top.points });
      }
      return out;
    },
    async castVote(wk, voterId, targetId) {
      const v = db.votes.find((x) => x.weekKey === wk && x.voterId === voterId);
      if (v) v.targetId = targetId;
      else db.votes.push({ weekKey: wk, voterId, targetId });
      save();
    },
    async getVote(wk, voterId) {
      return db.votes.find((x) => x.weekKey === wk && x.voterId === voterId)?.targetId ?? null;
    },
    async voterCount(wk) { return db.votes.filter((x) => x.weekKey === wk).length; },
    async voteTallies() {
      const map = new Map();
      for (const v of db.votes) {
        const k = v.weekKey + ':' + v.targetId;
        if (!map.has(k)) map.set(k, { weekKey: v.weekKey, id: v.targetId, name: byId(v.targetId)?.name ?? '?', votes: 0 });
        map.get(k).votes++;
      }
      return [...map.values()];
    },
    async getAwardSeen(id) { return byId(id)?.award_seen ?? null; },
    async setAwardSeen(id, wk) {
      const u = byId(id);
      if (u) { u.award_seen = wk; save(); }
    },
    async listQuizzes() { return db.quizzes; },
    async createQuiz(data, userId) {
      const id = db.nextQuizId++;
      db.quizzes.push({ id, ...data, created_by: userId });
      save();
      return id;
    },
    async updateQuiz(id, data) {
      const q = db.quizzes.find((x) => x.id === id);
      if (!q) return false;
      Object.assign(q, data);
      save();
      return true;
    },
    async deleteQuiz(id) {
      const before = db.quizzes.length;
      db.quizzes = db.quizzes.filter((x) => x.id !== id);
      save();
      return db.quizzes.length < before;
    }
  };
}

module.exports = { createStorage, weekKey, GAME_IDS };
