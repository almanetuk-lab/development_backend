// db.js
import pkg from "pg";
import dotenv from "dotenv";


dotenv.config();
const { Pool } = pkg;

// ✅ Connection string
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ Please set SUPABASE_DB_URL or DATABASE_URL in .env");
}

// ✅ Create PostgreSQL pool
const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

export const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// ✅ Test Connection
export const testConnection = async () => {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✅ Connected to PostgreSQL. Current time:", result.rows[0].now);

    // Dynamic table initialization for profile_compatibilities with indexes
    console.log("🧬 Verifying profile_compatibilities table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profile_compatibilities (
        id SERIAL PRIMARY KEY,
        user_a_id INT NOT NULL,
        user_b_id INT NOT NULL,
        compatibility_data JSONB NOT NULL,
        overall_score INT NOT NULL,
        ai_summary TEXT NOT NULL,
        compatibility_type VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_user_pair UNIQUE (user_a_id, user_b_id)
      );

      CREATE INDEX IF NOT EXISTS idx_profile_compatibilities_user_a ON profile_compatibilities (user_a_id);
      CREATE INDEX IF NOT EXISTS idx_profile_compatibilities_user_b ON profile_compatibilities (user_b_id);
    `);
    console.log("🧬 profile_compatibilities table and indexes successfully verified.");

    // Dynamic columns verification for profiles psychological data
    console.log("🧬 Verifying profiles table psychological AI columns...");
    await pool.query(`
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS confidence_score FLOAT8;
    `);
    console.log("🧬 profiles table psychological AI columns successfully verified.");
  } catch (err) {
    console.error("❌ Database connection error:", err.message);
  }
};

// ✅ Search Users by Email
export const searchUsers = async (searchTerm) => {
  const q = `
    SELECT
      id,
      INITCAP(SPLIT_PART(email, '@', 1)) AS name,  -- Extract name part from email
      email
    FROM users
    WHERE email ILIKE $1
    ORDER BY email
    LIMIT 50;
  `;
  const val = ["%" + searchTerm + "%"];
  const { rows } = await pool.query(q, val);
  return rows;
};

// ✅ Get Conversation Between Two Users
export const getConversation = async (userA, userB) => {
  const q = `
    SELECT id, sender_id, receiver_id, content, attachment_url, created_at
    FROM messages
    WHERE (sender_id = $1 AND receiver_id = $2)
       OR (sender_id = $2 AND receiver_id = $1)
    ORDER BY created_at ASC;
  `;
  const { rows } = await pool.query(q, [userA, userB]);
  return rows;
};

// ✅ Create Message
export const createMessage = async (senderId, receiverId, content, attachmentUrl = null) => {
  const q = `
    INSERT INTO messages (sender_id, receiver_id, content, attachment_url)
    VALUES ($1, $2, $3, $4)
    RETURNING id, sender_id, receiver_id, content, attachment_url, created_at;
  `;
  const { rows } = await pool.query(q, [senderId, receiverId, content, attachmentUrl]);
  return rows[0];
};

// ✅ Add or Update Reaction
export const addOrUpdateReaction = async (messageId, userId, emoji) => {
  const q = `
    INSERT INTO reactions (message_id, user_id, emoji)
    VALUES ($1, $2, $3)
    ON CONFLICT (message_id, user_id)
    DO UPDATE SET emoji = EXCLUDED.emoji, timestamp = CURRENT_TIMESTAMP
    RETURNING id, message_id, user_id, emoji, timestamp;
  `;
  const { rows } = await pool.query(q, [messageId, userId, emoji]);
  return rows[0];
};

// ✅ Get All Reactions in a Conversation
export const getReactionsForConversation = async (userA, userB) => {
  const q = `
    SELECT r.id, r.message_id, r.user_id, r.emoji
    FROM reactions r
    JOIN messages m ON m.id = r.message_id
    WHERE (m.sender_id = $1 AND m.receiver_id = $2)
       OR (m.sender_id = $2 AND m.receiver_id = $1);
  `;
  const { rows } = await pool.query(q, [userA, userB]);
  return rows;
};





// ✅ Get WhatsApp-style Recent Chats
export const getRecentChats = async (myUserId) => {
  const q = `
    WITH chat_partners AS (
      SELECT 
        CASE 
          WHEN sender_id = $1 THEN receiver_id 
          ELSE sender_id 
        END AS user_id
      FROM messages
      WHERE sender_id = $1 OR receiver_id = $1
      GROUP BY user_id
    ),

    last_messages AS (
      SELECT 
        m.*,
        ROW_NUMBER() OVER (
          PARTITION BY 
            CASE 
              WHEN m.sender_id = $1 THEN m.receiver_id 
              ELSE m.sender_id 
            END
          ORDER BY m.created_at DESC
        ) AS rn
      FROM messages m
      WHERE sender_id = $1 OR receiver_id = $1
    ),

    unread_counts AS (
      SELECT 
        sender_id AS user_id,
        COUNT(*) AS unread_count
      FROM messages
      WHERE receiver_id = $1 AND is_read = FALSE
      GROUP BY sender_id
    )

    SELECT 
      u.id AS user_id,
      INITCAP(SPLIT_PART(u.email, '@', 1)) AS name,
      u.email,
      p.image_url AS profile_picture_url,

      lm.content AS last_message,
      lm.created_at AS last_message_time,

      COALESCE(uc.unread_count, 0) AS unread_count

    FROM chat_partners cp
    JOIN users u ON u.id = cp.user_id
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN last_messages lm 
      ON lm.rn = 1 
     AND (
        (lm.sender_id = $1 AND lm.receiver_id = u.id)
        OR
        (lm.sender_id = u.id AND lm.receiver_id = $1)
     )

    LEFT JOIN unread_counts uc ON uc.user_id = u.id

    ORDER BY last_message_time DESC NULLS LAST;
  `;

  const { rows } = await pool.query(q, [myUserId]);
  return rows;
};
