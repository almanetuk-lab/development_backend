import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { io, onlineUsers } from "../server.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { generateAndCacheCompatibility } from "../controller/matchController.js";
import { createNotification } from "../controller/notificationController.js";

dotenv.config();

// ─────────────────────────────────────────────
// Comfortability thresholds
// ─────────────────────────────────────────────
const COMFORT_OVERALL_THRESHOLD        = 70;
const COMFORT_COMMUNICATION_THRESHOLD  = 65;
const COMFORT_EMOTIONAL_THRESHOLD      = 65;

// AI-to-AI conversation limits
const MAX_AI_MESSAGES_PER_BURST = 6;  // total AI messages in one burst (3 per side)
const AI_REPLY_DELAY_MS = 3000;       // 3s delay between AI messages for natural pacing

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

export const receiverHasAiAgentAccess = async (userId) => {
  try {
    const { rows } = await pool.query(
      `SELECT up.expires_at, p.allowed_features
       FROM user_plans up
       LEFT JOIN plans p ON up.plan_id = p.id
       WHERE up.user_id = $1 AND up.status = 'active'
       ORDER BY up.expires_at DESC
       LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return false;
    const isPlanActive = new Date(rows[0].expires_at) > new Date();
    if (!isPlanActive) return false;

    const allowedFeatures = rows[0].allowed_features;
    if (allowedFeatures === null || allowedFeatures === undefined) {
      return true; // Legacy plan, allow AI Agent by default
    }
    if (Array.isArray(allowedFeatures)) {
      return allowedFeatures.includes("ai_agent");
    }
    if (typeof allowedFeatures === 'object') {
      return !!allowedFeatures["ai_agent"];
    }
    return false;
  } catch (err) {
    console.error(`❌ [AIAgentService] receiverHasAiAgentAccess(${userId}):`, err.message);
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
    // Note: is_ai_generated guard removed — loop protection is handled by runAiConversation's counter
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
    emitAiError([ownerUserId, partnerUserId], {
      code: "GEMINI_GENERATION_FAILED",
      message: "AI agent couldn't generate a reply. Please try again later.",
      context: `Gemini error for user ${ownerUserId}`,
    });
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
  logAuditEvent(senderId, "AI_AGENT_RESPONSE", { receiver_id: receiverId, message_id: aiMessage.id });

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
// Generic AI error emitter
// Sends an ai_agent_error socket event to one or both users
// so the frontend can display a toast notification.
// ─────────────────────────────────────────────
const emitAiError = (toUserIds, { code, message, context }) => {
  const payload = {
    code: code || "AI_ERROR",
    message: message || "AI agent encountered an error",
    context: context || null,
    timestamp: new Date().toISOString(),
  };
  const ids = Array.isArray(toUserIds) ? toUserIds : [toUserIds];
  for (const uid of ids) {
    const socketId = onlineUsers.get(String(uid));
    if (socketId) {
      io.to(socketId).emit("ai_agent_error", payload);
      console.log(`🚨 [AIAgentService] ai_agent_error → user ${uid}: ${payload.code}`);
    }
  }
};

// ─────────────────────────────────────────────
// Orchestrator — fire-and-forget entry point
// ─────────────────────────────────────────────

// export const maybeGenerateAiReply = async (humanMessage) => {
//   const receiverId = humanMessage.receiver_id; // User B — the one whose AI will reply
//   const senderId = humanMessage.sender_id;     // User A — the one who should see the indicator

//   let typingStarted = false;

//   try {
//     // Guard: skip AI-generated messages (prevent AI↔AI loops)
//     if (humanMessage.is_ai_generated) {
//       console.log(`🤖 [AIAgentService] Skipping AI reply — incoming message is already AI-generated`);
//       return;
//     }

//     // Guard: skip attachment-only messages (no text content)
//     if (!humanMessage.content || !humanMessage.content.trim()) {
//       console.log(`🤖 [AIAgentService] Skipping AI reply — attachment-only message`);
//       return;
//     }

//     // Load config for receiver (User B)
//     const config = await getAgentConfig(receiverId);
//     if (!config.enabled) {
//       console.log(`🤖 [AIAgentService] AI disabled for user ${receiverId}`);
//       return;
//     }

//     // Check active plan for receiver (User B)
//     const hasPlan = await receiverHasActivePlan(receiverId);
//     if (!hasPlan) {
//       console.log(`🤖 [AIAgentService] No active plan for receiver ${receiverId} — skipping AI reply`);
//       return;
//     }

//     // [GUARD 5] Comfortability check — sender profile must pass all three thresholds
//     const isComfortable = await checkProfileComfortability(senderId, receiverId);
//     if (!isComfortable) {
//       console.log(`🤖 [AIAgentService] Comfortability FAILED for sender ${senderId} → receiver ${receiverId}. AI silent.`);

//       // ── Fetch both users' display names for notification messages ──────────
//       const [senderNameResult, receiverNameResult] = await Promise.all([
//         pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [senderId]),
//         pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [receiverId]),
//       ]);
//       const senderName   = senderNameResult.rows.length
//         ? `${senderNameResult.rows[0].first_name} ${senderNameResult.rows[0].last_name ?? ""}`.trim()
//         : `User ${senderId}`;
//       const receiverName = receiverNameResult.rows.length
//         ? `${receiverNameResult.rows[0].first_name} ${receiverNameResult.rows[0].last_name ?? ""}`.trim()
//         : `User ${receiverId}`;

//       // ── Persist bell-icon notifications for BOTH parties ─────────────────
//       // Sender gets notified that AI won't reply in their chat with receiver
//       // Receiver gets notified that AI won't reply in their chat with sender
//       const [senderNotif, receiverNotif] = await Promise.all([
//         createNotification(
//           senderId,
//           "⚠️ Match Incompatibility",
//           `Your AI agent will not reply in your conversation with ${receiverName} due to low compatibility scores.`,
//           "incompatible_match",
//           receiverId,
//           receiverName,
//           "ai_agent"
//         ),
//         createNotification(
//           receiverId,
//           "⚠️ Match Incompatibility",
//           `Your AI agent will not reply in your conversation with ${senderName} due to low compatibility scores.`,
//           "incompatible_match",
//           senderId,
//           senderName,
//           "ai_agent"
//         ),
//       ]);

//       // ── Real-time socket events ───────────────────────────────────────────
//       const incompatiblePayload = { sender_id: senderId, receiver_id: receiverId };
//       const senderSocketId   = onlineUsers.get(String(senderId));
//       const receiverSocketId = onlineUsers.get(String(receiverId));

//       if (senderSocketId) {
//         io.to(senderSocketId).emit("incompatible_match", incompatiblePayload);
//         if (senderNotif) io.to(senderSocketId).emit("new_notification", senderNotif);
//       }
//       if (receiverSocketId) {
//         io.to(receiverSocketId).emit("incompatible_match", incompatiblePayload);
//         if (receiverNotif) io.to(receiverSocketId).emit("new_notification", receiverNotif);
//       }

//       console.log(`🤖 [AIAgentService] Incompatible match for sender ${senderId} → receiver ${receiverId}. Socket + notifications emitted.`);

//       return;
//     }

//     // ── Start typing indicator ──
//     // User A (senderId) should see "AI is typing..." from User B (receiverId)
//     emitAiTyping(senderId, receiverId, true);
//     typingStarted = true;

//     // Generate reply
//     const replyContent = await generateAgentReply({
//       ownerUserId: receiverId,
//       partnerUserId: senderId,
//       incomingMessage: humanMessage,
//     });

//     if (!replyContent) {
//       console.log(`🤖 [AIAgentService] No reply generated for user ${receiverId}`);
//       return;
//     }

//     // Persist + emit (socket new_message will clear the typing indicator on frontend too)
//     await persistAiMessage({
//       senderId: receiverId,  // AI replies AS User B
//       receiverId: senderId,  // delivered TO User A
//       content: replyContent,
//     });
//   } catch (err) {
//     console.error(`❌ [AIAgentService] maybeGenerateAiReply error:`, err.message);
//     // Never re-throw — this is fire-and-forget
//   } finally {
//     // ── Always clear typing indicator ──
//     if (typingStarted) {
//       emitAiTyping(senderId, receiverId, false);
//     }
//   }
// };

// ─────────────────────────────────────────────
// Plan quota check + consume (for AI messages)
// ─────────────────────────────────────────────

const consumePlanQuota = async (userId) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.people_message_limit, up.people_message_used
       FROM user_plans up
       JOIN plans p ON p.id = up.plan_id
       WHERE up.user_id = $1 AND up.status = 'active' AND up.expires_at > NOW()`,
      [userId]
    );
    if (rows.length === 0) return false;

    const { people_message_limit, people_message_used } = rows[0];
    if (people_message_limit === -1) return true; // unlimited
    if (people_message_used >= people_message_limit) return false; // exhausted

    await pool.query(
      `UPDATE user_plans SET people_message_used = people_message_used + 1
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    return true;
  } catch (err) {
    console.error(`❌ [AIAgentService] consumePlanQuota(${userId}):`, err.message);
    return false;
  }
};

// ─────────────────────────────────────────────
// Persist AI message WITHOUT notification (burst mode)
// ─────────────────────────────────────────────

const persistAiMessageSilent = async ({ senderId, receiverId, content }) => {
  const { rows } = await pool.query(
    `INSERT INTO messages (sender_id, receiver_id, content, attachment_url, is_read, is_ai_generated)
     VALUES ($1, $2, $3, NULL, FALSE, TRUE)
     RETURNING *`,
    [senderId, receiverId, content]
  );
  const aiMessage = rows[0];
  io.emit("new_message", aiMessage);
  console.log(`📨 [AIAgentService] AI message (silent) persisted (sender: ${senderId}, receiver: ${receiverId})`);
  return aiMessage;
};

// ─────────────────────────────────────────────
// Summary notification after AI burst completes
// ─────────────────────────────────────────────

const sendBurstSummaryNotification = async (userAId, userBId, aiMessageCount) => {
  try {
    const [nameA, nameB] = await Promise.all([
      pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [userAId]),
      pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [userBId]),
    ]);
    const nameOfA = nameA.rows.length
      ? `${nameA.rows[0].first_name} ${nameA.rows[0].last_name ?? ""}`.trim()
      : `User ${userAId}`;
    const nameOfB = nameB.rows.length
      ? `${nameB.rows[0].first_name} ${nameB.rows[0].last_name ?? ""}`.trim()
      : `User ${userBId}`;

    const notifA = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at, sender_id, sender_name, source)
       VALUES ($1, $2, $3, $4, FALSE, NOW(), $5, $6, 'ai_agent') RETURNING *`,
      [userAId, "🤖 AI Conversation", `Your AI agent exchanged ${aiMessageCount} messages with ${nameOfB}`, "Message", userBId, nameOfB]
    );
    const notifB = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at, sender_id, sender_name, source)
       VALUES ($1, $2, $3, $4, FALSE, NOW(), $5, $6, 'ai_agent') RETURNING *`,
      [userBId, "🤖 AI Conversation", `Your AI agent exchanged ${aiMessageCount} messages with ${nameOfA}`, "Message", userAId, nameOfA]
    );

    const socketA = onlineUsers.get(String(userAId));
    const socketB = onlineUsers.get(String(userBId));
    if (socketA && notifA.rows.length > 0) io.to(socketA).emit("new_notification", notifA.rows[0]);
    if (socketB && notifB.rows.length > 0) io.to(socketB).emit("new_notification", notifB.rows[0]);

    console.log(`🔔 [AIAgentService] Burst summary sent (${aiMessageCount} msgs between ${userAId} ↔ ${userBId})`);
  } catch (err) {
    console.error(`❌ [AIAgentService] sendBurstSummaryNotification error:`, err.message);
  }
};

// ─────────────────────────────────────────────
// AI-to-AI Conversation Orchestrator
// Entry point — replaces maybeGenerateAiReply in chatController.
// Single-reply when only receiver has AI; iterative loop when both do.
// ─────────────────────────────────────────────

export const runAiConversation = async (humanMessage) => {
  const originalSenderId = humanMessage.sender_id;
  const originalReceiverId = humanMessage.receiver_id;

  try {
    // ── Phase 1: Entry guards (same as maybeGenerateAiReply) ──
    if (humanMessage.is_ai_generated) {
      console.log(`🤖 [AIConversation] Skipping — message is AI-generated`);
      return;
    }
    if (!humanMessage.content || !humanMessage.content.trim()) {
      console.log(`🤖 [AIConversation] Skipping — attachment-only`);
      return;
    }

    const receiverConfig = await getAgentConfig(originalReceiverId);
    if (!receiverConfig.enabled) {
      console.log(`🤖 [AIConversation] AI disabled for receiver ${originalReceiverId}`);
      return;
    }
    if (!(await receiverHasAiAgentAccess(originalReceiverId))) {
      console.log(`🤖 [AIConversation] No active plan or AI Agent access for receiver ${originalReceiverId}`);
      return;
    }

    // Comfortability check (symmetric — covers both directions)
    const isComfortable = await checkProfileComfortability(originalSenderId, originalReceiverId);
    if (!isComfortable) {
      console.log(`🤖 [AIConversation] Comfortability FAILED ${originalSenderId} → ${originalReceiverId}`);

      // ── Incompatible match notifications (preserved from maybeGenerateAiReply) ──
      const [senderNameRes, receiverNameRes] = await Promise.all([
        pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [originalSenderId]),
        pool.query(`SELECT first_name, last_name FROM profiles WHERE user_id = $1`, [originalReceiverId]),
      ]);
      const senderName = senderNameRes.rows.length
        ? `${senderNameRes.rows[0].first_name} ${senderNameRes.rows[0].last_name ?? ""}`.trim()
        : `User ${originalSenderId}`;
      const receiverName = receiverNameRes.rows.length
        ? `${receiverNameRes.rows[0].first_name} ${receiverNameRes.rows[0].last_name ?? ""}`.trim()
        : `User ${originalReceiverId}`;

      const [senderNotif, receiverNotif] = await Promise.all([
        createNotification(originalSenderId, "⚠️ Match Incompatibility",
          `Your AI agent will not reply in your conversation with ${receiverName} due to low compatibility scores.`,
          "incompatible_match", originalReceiverId, receiverName, "ai_agent"),
        createNotification(originalReceiverId, "⚠️ Match Incompatibility",
          `Your AI agent will not reply in your conversation with ${senderName} due to low compatibility scores.`,
          "incompatible_match", originalSenderId, senderName, "ai_agent"),
      ]);

      const payload = { sender_id: originalSenderId, receiver_id: originalReceiverId };
      const sSock = onlineUsers.get(String(originalSenderId));
      const rSock = onlineUsers.get(String(originalReceiverId));
      if (sSock) {
        io.to(sSock).emit("incompatible_match", payload);
        if (senderNotif) io.to(sSock).emit("new_notification", senderNotif);
      }
      if (rSock) {
        io.to(rSock).emit("incompatible_match", payload);
        if (receiverNotif) io.to(rSock).emit("new_notification", receiverNotif);
      }
      return;
    }

    // ── Phase 2: Determine mode ──
    const senderConfig = await getAgentConfig(originalSenderId);
    const bothAiEnabled = senderConfig.enabled && (await receiverHasAiAgentAccess(originalSenderId));
    const maxMessages = bothAiEnabled ? MAX_AI_MESSAGES_PER_BURST : 1;

    console.log(`🤖 [AIConversation] Mode: ${bothAiEnabled ? `BOTH AI (max ${maxMessages})` : 'SINGLE REPLY'}`);

    // ── Phase 3: Iterative loop ──
    let currentSenderId = originalReceiverId;   // B replies first
    let currentReceiverId = originalSenderId;   // A receives first
    let lastMessage = humanMessage;
    let aiMessageCount = 0;

    for (let i = 0; i < maxMessages; i++) {
      // Natural delay between AI messages (skip delay for the very first reply)
      if (i > 0) await sleep(AI_REPLY_DELAY_MS);

      // Re-check: AI still enabled?
      const cfg = await getAgentConfig(currentSenderId);
      if (!cfg.enabled) {
        console.log(`🤖 [AIConversation] AI disabled for ${currentSenderId} at round ${i + 1} — stopping`);
        break;
      }
      // Re-check: active plan and AI Agent access?
      if (!(await receiverHasAiAgentAccess(currentSenderId))) {
        console.log(`🤖 [AIConversation] No plan or AI Agent access for ${currentSenderId} at round ${i + 1} — stopping`);
        break;
      }
      // Check & consume plan quota
      const quotaOk = await consumePlanQuota(currentSenderId);
      if (!quotaOk) {
        console.log(`🤖 [AIConversation] Quota exhausted for ${currentSenderId} at round ${i + 1} — stopping`);
        break;
      }

      // Typing indicator → receiver sees "sender is typing"
      emitAiTyping(currentReceiverId, currentSenderId, true);
      emitAiTyping(currentSenderId, currentReceiverId, true);

      let replyContent;
      try {
        replyContent = await generateAgentReply({
          ownerUserId: currentSenderId,
          partnerUserId: currentReceiverId,
          incomingMessage: lastMessage,
        });
      } finally {
        emitAiTyping(currentReceiverId, currentSenderId, false);
        emitAiTyping(currentSenderId, currentReceiverId, false);
      }

      if (!replyContent) {
        console.log(`🤖 [AIConversation] Empty reply for ${currentSenderId} at round ${i + 1} — stopping`);
        break;
      }

      // Save AI message — silent in burst mode, full notification in single-reply mode
      const aiMsg = bothAiEnabled
        ? await persistAiMessageSilent({ senderId: currentSenderId, receiverId: currentReceiverId, content: replyContent })
        : await persistAiMessage({ senderId: currentSenderId, receiverId: currentReceiverId, content: replyContent });

      aiMessageCount++;
      console.log(`🤖 [AIConversation] Round ${i + 1}/${maxMessages}: ${currentSenderId} → ${currentReceiverId} ✅ (total: ${aiMessageCount})`);

      lastMessage = aiMsg;
      // Swap roles
      [currentSenderId, currentReceiverId] = [currentReceiverId, currentSenderId];
    }

    // ── Phase 4: Summary notification (conversation mode only) ──
    if (bothAiEnabled && aiMessageCount > 0) {
      await sendBurstSummaryNotification(originalSenderId, originalReceiverId, aiMessageCount);
    }

    console.log(`🤖 [AIConversation] Done — ${aiMessageCount/2} AI messages (${originalSenderId} ↔ ${originalReceiverId})`);
  } catch (err) {
    console.error(`❌ [AIConversation] runAiConversation error:`, err.message);
    emitAiError([originalSenderId, originalReceiverId], {
      code: "AI_CONVERSATION_FAILED",
      message: "AI conversation encountered an unexpected error.",
      context: `Conversation between ${originalSenderId} ↔ ${originalReceiverId}`,
    });
  }
};
