// import dotenv from "dotenv";
// import { v4 as uuidv4 } from "uuid";
// import { createClient } from "@supabase/supabase-js";
// import { io, onlineUsers, sendNotification } from "../server.js";
// import { pool } from "../config/db.js";
// import { searchUsers } from "../config/db.js";
// import cloudinary from "../config/cloudinaryConfig.js";
// import { createNotification } from "./notificationController.js";
// import { getRecentChats as dbGetRecentChats } from "../config/db.js";
// dotenv.config();

// // ✅ Initialize Supabase

// // ---------------- Health Check ----------------
// export const healthCheck = (req, res) => {
//   return res.json({ status: "Server running ✅" });
// };
// export const uploadFile = async (req, res) => {
//   try {
//     // ✅ Multer will give us req.file (buffer included)
//     if (!req.file) {
//       return res.status(400).json({ error: "No file received" });
//     }

//     const contentType = req.file.mimetype;

//     const stream = cloudinary.uploader.upload_stream(
//       {
//         folder: "chat_uploads",
//         resource_type: "auto",
//         public_id: uuidv4(),
//       },
//       (error, uploadResult) => {
//         if (error) {
//           console.error("Cloudinary error:", error);
//           return res.status(500).json({ error: "Upload failed" });
//         }

//         // ✅ Return Cloudinary URL to frontend
//         return res.json({
//           message: "File uploaded successfully ✅",
//           url: uploadResult.secure_url,
//         });
//       },
//     );

//     // ✅ Send buffer to Cloudinary
//     stream.end(req.file.buffer);
//   } catch (err) {
//     console.error("Upload Error:", err);
//     return res.status(500).json({ error: "Upload failed" });
//   }
// };

// // ---------------- Get All Users ----------------
// export const getAllUsers = async (req, res) => {
//   try {
//     const searchTerm = req.query.search || "";

//     if (!searchTerm.trim()) {
//       return res.status(200).json([]);
//     }

//     const users = await searchUsers(searchTerm);

//     return res.status(200).json(users);
//   } catch (err) {
//     console.error("❌ Error searching users:", err);
//     res.status(500).json({ error: "Server error while searching users" });
//   }
// };

// export const getMessagesForUser = async (req, res) => {
//   try {
//     const { userId } = req.params; // chat partner ID
//     const { myUserId } = req.query; // logged-in user ID   // get it from token

//     // ✅ 1️⃣ Validation
//     if (!userId || !myUserId) {
//       return res.status(400).json({ error: "Missing userId or myUserId" });
//     }

//     // ✅ 2️⃣ Fetch all messages between two users (sorted oldest → newest)
//     const { rows } = await pool.query(
//       `SELECT * FROM messages
//        WHERE (sender_id = $1 AND receiver_id = $2)
//           OR (sender_id = $2 AND receiver_id = $1)
//        ORDER BY created_at ASC`,
//       [myUserId, userId],
//     );

//     // ✅ 3️⃣ Mark all unread messages as read (for logged-in user)
//     await pool.query(
//       `UPDATE messages
//        SET is_read = TRUE
//        WHERE receiver_id = $1
//          AND sender_id = $2
//          AND is_read = FALSE`,
//       [myUserId, userId],
//     );

//     // ✅ 4️⃣ Return messages (frontend can now display updated messages)
//     return res.status(200).json(rows);
//   } catch (error) {
//     console.error("Error fetching messages:", error.message);
//     return res.status(500).json({ error: "Failed to fetch messages" });
//   }
// };

// // 🟢 Send a new message + create notification
// export const getAllMessages = async (req, res) => {
//   try {
//     const { sender_id, receiver_id, content, attachment_url } = req.body;

//     // ✅ 1️⃣ Validation
//     if (!sender_id || !receiver_id || (!content && !attachment_url)) {
//       return res.status(400).json({
//         error:
//           "sender_id, receiver_id and at least one of content or attachment_url are required",
//       });
//     }

//     // ✅ 2️⃣ Insert new message (is_read default = false)
//     const { rows } = await pool.query(
//       `INSERT INTO messages (sender_id, receiver_id, content, attachment_url, is_read)
//        VALUES ($1, $2, $3, $4, $5)
//        RETURNING *`,
//       [sender_id, receiver_id, content, attachment_url, false],
//     );

//     const savedMessage = rows[0];

//     const queryToGetSenderName = `SELECT first_name,last_name FROM profiles WHERE user_id = $1`;
//     const senderNameResult = await pool.query(queryToGetSenderName, [
//       sender_id,
//     ]);

//     const senderFullName = `${senderNameResult.rows[0].first_name} ${senderNameResult.rows[0].last_name}`;

//     // ✅ 3️⃣ Emit new message to all connected sockets (real-time chat)
//     io.emit("new_message", savedMessage);
//     // ✅ Send message ONLY to sender & receiver

//      // ✅ 4️⃣ If receiver is online, send real-time message notification
//     const receiverSocketId = onlineUsers.get(receiver_id);
//     if (receiverSocketId) {
//       io.to(receiverSocketId).emit("message_notification", {
//         from: sender_id,
//         message: content || "📎 Attachment",
//         timestamp: savedMessage.created_at,
//       });
//     }

//     // ✅ 5️⃣ Insert persistent notification in DB (for bell icon)
//     await pool.query(
//       `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
//        VALUES ($1, $2, $3, $4, FALSE, NOW())`,
//       [
//         receiver_id,
//         "New Message 💬",
//         `${senderFullName} sent you a new message.`,
//         "Message", // type of notification
//       ],
//     );
//        // console.log(`💬 Message from ${senderFullName} to user ${receiver_id}: ${content || 'Attachment'}`);
//     // ✅ 6️⃣ Return saved message
//     return res.status(201).json(savedMessage);
//   } catch (error) {
//     console.error("Error saving message:", error.message);
//     return res.status(500).json({ error: "Failed to save message" });
//   }
// };

// // ---------------- Add Reaction ----------------
// export const addReaction = async (req, res) => {
//   const { message_id, user_id, emoji } = req.body;

//   if (!message_id || !user_id || !emoji) {
//     return res.status(400).json({
//       error: "message_id, user_id, and emoji are required",
//     });
//   }

//   try {
//     // 1️⃣ Save or update the reaction
//     const { rows } = await pool.query(
//       `INSERT INTO reactions (message_id, user_id, emoji)
//        VALUES ($1, $2, $3)
//        ON CONFLICT (message_id, user_id)
//        DO UPDATE SET emoji = EXCLUDED.emoji
//        RETURNING *`,
//       [message_id, user_id, emoji],
//     );

//     const reaction = rows[0];

//     // 2️⃣ Get sender and receiver info from message
//     const msgQuery = await pool.query(
//       `SELECT sender_id, receiver_id FROM messages WHERE id = $1`,
//       [message_id],
//     );

//     if (msgQuery.rows.length === 0)
//       return res.status(404).json({ error: "Message not found" });

//     const message = msgQuery.rows[0];
//     const receiverId =
//       message.sender_id === user_id ? message.receiver_id : message.sender_id;
//     ////
//     const userResult = await pool.query(
//       `SELECT first_name, last_name FROM profiles WHERE user_id = $1`,
//       [user_id],
//     );

//     const senderFullName = userResult.rows.length
//       ? `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`
//       : `User ${user_id}`;
//     /////
//     /////
//     const notificationMessage = `${senderFullName} reacted with "${emoji}" on your message.`;

//    // 3️⃣ Create notification (DB + bell icon)
//     await createNotification(
//       receiverId,
//       "New Reaction 💬",
//       notificationMessage,
//       "reaction",
//     );

//     // 4️⃣ Send real-time notification if receiver online
//     const socketId = onlineUsers.get(receiverId);
//     if (socketId) {
//       io.to(socketId).emit("new_notification", {
//         title: "New Reaction 💬",
//         message: notificationMessage,
//         reaction,
//       });

//       // optional: also send reaction update
//       io.to(socketId).emit("new_reaction", reaction);
//     }

//     console.log(`💬 Reaction added by user ${notificationMessage} -> ${emoji}`);
//     return res.json({ success: true, reaction });
//   } catch (error) {
//     console.error("❌ Error saving reaction:", error.message);
//     return res.status(500).json({ error: "Failed to save reaction" });
//   }
// };

// // ---------------- Get All Reactions ----------------
// export const getAllReactions = async (req, res) => {
//   try {
//     const { rows } = await pool.query(
//       "SELECT * FROM reactions ORDER BY timestamp DESC",
//     );
//     return res.json(rows);
//   } catch (error) {
//     console.error("❌ Error fetching reactions:", error.message);
//     return res.status(500).json({ error: "Failed to fetch reactions" });
//   }
// };

// // ---------------- Get Recent Chats ----------------
// export const getRecentChats = async (req, res) => {
//   try {
//     const { myUserId } = req.params;

//     if (!myUserId) {
//       return res.status(400).json({ error: "Missing myUserId" });
//     }

//     const chats = await dbGetRecentChats(myUserId);

//     return res.status(200).json(chats);
//   } catch (err) {
//     console.error("❌ Error loading recent chats:", err);
//     return res.status(500).json({ error: "Failed to load recent chats" });
//   }
// };

// // ---------------- Delete Message ----------------
// export const deleteMessage = async (req, res) => {
//   try {
//     const messageId = req.params.id;
//     const userId = req.query.userId;

//     if (!messageId || !userId) {
//       return res.status(400).json({ error: "Missing messageId or userId" });
//     }

//     // Check if message exists
//     const msg = await pool.query("SELECT * FROM messages WHERE id = $1", [
//       messageId,
//     ]);

//     if (msg.rows.length === 0) {
//       return res.status(404).json({ error: "Message not found" });
//     }

//     // Only sender can delete
//     if (String(msg.rows[0].sender_id) !== String(userId)) {
//       return res
//         .status(403)
//         .json({ error: "Not allowed to delete this message" });
//     }

//     // Delete the message
//     const deleted = await pool.query(
//       "DELETE FROM messages WHERE id = $1 RETURNING *",
//       [messageId],
//     );

//     // Emit real-time delete event
//     io.emit("message_deleted", { id: messageId });

//     return res.status(200).json({
//       success: true,
//       deleted: deleted.rows[0],
//     });
//   } catch (err) {
//     console.error("Delete message error:", err);
//     return res.status(500).json({ error: "Failed to delete message" });
//   }
// };

import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { io, onlineUsers } from "../server.js";
import { pool } from "../config/db.js";
import {
  searchUsers,
  getRecentChats as dbGetRecentChats,
} from "../config/db.js";
import cloudinary from "../config/cloudinaryConfig.js";
import { createNotification } from "./notificationController.js";

dotenv.config();

// ---------------- Health Check ----------------
export const healthCheck = (req, res) => {
  return res.json({ status: "Server running ✅" });
};

// ---------------- Upload File ----------------
export const uploadFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file received" });
    }

    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "chat_uploads",
        resource_type: "auto",
        public_id: uuidv4(),
      },
      (error, uploadResult) => {
        if (error) {
          console.error("Cloudinary error:", error);
          return res.status(500).json({ error: "Upload failed" });
        }

        return res.json({
          message: "File uploaded successfully",
          url: uploadResult.secure_url,
        });
      },
    );

    stream.end(req.file.buffer);
  } catch (err) {
    console.error("Upload Error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
};

// ---------------- Search Users ----------------
export const getAllUsers = async (req, res) => {
  try {
    const searchTerm = req.query.search || "";
    if (!searchTerm.trim()) return res.status(200).json([]);

    const users = await searchUsers(searchTerm);
    return res.status(200).json(users);
  } catch (err) {
    console.error("❌ Error searching users:", err);
    res.status(500).json({ error: "Server error while searching users" });
  }
};

// // ---------------- Get Messages ----------------
// export const getMessagesForUser = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const { myUserId } = req.query;

//     if (!userId || !myUserId) {
//       return res.status(400).json({ error: "Missing userId or myUserId" });
//     }

//     const { rows } = await pool.query(
//       `
//       SELECT
//   m.sender_id,
//   m.receiver_id,
//   m.content,
//   sender.profile_picture_url AS sender_profile_picture_url,
//   receiver.profile_picture_url AS receiver_profile_picture_url
// FROM messages m
// JOIN users sender ON sender.id = m.sender_id
// JOIN users receiver ON receiver.id = m.receiver_id
// WHERE (m.sender_id = $1 AND m.receiver_id = $2)
//    OR (m.sender_id = $2 AND m.receiver_id = $1)
// ORDER BY m.created_at ASC;

//       `,
//       [myUserId, userId],
//     );

//     await pool.query(
//       `
//       UPDATE messages
//       SET is_read = TRUE
//       WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE
//       `,
//       [myUserId, userId],
//     );

//     return res.status(200).json(rows);
//   } catch (error) {
//     console.error("Error fetching messages:", error.message);
//     return res.status(500).json({ error: "Failed to fetch messages" });
//   }
// };


export const getMessagesForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { myUserId } = req.query;

    if (!userId || !myUserId) {
      return res.status(400).json({ error: "Missing userId or myUserId" });
    }

    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.sender_id,
        m.receiver_id,
        m.content,
        m.attachment_url,
        m.created_at,
        m.is_read,

        sender_profile.image_url   AS sender_profile_image_url,
        receiver_profile.image_url AS receiver_profile_image_url

      FROM messages m

      LEFT JOIN profiles sender_profile
        ON sender_profile.user_id = m.sender_id

      LEFT JOIN profiles receiver_profile
        ON receiver_profile.user_id = m.receiver_id

      WHERE (m.sender_id = $1 AND m.receiver_id = $2)
         OR (m.sender_id = $2 AND m.receiver_id = $1)

      ORDER BY m.created_at ASC
      `,
      [myUserId, userId]
    );

    await pool.query(
      `
      UPDATE messages
      SET is_read = TRUE
      WHERE receiver_id = $1
        AND sender_id = $2
        AND is_read = FALSE
      `,
      [myUserId, userId]
    );

    return res.status(200).json(rows);
  } catch (error) {
    console.error("Error fetching messages:", error.message);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
};


//shraddha new code//
// ---------------- SEND MESSAGE (WITH LIMIT CHECK) ----------------
export const getAllMessages = async (req, res) => {
  try {
    const { sender_id, receiver_id, content, attachment_url } = req.body;

    if (!sender_id || !receiver_id || (!content && !attachment_url)) {
      return res.status(400).json({
        error: "sender_id, receiver_id and content or attachment required",
      });
    }

    // 🔐 PLAN + MESSAGE LIMIT CHECK
    const planResult = await pool.query(
      `
      SELECT 
        p.people_message_limit,
        up.people_message_used
      FROM user_plans up
      JOIN plans p ON p.id = up.plan_id
      WHERE up.user_id = $1
        AND up.status = 'active'
        AND up.expires_at > NOW()
      `,
      [sender_id],
    );

    if (planResult.rows.length === 0) {
      return res.status(403).json({
        message: "No active plan found",
      });
    }

    const { people_message_limit, people_message_used } = planResult.rows[0];

    // 🚫 BLOCK IF LIMIT EXCEEDED (except unlimited = -1)
    if (
      people_message_limit !== -1 &&
      people_message_used >= people_message_limit
    ) {
      return res.status(403).json({
        code: "MESSAGE_LIMIT_EXCEEDED",
        message: "Your message limit is over. Please upgrade your plan.",
      });
    }

    /* ⭐ SHRADDHA NEW CODE END */
    // ✅ SAVE MESSAGE
    const { rows } = await pool.query(
      `
      INSERT INTO messages (sender_id, receiver_id, content, attachment_url, is_read)
      VALUES ($1, $2, $3, $4, FALSE)
      RETURNING *
      `,
      [sender_id, receiver_id, content, attachment_url],
    );

    const savedMessage = rows[0];
    /* ⭐ SHRADDHA NEW CODE START — INCREMENT MESSAGE COUNT */
    // ➕ INCREMENT MESSAGE COUNT (ONLY LIMITED PLANS)
    const queryToGetSenderName = `SELECT first_name,last_name FROM profiles WHERE user_id = $1`;
    const senderNameResult = await pool.query(queryToGetSenderName, [
      sender_id,
    ]);
    const senderFullName = `${senderNameResult.rows[0].first_name} ${senderNameResult.rows[0].last_name}`;
    if (people_message_limit !== -1) {
      await pool.query(
        `
        UPDATE user_plans
        SET people_message_used = people_message_used + 1
        WHERE user_id = $1 AND status = 'active'
        `,
        [sender_id],
      );
    }
    /* ⭐ SHRADDHA NEW CODE END */
    // 🔔 SOCKET EVENT
    io.emit("new_message", savedMessage);

    // 🔔 NOTIFICATION
    await pool.query(
      `
      INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
      VALUES ($1, $2, $3, $4, FALSE, NOW())
      `,
      [
        receiver_id,
        "New Message 💬",
        `${senderFullName} sent you a new message`,
        "Message",
      ],
    );

    return res.status(201).json(savedMessage);
  } catch (error) {
    console.error("❌ Message send error:", error.message);
    return res.status(500).json({ error: "Failed to send message" });
  }
};
/* ⭐ SHRADDHA NEW CODE START — REACTION NOTIFICATION */
// ---------------- Add Reaction ----------------
export const addReaction = async (req, res) => {
  const { message_id, user_id, emoji } = req.body;

  if (!message_id || !user_id || !emoji) {
    return res.status(400).json({
      error: "message_id, user_id, and emoji are required",
    });
  }

  try {
    const { rows } = await pool.query(
      `
      INSERT INTO reactions (message_id, user_id, emoji)
      VALUES ($1, $2, $3)
      ON CONFLICT (message_id, user_id)
      DO UPDATE SET emoji = EXCLUDED.emoji
      RETURNING *
      `,
      [message_id, user_id, emoji],
    );

    const reaction = rows[0];
    const messageResult = await pool.query(
      `SELECT sender_id, receiver_id FROM messages WHERE id = $1`,
      [message_id],
    );
    if (messageResult.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }
    const message = messageResult.rows[0];
    const reactionReceiverId =
      message.sender_id === user_id ? message.receiver_id : message.sender_id;

    const userResult = await pool.query(
      `SELECT first_name, last_name FROM profiles WHERE user_id = $1`,
      [user_id],
    );
    const senderFullName = userResult.rows.length
      ? `${userResult.rows[0].first_name} ${userResult.rows[0].last_name}`
      : `User ${user_id}`;
    const notificationMessage = `${senderFullName} reacted with "${emoji}" on your message.`;
    // Create notification
    await createNotification(
      reactionReceiverId,
      "New Reaction 💬",
      notificationMessage,
      "reaction",
    );

    const socketId = onlineUsers.get(reactionReceiverId);
    if (socketId) {
      io.to(socketId).emit("new_notification", {
        title: "New Reaction 💬",
        message: notificationMessage,
        reaction,
      });
    }

    io.emit("new_reaction", reaction);
    return res.json({ success: true, reaction });
  } catch (error) {
    console.error("❌ Reaction error:", error.message);
    return res.status(500).json({ error: "Failed to save reaction" });
  }
};
/* ⭐ SHRADDHA NEW CODE end — REACTION NOTIFICATION */
// ---------------- Get All Reactions ----------------
export const getAllReactions = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM reactions ORDER BY timestamp DESC",
    );
    return res.json(rows);
  } catch (error) {
    console.error("❌ Error fetching reactions:", error.message);
    return res.status(500).json({ error: "Failed to fetch reactions" });
  }
};

// ---------------- Recent Chats ----------------
export const getRecentChats = async (req, res) => {
  try {
    const { myUserId } = req.params;
    if (!myUserId) {
      return res.status(400).json({ error: "Missing myUserId" });
    }

    const chats = await dbGetRecentChats(myUserId);
    return res.status(200).json(chats);
  } catch (err) {
    console.error("❌ Error loading recent chats:", err);
    return res.status(500).json({ error: "Failed to load recent chats" });
  }
};

// ---------------- Delete Message ----------------
export const deleteMessage = async (req, res) => {
  try {
    const messageId = req.params.id;
    const userId = req.query.userId;

    if (!messageId || !userId) {
      return res.status(400).json({ error: "Missing messageId or userId" });
    }

    const msg = await pool.query("SELECT * FROM messages WHERE id = $1", [
      messageId,
    ]);

    if (!msg.rows.length) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (String(msg.rows[0].sender_id) !== String(userId)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    await pool.query("DELETE FROM messages WHERE id = $1", [messageId]);
    io.emit("message_deleted", { id: messageId });

    return res.json({ success: true });
  } catch (err) {
    console.error("Delete message error:", err);
    return res.status(500).json({ error: "Failed to delete message" });
  }
};
