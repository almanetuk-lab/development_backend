import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { setAuthCookies } from "../utils/cookieHelper.js";

dotenv.config();

// Authorization-code flow (popup): the frontend uses @react-oauth/google's
// useGoogleLogin({ flow: "auth-code" }) which yields a one-time `code`
// exchanged here for tokens using redirect_uri "postmessage" (the fixed
// value Google requires for JS popup-based code exchanges).
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "postmessage"
);

// Handles both "Sign in with Google" and "Sign up with Google" -
// the same endpoint finds an existing user or creates one on the fly.
export const googleAuth = async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Google authorization code is required" });
    }

    let tokens;
    try {
      ({ tokens } = await googleClient.getToken(code));
    } catch (exchangeError) {
      console.error("❌ Google code exchange failed:", exchangeError.message);
      return res.status(401).json({ error: "Invalid or expired Google authorization code" });
    }

    if (!tokens?.id_token) {
      return res.status(401).json({ error: "Google did not return an identity token" });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyError) {
      console.error("❌ Google token verification failed:", verifyError.message);
      return res.status(401).json({ error: "Invalid Google credential" });
    }

    const { email, given_name, family_name, name, email_verified } = payload;

    if (!email) {
      return res.status(400).json({ error: "Google account has no email" });
    }

    if (email_verified === false) {
      return res.status(401).json({ error: "Google email is not verified" });
    }

    const firstName = given_name || (name ? name.split(" ")[0] : "Google");
    const lastName =
      family_name || (name ? name.split(" ").slice(1).join(" ") : "User");

    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    let user;

    if (existingUser.rows.length === 0) {
      // 🔹 New user via Google - mirror registerUser's approval logic
      const configResult = await pool.query(
        "SELECT member_approval FROM configurations LIMIT 1"
      );
      const approval = configResult.rows[0]?.member_approval ?? 0;
      const userStatus = Number(approval) === 1 ? "Approve" : "In Process";

      const placeholderPassword = await bcrypt.hash(
        Math.random().toString(36).slice(2),
        10
      );

      const insertUserResult = await pool.query(
        `INSERT INTO users (email, password, status, auth_provider, is_email_verified)
         VALUES ($1, $2, $3, 'google', TRUE)
         RETURNING id, email, status`,
        [email, placeholderPassword, userStatus]
      );
      user = insertUserResult.rows[0];

      let baseUsername = email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, "");
      if (baseUsername.length < 3) baseUsername = `user${baseUsername}`;
      baseUsername = `${baseUsername}${Math.floor(Math.random() * 10000)}`;

      await pool.query(
        `INSERT INTO profiles (
          user_id, first_name, last_name, username, about_me, profession, is_submitted
        ) VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
        [user.id, firstName, lastName, baseUsername, "", "Other"]
      );
    } else {
      user = existingUser.rows[0];

      await pool.query(
        `UPDATE users SET auth_provider = 'google', is_email_verified = TRUE WHERE id = $1`,
        [user.id]
      );

      const profileCheck = await pool.query(
        "SELECT id FROM profiles WHERE user_id = $1",
        [user.id]
      );
      if (profileCheck.rows.length === 0) {
        let baseUsername = email
          .split("@")[0]
          .toLowerCase()
          .replace(/[^a-z0-9._]/g, "");
        if (baseUsername.length < 3) baseUsername = `user${baseUsername}`;
        baseUsername = `${baseUsername}${Math.floor(Math.random() * 10000)}`;

        await pool.query(
          `INSERT INTO profiles (user_id, first_name, last_name, username, is_submitted)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [user.id, firstName, lastName, baseUsername]
        );
      }
    }

    const profileResult = await pool.query(
      `SELECT id, user_id, first_name, last_name, profession, username, about_me
       FROM profiles WHERE user_id = $1`,
      [user.id]
    );
    const user_profile = profileResult.rows[0];
    user_profile.email = user.email;

    // Slim JWT payload — only immutable identifiers
    const jwtPayload = {
      id: user.id,
      email: user.email,
      status: user.status,
    };

    const accessToken = jwt.sign(jwtPayload, process.env.ACCESS_SECRET_KEY, {
      expiresIn: "30m",
    });
    const refreshToken = jwt.sign(jwtPayload, process.env.REFRESH_SECRET_KEY, {
      expiresIn: "7d",
    });

    // Set httpOnly cookies instead of returning tokens in response body
    setAuthCookies(res, accessToken, refreshToken);

    return res.status(200).json({
      message: "Google authentication successful",
      user_profile,
      status: user.status,
    });
  } catch (error) {
    console.error("❌ googleAuth error:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};
