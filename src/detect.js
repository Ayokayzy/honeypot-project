// Keyword-based tactic detection. The server, the analysis script and the stats
// endpoint all go through detectTactics() so there is a single source of truth for
// what counts as a given tactic — change a keyword list here and every reader
// agrees on the next request.

const RULES = [
  {
    tag: 'urgency',
    keywords: ['urgent', 'immediately', 'right away', 'today only', 'expires', 'deadline is'],
  },
  {
    tag: 'payment_request',
    keywords: ['processing fee', 'transfer', 'pay', 'payment', 'account number', 'bank details', 'wire'],
  },
  {
    tag: 'authority_claim',
    keywords: ['official', 'ministry', 'board', 'certified', 'authorized', 'on behalf of'],
  },
  {
    tag: 'personal_info_request',
    keywords: ['bvn', 'date of birth', 'passport number', 'nin', 'send your id', 'utility bill'],
  },
];

const TACTIC_NAMES = RULES.map((r) => r.tag);

function detectTactics(text) {
  const lower = (text || '').toLowerCase();
  const matched = [];
  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      matched.push(rule.tag);
    }
  }
  return matched;
}

module.exports = { detectTactics, TACTIC_NAMES, RULES };
