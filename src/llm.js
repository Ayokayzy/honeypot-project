// LLM provider shim. One function, complete({system, messages, maxTokens}), that
// hits whichever provider LLM_PROVIDER points at via plain fetch (no SDK). Timeouts,
// per-minute rate caps and a lifetime call budget (persisted in SQLite) all throw
// synchronously — callers always fall back to the scripted responder rather than
// surfacing an AI error to the user.

const db = require('../backend/db');

const PROVIDER = (process.env.LLM_PROVIDER || 'none').toLowerCase();
const MODEL = process.env.LLM_MODEL ||
  (PROVIDER === 'anthropic' ? 'claude-haiku-5-5' : 'openai/gpt-oss-20b');
const TIMEOUT_MS = 8000;
const RPM = Number(process.env.LLM_RPM || 20);
const CALL_BUDGET = Number(process.env.LLM_CALL_BUDGET || 600);

// In-memory metrics; the lifetime calls_total also lives in SQLite so a restart
// doesn't reset the budget. The counts are read by /api/stats.
const metrics = {
  callsSession: 0,
  fallbacks: 0,
  failures: 0,
};

const readTotal = db.prepare("SELECT value AS v FROM llm_counters WHERE key = 'calls_total'");
const bumpTotal = db.prepare(
  "UPDATE llm_counters SET value = value + 1 WHERE key = 'calls_total'"
);

function totalCalls() {
  const row = readTotal.get();
  return row ? row.v : 0;
}

// Minute-window ring. We don't block or queue — if the room is already pushing
// the limiter we refuse the call and the handler falls back. Pacing would just
// mean students stare at a spinner.
const minuteWindow = [];

function pruneWindow(now) {
  const cutoff = now - 60_000;
  while (minuteWindow.length > 0 && minuteWindow[0] < cutoff) minuteWindow.shift();
}

function checkBudget() {
  if (PROVIDER === 'none') {
    throw new Error('LLM provider disabled (LLM_PROVIDER=none)');
  }
  const now = Date.now();
  pruneWindow(now);
  if (minuteWindow.length >= RPM) {
    throw new Error(`LLM rpm limit: ${RPM}/min reached`);
  }
  if (totalCalls() >= CALL_BUDGET) {
    throw new Error(`LLM call budget spent (${CALL_BUDGET})`);
  }
  minuteWindow.push(now);
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic({ system, messages, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');

  const body = {
    model: MODEL,
    max_tokens: maxTokens || 400,
    system,
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  };

  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  const text = block ? block.text : '';
  if (!text) throw new Error('anthropic: empty response');
  return text;
}

async function callGroq({ system, messages, maxTokens }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not set');

  const body = {
    model: MODEL,
    max_tokens: maxTokens || 400,
    messages: [
      { role: 'system', content: system },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ],
  };

  const res = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`groq ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  if (!text) throw new Error('groq: empty response');
  return text;
}

async function complete({ system, messages, maxTokens }) {
  checkBudget();
  metrics.callsSession += 1;
  bumpTotal.run();
  try {
    if (PROVIDER === 'anthropic') return await callAnthropic({ system, messages, maxTokens });
    if (PROVIDER === 'groq') return await callGroq({ system, messages, maxTokens });
    throw new Error(`Unknown LLM provider: ${PROVIDER}`);
  } catch (err) {
    metrics.failures += 1;
    throw err;
  }
}

function recordFallback() {
  metrics.fallbacks += 1;
}

function stats() {
  return {
    provider: PROVIDER,
    model: PROVIDER === 'none' ? null : MODEL,
    calls_used: totalCalls(),
    calls_budget: CALL_BUDGET,
    rpm_limit: RPM,
    calls_this_run: metrics.callsSession,
    fallbacks: metrics.fallbacks,
    failures: metrics.failures,
  };
}

module.exports = { complete, recordFallback, stats };
