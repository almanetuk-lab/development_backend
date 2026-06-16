import { pool } from "../config/db.js";

// 🔹 Get all notifications for a user
export const getNotifications = async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]
    );
    console.log("✅ Notifications fetched successfully.");
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// 🔹 Mark a single notification as read
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "UPDATE notifications SET is_read = TRUE WHERE id = $1",
      [id]
    );

    res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// 🔹 Create a new notification (used by backend code)
export const createNotification = async (user_id, title, message, type = "general") => {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())`,
      [user_id, title, message, type]
    );
  } catch (error) {
    console.error("Error creating notification:", error);
  }
};

// // 🔹 Mark all unread notifications as read for a user
export const markNotificationsAsRead = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE
       RETURNING *`,
      [userId]
    );

    return res.json({
      message: "All unread notifications marked as read",
      updated: result.rowCount,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error marking notifications as read:", error.message);
    return res.status(500).json({ error: "Failed to mark notifications as read" });
  }
};





// //Get all notification :- 
// export const getUnreadNotifications = async (req, res) => {
//   const userId = req.user.id

//   try {
//     const query = `
//       SELECT 
//           n.id AS notification_id,
//           n.title,
//           CONCAT(sender.first_name, ' ', sender.last_name, ': ', m.content) AS notification_message,
//           n.is_read,
//           n.type,
//           TO_CHAR(n.created_at, 'DD Mon, HH12:MI am') AS created_at,
//           sender_user.email AS sender_email
//       FROM notifications n
//       JOIN messages m ON m.receiver_id = n.user_id 
//       JOIN profiles sender ON m.sender_id = sender.id
//       JOIN users sender_user ON sender.user_id = sender_user.id
//       WHERE n.user_id = $1
//         AND n.is_read = false
//       ORDER BY m.created_at DESC
//       LIMIT 1;
//     `;

//     const result = await pool.query(query, [userId]);
//     console.log("✅ Unread notifications fetched successfully.", result.rows);
//     res.json(result.rows);
//   } catch (err) {
//     console.error("❌ Error fetching notifications:", err);
//     res.status(500).json({ message: err.message });
//   }
// };



// //To get the unread messages of clicked user and logged in user (conversation of the logged in user and clicked user from the notification bar)
// export const getChatMessages = async (req, res) => {
//   const { senderId } = req.params;
//   const currUserId = req.user.id // logged-in user

//   try {
//     // 1️⃣ Mark unread messages as read
//     const updateMessagesQuery = `
//       UPDATE messages
//       SET is_read = true
//       WHERE receiver_id = $1
//         AND sender_id = $2
//         AND is_read = false;
//     `;
//     await pool.query(updateMessagesQuery, [currUserId, senderId]);

//     // 2️⃣ Mark related notifications as read
//     const updateNotificationsQuery = `
//       UPDATE notifications
//       SET is_read = true
//       WHERE user_id = $1
//         AND type = 'message'
//         AND is_read = false;
//     `;
//     await pool.query(updateNotificationsQuery, [currUserId]);

//     // 3️⃣ Fetch all chat messages between sender and current user
//     const selectQuery = `
//       SELECT 
//           m.id AS message_id,
//           m.content AS message,
//           m.attachment_url,
//           TO_CHAR(m.created_at AT TIME ZONE 'UTC', 'DD Mon, hh:mi am') AS created_at,
//           m.sender_id,
//           sender_user.email AS sender_email,
//           m.receiver_id,
//           receiver_user.email AS receiver_email,
//           m.is_read
//       FROM messages m
//       JOIN profiles sender ON m.sender_id = sender.id
//       JOIN users sender_user ON sender.user_id = sender_user.id
//       JOIN profiles receiver ON m.receiver_id = receiver.user_id
//       JOIN users receiver_user ON receiver.user_id = receiver_user.id
//       WHERE (m.sender_id = $1 AND m.receiver_id = $2)
//       OR (m.sender_id = $2 AND m.receiver_id = $1)
//       ORDER BY m.created_at ASC;
//     `;

//     const result = await pool.query(selectQuery, [currUserId, senderId]);

//     console.log("Messages fetched:", result.rows);
//     //To get the details(Like fullname, email, etc) of two users who are chating togther:-
//     let query2 = `SELECT 
//     u.id AS user_id, 
//     p.id AS profile_id, 
//     u.*, 
//     p.*
//     FROM users u
//     JOIN profiles p ON u.id = p.user_id
//     WHERE u.id = $1;`

//     let result2 = await pool.query(query2, [senderId]);

//     res.json({ messgaes: result.rows, chattingUser: result2.rows });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: err.message });
//   }
// };



