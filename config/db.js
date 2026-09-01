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

    // Verify/alter notifications table
    console.log("🔔 Verifying notifications table columns...");
    await pool.query(`
      ALTER TABLE notifications 
      ADD COLUMN IF NOT EXISTS sender_id INTEGER,
      ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS source VARCHAR(50),
      ADD COLUMN IF NOT EXISTS reaction_emoji VARCHAR(50);
    `);
    console.log("🔔 notifications table columns verified.");

    // Align enum types for children and pets preferences to support both straight and curly apostrophes
    try {
      await pool.query(`
        ALTER TYPE children_preference_enum ADD VALUE IF NOT EXISTS 'Don''t want';
        ALTER TYPE children_preference_enum ADD VALUE IF NOT EXISTS 'Have and don''t want more';
        ALTER TYPE children_preference_enum ADD VALUE IF NOT EXISTS 'Open / Not sure yet';
        ALTER TYPE pets_preference_enum ADD VALUE IF NOT EXISTS 'Don''t want';
        ALTER TYPE pets_preference_enum ADD VALUE IF NOT EXISTS 'Have and don''t want more';
        ALTER TYPE pets_preference_enum ADD VALUE IF NOT EXISTS 'Open / Not Sure yet';
      `);
    } catch (enumErr) {
      console.warn("⚠️ Enum alignment notice:", enumErr.message);
    }

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

    // Dynamic table initialization for digital_twins
    console.log("🧬 Verifying digital_twins table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS digital_twins (
        id SERIAL PRIMARY KEY,
        user_id INT UNIQUE NOT NULL,
        twin_data JSONB NOT NULL,
        current_state_summary TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("🧬 digital_twins table successfully verified.");

    // Dynamic table initialization for handshake_sessions
    console.log("🧬 Verifying handshake_sessions table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS handshake_sessions (
        id SERIAL PRIMARY KEY,
        user_a_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'completed',
        compatibility_markers JSONB NOT NULL,
        risk_flags JSONB NOT NULL,
        handshake_summary TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_handshake_sessions_user_a ON handshake_sessions (user_a_id);
      CREATE INDEX IF NOT EXISTS idx_handshake_sessions_user_b ON handshake_sessions (user_b_id);
    `);
    console.log("🧬 handshake_sessions table and indexes successfully verified.");

    // Dynamic columns verification for handshake_sessions table
    console.log("🧬 Verifying handshake_sessions table stress synchronization columns...");
    await pool.query(`
      ALTER TABLE handshake_sessions ADD COLUMN IF NOT EXISTS stress_synchronization JSONB;
    `);
    console.log("🧬 handshake_sessions table stress synchronization columns successfully verified.");

    // Dynamic columns verification for profiles psychological data
    console.log("🧬 Verifying profiles table psychological AI columns...");
    await pool.query(`
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS confidence_score FLOAT8;
    `);
    console.log("🧬 profiles table psychological AI columns successfully verified.");

    // Dynamic columns verification for plans allowed_features column
    console.log("💳 Verifying plans table allowed_features column...");
    await pool.query(`
      ALTER TABLE plans ADD COLUMN IF NOT EXISTS allowed_features JSONB;
    `);
    console.log("💳 plans table allowed_features column successfully verified.");

    // Backfill legacy plans with all features enabled by default
    console.log("💳 Backfilling legacy plans allowed_features...");
    await pool.query(`
      UPDATE plans 
      SET allowed_features = '{"dashboard":true,"profile":true,"message":true,"basic_search":true,"advance_search":true,"edit_profile":true,"my_matches":true,"ai_suggestion":true,"near_me":true,"browse_members":true,"ai_agent":true}'::jsonb
      WHERE allowed_features IS NULL;
    `);
    console.log("💳 Backfilling legacy plans allowed_features completed.");


    // Dynamic table initialization for security_audit_logs
    console.log("🛡️ Verifying security_audit_logs table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        action VARCHAR(255) NOT NULL,
        details TEXT DEFAULT NULL,
        ip_address VARCHAR(45) DEFAULT NULL,
        user_agent TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user_id ON security_audit_logs (user_id);
      CREATE INDEX IF NOT EXISTS idx_security_audit_logs_action ON security_audit_logs (action);
    `);
    console.log("🛡️ security_audit_logs table and indexes verified.");

    // Dynamic table initialization for contact_messages
    console.log("📬 Verifying contact_messages table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("📬 contact_messages table verified.");

    // Dynamic table initialization for newsletter_subscriptions
    console.log("📰 Verifying newsletter_subscriptions table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("📰 newsletter_subscriptions table verified.");
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
