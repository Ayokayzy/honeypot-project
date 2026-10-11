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

## Current state

The bait page is `frontend/index.html` — a single self-contained file (inline CSS and JS, no build).
It submits to `/api/apply`, then swaps the form out for a chat thread driven by `/api/message`,
holding `applicant_id` in a module-scoped variable, so a page reload ends the conversation.

`scripts/analyze.js` reads the DB read-only and prints the tactic-frequency table intended as
"Table 1" in the write-up. It has its own `package.json`, but `npm run analyze` from the root works too.

Not yet present: rate limiting on the public write endpoints, and any persistence of `applicant_id`
across reloads.
