// Picks a persona reply for a given scammer message. Tactic detection lives in
// src/detect.js so this file only owns the reply pools and the random pick.

const { detectTactics } = require('../src/detect');

const REPLIES_BY_TAG = {
  urgency: [
    "Oh wow, okay — I didn't realize it was that time-sensitive. Let me see what I can do.",
    "That's a lot sooner than I expected. Can you remind me exactly what you need from me by when?",
  ],
  payment_request: [
    "I wasn't told there'd be a fee for this — is that normal for the scholarship process?",
    "Okay, before I send anything, can you tell me which office this payment officially goes to?",
  ],
  authority_claim: [
    "Do you have something official I can check this against, just so I have it on file?",
    "Got it. Is there a reference number for this so I can cross-check with the school?",
  ],
  personal_info_request: [
    "That feels like a lot of personal detail for this stage — is this the usual process?",
    "Sure, I can share that once I understand exactly why it's needed at this step.",
  ],
};

const DEFAULT_REPLIES = [
  "Okay, I see. Can you explain a bit more about how this works?",
  "Thanks for reaching out — I want to make sure I understand this correctly before proceeding.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function analyzeAndRespond(message) {
  const tags = detectTactics(message);
  const pool = tags.flatMap((tag) => REPLIES_BY_TAG[tag] || []);
  const reply = pool.length > 0 ? pick(pool) : pick(DEFAULT_REPLIES);

  return {
    tags: tags.length > 0 ? tags : ['unclassified'],
    reply,
  };
}

module.exports = { analyzeAndRespond };
