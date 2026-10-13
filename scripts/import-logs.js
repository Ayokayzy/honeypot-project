#!/usr/bin/env node
//
// Loads a GET /api/logs payload — saved from a deployed instance — into a local
// SQLite database so analyze.js can report on it.
//
//   curl "https://<app>.onrender.com/api/logs?token=$LOGS_TOKEN" > class-data.json
//   node scripts/import-logs.js class-data.json
//   DB_PATH=data/class-data.db npm run analyze
//
// Writes to data/class-data.db by default rather than data/honeypot.db, so an
// accidental run cannot overwrite locally collected research data.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_DB = path.join(ROOT, "data", "class-data.db");

// Paths inside the project print relative; anything outside prints absolute, since
// path.relative would otherwise emit a long chain of "..".
function shortPath(target) {
  const rel = path.relative(ROOT, target);
  return rel.startsWith("..") ? target : rel;
}

function usage(message) {
  if (message) console.error(`\n  ${message}`);
  console.error(`
  Usage: node scripts/import-logs.js <payload.json> [--db <path>] [--force]

    <payload.json>   JSON saved from GET /api/logs
    --db <path>      target database (default: data/class-data.db)
    --force          overwrite a target that already holds rows
`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { input: null, db: DEFAULT_DB, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") out.force = true;
    else if (arg === "--db") {
      if (!argv[i + 1]) usage("--db needs a path.");
      out.db = path.resolve(argv[++i]);
    } else if (arg.startsWith("-")) usage(`Unknown option: ${arg}`);
    else if (out.input) usage("Only one input file can be imported at a time.");
    else out.input = path.resolve(arg);
  }
  if (!out.input) usage("No input file given.");
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!fs.existsSync(args.input)) usage(`No such file: ${args.input}`);

let payload;
try {
  payload = JSON.parse(fs.readFileSync(args.input, "utf8"));
} catch (err) {
  usage(`${path.basename(args.input)} is not valid JSON: ${err.message}`);
}

// The most common mistake is saving an error response instead of the data: a wrong
// or missing token returns JSON too, so curl reports success and the file looks fine.
if (payload && payload.error) {
  usage(
    `That file holds an error response, not log data: "${payload.error}".\n` +
    `  GET /api/logs needs LOGS_TOKEN — pass it as ?token=<value> or an X-Logs-Token header.`
  );
}
if (!payload || !Array.isArray(payload.applicants) || !Array.isArray(payload.conversations)) {
  usage(
    "That file is not a /api/logs payload — it should be an object with\n" +
    "  \"applicants\" and \"conversations\" arrays."
  );
}

// Reuse backend/db.js so the schema and pragmas have a single definition. It reads
// DB_PATH, creates any missing tables and makes the parent directory.
process.env.DB_PATH = args.db;
const db = require("../backend/db.js");

const existingApplicants = db.prepare("SELECT COUNT(*) AS n FROM applicants").get().n;
const existingLog = db.prepare("SELECT COUNT(*) AS n FROM conversation_log").get().n;

if ((existingApplicants > 0 || existingLog > 0) && !args.force) {
  console.error(
    `\n  ${shortPath(args.db)} already holds ${existingApplicants} applicants ` +
    `and ${existingLog} log rows.\n  Re-run with --force to replace them, or pass ` +
    `--db <path> to import somewhere else.\n`
  );
  db.close();
  process.exit(1);
}

const insertApplicant = db.prepare(`
  INSERT INTO applicants (id, full_name, email, phone, message, ip_address, user_agent, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertLogEntry = db.prepare(`
  INSERT INTO conversation_log (id, applicant_id, sender, content, tactic_tags, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// SQLite stores created_at as 'YYYY-MM-DD HH:MM:SS' via datetime('now'). Rows arriving
// without one get the import time rather than NULL, which would break ORDER BY created_at.
const now = new Date().toISOString().replace("T", " ").slice(0, 19);
const val = (v) => (v === undefined ? null : v);

const load = db.transaction((data) => {
  if (args.force) {
    db.prepare("DELETE FROM conversation_log").run();
    db.prepare("DELETE FROM applicants").run();
  }
  for (const a of data.applicants) {
    insertApplicant.run(
      val(a.id), val(a.full_name), val(a.email), val(a.phone),
      val(a.message), val(a.ip_address), val(a.user_agent), a.created_at || now
    );
  }
  for (const c of data.conversations) {
    insertLogEntry.run(
      val(c.id), val(c.applicant_id), val(c.sender),
      val(c.content), val(c.tactic_tags), c.created_at || now
    );
  }
});

try {
  load(payload);
} catch (err) {
  console.error(`\n  Import failed, nothing was written: ${err.message}\n`);
  db.close();
  process.exit(1);
}

const applicants = db.prepare("SELECT COUNT(*) AS n FROM applicants").get().n;
const logRows = db.prepare("SELECT COUNT(*) AS n FROM conversation_log").get().n;
const orphans = db.prepare(`
  SELECT COUNT(*) AS n FROM conversation_log c
  LEFT JOIN applicants a ON a.id = c.applicant_id
  WHERE a.id IS NULL
`).get().n;
const taggedPersona = db.prepare(
  "SELECT COUNT(*) AS n FROM conversation_log WHERE sender = 'persona' AND tactic_tags IS NOT NULL"
).get().n;
const distinctIps = db.prepare(
  "SELECT COUNT(DISTINCT ip_address) AS n FROM applicants WHERE ip_address IS NOT NULL"
).get().n;

db.close();

const rel = shortPath(args.db);
console.log(`
  Imported into ${rel}
    applicants:          ${applicants}
    conversation rows:   ${logRows}`);

if (orphans > 0) {
  console.log(`    log rows with no matching applicant: ${orphans}`);
}
if (taggedPersona > 0) {
  console.log(`    persona rows carrying tactic_tags:   ${taggedPersona} (expected 0)`);
}
if (applicants > 1 && distinctIps === 1) {
  console.log(`
  All ${applicants} applicants share one ip_address — expected when a group submits
  from the same network, since NAT presents a single public address. Do not read it
  as distinct sources.`);
}
console.log(`
  Report on it with:
    DB_PATH=${rel} npm run analyze
`);
