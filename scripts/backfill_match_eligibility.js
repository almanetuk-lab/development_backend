// backfill_match_eligibility.js — sets profiles.is_match_eligible for every profile
// using the rules in utils/profileCompleteness.js.
//
// Run once right after deploying the completeness gate (until it runs, every
// profile is hidden from discovery because the column defaults to false):
//
//   node scripts/backfill_match_eligibility.js --dry-run   # counts only, writes nothing
//   node scripts/backfill_match_eligibility.js             # applies
//
// Safe to re-run: it only writes rows whose flag actually changes.
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import pkg from "pg";
import { evaluateProfileCompleteness } from "../utils/profileCompleteness.js";
const { Pool } = pkg;

const dryRun = process.argv.includes("--dry-run");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  // Same DDL as config/db.js, so the script works even before the first boot.
  if (!dryRun) {
    await pool.query(
      `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_match_eligible BOOLEAN NOT NULL DEFAULT false`
    );
  }
  const hasColumn = (
    await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'is_match_eligible'`
    )
  ).rowCount > 0;

  const { rows: profiles } = await pool.query(`SELECT * FROM profiles`);
  const { rows: promptRows } = await pool.query(
    `SELECT profile_id, question_key, answer FROM profile_prompts`
  );

  const promptsByProfile = new Map();
  for (const r of promptRows) {
    if (!promptsByProfile.has(r.profile_id)) promptsByProfile.set(r.profile_id, {});
    promptsByProfile.get(r.profile_id)[r.question_key] = r.answer;
  }

  let ready = 0;
  let notReady = 0;
  const toTrue = [];
  const toFalse = [];
  const missingTally = {};

  for (const p of profiles) {
    const c = evaluateProfileCompleteness(p, promptsByProfile.get(p.id) || {});
    if (c.isReady) ready++;
    else {
      notReady++;
      for (const m of c.mustHaves.missing) missingTally[m.key] = (missingTally[m.key] || 0) + 1;
      if (c.mustHaves.missing.length === 0) missingTally["(only extras short)"] = (missingTally["(only extras short)"] || 0) + 1;
    }
    const current = hasColumn ? p.is_match_eligible === true : false;
    if (c.isReady !== current || !hasColumn) (c.isReady ? toTrue : toFalse).push(p.user_id);
  }

  console.log(`Profiles: ${profiles.length}  |  ready: ${ready}  |  not ready: ${notReady}`);
  console.log("Not-ready profiles, by missing must-have:");
  for (const [k, n] of Object.entries(missingTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(22)} ${n}`);
  }
  console.log(`Changes: ${toTrue.length} → ready, ${toFalse.length} → not ready`);

  if (dryRun) {
    console.log("🔎 Dry run — nothing written.");
  } else {
    if (toTrue.length) {
      await pool.query(`UPDATE profiles SET is_match_eligible = true WHERE user_id = ANY($1::int[])`, [toTrue]);
    }
    if (toFalse.length) {
      await pool.query(`UPDATE profiles SET is_match_eligible = false WHERE user_id = ANY($1::int[])`, [toFalse]);
    }
    console.log("✅ Backfill applied.");
  }
} catch (err) {
  console.error("❌ Backfill failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
