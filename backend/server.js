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

// Statements are prepared once at startup instead of inside each handler, and the
// multi-row writes below run inside a transaction so a submission costs one commit
// rather than three. Both matter when a room full of people submits at once.
const insertApplicant = db.prepare(`
  INSERT INTO applicants (full_name, email, phone, message, ip_address, user_agent)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertLogEntry = db.prepare(`
  INSERT INTO conversation_log (applicant_id, sender, content, tactic_tags)
  VALUES (?, ?, ?, ?)
`);

// Writes the applicant plus both sides of the opening exchange. The scammer's first
// message is logged here too, so conversation_log holds the whole interaction.
const recordApplication = db.transaction((applicant, openingMessage, tags, reply) => {
  const info = insertApplicant.run(
    applicant.full_name, applicant.email, applicant.phone,
    applicant.message, applicant.ip_address, applicant.user_agent
  );
  const applicantId = info.lastInsertRowid;
  insertLogEntry.run(applicantId, 'scammer', openingMessage, tags);
  insertLogEntry.run(applicantId, 'persona', reply, null);
  return applicantId;
});

const recordExchange = db.transaction((applicantId, message, tags, reply) => {
  insertLogEntry.run(applicantId, 'scammer', message, tags);
  insertLogEntry.run(applicantId, 'persona', reply, null);
});

const selectApplicants = db.prepare('SELECT * FROM applicants ORDER BY created_at');
const selectConversations = db.prepare('SELECT * FROM conversation_log ORDER BY created_at');

// Simple health check — confirms the server is up and reachable.
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Honeypot server is active', time: new Date().toISOString() });
});

// Initial "scholarship application" submission — this is the first bite of the bait.
app.post('/api/apply', (req, res) => {
  const { full_name, email, phone, message } = req.body;
  const ip_address = req.ip;
  const user_agent = req.headers['user-agent'] || '';

  const { tags, reply } = analyzeAndRespond(message || '');
  const applicantId = recordApplication(
    { full_name, email, phone, message, ip_address, user_agent },
    message || '',
    tags.join(','),
    reply
  );

  res.json({ applicant_id: applicantId, reply });
});

// Follow-up messages in the ongoing "conversation" with a given applicant.
app.post('/api/message', (req, res) => {
  const { applicant_id, message } = req.body;

  if (!applicant_id || !message) {
    return res.status(400).json({ error: 'applicant_id and message are required' });
  }

  const { tags, reply } = analyzeAndRespond(message);
  recordExchange(applicant_id, message, tags.join(','), reply);

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

  const applicants = selectApplicants.all();
  const conversations = selectConversations.all();
  res.json({ applicants, conversations });
});

app.listen(PORT, () => {
  console.log(`Honeypot server running at http://localhost:${PORT}`);
});
