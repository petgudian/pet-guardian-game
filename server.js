// server.js - API game + admin
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_change_me';

app.use(cors());
app.use(bodyParser.json());

// ===== Helper DB =====
function getPlayerByTgId(tg_id) {
  return db.prepare('SELECT * FROM players WHERE tg_id = ?').get(tg_id);
}

function upsertPlayer({ tg_id, username, state }) {
  let player = getPlayerByTgId(tg_id);
  if (!player) {
    const info = db
      .prepare(`
        INSERT INTO players (tg_id, username, rank, level, gold, token, energy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        String(tg_id),
        username || null,
        state.rank || 0,
        state.level || 1,
        state.gold || 0,
        state.token || 0,
        state.energy || 0
      );
    player = db
      .prepare('SELECT * FROM players WHERE id = ?')
      .get(info.lastInsertRowid);
  } else {
    db.prepare(`
      UPDATE players
      SET username = COALESCE(?, username),
          rank = ?,
          level = ?,
          gold = ?,
          token = ?,
          energy = ?,
          last_seen = CURRENT_TIMESTAMP
      WHERE tg_id = ?
    `).run(
      username || player.username,
      state.rank || player.rank,
      state.level || player.level,
      state.gold || player.gold,
      state.token || player.token,
      state.energy || player.energy,
      String(tg_id)
    );
    player = getPlayerByTgId(tg_id);
  }
  return player;
}

// ===== API PUBLIC (GAME) =====

// sync trạng thái người chơi
app.post('/api/player/sync', (req, res) => {
  const { tg_id, username, state } = req.body || {};
  if (!tg_id || !state) {
    return res.status(400).json({ error: 'tg_id & state required' });
  }
  try {
    const player = upsertPlayer({
      tg_id: String(tg_id),
      username,
      state,
    });
    res.json({ ok: true, player });
  } catch (e) {
    console.error('sync error', e);
    res.status(500).json({ error: 'server error' });
  }
});

// tạo lệnh rút (chỉ lưu DB, không chuyển tiền)
app.post('/api/withdraw/create', (req, res) => {
  const { tg_id, tokens } = req.body || {};
  if (!tg_id || !tokens) {
    return res.status(400).json({ error: 'tg_id & tokens required' });
  }
  const t = Number(tokens);
  if (isNaN(t) || t <= 0) {
    return res.status(400).json({ error: 'invalid tokens' });
  }

  let player = getPlayerByTgId(String(tg_id));
  if (!player) {
    player = upsertPlayer({
      tg_id: String(tg_id),
      username: null,
      state: { rank: 0, level: 1, gold: 0, token: 0, energy: 0 },
    });
  }

  const info = db
    .prepare(
      'INSERT INTO withdrawals (player_id, tokens, status) VALUES (?, ?, ?)'
    )
    .run(player.id, t, 'pending');

  const wd = db
    .prepare('SELECT * FROM withdrawals WHERE id = ?')
    .get(info.lastInsertRowid);

  res.json({ ok: true, withdraw: wd });
});

// ===== ADMIN LOGIN / AUTH =====
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'invalid password' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, {
    expiresIn: '12h',
  });
  res.json({ token });
});

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'no token' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === 'admin') {
      req.admin = decoded;
      return next();
    }
  } catch (e) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// ===== ADMIN API =====

// lấy 1 player theo tg_id
app.get('/api/admin/player/:tg_id', requireAdmin, (req, res) => {
  const tg_id = String(req.params.tg_id);
  const player = getPlayerByTgId(tg_id);
  if (!player) return res.status(404).json({ error: 'player not found' });

  const withdraws = db
    .prepare(
      'SELECT * FROM withdrawals WHERE player_id = ? ORDER BY created_at DESC'
    )
    .all(player.id);

  res.json({ player, withdraws });
});

// list players
app.get('/api/admin/players', requireAdmin, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (!q) {
    rows = db
      .prepare(
        'SELECT * FROM players ORDER BY last_seen DESC LIMIT 50'
      )
      .all();
  } else {
    rows = db
      .prepare(
        'SELECT * FROM players WHERE tg_id LIKE ? OR username LIKE ? ORDER BY last_seen DESC LIMIT 50'
      )
      .all(`%${q}%`, `%${q}%`);
  }
  res.json(rows);
});

// cộng/trừ gold, token
app.post('/api/admin/player/update-balance', requireAdmin, (req, res) => {
  const { tg_id, addGold, addToken } = req.body || {};
  if (!tg_id) return res.status(400).json({ error: 'tg_id required' });
  const player = getPlayerByTgId(String(tg_id));
  if (!player) return res.status(404).json({ error: 'player not found' });

  const g = Number(addGold || 0);
  const t = Number(addToken || 0);

  const newGold = Math.max(0, player.gold + g);
  const newToken = Math.max(0, player.token + t);

  db.prepare(
    'UPDATE players SET gold = ?, token = ?, last_seen = CURRENT_TIMESTAMP WHERE tg_id = ?'
  ).run(newGold, newToken, String(tg_id));

  const updated = getPlayerByTgId(String(tg_id));
  res.json({ ok: true, player: updated });
});

// list lệnh rút
app.get('/api/admin/withdraws', requireAdmin, (req, res) => {
  const status = req.query.status || '';
  let rows;
  if (status) {
    rows = db
      .prepare(
        `SELECT w.*, p.tg_id, p.username
         FROM withdrawals w
         JOIN players p ON w.player_id = p.id
         WHERE w.status = ?
         ORDER BY w.created_at DESC`
      )
      .all(status);
  } else {
    rows = db
      .prepare(
        `SELECT w.*, p.tg_id, p.username
         FROM withdrawals w
         JOIN players p ON w.player_id = p.id
         ORDER BY w.created_at DESC
         LIMIT 100`
      )
      .all();
  }
  res.json(rows);
});

// đổi trạng thái lệnh rút
app.post('/api/admin/withdraws/:id/status', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { status, note } = req.body || {};
  if (!['pending', 'approved', 'rejected', 'done'].includes(status)) {
    return res.status(400).json({ error: 'invalid status' });
  }
  const wd = db
    .prepare('SELECT * FROM withdrawals WHERE id = ?')
    .get(id);
  if (!wd) return res.status(404).json({ error: 'not found' });

  db.prepare(
    'UPDATE withdrawals SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(status, note || null, id);

  const updated = db
    .prepare('SELECT * FROM withdrawals WHERE id = ?')
    .get(id);
  res.json({ ok: true, withdraw: updated });
});

app.listen(PORT, () => {
  console.log('Backend running on port', PORT);
});
