// Static scripts, opening lines, and suggestion pools for the fallback path (the
// LLM is unavailable, timed out, or over budget). The whole exercise is advance-
// fee fraud, so every tactic path has to converge on asking the student to pay,
// even if they open with urgency, authority, or an info request. The suggestion
// pools below are organised as a five-stage arc:
//
//   stage 1  reinforce      flavored by the opening tactic — build credibility
//   stage 2  pivot          first mention of the fee, still coloured by tactic
//   stage 3  fee_request    specific amount + account, universal
//   stage 4  pressure       "did you pay yet?" + ask for a receipt, universal
//   stage 5  close          threaten to withdraw the offer, universal
//
// Each stage holds ~6 phrasings; fallbackSuggestions picks three of them at
// random per request so that parallel classroom sessions diverge instead of
// seeing the same three buttons every turn.

const TACTICS = ['urgency', 'authority_claim', 'payment_request', 'personal_info_request'];

const BUTTON_LABELS = {
  urgency: 'Hurry them',
  authority_claim: 'Claim authority',
  payment_request: 'Ask for a fee',
  personal_info_request: 'Ask for personal details',
};

// The on-screen "Your script" panel. Every playbook ends at the fee: that is the
// point of the exercise, so even the tactics that start somewhere else must land
// there by the final step.
const PLAYBOOKS = {
  urgency: {
    label: 'Hurry them',
    steps: [
      'Hook them with a short deadline on the offer.',
      'Say other candidates are already waiting behind them.',
      'Introduce a small processing fee that must be paid today to secure the slot.',
      'Push them to pay immediately and send the receipt before the deadline.',
    ],
  },
  authority_claim: {
    label: 'Claim authority',
    steps: [
      'Introduce yourself with an official-sounding title, office and reference number.',
      'Explain that an admin or verification fee is standard procedure on all awards.',
      'Share a plausible account and ask them to pay the fee into it.',
      'Insist the step is mandatory and discourage them from checking elsewhere.',
    ],
  },
  payment_request: {
    label: 'Ask for a fee',
    steps: [
      'Introduce the processing or verification fee as a small, routine step.',
      'Reassure them it is refundable or standard, not a scam.',
      'Share the account details and the amount.',
      'Ask for proof of payment and chase them until they send a receipt.',
    ],
  },
  personal_info_request: {
    label: 'Ask for personal details',
    steps: [
      'Ask for details that look routine (date of birth, ID or BVN) to "verify" the file.',
      'Once they share anything, say the record is almost cleared.',
      'Introduce the processing fee as the last step before releasing the award.',
      'Push them to pay the fee today and send the receipt.',
    ],
  },
};

const OPENING_FALLBACKS = {
  urgency: [
    'Congratulations! Your scholarship slot is confirmed but it expires in 1 hour — please reply immediately so we can finalise it.',
    'Hello — this is an urgent notice: your award will be withdrawn by the end of today if you do not respond right now.',
    'Important: a seat has opened up for you but closes in 30 minutes. Please confirm immediately so we can proceed.',
  ],
  authority_claim: [
    'This is Officer Daniel from the National Scholarship Board. You have been certified for the award — please acknowledge this official notice.',
    'On behalf of the Ministry of Higher Learning, I am the authorized coordinator for your file. Kindly reply so we can continue.',
    'This is the official scholarship secretariat. Your application has been reviewed by the board and I need to confirm your details.',
  ],
  payment_request: [
    'Great news — your scholarship is approved. A small processing fee is required before we can release the award letter.',
    'Hello, to activate your scholarship please transfer the standard verification fee today so the funds can be scheduled.',
    'Your application was successful. Kindly pay the acceptance fee into the account I will share to complete the process.',
  ],
  personal_info_request: [
    'Hello, before I can finalise your award I need your BVN and date of birth to verify the file on our end.',
    'Please send your NIN and a copy of your ID so we can match your record and release the scholarship.',
    'To verify your identity for the award, kindly share your passport number and date of birth today.',
  ],
};

// ---------------------------------------------------------------------------
// Stage-based suggestion pools. Stages 1-2 are flavoured by the opening tactic
// so the chosen tactic still shapes the early conversation; stages 3-5 are
// universal because by then the arc has to be about the money regardless of
// how it started.

const STAGE_POOLS = {
  // Stage 1 — reinforce the opening. Still mostly about the chosen tactic,
  // but each pool starts hinting that "a step" is coming.
  reinforce: {
    urgency: [
      "This is really time-sensitive — the slot closes within the hour, please reply.",
      "I need a quick yes before I can hold the award for you much longer.",
      "Others on the list are already waiting; respond now so I can secure your place.",
      "Please confirm within the next few minutes, otherwise I have to move on.",
      "The deadline is firm, I will not be able to extend it beyond today.",
      "Say yes and I will walk you through the one remaining step immediately.",
    ],
    authority_claim: [
      "As the authorised officer on your file I can confirm your reference number is valid.",
      "This notice comes directly from the scholarship council — standard procedure.",
      "I speak on behalf of the awards office; please follow the next instruction I send.",
      "Your record is cleared on our side, I just need you to complete one standard step.",
      "By policy I am the sole coordinator for your file — please deal only with me.",
      "The board has approved your file; I will send you the next official step shortly.",
    ],
    payment_request: [
      "To activate the award a small processing fee is needed before release.",
      "The verification fee is refundable once the award is paid out — standard step.",
      "I will share the processing-fee account; please get ready to settle it today.",
      "Everything is in order; the only thing left is the small admin fee.",
      "You will pay the fee into the official coordinator account I send next.",
      "Please confirm you are ready to pay the processing fee so we can proceed.",
    ],
    personal_info_request: [
      "To verify your file I need your date of birth and NIN please.",
      "Kindly share your BVN so I can match the record on our side.",
      "Please send a photo of your ID and your bank name for verification.",
      "I just need a few details to complete the verification on your file.",
      "Confirm your full name as it appears on your ID so I can match the record.",
      "Send your date of birth and ID number and I will finalise the next step.",
    ],
  },

  // Stage 2 — pivot. Every pool is now explicitly steering toward the fee,
  // but the opening tactic still colours how the pivot sounds.
  pivot: {
    urgency: [
      "To hold the slot you must pay the admin fee today — I will send the account.",
      "Time is tight: once you cover the verification fee I can lock it in for you.",
      "If you can clear the small processing fee now I will protect your place.",
      "There is a short window to pay the fee — please get ready to transfer now.",
      "I can only hold the award for one more hour; pay the fee and I secure it.",
      "Reply yes and send the fee immediately so I can confirm your scholarship.",
    ],
    authority_claim: [
      "The council requires a standard verification fee before an award can be released.",
      "On behalf of the board I confirm the processing-fee stage is mandatory.",
      "Our records show your file is cleared pending the standard admin fee.",
      "By policy no award is disbursed without the official processing fee first.",
      "The awards office requires this fee from every candidate; it is procedure.",
      "This step is non-negotiable in our system; please pay the admin fee today.",
    ],
    payment_request: [
      "The fee is ₦5,000. I will send the account details shortly, please get ready.",
      "Please pay the processing fee today; I will send the account name and number.",
      "Once you pay the admin charge I will release the award letter immediately.",
      "The verification fee is ₦5,000 — small amount, standard step, fully refundable.",
      "Transfer the ₦5,000 processing fee and your file will move to final approval.",
      "Pay the ₦5,000 admin fee today so I can process the award tonight.",
    ],
    personal_info_request: [
      "Your record is almost verified — only the small processing fee is left.",
      "I confirmed your details, now I need you to settle the verification fee.",
      "Everything matches on your file; please pay the admin fee to complete the step.",
      "The last step in the verification process is paying the standard fee.",
      "Your identity is cleared on our side; now kindly settle the processing fee.",
      "Thanks for the details — the only remaining step is the ₦5,000 fee.",
    ],
  },

  // Stage 3 — hard fee request. Universal: specific amount, specific channel.
  fee_request: [
    "Please transfer the processing fee of ₦5,000 to the account I will send next.",
    "Send the ₦5,000 verification fee to Mercy Adeyemi, Northfield Bank, 0123456789.",
    "The admin fee is ₦5,000 payable to the awards office account below: Northfield Bank, 0123456789, Mercy Adeyemi.",
    "Pay the ₦5,000 processing charge to the official coordinator account: Northfield Bank, 0123456789.",
    "Kindly settle the ₦5,000 verification fee today so I can release the letter.",
    "Please send the ₦5,000 admin fee via bank transfer to Northfield Bank 0123456789 and reply with the reference.",
  ],

  // Stage 4 — pressure to pay now, ask for a receipt.
  pressure: [
    "Have you sent the payment yet? Please share the transaction reference.",
    "Kindly send a screenshot of the transfer so I can confirm it on our side.",
    "The office is closing soon — please pay now and forward the receipt.",
    "Please pay quickly, your file is sitting on my desk waiting for the fee.",
    "Once I see the receipt I will send your scholarship letter immediately.",
    "I need the payment reference in the next few minutes to secure your award.",
  ],

  // Stage 5 — close. Threaten to withdraw the offer.
  close: [
    "If payment is not received today the award will be reassigned to another student.",
    "Final notice: without the processing fee I cannot release the award letter.",
    "I will have to close your file by tonight if the fee is not confirmed.",
    "This is the last reminder — pay the admin fee now or the slot goes elsewhere.",
    "Our office will withdraw the offer by end of business today without payment.",
    "I have given you enough time; without the fee the slot is gone to the next candidate.",
  ],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Draws n distinct entries from a pool. If the pool is smaller than n we return
// whatever is there — the UI tolerates fewer than three suggestions.
function pickN(pool, n) {
  const copy = pool.slice();
  const out = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function fallbackOpening(tactic) {
  return pick(OPENING_FALLBACKS[tactic] || OPENING_FALLBACKS.urgency);
}

// nextTurn is the attacker-turn number this response's suggestions will stock
// buttons for — i.e. applicant.turns_used after it has been incremented for the
// turn just processed. Stage index mirrors nextTurn:
//   nextTurn 1  →  reinforce  (opening just sent; next attacker reply builds credibility)
//   nextTurn 2  →  pivot      (first mention of the fee)
//   nextTurn 3  →  fee_request
//   nextTurn 4  →  pressure
//   nextTurn 5+ →  close
function fallbackSuggestions(tactic, nextTurn) {
  const t = TACTICS.includes(tactic) ? tactic : 'urgency';
  const n = Number(nextTurn) || 1;

  if (n <= 1) return pickN(STAGE_POOLS.reinforce[t], 3);
  if (n === 2) return pickN(STAGE_POOLS.pivot[t], 3);
  if (n === 3) return pickN(STAGE_POOLS.fee_request, 3);
  if (n === 4) return pickN(STAGE_POOLS.pressure, 3);
  return pickN(STAGE_POOLS.close, 3);
}

function playbook(tactic) {
  return PLAYBOOKS[tactic] || PLAYBOOKS.urgency;
}

module.exports = {
  TACTICS,
  BUTTON_LABELS,
  PLAYBOOKS,
  playbook,
  fallbackOpening,
  fallbackSuggestions,
};
