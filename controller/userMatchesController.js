 import { pool } from "../config/db.js";

/* ---------- Helpers ---------- */

function toArray(field) {
    if (!field) return [];
    if (Array.isArray(field)) return field;
    if (typeof field === "object" && field !== null) return Object.values(field);
    try {
        const parsed = JSON.parse(field);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function intersect(arr1, arr2) {
    if (!Array.isArray(arr1) || !Array.isArray(arr2)) return [];
    return arr1.filter((x) => arr2.includes(x));
}

/* ---------- Controller ---------- */

export const getUserMatches = async (req, res) => {
    const userId = req.params.userId;
    const TOP_N = 20; // Limit to top 20 matches

    try {
        // 1️⃣ Fetch logged-in user profile
        const userResult = await pool.query(
            `SELECT * FROM profiles WHERE user_id = $1`,
            [userId]
        );
        const user = userResult.rows[0];
        if (!user) return res.status(404).json({ message: "User not found" });

        // 2️⃣ Parse array/JSON fields
        const userInterests = toArray(user.interests);
        const userHobbies = toArray(user.hobbies);
        const userSkills = toArray(user.skills);
        const userLanguages = toArray(user.languages_spoken);
        const userLoveLanguages = toArray(user.love_language_affection);
        const userPreferenceGender = toArray(user.preference_gender);

        // 3️⃣ Fetch all other active profiles
        const allUsersResult = await pool.query(
            `SELECT * FROM profiles
             WHERE user_id != $1 AND is_active = true`,
            [userId]
        );

        let allUsers = allUsersResult.rows;

        // 4️⃣ Filter by gender preference if set
        if (userPreferenceGender.length) {
            allUsers = allUsers.filter(u => userPreferenceGender.includes(u.gender));
        }

        // 5️⃣ Calculate match scores
        const matches = allUsers.map((u) => {
            const uInterests = toArray(u.interests);
            const uHobbies = toArray(u.hobbies);
            const uSkills = toArray(u.skills);
            const uLanguages = toArray(u.languages_spoken);
            const uLoveLanguages = toArray(u.love_language_affection);

            let score = 0;

            // Location
            if (user.country?.trim().toLowerCase() === u.country?.trim().toLowerCase()) score += 2;
            if (user.state?.trim().toLowerCase() === u.state?.trim().toLowerCase()) score += 2;
            if (user.city?.trim().toLowerCase() === u.city?.trim().toLowerCase()) score += 2;

            // Profession / Education
            if (user.profession && user.profession === u.profession) score += 3;
            if (user.education && user.education === u.education) score += 2;
            if (user.company && user.company === u.company) score += 1;
            if (intersect(userSkills, uSkills).length > 0) score += 2;

            // Interests / Hobbies / Languages
            if (intersect(userInterests, uInterests).length > 0) score += 3;
            if (intersect(userHobbies, uHobbies).length > 0) score += 2;
            if (intersect(userLanguages, uLanguages).length > 0) score += 1;
            if (intersect(userLoveLanguages, uLoveLanguages).length > 0) score += 1;

            // Relationship & Lifestyle
            if (user.relationship_goal && user.relationship_goal === u.relationship_goal) score += 2;
            if (user.relationship_values && user.relationship_values === u.relationship_values) score += 2;
            if (user.preference_of_closeness && user.preference_of_closeness === u.preference_of_closeness) score += 1;
            if (user.approach_to_physical_closeness && user.approach_to_physical_closeness === u.approach_to_physical_closeness) score += 1;
            if (user.religious_belief && user.religious_belief === u.religious_belief) score += 1;
            if (user.pets_preference && user.pets_preference === u.pets_preference) score += 1;
            if (user.smoking && user.smoking === u.smoking) score += 1;
            if (user.drinking && user.drinking === u.drinking) score += 1;

            // Personal Details
            if (user.marital_status && user.marital_status === u.marital_status) score += 2;
            if (user.gender && user.gender === u.gender) score += 2;
            if (user.children_preference && user.children_preference === u.children_preference) score += 2;
            if (user.age && u.age) {
                const ageDiff = Math.abs(user.age - u.age);
                if (ageDiff <= 5) score += 2;
            }

            // Lifestyle / Personality
            if (user.self_expression && user.self_expression === u.self_expression) score += 2;
            if (user.freetime_style && user.freetime_style === u.freetime_style) score += 2;
            if (user.work_environment && user.work_environment === u.work_environment) score += 1;
            if (user.interaction_style && user.interaction_style === u.interaction_style) score += 1;
            if (user.career_decision_style && user.career_decision_style === u.career_decision_style) score += 1;
            if (user.work_demand_response && user.work_demand_response === u.work_demand_response) score += 1;
            if (user.values_in_others && user.values_in_others === u.values_in_others) score += 1;
            if (user.relationship_pace && user.relationship_pace === u.relationship_pace) score += 1;
            if (user.height && u.height && Math.abs(user.height - u.height) <= 5) score += 1;
            if (user.life_rhythms && user.life_rhythms === u.life_rhythms) score += 1;
            if (user.ways_i_spend_time && user.ways_i_spend_time === u.ways_i_spend_time) score += 1;
            if (user.work_rhythm && user.work_rhythm === u.work_rhythm) score += 1;
            if (user.about_me && user.about_me === u.about_me) score += 1;

            // Penalize missing profile image
            if (!u.image_url) score -= 1;

            return {
                user_id: u.user_id,
                username: u.username,
                first_name: u.first_name,
                last_name: u.last_name,
                full_name: u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.username,
                gender: u.gender,
                age: u.age,
                marital_status: u.marital_status,
                children_preference: u.children_preference,
                city: u.city,
                state: u.state,
                country: u.country,
                profession: u.profession,
                company: u.company,
                education: u.education,
                interests: toArray(u.interests),
                hobbies: toArray(u.hobbies),
                skills: toArray(u.skills),
                languages_spoken: toArray(u.languages_spoken),
                love_language_affection: toArray(u.love_language_affection),
                relationship_goal: u.relationship_goal,
                relationship_values: u.relationship_values,
                preference_of_closeness: u.preference_of_closeness,
                approach_to_physical_closeness: u.approach_to_physical_closeness,
                pets_preference: u.pets_preference,
                religious_belief: u.religious_belief,
                smoking: u.smoking,
                drinking: u.drinking,
                self_expression: u.self_expression,
                freetime_style: u.freetime_style,
                work_environment: u.work_environment,
                interaction_style: u.interaction_style,
                career_decision_style: u.career_decision_style,
                work_demand_response: u.work_demand_response,
                values_in_others: u.values_in_others,
                relationship_pace: u.relationship_pace,
                height: u.height,
                life_rhythms: u.life_rhythms,
                ways_i_spend_time: u.ways_i_spend_time,
                work_rhythm: u.work_rhythm,
                about_me: u.about_me,
                zodiac_sign: u.zodiac_sign,
                image_url: u.image_url,
                match_score: score,
            };

        });

        // Filter relevant matches and sort
        const topMatches = matches
            .filter(m => m.match_score >= 5)
            .sort((a, b) => b.match_score - a.match_score)
            .slice(0, TOP_N); // Take only top N

        return res.status(200).json(topMatches);

    } catch (err) {
        console.error("Error in getUserMatches:", err);
        return res.status(500).json({ message: "Server error" });
    }
};