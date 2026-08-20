import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { io, onlineUsers } from "../server.js";
import { generateAndCacheCompatibility } from "../controller/matchController.js";
import { createNotification } from "../controller/notificationController.js";

dotenv.config();

// ─────────────────────────────────────────────
// Comfortability thresholds
// ─────────────────────────────────────────────
const COMFORT_OVERALL_THRESHOLD        = 70;
const COMFORT_COMMUNICATION_THRESHOLD  = 65;
const COMFORT_EMOTIONAL_THRESHOLD      = 65;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─────────────────────────────────────────────
// Config helpers
// ─────────────────────────────────────────────

export const getAgentConfig = async (userId) => {
  try {
    const { rows } = await pool.query(
      `SELECT enabled, instructions FROM ai_agent_config WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) return { enabled: false, instructions: "" };
    return {
      enabled: rows[0].enabled,
      instructions: rows[0].instructions ?? "",
    };
  } catch (err) {
    console.error(`❌ [AIAgentService] getAgentConfig(${userId}):`, err.message);
    return { enabled: false, instructions: "" };
  }
};

export const upsertAgentConfig = async (userId, { enabled, instructions }) => {
  const { rows } = await pool.query(
    `INSERT INTO ai_agent_config (user_id, enabled, instructions, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       instructions = EXCLUDED.instructions,
       updated_at = NOW()
     RETURNING enabled, instructions, updated_at`,
    [userId, enabled, instructions ?? null]
  );
  return rows[0];
};

// ─────────────────────────────────────────────
// Plan check (receiver must have active plan)
// ─────────────────────────────────────────────

export const receiverHasActivePlan = async (userId) => {
  try {
    const { rows } = await pool.query(
      `SELECT expires_at
       FROM user_plans
       WHERE user_id = $1 AND status = 'active'
       ORDER BY expires_at DESC
       LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return false;
    return new Date(rows[0].expires_at) > new Date();
  } catch (err) {
    console.error(`❌ [AIAgentService] receiverHasActivePlan(${userId}):`, err.message);
    return false;
  }
};

// ─────────────────────────────────────────────
// Comfortability check
// Reads the cached compatibility record for a sender-receiver pair and
// verifies all three score thresholds.
// Fail-closed on cache miss: AI is blocked AND a background calculation is
// triggered so future messages will have a score to check against.
// Fail-open on DB error only (never block AI due to infrastructure failure).
// ─────────────────────────────────────────────

export const checkProfileComfortability = async (senderId, receiverId) => {
  try {
    // Pair must always be stored as (min, max)
    const userA = Math.min(Number(senderId), Number(receiverId));
    const userB = Math.max(Number(senderId), Number(receiverId));

    const { rows } = await pool.query(
      `SELECT
         overall_score,
         (compatibility_data -> 'scores' ->> 'communication_compatibility')::int AS communication_score,
         (compatibility_data -> 'scores' ->> 'emotional_compatibility')::int     AS emotional_score
       FROM profile_compatibilities
       WHERE user_a_id = $1
         AND user_b_id = $2
         AND updated_at > NOW() - INTERVAL '7 days'
       LIMIT 1`,
      [userA, userB]
    );

    // ── Cache miss → fail-closed + trigger background calculation ───────────
    if (rows.length === 0) {
      console.log(
        `🤖 [AIAgentService] No compatibility cache for pair (${userA}, ${userB}) — AI BLOCKED. Triggering background calculation...`
      );
      // Fire-and-forget: compute and cache so next message has a score
      generateAndCacheCompatibility(senderId, receiverId).catch((err) => {
        console.error(`❌ [AIAgentService] Background compat calc failed for (${userA}, ${userB}):`, err.message);
      });
      return false; // block AI this time
    }

    const { overall_score, communication_score, emotional_score } = rows[0];

    const overallOk       = (overall_score       ?? 0) >= COMFORT_OVERALL_THRESHOLD;
    const communicationOk = (communication_score ?? 0) >= COMFORT_COMMUNICATION_THRESHOLD;
    const emotionalOk     = (emotional_score     ?? 0) >= COMFORT_EMOTIONAL_THRESHOLD;

    const comfortable = overallOk && communicationOk && emotionalOk;

    console.log(
      `🤖 [AIAgentService] Comfortability (${senderId}→${receiverId}): ` +
      `overall=${overall_score}(${overallOk ? '✅' : '❌'}) ` +
      `comm=${communication_score}(${communicationOk ? '✅' : '❌'}) ` +
      `emo=${emotional_score}(${emotionalOk ? '✅' : '❌'}) ` +
      `→ ${comfortable ? 'ALLOW' : 'BLOCK'}`
    );

    return comfortable;
  } catch (err) {
    console.error(`❌ [AIAgentService] checkProfileComfortability error:`, err.message);
    return true; // fail-open on DB error — never block AI due to infrastructure failure
  }
};

// ─────────────────────────────────────────────
// Context loader
// ─────────────────────────────────────────────

export const loadAgentContext = async (ownerUserId, partnerUserId) => {
  // 1. Profile
  const profileResult = await pool.query(
    `SELECT first_name, last_name, about_me, profession, relationship_goal,
            interested_in, intent_tags, interaction_style, work_environment,
            work_rhythm, life_rhythms
     FROM profiles
     WHERE user_id = $1`,
    [ownerUserId]
  );
  const profile = profileResult.rows[0] ?? {};

  // 2. Digital twin (optional)
  const twinResult = await pool.query(
    `SELECT twin_data, current_state_summary FROM digital_twins WHERE user_id = $1`,
    [ownerUserId]
  );
  const twin = twinResult.rows[0] ?? null;
  console.log("Twin DAta:", twin)


  // 3. Last 20 messages (DESC then reverse for chronological order)
  const historyResult = await pool.query(
    `SELECT id, sender_id, receiver_id, content, is_ai_generated, created_at
     FROM messages
     WHERE (sender_id = $1 AND receiver_id = $2)
        OR (sender_id = $2 AND receiver_id = $1)
     ORDER BY created_at DESC
     LIMIT 20`,
    [ownerUserId, partnerUserId]
  );
  const history = historyResult.rows.reverse(); // oldest → newest

  return { profile, twin, history };
};

// ─────────────────────────────────────────────
// Gemini reply generator
// ─────────────────────────────────────────────

export const generateAgentReply = async ({ ownerUserId, partnerUserId, incomingMessage }) => {
  try {
    const config = await getAgentConfig(ownerUserId);
    if (!config.enabled) return null;
    if (incomingMessage.is_ai_generated) return null;
    const hasPlan = await receiverHasActivePlan(ownerUserId);
    if (!hasPlan) return null;

    const { profile, twin, history } = await loadAgentContext(ownerUserId, partnerUserId);

    // Build profile summary
    const profileSummary = [
      profile.first_name && `Name: ${profile.first_name} ${profile.last_name ?? ""}`.trim(),
      profile.profession && `Profession: ${profile.profession}`,
      profile.about_me && `About: ${profile.about_me}`,
      profile.relationship_goal && `Relationship goal: ${profile.relationship_goal}`,
      profile.interested_in && `Interested in: ${profile.interested_in}`,
      profile.interaction_style && `Communication style: ${profile.interaction_style}`,
      profile.intent_tags && `Interests/tags: ${Array.isArray(profile.intent_tags) ? profile.intent_tags.join(", ") : profile.intent_tags}`,
    ]
      .filter(Boolean)
      .join("\n");

    // Build conversation history
    const historyLines = history
      .map((m) => {
        const label = String(m.sender_id) === String(ownerUserId) ? "Me" : "Them";
        return `${label}: ${m.content ?? "[attachment]"}`;
      })
      .join("\n");

    const twinSection = twin?.twin_data
      ? JSON.stringify(twin.twin_data, null, 2)
      : "none";

    const instructionsSection = config.instructions?.trim()
      ? config.instructions.trim()
      : "(none)";

    const prompt = `You are composing a direct chat reply AS the user described below.
Write only the message text to send. No quotes, no prefixes, no markdown, no "As an AI".

CUSTOM INSTRUCTIONS (highest priority, follow exactly if present):
${instructionsSection}

PERSONA (digital twin JSON if present, else "none"):
${twinSection}

PROFILE SUMMARY:
${profileSummary || "(no profile data)"}

RECENT CONVERSATION (oldest → newest, "Me" = the user you are writing as):
${historyLines || "(no prior messages)"}

LATEST MESSAGE FROM THEM:
${incomingMessage.content}

Write a natural, concise reply (1–3 short sentences, ~500 chars max). Match the tone and communication style from the persona/profile. Do not invent private facts not found in the context above.`;

    console.log(`🤖 [AIAgentService] Generating reply for user ${ownerUserId}...`);

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const replyText = result.response.text()?.trim();

    if (!replyText) {
      console.warn(`⚠️ [AIAgentService] Empty reply from Gemini for user ${ownerUserId}`);
      return null;
    }

    console.log(`✅ [AIAgentService] Reply generated for user ${ownerUserId}: "${replyText.substring(0, 60)}..."`);
    return replyText;
  } catch (err) {
    console.error(`❌ [AIAgentService] generateAgentReply(${ownerUserId}):`, err.message);
    return null;
  }
};

// ─────────────────────────────────────────────
// Persist AI message + notify + emit socket
// ─────────────────────────────────────────────

export const persistAiMessage = async ({ senderId, receiverId, content }) => {
  // INSERT AI message
  const { rows } = await pool.query(
    `INSERT INTO messages (sender_id, receiver_id, content, attachment_url, is_read, is_ai_generated)
     VALUES ($1, $2, $3, NULL, FALSE, TRUE)
     RETURNING *`,
    [senderId, receiverId, content]
  );
  const aiMessage = rows[0];

  // Emit via Socket.IO (same event as human messages)
  io.emit("new_message", aiMessage);

  // Get sender display name for notification
  const nameResult = await pool.query(
    `SELECT first_name, last_name FROM profiles WHERE user_id = $1`,
    [senderId]
  );
  const senderName = nameResult.rows.length
    ? `${nameResult.rows[0].first_name} ${nameResult.rows[0].last_name ?? ""}`.trim()
    : `User ${senderId}`;

  // Create notification for the receiver (partner / User B)
  const notifResult = await pool.query(
    `INSERT INTO notifications (user_id, title, message, type, is_read, created_at, sender_id, sender_name, source)
     VALUES ($1, $2, $3, $4, FALSE, NOW(), $5, $6, 'message')
     RETURNING *`,
    [
      receiverId,
      "New Message 💬",
      `${senderName} sent you a new message`,
      "Message",
      senderId,
      senderName,
    ]
  );

  // Push notification to receiver if online
  const receiverSocketId = onlineUsers.get(String(receiverId));
  if (receiverSocketId && notifResult.rows.length > 0) {
    io.to(receiverSocketId).emit("new_notification", notifResult.rows[0]);
  }

  console.log(`📨 [AIAgentService] AI message persisted and emitted (sender: ${senderId}, receiver: ${receiverId})`);
  return aiMessage;
};

// ─────────────────────────────────────────────
// Typing indicator helper
// ─────────────────────────────────────────────

// Emit ai_typing event to a specific user's socket (if they are online)
const emitAiTyping = (toUserId, aiOwnerId, isTyping) => {
  const socketId = onlineUsers.get(String(toUserId));
  if (socketId) {
    io.to(socketId).emit("ai_typing", {
      aiUserId: aiOwnerId,  // the user whose AI is generating (User B)
      isTyping,
    });
    console.log(`⌨️  [AIAgentService] ai_typing=${isTyping} → socket of user ${toUserId} (AI owner: ${aiOwnerId})`);
  }
};

// ─────────────────────────────────────────────
// Orchestrator — fire-and-forget entry point
// ─────────────────────────────────────────────

export const maybeGenerateAiReply = async (humanMessage) => {
  const receiverId = humanMessage.receiver_id; // User B — the one whose AI will reply
  const senderId = humanMessage.sender_id;     // User A — the one who should see the indicator

  let typingStarted = false;

  try {
    // Guard: skip AI-generated messages (prevent AI↔AI loops)
    if (humanMessage.is_ai_generated) {
      console.log(`🤖 [AIAgentService] Skipping AI reply — incoming message is already AI-generated`);
      return;
    }

    // Guard: skip attachment-only messages (no text content)
    if (!humanMessage.content || !humanMessage.content.trim()) {
      console.log(`🤖 [AIAgentService] Skipping AI reply — attachment-only message`);
      return;
    }

    // Load config for receiver (User B)
    const config = await getAgentConfig(receiverId);
    if (!config.enabled) {
      console.log(`🤖 [AIAgentService] AI disabled for user ${receiverId}`);
      return;
    }

    // Check active plan for receiver (User B)
    const hasPlan = await receiverHasActivePlan(receiverId);
    if (!hasPlan) {
      console.log(`🤖 [AIAgentService] No active plan for receiver ${receiverId} — skipping AI reply`);
      return;
    }

    // [GUARD 5] Comfortability check — sender profile must pass all three thresholds
    const isComfortable = await checkProfileComfortability(senderId, receiverId);
    if (!isComfortable) {
      console.log(`🤖 [AIAgentService] Comfortability FAILED for sender ${senderId} → receiver ${receiverId}. AI silent.`);

      // ── Fetch both users' display names for notification messages ──────────
      const [senderNameResult, receiverNameResult] = await Promise.all([
        pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [senderId]),
        pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [receiverId]),
      ]);
      const senderName   = senderNameResult.rows.length
        ? `${senderNameResult.rows[0].first_name} ${senderNameResult.rows[0].last_name ?? ""}`.trim()
        : `User ${senderId}`;
      const receiverName = receiverNameResult.rows.length
        ? `${receiverNameResult.rows[0].first_name} ${receiverNameResult.rows[0].last_name ?? ""}`.trim()
        : `User ${receiverId}`;

      // ── Persist bell-icon notifications for BOTH parties ─────────────────
      // Sender gets notified that AI won't reply in their chat with receiver
      // Receiver gets notified that AI won't reply in their chat with sender
      const [senderNotif, receiverNotif] = await Promise.all([
        createNotification(
          senderId,
          "⚠️ Match Incompatibility",
          `Your AI agent will not reply in your conversation with ${receiverName} due to low compatibility scores.`,
          "incompatible_match",
          receiverId,
          receiverName,
          "ai_agent"
        ),
        createNotification(
          receiverId,
          "⚠️ Match Incompatibility",
          `Your AI agent will not reply in your conversation with ${senderName} due to low compatibility scores.`,
          "incompatible_match",
          senderId,
          senderName,
          "ai_agent"
        ),
      ]);

      // ── Real-time socket events ───────────────────────────────────────────
      const incompatiblePayload = { sender_id: senderId, receiver_id: receiverId };
      const senderSocketId   = onlineUsers.get(String(senderId));
      const receiverSocketId = onlineUsers.get(String(receiverId));

      if (senderSocketId) {
        io.to(senderSocketId).emit("incompatible_match", incompatiblePayload);
        if (senderNotif) io.to(senderSocketId).emit("new_notification", senderNotif);
      }
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("incompatible_match", incompatiblePayload);
        if (receiverNotif) io.to(receiverSocketId).emit("new_notification", receiverNotif);
      }

      console.log(`🤖 [AIAgentService] Incompatible match for sender ${senderId} → receiver ${receiverId}. Socket + notifications emitted.`);

      return;
    }

    // ── Start typing indicator ──
    // User A (senderId) should see "AI is typing..." from User B (receiverId)
    emitAiTyping(senderId, receiverId, true);
    typingStarted = true;

    // Generate reply
    const replyContent = await generateAgentReply({
      ownerUserId: receiverId,
      partnerUserId: senderId,
      incomingMessage: humanMessage,
    });

    if (!replyContent) {
      console.log(`🤖 [AIAgentService] No reply generated for user ${receiverId}`);
      return;
    }

    // Persist + emit (socket new_message will clear the typing indicator on frontend too)
    await persistAiMessage({
      senderId: receiverId,  // AI replies AS User B
      receiverId: senderId,  // delivered TO User A
      content: replyContent,
    });
  } catch (err) {
    console.error(`❌ [AIAgentService] maybeGenerateAiReply error:`, err.message);
    // Never re-throw — this is fire-and-forget
  } finally {
    // ── Always clear typing indicator ──
    if (typingStarted) {
      emitAiTyping(senderId, receiverId, false);
    }
  }
};
