import { pool } from "./config/db.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const accessSecretKey = process.env.ACCESS_SECRET_KEY || "dh53kx3w";

// Initiator: User 33 (celina@gmail.com) — has a profile but NO digital twin
// Target: User 21 (imrankhan.ca2020@gmail.com) — has a profile AND a digital twin
const initiatorId = 33;
const targetId = 21;
const initiatorEmail = "celina@gmail.com";

// Generate JWT token for the initiator
const token = jwt.sign({ id: initiatorId, email: initiatorEmail }, accessSecretKey, { expiresIn: "30m" });
const headers = {
  "Authorization": `Bearer ${token}`,
  "Content-Type": "application/json"
};

async function runTests() {
  try {
    console.log("\n=======================================================");
    console.log("PRE-TEST: Verify initiator (User 33) has NO twin");
    console.log("=======================================================");
    const check = await pool.query("SELECT user_id FROM digital_twins WHERE user_id = $1", [initiatorId]);
    console.log(check.rows.length === 0 ? `✅ Confirmed: user ${initiatorId} has NO pre-existing twin` : `⚠️  User ${initiatorId} already has a twin`);

    console.log("\n====================================");
    console.log("TEST 1: Self-Handshake Guard");
    console.log("====================================");
    let res = await fetch(`http://localhost:3435/api/handshake/${initiatorId}`, { method: "POST", headers });
    console.log("Status:", res.status, "(expected 400)");
    console.log("Body:", JSON.stringify(await res.json(), null, 2));

    console.log("\n====================================");
    console.log("TEST 2: Handshake with Auto-Twin Generation");
    console.log("(Initiator has no pre-existing twin — should auto-generate)");
    console.log("====================================");
    res = await fetch(`http://localhost:3435/api/handshake/${targetId}`, { method: "POST", headers });
    console.log("Status:", res.status, "(expected 201)");
    const body2 = await res.json();
    console.log("Full response body:", JSON.stringify(body2, null, 2));

    console.log("\n====================================");
    console.log("POST-TEST: Verify twin WAS auto-generated");
    console.log("====================================");
    const checkAfter = await pool.query("SELECT user_id, current_state_summary FROM digital_twins WHERE user_id = $1", [initiatorId]);
    if (checkAfter.rows.length > 0) {
      console.log(`✅ Twin auto-generated for user ${initiatorId}:`, checkAfter.rows[0].current_state_summary);
    } else {
      console.log(`❌ Twin was NOT generated for user ${initiatorId}`);
    }

    console.log("\n====================================");
    console.log("TEST 3: Handshake History");
    console.log("====================================");
    res = await fetch(`http://localhost:3435/api/handshake/history`, { method: "GET", headers });
    console.log("Status:", res.status, "(expected 200)");
    const hist = await res.json();
    console.log("Session count:", hist?.data?.length);
    if (hist?.data?.length > 0) {
      console.log("Latest session stressSynchronization:", JSON.stringify(hist.data[0].stressSynchronization, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

runTests();
