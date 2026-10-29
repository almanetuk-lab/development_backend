import { Filter } from "bad-words";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { SEVERE_PHRASES, SEVERE_TERMS } from "../utils/moderationTerms.js";

dotenv.config();

// Local, zero-cost profanity filter for chat messages. Flagged messages are
// still delivered; they are recorded for admin review in message_moderation_flags.
// Two tiers: "severe" (utils/moderationTerms.js) is a strike against the sender and
// drives automatic warnings and mutes (services/autoModerationService.js);
// "mild" (any other bad-words match) is only flagged for review.

const parseList = (value) =>
  (value || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

const isEnabled = () => process.env.ENABLE_CONTENT_MODERATION !== "false";

const filter = new Filter();
const extraWords = parseList(process.env.MODERATION_EXTRA_WORDS);
const allowedWords = parseList(process.env.MODERATION_ALLOWED_WORDS);
if (extraWords.length) filter.addWords(...extraWords);
if (allowedWords.length) filter.removeWords(...allowedWords);

const allowedSet = new Set(filter.exclude.map((w) => w.toLowerCase()));
const mildSet = new Set(filter.list.map((w) => w.toLowerCase()).filter((w) => !allowedSet.has(w)));
const severeSet = new Set(
  [...SEVERE_TERMS, ...parseList(process.env.MODERATION_SEVERE_WORDS)].filter((w) => !allowedSet.has(w)),
);
// Letters-only words, used to resolve masked spellings like "f*ck".
const plainWords = [...new Set([...mildSet, ...severeSet])].filter((w) => /^[a-z]+$/.test(w));

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s", "!": "i" };
const deLeet = (s) => s.replace(/[013457@$!]/g, (c) => LEET[c]);

// Lowercase and strip accents ("fück" → "fuck").
const fold = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Full-text form used for phrase matching: leet decoded, punctuation as spaces.
// A trailing "!" is punctuation, not a leet "i" ("die!!" stays "die").
const phraseForm = (s) =>
  ` ${deLeet(fold(s).replace(/!+(?=\s|$)/g, " ")).replace(/[^a-z\s]+/g, " ").replace(/\s+/g, " ").trim()} `;
const severePhrases = SEVERE_PHRASES.map((p) => ({ phrase: p, form: phraseForm(p) }));

// Severe terms also match simple inflections: fags, raped, raping, retarded.
const severeStem = (word) => {
  if (severeSet.has(word)) return word;
  const stems = [
    word.endsWith("s") && word.slice(0, -1),
    word.endsWith("ed") && word.slice(0, -2),
    word.endsWith("d") && word.slice(0, -1),
    word.endsWith("ing") && word.slice(0, -3),
    word.endsWith("ing") && `${word.slice(0, -3)}e`,
  ];
  return stems.find((s) => s && severeSet.has(s)) || null;
};

/** Classifies one candidate spelling. Returns { word, severity } or null. */
const classifyWord = (candidate) => {
  if (!candidate || allowedSet.has(candidate)) return null;
  // Whole token first, then hyphen/punctuation-separated parts ("cock-head").
  const parts = [candidate, ...candidate.split(/[^a-z0-9]+/).filter((p) => p && p !== candidate)];
  for (const part of parts) {
    if (allowedSet.has(part)) continue;
    const severe = severeStem(part);
    if (severe) return { word: severe, severity: "severe" };
  }
  for (const part of parts) {
    if (!allowedSet.has(part) && mildSet.has(part)) return { word: part, severity: "mild" };
  }
  return null;
};

/**
 * Resolves a masked spelling ("f*ck", "c#nt", "n****r"): each * or # stands for one letter.
 * Severe only when every possible reading is severe ("s**t" could be "shit", so it is mild).
 */
const classifyMasked = (candidate) => {
  const letters = candidate.replace(/[*#]/g, "");
  if (letters.length < 2 || !/^[a-z*#]+$/.test(candidate) || letters.length === candidate.length) return null;
  const pattern = new RegExp(`^${candidate.replace(/[*#]/g, "[a-z]")}$`);
  const hits = plainWords.filter((w) => pattern.test(w) && !allowedSet.has(w));
  if (!hits.length) return null;
  const severeHits = hits.filter((w) => severeSet.has(w));
  if (severeHits.length === hits.length) return { word: severeHits[0], severity: "severe" };
  return { word: hits.find((w) => !severeSet.has(w)), severity: "mild" };
};

/** All spellings worth checking for one raw token. */
const candidatesFor = (raw) => {
  const strict = raw.replace(/^[^\w]+|[^\w]+$/g, "");
  // Keep mask/leet characters at the edges ("@$$", "f*ck"); trailing "!" is punctuation.
  const loose = raw.replace(/^[^a-z0-9@$*#]+/, "").replace(/[^a-z0-9@$*#]+$/, "");
  const out = new Set([strict, deLeet(loose)]);
  // Separated letters: "f.u.c.k", "s-h-i-t"
  if (/^[a-z0-9@$!*#]([._\-][a-z0-9@$!*#]){2,}$/.test(loose)) out.add(deLeet(loose.replace(/[._\-]/g, "")));
  // Stretched letters: "fuuuuck" → "fuck" (only runs of 3+, so "ass" and "class" are untouched)
  for (const c of [...out]) if (/(.)\1\1/.test(c)) out.add(c.replace(/(.)\1+/g, "$1"));
  out.delete("");
  return [...out];
};

const NOT_FLAGGED = Object.freeze({ isFlagged: false, severity: "none", matchedWords: [] });

/**
 * Scans message text. Synchronous and never throws — moderation must never
 * break message sending.
 * @param {string|null|undefined} text
 * @returns {{ isFlagged: boolean, severity: 'none'|'mild'|'severe', matchedWords: string[] }}
 */
export const checkContent = (text) => {
  try {
    if (!isEnabled() || typeof text !== "string" || !text.trim()) return NOT_FLAGGED;

    const matched = new Map(); // word → severity
    const add = (hit) => {
      if (hit && matched.get(hit.word) !== "severe") matched.set(hit.word, hit.severity);
    };

    // Collapse repeated punctuation ("shit!!!" → "shit!") before tokenizing; mask and
    // leet characters are kept so "f**k" and "a$$" survive.
    const normalized = fold(text).replace(/([^\w\s*#$])\1+/g, "$1");
    const tokens = normalized.split(/\s+/).filter(Boolean);

    // Spaced-out letters: "f u c k" → also check "fuck".
    const words = [...tokens];
    for (let i = 0; i < tokens.length; ) {
      let j = i;
      while (j < tokens.length && /^[a-z0-9@$!*#]$/.test(tokens[j])) j++;
      if (j - i >= 3) words.push(tokens.slice(i, j).join(""));
      i = j > i ? j : i + 1;
    }

    for (const raw of words) {
      for (const candidate of candidatesFor(raw)) {
        add(/[*#]/.test(candidate) ? classifyMasked(candidate) : classifyWord(candidate));
      }
    }

    const fullText = phraseForm(text);
    for (const { phrase, form } of severePhrases) {
      if (fullText.includes(form)) add({ word: phrase, severity: "severe" });
    }

    if (!matched.size) return NOT_FLAGGED;
    const severity = [...matched.values()].includes("severe") ? "severe" : "mild";
    return { isFlagged: true, severity, matchedWords: [...matched.keys()] };
  } catch (err) {
    console.error("❌ [ContentModeration] checkContent failed:", err.message);
    return NOT_FLAGGED;
  }
};

const fullName = (row) =>
  row ? `${row.first_name || ""} ${row.last_name || ""}`.trim() || null : null;

/**
 * Persists a review flag for a saved message, applies an automatic strike for
 * severe human-written messages, and alerts connected admins.
 * Fire-and-forget: callers should `.catch(() => {})`.
 */
export const recordFlag = async (message, matchedWords, severity = "mild") => {
  const isStrike = severity === "severe" && !message.is_ai_generated;
  const { rows } = await pool.query(
    `INSERT INTO message_moderation_flags
       (message_id, sender_id, receiver_id, original_content, matched_words, is_ai_generated, severity, is_strike)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      message.id,
      message.sender_id,
      message.receiver_id,
      message.content,
      matchedWords,
      !!message.is_ai_generated,
      severity === "severe" ? "severe" : "mild",
      isStrike,
    ],
  );
  const flag = rows[0];

  // Lazy imports: keep checkContent usable (and testable) without booting server.js.
  let strike = { strike_count: null, auto_action: null, muted_until: null, needs_ban_review: false };
  if (isStrike) {
    const { applyStrike } = await import("./autoModerationService.js");
    strike = await applyStrike(flag);
  }

  const names = await pool.query(
    `SELECT user_id, first_name, last_name FROM profiles WHERE user_id = ANY($1::int[])`,
    [[message.sender_id, message.receiver_id]],
  );
  const byId = new Map(names.rows.map((r) => [String(r.user_id), r]));

  const { io } = await import("../server.js");
  io.to("admins").emit("abuse_alert", {
    id: flag.id,
    message_id: flag.message_id,
    sender_id: flag.sender_id,
    receiver_id: flag.receiver_id,
    sender_name: fullName(byId.get(String(flag.sender_id))),
    receiver_name: fullName(byId.get(String(flag.receiver_id))),
    content_preview: flag.original_content.slice(0, 200),
    matched_words: flag.matched_words,
    is_ai_generated: flag.is_ai_generated,
    severity: flag.severity,
    is_strike: flag.is_strike,
    strike_count: strike.strike_count,
    auto_action: strike.auto_action,
    muted_until: strike.muted_until,
    needs_ban_review: strike.needs_ban_review,
    created_at: flag.created_at,
  });

  return flag;
};
