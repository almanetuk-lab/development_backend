import { pool } from "../config/db.js";
import { extractIntentTags, enrichContextualMetadata } from "../services/geminiService.js";
import { buildSemanticProfileText, generateEmbedding } from "../services/embeddingService.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import { sendNotification } from "../server.js";
import { sendEmail } from "../services/sendEmail.js";

//import { sendEmail } from "../emailService.js";

dotenv.config();

// New code register

export const registerUser = async (req, res) => {
  try {
    let {
      first_name, // ✅ Changed from full_name
      last_name, // ✅ New field
      email,
      password,
      profession,
      username,
      about_me,
    } = req.body;

    // Sanitize, type-check, and trim string inputs to avoid crash/bypass issues
    first_name = typeof first_name === "string" ? first_name.trim() : "";
    last_name = typeof last_name === "string" ? last_name.trim() : "";
    email = typeof email === "string" ? email.trim() : "";
    password = typeof password === "string" ? password : "";
    profession = typeof profession === "string" ? profession.trim() : "";
    username = typeof username === "string" ? username.trim().toLowerCase() : "";
    about_me = typeof about_me === "string" ? about_me.trim() : "";

    // 🔹 Basic validation - Ensure all required fields exist
    if (
      !first_name ||
      !last_name ||
      !email ||
      !password ||
      !profession ||
      !username ||
      !about_me
    ) {
      return res.status(400).json({
        error: "All fields are required. Please fill in first name, last name, email, password, profession, username, and about me.",
      });
    }

    // First Name validation
    if (first_name.length < 2 || first_name.length > 50) {
      return res.status(400).json({ error: "First name must be between 2 and 50 characters." });
    }
    const nameRegex = /^[a-zA-Z\s\-]+$/;
    if (!nameRegex.test(first_name)) {
      return res.status(400).json({ error: "First name can only contain letters, spaces, and hyphens." });
    }

    // Last Name validation
    if (last_name.length < 2 || last_name.length > 50) {
      return res.status(400).json({ error: "Last name must be between 2 and 50 characters." });
    }
    if (!nameRegex.test(last_name)) {
      return res.status(400).json({ error: "Last name can only contain letters, spaces, and hyphens." });
    }

    // Email validation
    if (email.length > 100) {
      return res.status(400).json({ error: "Email address cannot exceed 100 characters." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Profession validation
    if (profession.length < 2 || profession.length > 100) {
      return res.status(400).json({ error: "Profession must be between 2 and 100 characters." });
    }
    const professionRegex = /^[a-zA-Z0-9\s\-\.\,]+$/;
    if (!professionRegex.test(profession)) {
      return res.status(400).json({ error: "Profession can only contain letters, numbers, spaces, hyphens, periods, and commas." });
    }

    // Password validation (8-100 characters, complexity)
    if (password.length < 8 || password.length > 100) {
      return res.status(400).json({ error: "Password must be between 8 and 100 characters." });
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,100}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)." });
    }

    // About Me validation
    if (about_me.length < 10 || about_me.length > 1000) {
      return res.status(400).json({ error: "About Me section must be between 10 and 1000 characters to build your psychological profile." });
    }

    // // Reserved usernames (cannot be used)
    const reservedUsernames = [
      "admin",
      "support",
      "root",
      "system",
      "api",
      "help",
      "contact",
      "about",
    ];

    if (reservedUsernames.includes(username)) {
      return res.status(400).json({
        error: "This username is reserved. Please choose another.",
      });
    }

    // Instagram-style username regex
    const usernameRegex = /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{3,30}$/;

    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        error:
          "Username must be 3–30 characters, lowercase, and can contain letters, numbers, dots (.), or underscores (_). Dots cannot be consecutive or at the start/end.",
      });
    }

    // 🔹 Check if user already exists
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "User already exists." });
    }
    //

    // Check if username already taken
    const existingUsername = await pool.query(
      "SELECT 1 FROM profiles WHERE username = $1",
      [username]
    );
    if (existingUsername.rowCount > 0) {
      return res
        .status(400)
        .json({ error: "Username already taken. Please choose another." });
    }
    //

    // 🔹 Fetch approval configuration
    const configResult = await pool.query(
      "SELECT member_approval FROM configurations LIMIT 1"
    );
    const approval = configResult.rows[0]?.member_approval ?? 0;

    // 🔹 Decide user status based on configuration
    const userStatus = Number(approval) === 1 ? "Approve" : "In Process";

    // 🔹 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔹 Gemini Intent & Contextual Enrichment Pipeline
    let intent_tags = null;
    let confidence_score = null;
    let contextual_tags = null;
    let intent_embedding = null;
    let semanticText = null;

    if (about_me && about_me.trim().length > 0) {
      console.log("🤖 Registration Bio:", about_me);

      const profileData = {
        about_me,
        profession,
        first_name,
        last_name,
        username,
      };

      console.log("🤖 Generating intent tags and confidence score for registration...");
      try {
        const geminiResult = await extractIntentTags(profileData);
        intent_tags = geminiResult.intent_tags;
        confidence_score = geminiResult.confidence_score;
        console.log("🤖 Registration intent_tags:", intent_tags);
        console.log("🤖 Registration confidence_score:", confidence_score);
      } catch (geminiError) {
        console.error("❌ Gemini parsing failed on registration, using fallback defaults:", geminiError.message);
        intent_tags = {
          ambition_level: "Moderate",
          stress_cycle: "Balanced",
          social_preference: "Moderate",
          communication_style: "Friendly",
          relationship_intent: "Meaningful",
        };
        confidence_score = 0.50;
      }

      console.log("🤖 Generating contextual metadata for registration...");
      try {
        contextual_tags = await enrichContextualMetadata(profileData);
        console.log("🤖 Registration contextual_tags:", contextual_tags);
      } catch (contextError) {
        console.error("❌ Gemini contextual metadata failed on registration:", contextError.message);
        contextual_tags = {
          city_energy: "Moderate",
          cost_of_living: "Moderate",
          career_pressure: "Moderate",
          commute_stress: "Moderate",
          social_environment: "Balanced",
          emotional_environment: "Balanced",
          lifestyle_intensity: "Balanced"
        };
      }

      // --- Semantic Text & Embedding Generation ---
      console.log("🤖 Generating semantic profile text for registration...");
      const fullProfileForEmbedding = {
        ...profileData,
        contextual_tags_parsed: contextual_tags,
      };
      semanticText = buildSemanticProfileText(fullProfileForEmbedding, intent_tags);
      console.log("🤖 Semantic Profile Text:", semanticText);

      console.log("🤖 Generating intent embedding vector for registration...");
      try {
        intent_embedding = await generateEmbedding(semanticText);
      } catch (embedError) {
        console.error("❌ Generating embedding failed on registration:", embedError.message);
      }
    }

    // 🔹 Insert user
    const userQuery = `
      INSERT INTO users (email, password, status)
      VALUES ($1, $2, $3)
      RETURNING id, email, status, created_at;
    `;
    const userValues = [email, hashedPassword, userStatus];
    const result = await pool.query(userQuery, userValues);
    const user_id = result.rows[0].id;

    // 🔹 Insert profile - UPDATED
    const profileQuery = `
      INSERT INTO profiles (
        user_id, first_name, last_name, username, about_me,
        profession, is_submitted, intent_tags, intent_embedding, confidence_score, contextual_tags
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10, $11::jsonb)
      RETURNING id, user_id, first_name, last_name, username, about_me, profession, intent_tags, contextual_tags, confidence_score, created_at;
    `;
    const profileValues = [
      user_id,
      first_name,
      last_name,
      username,
      about_me,
      profession,
      true,
      intent_tags ? JSON.stringify(intent_tags) : null,
      intent_embedding ? JSON.stringify(intent_embedding) : null,
      confidence_score !== null && confidence_score !== undefined ? confidence_score : 0.50,
      contextual_tags ? JSON.stringify(contextual_tags) : null,
    ];
    console.log("=========================================");
    console.log("🤖 REGISTRATION PROFILE PIPELINE LOGS");
    console.log("USER ID:", user_id);
    console.log("ABOUT ME RECEIVED:", about_me);
    console.log("GENERATED INTENT TAGS:", intent_tags ? JSON.stringify(intent_tags) : "null");
    console.log("GENERATED CONTEXTUAL TAGS:", contextual_tags ? JSON.stringify(contextual_tags) : "null");
    console.log("GENERATED CONFIDENCE SCORE:", confidence_score);
    console.log("SEMANTIC TEXT:", semanticText);
    console.log("EMBEDDING DIMENSIONS COUNT:", intent_embedding ? intent_embedding.length : 0);
    console.log("=========================================");

    const profileResult = await pool.query(profileQuery, profileValues);
    console.log("==================================================");
    console.log("✅ Registration Profile SUCCESS. DB SAVE SUCCESS: true. intent_tags:", profileResult.rows[0].intent_tags, "contextual_tags:", profileResult.rows[0].contextual_tags, "confidence_score:", profileResult.rows[0].confidence_score);
    console.log("==================================================");


    const user = {
      email: result.rows[0].email,
      status: result.rows[0].status,
      profile_info: profileResult.rows[0], // ✅ Automatically includes first_name, last_name
    };

    // 🔹 Send user notification
    await sendNotification(
      user_id,
      "Registration Successful",
      Number(approval) === 1
        ? "You have been auto-approved. Welcome!"
        : "You have successfully registered. Please wait for admin approval."
    );

    // ✅ Send final response
    res.status(201).json({
      message: "User registered successfully!",
      user,
      // accessToken,
      // refreshToken,
    });
  } catch (error) {
    console.error("Error registering user:", error);

    if (error.code === "23505") {
      return res
        .status(400)
        .json({ error: "Username already taken. Please choose another." });
    }

    res.status(500).json({ error: "Internal server error." });
  }
};

// // for login User-----------------------------------------**

export async function loginUser(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const userQuery = `SELECT id, email, password, status FROM users WHERE email = $1`;
    const { rows } = await pool.query(userQuery, [email]);

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email" });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid Password" });
    }

    const profileQuery = `
      SELECT id, user_id, first_name, last_name, profession, username, about_me
      FROM profiles
      WHERE user_id = $1
    `;
    const result = await pool.query(profileQuery, [user.id]);
    const user_profile = result.rows[0];

    if (!user_profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    user_profile.email = user.email;

    const payload = {
      id: user.id,
      user_id: user_profile.user_id,
      email: user_profile.email,
      phone: user_profile.phone,
      first_name: user_profile.first_name, // full_name -> first_name
      last_name: user_profile.last_name, //  New field
      profession: user_profile.profession,
      username: user_profile.username,
      about_me: user_profile.about_me,
      status: user.status,
    };

    const access_secret_key = process.env.ACCESS_SECRET_KEY;
    const refresh_secret_key = process.env.REFRESH_SECRET_KEY;

    const accessToken = jwt.sign(payload, access_secret_key, {
      expiresIn: "30m",
    });
    const refreshToken = jwt.sign(payload, refresh_secret_key, {
      expiresIn: "7d",
    });

    return res.status(200).json({
      message: "Login successful",
      user_profile: {
        ...user_profile,
        // ✅ first_name and last_name automatically included
      },
      status: user.status,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error("❌ loginUser error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

// Forgot Password

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (!user.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });
    // const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
    const resetLink = `${process.env.FRONTEND_URL}/#/reset-password/${token}`;


    await sendEmail({
      to: email,
      subject: "Reset your Intentional Connection password",
      html: `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF2A6D 0%,#ff6b9d 100%);padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Intentional Connection</h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-weight:500;">Your mindful matchmaking platform</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a2e;">Reset your password</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                We received a request to reset the password for your account. Click the button below to create a new password. This link is valid for <strong>15 minutes</strong>.
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
                <tr>
                  <td style="background:linear-gradient(135deg,#FF2A6D,#ff6b9d);border-radius:10px;">
                    <a href="${resetLink}" target="_blank"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.2px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:13px;color:#888;line-height:1.6;">
                If the button doesn't work, copy and paste the link below into your browser:
              </p>
              <p style="margin:0 0 28px;word-break:break-all;">
                <a href="${resetLink}" style="color:#FF2A6D;font-size:13px;">${resetLink}</a>
              </p>

              <div style="background:#fff5f8;border:1px solid #ffd6e4;border-radius:10px;padding:16px 20px;">
                <p style="margin:0;font-size:13px;color:#cc3366;line-height:1.6;">
                  <strong>⚠ Didn't request this?</strong> If you didn't ask to reset your password, you can safely ignore this email. Your account remains secure.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9f9fb;border-top:1px solid #efefef;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#aaa;">© ${new Date().getFullYear()} Intentional Connection. All rights reserved.</p>
              <p style="margin:0;font-size:12px;color:#bbb;">This is an automated email — please do not reply directly.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `,
    });

    res.json({ message: "Password reset link sent to your email." });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Reset Password
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const email = decoded.email;

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [
      hashedPassword,
      email,
    ]);

    res.json({ message: "Password reset successful." });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(400).json({ error: "Invalid or expired token." });
  }
};

// Change Password (Authenticated)
export const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters long." });
    }

    // 1. Fetch user password hash
    const userResult = await pool.query(
      "SELECT password, email FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const user = userResult.rows[0];

    // 2. Validate current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Incorrect current password." });
    }

    // 3. Hash and save new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);

    // 4. Log security event for GDPR/security compliance
    try {
      const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";
      await pool.query(
        `INSERT INTO security_audit_logs (user_id, action_type, ip_address, user_agent, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          userId,
          "PASSWORD_CHANGE",
          ip,
          userAgent,
          JSON.stringify({ message: "Password updated successfully by user" }),
        ]
      );
    } catch (logErr) {
      console.error("Failed to log security audit event:", logErr);
    }

    res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── Contact Form ─────────────────────────────────────────────────────────────
export const sendContactMessage = async (req, res) => {
  try {
    let { name, email, subject, message } = req.body;

    // Sanitize string inputs
    name = typeof name === "string" ? name.trim() : "";
    email = typeof email === "string" ? email.trim() : "";
    subject = typeof subject === "string" ? subject.trim() : "";
    message = typeof message === "string" ? message.trim() : "";

    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "All fields are required. Please fill in name, email, subject, and message." });
    }

    // Name validation
    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({ error: "Name must be between 2 and 100 characters." });
    }
    const nameRegex = /^[a-zA-Z\s\-]+$/;
    if (!nameRegex.test(name)) {
      return res.status(400).json({ error: "Name can only contain letters, spaces, and hyphens." });
    }

    // Email validation
    if (email.length > 100) {
      return res.status(400).json({ error: "Email address cannot exceed 100 characters." });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Subject validation
    if (subject.length < 3 || subject.length > 200) {
      return res.status(400).json({ error: "Subject must be between 3 and 200 characters." });
    }

    // Message validation
    if (message.length < 10 || message.length > 5000) {
      return res.status(400).json({ error: "Message must be between 10 and 5000 characters." });
    }

    // Insert contact message into database
    await pool.query(
      `INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
      [name, email, subject, message]
    );

    const adminEmail = process.env.ADMIN_CONTACT_EMAIL || process.env.EMAIL_FROM;

    // 1. Notify admin with full message details
    await sendEmail({
      to: adminEmail,
      subject: `[Contact Form] ${subject}`,
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>New Contact Message</title></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#FF2A6D 0%,#ff6b9d 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:20px;font-weight:800;">New Contact Message</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Intentional Connection — Admin Notification</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                  <p style="margin:0;font-size:12px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">From</p>
                  <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#1a1a2e;">${name} &lt;${email}&gt;</p>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
                  <p style="margin:0;font-size:12px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Subject</p>
                  <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#1a1a2e;">${subject}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 0;">
                  <p style="margin:0;font-size:12px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Message</p>
                  <p style="margin:8px 0 0;font-size:15px;color:#444;line-height:1.7;white-space:pre-line;">${message}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9fb;border-top:1px solid #efefef;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">© ${new Date().getFullYear()} Intentional Connection</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
      `,
    });

    // 2. Send confirmation email to the user
    await sendEmail({
      to: email,
      subject: "We received your message — Intentional Connection",
      html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Message Received</title></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#FF2A6D 0%,#ff6b9d 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Intentional Connection</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-weight:500;">Your mindful matchmaking platform</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a2e;">Thanks for reaching out, ${name}!</h2>
            <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.7;">
              We've received your message and our team will get back to you within <strong>1–2 business days</strong>.
            </p>
            <div style="background:#f9f9fb;border:1px solid #efefef;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
              <p style="margin:0 0 6px;font-size:12px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;">Your message</p>
              <p style="margin:0;font-size:14px;color:#555;line-height:1.7;font-style:italic;">"${message.substring(0, 200)}${message.length > 200 ? '...' : ''}"</p>
            </div>
            <p style="margin:0;font-size:14px;color:#888;line-height:1.6;">
              In the meantime, feel free to browse our <a href="${process.env.FRONTEND_URL}" style="color:#FF2A6D;font-weight:600;">platform</a> or check out our latest articles.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9fb;border-top:1px solid #efefef;padding:24px 40px;text-align:center;">
            <p style="margin:0 0 6px;font-size:12px;color:#aaa;">© ${new Date().getFullYear()} Intentional Connection. All rights reserved.</p>
            <p style="margin:0;font-size:12px;color:#bbb;">This is an automated confirmation — our team will reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
      `,
    });

    res.json({ success: true, message: "Message sent successfully." });
  } catch (error) {
    console.error("Contact form error:", error);
    res.status(500).json({ error: "Failed to send message. Please try again." });
  }
};

// ─── Newsletter Subscription ──────────────────────────────────────────────────
export const subscribeNewsletter = async (req, res) => {
  try {
    let { email } = req.body;
    email = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    // Insert into database (DO NOTHING if email already subscribed)
    await pool.query(
      `INSERT INTO newsletter_subscriptions (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [email]
    );

    // Send confirmation email to subscriber
    try {
      await sendEmail({
        to: email,
        subject: "Subscribed to Intentional Connection Newsletter",
        html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Subscribed</title></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#FF2A6D 0%,#ff6b9d 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Intentional Connection</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;font-weight:500;">Your mindful matchmaking platform</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h2 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#1a1a2e;">You're Subscribed!</h2>
            <p style="margin:0 0 20px;font-size:15px;color:#555;line-height:1.7;">
              Thank you for subscribing to our newsletter! We'll keep you updated with compatibility matches, feature updates, relationship tips, and event launches.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9fb;border-top:1px solid #efefef;padding:24px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#aaa;">© ${new Date().getFullYear()} Intentional Connection. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
        `,
      });
    } catch (emailErr) {
      console.error("Newsletter subscription confirmation email failed to send:", emailErr);
    }

    res.json({ success: true, message: "Subscribed successfully!" });
  } catch (error) {
    console.error("Newsletter subscription error:", error);
    res.status(500).json({ error: "Failed to subscribe. Please try again." });
  }
};

