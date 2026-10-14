const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH lets a deployment point this at a mounted volume. The directory is created
// first because a fresh container has no data/ dir (it holds only the ignored .db file,
// so git does not carry it) and better-sqlite3 will not create missing parents.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'honeypot.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Write-ahead logging lets readers run while a write is in flight and commits without
// rewriting the rollback journal each time; NORMAL stops fsync-ing on every single commit.
// Under a burst of concurrent submissions the default (journal_mode=delete, synchronous=FULL)
// serialises every insert behind a disk flush, which is the dominant cost in this app.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    message TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conversation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id INTEGER,
    sender TEXT, -- 'scammer' or 'persona'
    content TEXT,
    tactic_tags TEXT, -- comma-separated tags applied by the auto-responder logic
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (applicant_id) REFERENCES applicants(id)
  );

  CREATE TABLE IF NOT EXISTS llm_counters (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`);

// Additive migration: SQLite has no ADD COLUMN IF NOT EXISTS, so we inspect
// pragma_table_info and only add what's missing. This leaves existing deployments
// (which already have populated applicants/conversation_log rows) in place.
function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function addColumn(table, column, decl) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

addColumn('applicants', 'tactic_choice', 'TEXT');
addColumn('applicants', 'turns_used', 'INTEGER NOT NULL DEFAULT 0');
addColumn('applicants', 'closed', 'INTEGER NOT NULL DEFAULT 0');
addColumn('conversation_log', 'source', "TEXT"); // 'opening' | 'suggestion' | 'typed'
addColumn('conversation_log', 'reply_origin', "TEXT"); // 'ai' | 'fallback'

// Seed the lifetime-call counter row so increments can run unconditionally.
db.prepare("INSERT OR IGNORE INTO llm_counters (key, value) VALUES ('calls_total', 0)").run();

module.exports = db;
