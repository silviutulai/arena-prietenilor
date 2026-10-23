'use strict';
// Stocarea datelor: Postgres dacă există DATABASE_URL (pe Render), altfel un fișier data.json (pentru teste locale).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  `);

  return {
    kind: 'postgres',
    async listUsers() {
      const r = await pool.query('SELECT id, name, created_at AS "createdAt" FROM users ORDER BY name_lower');
      return r.rows;
    },
    async setPassword(id, hash) {
      const r = await pool.query('UPDATE users SET pass_hash = $2 WHERE id = $1', [id, hash]);
      return r.rowCount > 0;
    },
    async getUserById(id) {
      const r = await pool.query('SELECT id, name, pass_hash FROM users WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async deleteSessionsOf(id) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    },
    async deleteUser(id) {
      const r = await pool.query('DELETE FROM users WHERE id = $1', [id]);
      return r.rowCount > 0;
    },
    async firstUserId() {
      const r = await pool.query('SELECT MIN(id) AS id FROM users');
      return r.rows[0].id;
    },
    async listQuizzes() {
      const r = await pool.query('SELECT id, title, level, seconds, questions FROM quizzes ORDER BY id');
      return r.rows;
    },
    async createQuiz({ title, level, seconds, questions }, userId) {
      const r = await pool.query(
        'INSERT INTO quizzes (title, level, seconds, questions, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [title, level, seconds, JSON.stringify(questions), userId]
      );
      return r.rows[0].id;
    },
    async updateQuiz(id, { title, level, seconds, questions }) {
      const r = await pool.query(
        'UPDATE quizzes SET title = $2, level = $3, seconds = $4, questions = $5 WHERE id = $1',
        [id, title, level, seconds, JSON.stringify(questions)]
      );
      return r.rowCount > 0;
    },
    async deleteQuiz(id) {
      const r = await pool.query('DELETE FROM quizzes WHERE id = $1', [id]);
      return r.rowCount > 0;
    },
    async getUserByName(name) {
      const r = await pool.query('SELECT id, name, pass_hash FROM users WHERE name_lower = $1', [lower(name)]);
      return r.rows[0] || null;
    },
    async createUser(name, hash) {
      const r = await pool.query(
        'INSERT INTO users (name, name_lower, pass_hash) VALUES ($1, $2, $3) RETURNING id, name',
        [name, lower(name), hash]
      );
      return r.rows[0];
    },
    async createSession(userId) {
      const token = newToken();
      await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
      return token;
    },
    async getSessionUser(token) {
      if (!token || typeof token !== 'string') return null;
      const r = await pool.query(
        'SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]
      );
      return r.rows[0] || null;
    },
    async deleteSession(token) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    },
    async addResult({ userId, game, outcome, points }) {
      await pool.query(
        'INSERT INTO results (user_id, game, outcome, points, week_key) VALUES ($1, $2, $3, $4, $5)',
        [userId, game, outcome, points, weekKey()]
      );
    },
    async leaderboard(wk) {
      const r = await pool.query(`
        SELECT u.name,
               SUM(r.points)::int AS points,
               COUNT(*)::int AS games,
               COUNT(*) FILTER (WHERE r.outcome = 'win')::int  AS wins,
               COUNT(*) FILTER (WHERE r.outcome = 'draw')::int AS draws,
               COUNT(*) FILTER (WHERE r.outcome = 'loss')::int AS losses,
               COALESCE(SUM(r.points) FILTER (WHERE r.game = 'ttt'), 0)::int     AS ttt,
               COALESCE(SUM(r.points) FILTER (WHERE r.game = 'tttq'), 0)::int    AS tttq,
               COALESCE(SUM(r.points) FILTER (WHERE r.game = 'c4'), 0)::int      AS c4,
               COALESCE(SUM(r.points) FILTER (WHERE r.game = 'hangman'), 0)::int AS hangman,
               COALESCE(SUM(r.points) FILTER (WHERE r.game = 'quiz'), 0)::int    AS quiz
        FROM results r JOIN users u ON u.id = r.user_id
        WHERE r.week_key = $1
        GROUP BY u.id, u.name
        ORDER BY points DESC, wins DESC, u.name`, [wk]);
      return r.rows;
    },
    async weekWinners(limit) {
      const r = await pool.query(`
        SELECT week_key AS "weekKey", name, points FROM (
          SELECT r.week_key, u.name, SUM(r.points)::int AS points,
                 ROW_NUMBER() OVER (
                   PARTITION BY r.week_key
                   ORDER BY SUM(r.points) DESC,
                            SUM(CASE WHEN r.outcome = 'win' THEN 1 ELSE 0 END) DESC,
                            u.name
                 ) AS rn
          FROM results r JOIN users u ON u.id = r.user_id
          GROUP BY r.week_key, u.id, u.name
        ) t
        WHERE rn = 1
        ORDER BY week_key DESC
        LIMIT $1`, [limit]);
      return r.rows;
    }
  };
}

function createJson(file) {
  let db = { nextUserId: 1, users: [], sessions: {}, results: [] };
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  db.quizzes ||= [];
  db.nextQuizId ||= 1;
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
        e = { name: byId(r.userId)?.name ?? '?', points: 0, games: 0, wins: 0, draws: 0, losses: 0, ttt: 0, tttq: 0, c4: 0, hangman: 0, quiz: 0 };
        map.set(r.userId, e);
      }
      e.points += r.points;
      e.games++;
      e[OUTCOME_COL[r.outcome]]++;
      e[r.game] += r.points;
    }
    return [...map.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
  }

  return {
    kind: 'json',
    async listUsers() {
      return db.users.map((u) => ({ id: u.id, name: u.name, createdAt: u.createdAt || null }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ro'));
    },
    async setPassword(id, hash) {
      const u = byId(id);
      if (!u) return false;
      u.pass_hash = hash;
      save();
      return true;
    },
    async getUserById(id) {
      return byId(id) || null;
    },
    async deleteSessionsOf(id) {
      for (const [t, uid] of Object.entries(db.sessions)) if (uid === id) delete db.sessions[t];
      save();
    },
    async deleteUser(id) {
      const before = db.users.length;
      db.users = db.users.filter((u) => u.id !== id);
      db.results = db.results.filter((r) => r.userId !== id);
      for (const [t, uid] of Object.entries(db.sessions)) if (uid === id) delete db.sessions[t];
      save();
      return db.users.length < before;
    },
    async firstUserId() {
      return db.users[0]?.id ?? null;
    },
    async listQuizzes() {
      return db.quizzes;
    },
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
    },
    async getUserByName(name) {
      return db.users.find((u) => u.name_lower === lower(name)) || null;
    },
    async createUser(name, hash) {
      if (db.users.some((u) => u.name_lower === lower(name))) throw new Error('exists');
      const u = { id: db.nextUserId++, name, name_lower: lower(name), pass_hash: hash, createdAt: new Date().toISOString() };
      db.users.push(u);
      save();
      return { id: u.id, name: u.name };
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
      return u ? { id: u.id, name: u.name } : null;
    },
    async deleteSession(token) {
      delete db.sessions[token];
      save();
    },
    async addResult({ userId, game, outcome, points }) {
      db.results.push({ userId, game, outcome, points, weekKey: weekKey(), at: Date.now() });
      save();
    },
    leaderboard,
    async weekWinners(limit) {
      const weeks = [...new Set(db.results.map((r) => r.weekKey))].sort().reverse().slice(0, limit);
      const out = [];
      for (const w of weeks) {
        const top = (await leaderboard(w))[0];
        if (top) out.push({ weekKey: w, name: top.name, points: top.points });
      }
      return out;
    }
  };
}

module.exports = { createStorage, weekKey };
