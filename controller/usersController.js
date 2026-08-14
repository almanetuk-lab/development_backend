import { pool } from '../config/db.js';
import { generateAndCacheCompatibility } from './matchController.js';

//Get specific Users and Profile table:
export const userProfile = async (req, res) => {
    let { userId } = req.params;
    let q = `
      SELECT
        u.id         AS user_id,
        u.email,
        u.status,
        u.created_at AS registered_at,

        p.id         AS profile_id,
        p.first_name,
        p.last_name,
        p.username,
        p.gender,
        p.dob,
        p.age,
        p.marital_status,
        p.height,
        p.zodiac_sign,
        p.languages_spoken,
        p.phone,
        p.country,
        p.state,
        p.city,
        p.pincode,
        p.address,
        p.headline,
        p.profession,
        p.professional_identity,
        p.company,
        p.position,
        p.company_type,
        p.experience,
        p.education,
        p.education_institution_name,
        p.about_me,
        p.hobbies,
        p.skills,
        p.interests,
        p.image_url,
        p.is_submitted,
        p.is_active,
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
        p.interested_in,
        p.relationship_goal,
        p.children_preference,
        p.life_rhythms,
        p.ways_i_spend_time,
        p.latitude,
        p.longitude,
        p.updated_at
      FROM users AS u
      LEFT JOIN profiles AS p ON u.id = p.user_id
      WHERE u.id = $1
    `;

    let result = await pool.query(q, [userId]);
    let user = result.rows[0];
    if (!user) {
        return res.json({ message: "User does not exist" });
    }

    // Auto-generate compatibility in background when profile is viewed
    const currentUserId = req.user?.id;
    if (currentUserId && Number(currentUserId) !== Number(userId)) {
        console.log(`🧬 Profile View Trigger: Generating compatibility in background for viewer ${currentUserId} and target ${userId}...`);
        generateAndCacheCompatibility(currentUserId, userId).catch(err => {
            console.error("❌ Background auto-generation error on profile view:", err.message);
        });
    }

    res.json(user);
};