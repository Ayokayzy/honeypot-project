const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { analyzeAndRespond } = require('./responder');

const app = express();
const PORT = process.env.PORT || 8080;

// Hosting platforms put a load balancer in front of us; without this req.ip
// records the proxy's address instead of the visitor's, which would make the
// ip_address column useless for attribution.
app.set('trust proxy', true);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Simple health check — confirms the server is up and reachable.
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Honeypot server is active', time: new Date().toISOString() });
});

// Initial "scholarship application" submission — this is the first bite of the bait.
app.post('/api/apply', (req, res) => {
  const { full_name, email, phone, message } = req.body;
  const ip_address = req.ip;
  const user_agent = req.headers['user-agent'] || '';

  const stmt = db.prepare(`
    INSERT INTO applicants (full_name, email, phone, message, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(full_name, email, phone, message, ip_address, user_agent);
  const applicantId = info.lastInsertRowid;

  // Log the initial message as part of the conversation too, so all interaction lives in one table.
  const { tags, reply } = analyzeAndRespond(message || '');
  db.prepare(`
    INSERT INTO conversation_log (applicant_id, sender, content, tactic_tags)
    VALUES (?, 'scammer', ?, ?)
  `).run(applicantId, message || '', tags.join(','));

  db.prepare(`
    INSERT INTO conversation_log (applicant_id, sender, content, tactic_tags)
    VALUES (?, 'persona', ?, NULL)
  `).run(applicantId, reply);

  res.json({ applicant_id: applicantId, reply });
});

// Follow-up messages in the ongoing "conversation" with a given applicant.
app.post('/api/message', (req, res) => {
  const { applicant_id, message } = req.body;

  if (!applicant_id || !message) {
    return res.status(400).json({ error: 'applicant_id and message are required' });
  }

  const { tags, reply } = analyzeAndRespond(message);

  db.prepare(`
    INSERT INTO conversation_log (applicant_id, sender, content, tactic_tags)
    VALUES (?, 'scammer', ?, ?)
  `).run(applicant_id, message, tags.join(','));

  db.prepare(`
    INSERT INTO conversation_log (applicant_id, sender, content, tactic_tags)
    VALUES (?, 'persona', ?, NULL)
  `).run(applicant_id, reply);

  res.json({ reply });
});

// Retrieve full logged data — used by the analysis script and for demo/screenshot purposes.
// This returns names, emails, phone numbers and IPs, so it is token-gated once deployed:
// set LOGS_TOKEN and pass it as ?token= or an X-Logs-Token header. Left open on localhost
// so local inspection keeps working.
app.get('/api/logs', (req, res) => {
  const token = process.env.LOGS_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && !token) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (token) {
    const provided = req.get('x-logs-token') || req.query.token;
    if (provided !== token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const applicants = db.prepare('SELECT * FROM applicants ORDER BY created_at').all();
  const conversations = db.prepare('SELECT * FROM conversation_log ORDER BY created_at').all();
  res.json({ applicants, conversations });
});

app.listen(PORT, () => {
  console.log(`Honeypot server running at http://localhost:${PORT}`);
});
