import { Filter } from "bad-words";
import dotenv from "dotenv";
import { pool } from "../config/db.js";

dotenv.config();

// Local, zero-cost profanity filter for chat messages. Flagged messages are
// still delivered; they are recorded for admin review in message_moderation_flags.

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

const NOT_FLAGGED = Object.freeze({ isFlagged: false, matchedWords: [] });

/**
 * Scans message text. Synchronous and never throws — moderation must never
 * break message sending.
 * @param {string|null|undefined} text
 * @returns {{ isFlagged: boolean, matchedWords: string[] }}
 */
export const checkContent = (text) => {
  try {
    if (!isEnabled() || typeof text !== "string" || !text.trim()) return NOT_FLAGGED;

    // Collapse repeated punctuation ("shit!!!" → "shit!") before tokenizing.
    const normalized = text.toLowerCase().replace(/([^\w\s])\1+/g, "$1");
    const matched = new Set();
    for (const raw of normalized.split(/\s+/)) {
      const token = raw.replace(/^[^\w]+|[^\w]+$/g, "");
      if (token && filter.isProfane(token)) matched.add(token);
    }

    return matched.size ? { isFlagged: true, matchedWords: [...matched] } : NOT_FLAGGED;
  } catch (err) {
    console.error("❌ [ContentModeration] checkContent failed:", err.message);
    return NOT_FLAGGED;
  }
};

const fullName = (row) =>
  row ? `${row.first_name || ""} ${row.last_name || ""}`.trim() || null : null;

/**
 * Persists a review flag for a saved message and alerts connected admins.
 * Fire-and-forget: callers should `.catch(() => {})`.
 */
export const recordFlag = async (message, matchedWords) => {
  const { rows } = await pool.query(
    `INSERT INTO message_moderation_flags
       (message_id, sender_id, receiver_id, original_content, matched_words, is_ai_generated)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      message.id,
      message.sender_id,
      message.receiver_id,
      message.content,
      matchedWords,
      !!message.is_ai_generated,
    ],
  );
  const flag = rows[0];

  const names = await pool.query(
    `SELECT user_id, first_name, last_name FROM profiles WHERE user_id = ANY($1::int[])`,
    [[message.sender_id, message.receiver_id]],
  );
  const byId = new Map(names.rows.map((r) => [String(r.user_id), r]));

  // Lazy import: keeps checkContent usable (and testable) without booting server.js.
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
    created_at: flag.created_at,
  });

  return flag;
};
