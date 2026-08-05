/**
 * seed_nearme_test_users.js
 * ──────────────────────────────────────────────────────────────────────────
 * Creates 6 test accounts at real GPS coordinates near Indore, MP.
 * Run:  node backend/scripts/seed_nearme_test_users.js
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Test credentials (all share password: Test@1234):
 *
 *  email                       | city            | ~distance from Indore
 *  ──────────────────────────────────────────────────────────────────────
 *  nearme.test1@example.com    | Indore (centre) | ~0 km
 *  nearme.test2@example.com    | Indore (east)   | ~5 km
 *  nearme.test3@example.com    | Dewas           | ~35 km
 *  nearme.test4@example.com    | Ujjain          | ~55 km
 *  nearme.test5@example.com    | Bhopal          | ~190 km
 *  nearme.test6@example.com    | Mumbai          | ~580 km
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load .env from backend root (works regardless of cwd)
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import pkg from "pg";
import bcrypt from "bcrypt";

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PASSWORD = "Test@1234";

const TEST_USERS = [
  {
    email: "nearme.test1@example.com",
    username: "nearme_test1",
    first_name: "Priya",
    last_name: "Sharma",
    profession: "Software Engineer",
    about_me: "I love coding and exploring new technologies.",
    city: "Indore",
    state: "Madhya Pradesh",
    pincode: "452001",
    gender: "Female",
    age: 26,
    lat: 22.7196,
    lon: 75.8577,   // Indore centre
    note: "~0 km from user",
  },
  {
    email: "nearme.test2@example.com",
    username: "nearme_test2",
    first_name: "Rahul",
    last_name: "Verma",
    profession: "Data Scientist",
    about_me: "Passionate about machine learning and data.",
    city: "Indore",
    state: "Madhya Pradesh",
    pincode: "452010",
    gender: "Male",
    age: 29,
    lat: 22.7547,
    lon: 75.9003,   // Indore east ~5 km
    note: "~5 km from user",
  },
  {
    email: "nearme.test3@example.com",
    username: "nearme_test3",
    first_name: "Ananya",
    last_name: "Patel",
    profession: "Doctor",
    about_me: "Working in healthcare and love travelling.",
    city: "Dewas",
    state: "Madhya Pradesh",
    pincode: "455001",
    gender: "Female",
    age: 31,
    lat: 22.9676,
    lon: 76.0534,   // Dewas ~35 km
    note: "~35 km from user",
  },
  {
    email: "nearme.test4@example.com",
    username: "nearme_test4",
    first_name: "Arjun",
    last_name: "Gupta",
    profession: "Teacher",
    about_me: "Educator passionate about youth development.",
    city: "Ujjain",
    state: "Madhya Pradesh",
    pincode: "456001",
    gender: "Male",
    age: 34,
    lat: 23.1765,
    lon: 75.7885,   // Ujjain ~55 km
    note: "~55 km from user",
  },
  {
    email: "nearme.test5@example.com",
    username: "nearme_test5",
    first_name: "Meera",
    last_name: "Joshi",
    profession: "Architect",
    about_me: "Designing spaces that inspire people.",
    city: "Bhopal",
    state: "Madhya Pradesh",
    pincode: "462001",
    gender: "Female",
    age: 28,
    lat: 23.2599,
    lon: 77.4126,   // Bhopal ~190 km
    note: "~190 km from user",
  },
  {
    email: "nearme.test6@example.com",
    username: "nearme_test6",
    first_name: "Karan",
    last_name: "Mehta",
    profession: "Entrepreneur",
    about_me: "Building businesses that make a difference.",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    gender: "Male",
    age: 33,
    lat: 19.0760,
    lon: 72.8777,   // Mumbai ~580 km
    note: "~580 km from user",
  },
];

async function getPlanId() {
  // Grab any active plan to assign
  const { rows } = await pool.query(
    `SELECT id FROM plans WHERE is_active = 1 LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function seedUser(user, hashedPassword, planId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 1. Upsert into users ────────────────────────────────────────────────
    const userRes = await client.query(
      `INSERT INTO users (email, password, status)
       VALUES ($1, $2, 'Approve')
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
       RETURNING id`,
      [user.email, hashedPassword]
    );
    const userId = userRes.rows[0].id;

    // ── 2. Upsert profile with lat/lon ──────────────────────────────────────
    await client.query(
      `INSERT INTO profiles (
         user_id, first_name, last_name, username, about_me, profession,
         city, state, pincode, gender, age,
         latitude, longitude,
         is_submitted, intent_tags, contextual_tags, confidence_score
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14::jsonb,$15::jsonb,$16)
       ON CONFLICT (user_id) DO UPDATE SET
         first_name   = EXCLUDED.first_name,
         last_name    = EXCLUDED.last_name,
         city         = EXCLUDED.city,
         state        = EXCLUDED.state,
         pincode      = EXCLUDED.pincode,
         gender       = EXCLUDED.gender,
         age          = EXCLUDED.age,
         latitude     = EXCLUDED.latitude,
         longitude    = EXCLUDED.longitude,
         is_submitted = true`,
      [
        userId,
        user.first_name,
        user.last_name,
        user.username,
        user.about_me,
        user.profession,
        user.city,
        user.state,
        user.pincode,
        user.gender,
        user.age,
        user.lat,
        user.lon,
        JSON.stringify({ ambition_level: "Moderate", stress_cycle: "Balanced", social_preference: "Moderate", communication_style: "Friendly", relationship_intent: "Serious" }),
        JSON.stringify({ city_energy: "Moderate", cost_of_living: "Moderate", career_pressure: "Moderate", commute_stress: "Low", social_environment: "Balanced", emotional_environment: "Balanced", lifestyle_intensity: "Balanced" }),
        0.75,
      ]
    );

    // ── 3. Assign an active plan so search passes plan-gate ─────────────────
    if (planId) {
      // Clear any existing plan rows for this user first, then insert fresh
      await client.query(`DELETE FROM user_plans WHERE user_id = $1`, [userId]);
      await client.query(
        `INSERT INTO user_plans (user_id, plan_id, status, starts_at, expires_at, people_search_used)
         VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '30 days', 0)`,
        [userId, planId]
      );
    }

    await client.query("COMMIT");
    console.log(`✅  Created: ${user.email}  [${user.city} — ${user.note}]  lat=${user.lat} lon=${user.lon}`);
    return userId;
  } catch (err) {
    await client.query("ROLLBACK");
    // If conflict on username, log and continue
    console.warn(`⚠️  Skipped ${user.email}: ${err.message}`);
  } finally {
    client.release();
  }
}

async function main() {
  console.log("\n🌱  Seeding Near Me test users…\n");

  // Check if latitude column exists (it should after migration)
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'profiles' AND column_name IN ('latitude','longitude')`
  );
  if (cols.length < 2) {
    console.error("❌  profiles table is missing latitude/longitude columns.");
    console.error("   Run the PostGIS migration first, or add the columns manually:");
    console.error("   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS latitude FLOAT8;");
    console.error("   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS longitude FLOAT8;");
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  const planId = await getPlanId();
  if (!planId) console.warn("⚠️  No active plan found — skipping plan assignment (search may be blocked by plan gate).");

  for (const user of TEST_USERS) {
    await seedUser(user, hashedPassword, planId);
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("🎉  Seeding complete!");
  console.log("──────────────────────────────────────────────────────────────");
  console.log(`  Password for ALL accounts: ${PASSWORD}`);
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Email                         | City    | Distance");
  console.log("  ──────────────────────────────|─────────|──────────");
  TEST_USERS.forEach(u =>
    console.log(`  ${u.email.padEnd(30)} | ${u.city.padEnd(7)} | ${u.note}`)
  );
  console.log("══════════════════════════════════════════════════════════════\n");

  await pool.end();
}

main().catch(err => {
  console.error("❌  Fatal seed error:", err.message);
  process.exit(1);
});
