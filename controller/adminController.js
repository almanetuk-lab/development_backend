import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { pool } from "../config/db.js";
import { sendNotification } from "../server.js";
dotenv.config();

// ---------------- Admin Login ----------------
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM admins WHERE email=$1", [email]);
    const admin = result.rows[0];

    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      process.env.ACCESS_SECRET_KEY,
      { expiresIn: "2h" }
    );

    return res.status(200).json({
      status: "success",
      message: "Admin logged in successfully",
      token,
      admin: {
        id: admin.id,
        full_name: admin.full_name,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
};

//  Approve User
export const approveUser = async (req, res) => {
  const approvedUser = req.body;

  const updateQuery = `UPDATE users SET status='Approve', approved_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *`;
  const values = [approvedUser.approved_by, approvedUser.id];
  try {
    const result = await pool.query(updateQuery, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const { reason, ...userWithoutReason } = result.rows[0];

    // ✅ Send notification
    await sendNotification(
      approvedUser.id,
      "Account Approved",
      "Your account has been approved by the admin."
    );

    return res.status(200).json({
      status: "success",
      message: "User approved successfully",
      user: userWithoutReason,
    });
  } catch (error) {
    console.error("Error approving user:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

//  Put User On Hold
export const onHoldUser = async (req, res) => {
  try {
    const { user_id, reason } = req.body;
    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const updateQuery = `
      UPDATE users
      SET status = 'On Hold',
          reason = $1,
          updated_at = NOW()
      WHERE id = $2::integer
      RETURNING id, status, reason, updated_at
    `;
    const values = [reason || null, user_id];
    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Send notification
    await sendNotification(
      user_id,
      "Account On Hold",
      `Your account has been put on hold. Reason: ${reason || "Not specified"}`
    );

    return res.status(200).json({
      message: "User placed on hold",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Error placing user on hold:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

//  Deactivate User
export const deactivateUser = async (req, res) => {
  try {
    const { user_id, reason } = req.body;
    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const updateQuery = `
      UPDATE users
      SET status = 'Deactivate',
          reason = $1
      WHERE id = $2::integer
      RETURNING id, status, reason
    `;
    const values = [reason || null, user_id];
    const result = await pool.query(updateQuery, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Send notification
    await sendNotification(
      user_id,
      "Account Deactivated",
      `Your account has been deactivated. Reason: ${reason || "Not specified"}`
    );

    return res.status(200).json({
      status: "success",
      message: "User deactivate successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Error deactivating user:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
// ---------------- Admin Configurations ----------------
export const getAllUsers = async (req, res) => {
  try {
    // 🔹 Fetch users and their profiles (NO configuration logic here)
    const query = `
      SELECT 
        u.id,
        u.email,
        u.password,
        u.status,
        u.created_at,
        u.updated_at,
        p.first_name,
        p.last_name,
        p.profession
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      ORDER BY u.created_at DESC;
    `;

    const { rows: usersList } = await pool.query(query);

    // 🔹 Prepare response (direct DB status)
    const users = usersList.map((user) => ({
      id: user.id,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      email: user.email,
      password: user.password, // (admin view only)
      profession: user.profession || null,
      status: user.status, // ✅ DIRECT FROM DB
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    }));

    // ✅ Send response
    return res.status(200).json({
      status: "success",
      message: "Users fetched successfully",
      users,
    });

  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch users",
      error: error.message,
    });
  }
};

// 🔹 Update member approval setting
export const getAllUserDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        status: "error",
        message: "User ID is required",
      });
    }

    const query = `
      SELECT 
        u.id AS user_id,
        u.email,
        u.status AS current_status,
        u.created_at AS registration_date,

        -- Profile fields
        p.id AS profile_id,
        p.first_name,
        p.last_name,
        p.phone,
        p.gender,
        p.marital_status,
        p.address,
        p.profession,
        p.skills,
        p.interests,
        p.hobbies,
        p.about,
        p.city,
        p.state,
        p.country,
        p.pincode,
        p.headline,
        p.dob,
        p.age,
        p.education,
        p.company,
        p.company_type,
        p.experience,
        p.position,
        p.professional_identity,
        p.interested_in,
        p.relationship_goal,
        p.children_preference,
        p.education_institution_name,
        p.languages_spoken,
        p.zodiac_sign,
        p.self_expression,
        p.freetime_style,
        p.health_activity_level,
        p.pets_preference,
        p.religious_belief,
        p.smoking,
        p.drinking,
        p.work_environment,
        p.interaction_style,
        p.work_rhythm,
        p.career_decision_style,
        p.work_demand_response,
        p.love_language_affection,
        p.preference_of_closeness,
        p.approach_to_physical_closeness,
        p.relationship_values,
        p.values_in_others,
        p.relationship_pace,
        p.height,
        p.life_rhythms,
        p.ways_i_spend_time,
        p.about_me,
        p.username,
        p.image_url,
        p.is_submitted,
        p.updated_at,

        -- Prompts (JSON)
        COALESCE(
          jsonb_object_agg(pp.question_key, pp.answer)
          FILTER (WHERE pp.question_key IS NOT NULL),
          '{}'
        ) AS prompts

      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      LEFT JOIN profile_prompts pp ON p.id = pp.profile_id
      WHERE u.id = $1
      GROUP BY u.id, p.id
      ORDER BY u.created_at DESC;
    `;

    const { rows } = await pool.query(query, [id]);

    if (!rows.length) {
      return res.status(404).json({
        status: "error",
        message: "User not found",
      });
    }

    return res.status(200).json({
      status: "success",
      message: "User full details fetched successfully",
      user: rows[0],
    });

  } catch (error) {
    console.error("Admin get user details error:", error);
    return res.status(500).json({
      status: "error",
      message: "Failed to fetch user details",
      error: error.message,
    });
  }
};







// // export const saveAdmin = async (req,res) => {

// // let data = req.body;

// // data.password = await bcrypt.hash(data.password, 10);

// // const values =Object.values(data) ;

// // await pool.query('INSERT INTO admins (full_name, email, password, role) VALUES ($1, $2, $3, $4)',values);
// // }





