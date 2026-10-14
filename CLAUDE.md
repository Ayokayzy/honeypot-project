# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A scam-baiting honeypot. It presents itself as a "scholarship application" site; when a scammer engages,
the server logs everything, classifies the social-engineering tactics used, and replies in the voice of a
credulous applicant persona to keep the conversation going. The research output is the logged conversation
data, not the app itself.

## Commands

All npm dependencies live in `backend/`, but the server is normally launched from the **project root** so that
its relative paths (`../frontend`, `../data`) resolve:

```
npm install                   # install deps (root package.json drives deployment too)
npm start                     # run from project root — serves on http://localhost:8080
npm run analyze               # tactic-frequency report from the local DB
```

`PORT`, `DB_PATH` and `LOGS_TOKEN` are read from the environment; the defaults above apply when unset.

There is no build step, no linter, and no test suite (`npm test` is still the npm placeholder that exits 1).
To verify the server is up: `curl http://localhost:8080/api/ping`.

Open the bait page at http://localhost:8080 — Express serves `frontend/` statically at the site root. Do **not**
open `frontend/index.html` through VS Code Live Server or `file://`: the page's fetches are relative
(`API_BASE = ""`), so from another origin they hit that origin instead and fail with 405 or a network error.

Inspect logged data directly with `sqlite3 data/honeypot.db` or via `GET /api/logs`.

### Reporting on a deployed session

`GET /api/logs` is the only way to retrieve data off a deployment, because the disk is ephemeral.
Save it and import it into a local database:

```
curl "https://<app>.onrender.com/api/logs?token=$LOGS_TOKEN" > class-data.json
npm run import-logs -- class-data.json          # writes data/class-data.db
DB_PATH=data/class-data.db npm run analyze
```

`import-logs.js` defaults to `data/class-data.db`, never `data/honeypot.db`, so a stray run cannot
overwrite locally collected data; `--db <path>` chooses another target and `--force` replaces a target
that already holds rows. It preserves the original `id` and `created_at` values, and reuses the schema
from `backend/db.js` rather than restating the DDL. Both it and `analyze.js` read `DB_PATH`, matching
`backend/db.js`.

Saved payloads carry the same personal data as the database, so `class-data.json`, `*-logs.json` and
`logs-*.json` are gitignored.

## Architecture

Three backend modules, no framework beyond Express 5 + better-sqlite3:

- `backend/db.js` — opens `data/honeypot.db` and runs `CREATE TABLE IF NOT EXISTS` on require. Schema changes
  go here, but note this only creates missing tables; it will not migrate an existing `honeypot.db`, so an
  altered column needs a manual migration or a deleted db file.
- `backend/responder.js` — the classification engine. A `RULES` array maps case-insensitive keyword lists to a
  tactic tag (`urgency`, `payment_request`, `authority_claim`, `personal_info_request`) and a pool of persona
  replies. `analyzeAndRespond()` returns every matching tag plus one reply picked at random from the union of
  matched pools, falling back to `DEFAULT_REPLIES` and the `unclassified` tag. Adding a tactic means adding a
  rule object — nothing else needs to change.
- `backend/server.js` — routes only; all analysis is delegated to the responder.

### Data model and the invariant that matters

Two tables: `applicants` (one row per initial submission, with `ip_address` and `user_agent` captured for
attribution) and `conversation_log` (every message, keyed by `applicant_id`).

The deliberate design choice to preserve: **the whole interaction lives in `conversation_log`**, including the
message that came in with the original application form. So `POST /api/apply` writes three rows — the applicant,
their opening message as `sender='scammer'`, and the persona's answer as `sender='persona'`. Only scammer rows
carry `tactic_tags`; persona rows store NULL. Analysis code can therefore read one table in `created_at` order
and see a complete transcript.

### Routes

- `GET  /api/ping` — health check.
- `POST /api/apply` — first contact; creates the applicant and returns `{ applicant_id, reply }`. The client must
  hold onto `applicant_id` for the rest of the conversation.
- `POST /api/message` — follow-up turns; requires `applicant_id` and `message`.
- `GET  /api/logs` — dumps both tables, for the analysis script and demo screenshots.

## Deployment

Deployed on Render's free tier as a Blueprint; `render.yaml` configures the service, so the
dashboard needs nothing filled in. `npm ci` builds, `npm start` runs, `/api/ping` is the health check.

Two consequences of the free tier worth remembering:

- **The disk is ephemeral and the service sleeps after ~15 minutes idle.** Conversations logged in
  production are lost on every restart, sleep and redeploy. The authoritative research data is the
  local `data/honeypot.db`; treat the deployed instance as a demo, not as a collection point. Moving
  to a host with a persistent volume (Fly.io) or hosted Postgres/Turso is what changes this.
- First request after sleeping takes ~30-60s to answer.

`GET /api/logs` requires `LOGS_TOKEN` in production (as `?token=` or an `X-Logs-Token` header) and
404s when the variable is unset; Render generates the value. Locally the route stays open.

The bait page carries a `noindex` meta tag and `frontend/robots.txt` disallows everything. This is
deliberate and should stay: the page imitates an institutional scholarship portal, so a real
applicant arriving via search is a failure mode. Keeping it unindexed preserves the deception for
people sent the link without exposing it to people who weren't.

`data/` is gitignored because the DB holds names, emails, phone numbers and IPs.

### Deploying somewhere other than Render

Nothing in the app is Render-specific: it reads `PORT`, `DB_PATH`, `LOGS_TOKEN`, `ADMIN_PASSWORD`,
the `LLM_*` settings and the classroom caps from the environment, binds all interfaces, and trusts
the proxy. Only two things need attention on a new host.

**Declare the right Node version.** `package.json` > `engines` > `node` must stay at `>=22`:
`better-sqlite3@13` itself requires Node >=22, and build platforms resolve the runtime from our
`engines` field, not from the dependency's. With `>=20` declared, Railway's Railpack installed Node
20.20.2 and the prebuilt binding segfaulted inside `new Database()` — the process died before
`app.listen`, so the build looked clean and only the health check failed, with nothing in the log but
`Segmentation fault`. Loosening `engines` below the strictest dependency reintroduces this.

**Skip the native build.** `better-sqlite3` ships prebuilt binaries in `prebuilds/` and loads them
in its own `lib/binding.js`, but it also has a `binding.gyp` and no install script, so npm runs
`node-gyp rebuild` by default and compiles SQLite from source — minutes of build time producing a
binary that is never loaded. Where the install command is yours, pass `--ignore-scripts`. Where the
platform runs `npm install` for you (Railway, Heroku and most buildpack hosts), set the environment
variable `NPM_CONFIG_IGNORE_SCRIPTS=true`, which npm honours the same way. Either drops the install
to a couple of seconds.

**Point `DB_PATH` at a mounted volume** if the host offers one, otherwise the database is lost on
every restart — including the `llm_counters` row holding the lifetime LLM call budget.

Railway specifically: connect the repo, set the env vars above, set the healthcheck to `/api/ping`,
and leave the per-service Serverless setting **off** — it sleeps a service after ~5 minutes idle and
the waking request can return a 502. Railway's Config-as-Code (`railway.json`) is deprecated, with
legacy services supported only until 2026-12-01, so configure it in the dashboard rather than
committing a config file.

### Load characteristics

Measured with 90 concurrent clients each submitting a form plus three follow-ups (450 requests),
in containers capped to match Render's CPU allowances:

| Plan | CPU | page p50 | page p95 | apply p95 | throughput |
|---|---|---|---|---|---|
| Free | 0.1 | 3758ms | 8666ms | 1201ms | 45 req/s |
| Starter | 0.5 | 205ms | 419ms | 404ms | 853 req/s |

Nothing failed on either tier — the free tier is slow, not broken. A classroom-sized burst needs
Starter; free is only adequate for a handful of people at a time, and it also sleeps after ~15
minutes idle with a 30-60s cold start.

The write path is the part that was optimised (WAL, batched transactions, hoisted statements). SQLite
still allows only one writer at a time, which is fine at this scale but is the ceiling if load grows.

A build takes ~2.5 minutes because `better-sqlite3` has a `binding.gyp` and no install script, so npm
compiles it from source with node-gyp rather than fetching a prebuilt binary.

### Everyone on one network shares an IP

When a group submits from the same venue WiFi, every row gets the same `ip_address`, because the NAT
presents one public address. Two consequences:

- **Do not add IP-based rate limiting** without accounting for this. A naive per-IP limiter treats a
  whole room as a single client and locks everyone out after the first few submissions.
- `ip_address` does not distinguish participants in that data, so it cannot be used to count distinct
  sources in any analysis of a group session.

Also note `trust proxy` is set to `true`, which takes the left-most `X-Forwarded-For` value. That is
client-supplied and therefore spoofable; it is fine for a demo but not evidence of origin.

## Current state

The bait page is `frontend/index.html` — a single self-contained file (inline CSS and JS, no build).
It submits to `/api/apply`, then swaps the form out for a chat thread driven by `/api/message`,
holding `applicant_id` in a module-scoped variable, so a page reload ends the conversation.

`scripts/analyze.js` reads the DB read-only and prints the tactic-frequency table intended as
"Table 1" in the write-up. It has its own `package.json`, but `npm run analyze` from the root works too.

Not yet present: rate limiting on the public write endpoints, and any persistence of `applicant_id`
across reloads.
