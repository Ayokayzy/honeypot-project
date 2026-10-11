// Rule-based tactic detection + scripted persona responses.
// Each rule: keywords to match (case-insensitive), the tactic tag it represents,
// and a pool of persona replies to pick from (keeps responses varied, not robotic).

const RULES = [
  {
    tag: 'urgency',
    keywords: ['urgent', 'immediately', 'right away', 'today only', 'expires', 'deadline is'],
    replies: [
      "Oh wow, okay — I didn't realize it was that time-sensitive. Let me see what I can do.",
      "That's a lot sooner than I expected. Can you remind me exactly what you need from me by when?",
    ],
  },
  {
    tag: 'payment_request',
    keywords: ['processing fee', 'transfer', 'pay', 'payment', 'account number', 'bank details', 'wire'],
    replies: [
      "I wasn't told there'd be a fee for this — is that normal for the scholarship process?",
      "Okay, before I send anything, can you tell me which office this payment officially goes to?",
    ],
  },
  {
    tag: 'authority_claim',
    keywords: ['official', 'ministry', 'board', 'certified', 'authorized', 'on behalf of'],
    replies: [
      "Do you have something official I can check this against, just so I have it on file?",
      "Got it. Is there a reference number for this so I can cross-check with the school?",
    ],
  },
  {
    tag: 'personal_info_request',
    keywords: ['bvn', 'date of birth', 'passport number', 'nin', 'send your id', 'utility bill'],
    replies: [
      "That feels like a lot of personal detail for this stage — is this the usual process?",
      "Sure, I can share that once I understand exactly why it's needed at this step.",
    ],
  },
];

const DEFAULT_REPLIES = [
  "Okay, I see. Can you explain a bit more about how this works?",
  "Thanks for reaching out — I want to make sure I understand this correctly before proceeding.",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Analyzes an incoming message, returns matched tactic tags and a scripted reply.
 */
function analyzeAndRespond(message) {
  const lower = message.toLowerCase();
  const matchedTags = [];
  let replyPool = [];

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      matchedTags.push(rule.tag);
      replyPool = replyPool.concat(rule.replies);
    }
  }

  const reply = replyPool.length > 0 ? pick(replyPool) : pick(DEFAULT_REPLIES);

  return {
    tags: matchedTags.length > 0 ? matchedTags : ['unclassified'],
    reply,
  };
}

module.exports = { analyzeAndRespond };
