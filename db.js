// db.js - SQLite cho người chơi & lệnh rút
const Database = require('better-sqlite3');

const db = new Database('game.db');

// Tạo bảng nếu chưa có
db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id TEXT UNIQUE,
  username TEXT,
  rank INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  gold INTEGER DEFAULT 0,
  token INTEGER DEFAULT 0,
  energy INTEGER DEFAULT 0,
  last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER,
  tokens INTEGER,
  status TEXT DEFAULT 'pending', -- pending / approved / rejected / done
  admin_note TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(player_id) REFERENCES players(id)
);
`);

module.exports = db;
