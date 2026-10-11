const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "honeypot.db");
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const applicantCount = db
  .prepare("SELECT COUNT(*) AS n FROM applicants")
  .get().n;

const scammerRows = db
  .prepare(
    "SELECT tactic_tags FROM conversation_log WHERE sender = 'scammer' AND tactic_tags IS NOT NULL"
  )
  .all();

const totalScammerMessages = scammerRows.length;

const tally = new Map();
let unclassifiedCount = 0;

for (const row of scammerRows) {
  const tags = row.tactic_tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const uniqueTags = new Set(tags);

  if (uniqueTags.has("unclassified")) {
    unclassifiedCount += 1;
  }

  for (const tag of uniqueTags) {
    if (tag === "unclassified") continue;
    tally.set(tag, (tally.get(tag) || 0) + 1);
  }
}

const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);

const pct = (n) =>
  totalScammerMessages === 0
    ? "0.0%"
    : ((n / totalScammerMessages) * 100).toFixed(1) + "%";

const line = (ch = "-", n = 60) => ch.repeat(n);

console.log();
console.log(line("="));
console.log("  Honeypot Conversation Analysis Report");
console.log(line("="));
console.log();
console.log(`  Total simulated interactions (applicants): ${applicantCount}`);
console.log(`  Total scammer messages analyzed:           ${totalScammerMessages}`);
console.log();
console.log(line());
console.log("  Tactic Frequency (sorted, most frequent first)");
console.log(line());

const nameCol = 28;
const countCol = 8;
const pctCol = 10;

console.log(
  "  " +
    "Tactic".padEnd(nameCol) +
    "Count".padStart(countCol) +
    "Share".padStart(pctCol)
);
console.log("  " + line("-", nameCol + countCol + pctCol));

if (sorted.length === 0) {
  console.log("  (no classified tactics found)");
} else {
  for (const [tag, count] of sorted) {
    console.log(
      "  " +
        tag.padEnd(nameCol) +
        String(count).padStart(countCol) +
        pct(count).padStart(pctCol)
    );
  }
}

console.log();
console.log(line());
console.log(
  `  Messages with no clear tactic match (unclassified): ${unclassifiedCount}` +
    (totalScammerMessages > 0 ? `  (${pct(unclassifiedCount)})` : "")
);
console.log(line());
console.log();
console.log(
  '  Note: this table can be labeled "Table 1 — Tactic frequency across'
);
console.log('  simulated test interactions" for the paper.');
console.log();

db.close();
