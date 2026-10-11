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
cd backend && npm install     # install deps
node backend/server.js        # run from project root — serves on http://localhost:8080
```

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

## Current state

`frontend/` and `scripts/` exist but are empty. `server.js` already mounts `frontend/` as static at the site
root, so the bait page belongs there and will be served without any route changes. The analysis tooling that
`/api/logs` was written for is the intended contents of `scripts/`.
