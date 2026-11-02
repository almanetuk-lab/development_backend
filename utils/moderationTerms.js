// Severe-tier terms for chat moderation. A match on these is a strike against the sender
// (see utils/moderationRules.js); any other bad-words match is "mild" and only flagged for review.
// Lowercase, letters only. Plurals and -ed/-ing forms are matched by the service, so list base forms.
// Extend at deploy time with MODERATION_SEVERE_WORDS (comma-separated).

export const SEVERE_TERMS = [
  // Slurs
  "nigger", "nigga", "niggah", "faggot", "fag", "kike", "chink", "gook", "spic", "wetback",
  "tranny", "retard", "paki", "coon", "beaner",
  // Sexual abuse / degradation
  "cunt", "whore", "slut", "rape", "rapist", "pedo", "pedophile", "paedophile",
  // Self-harm / threat shorthand
  "kys",
];

// Matched against the whole normalized message, word-bounded. Whitespace inside a phrase
// matches any run of whitespace.
export const SEVERE_PHRASES = [
  "kill yourself",
  "kill urself",
  "kill ur self",
  "go kill yourself",
  "go die",
  "hope you die",
  "hope u die",
  "i will kill you",
  "ill kill you",
  "i'll kill you",
  "i will rape you",
  "rape you",
  "you should die",
  "u should die",
  "end your life",
  "slit your wrists",
];
