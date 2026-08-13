 import { pool } from "../config/db.js";

/* ---------- Helpers ---------- */

function toArray(field) {
    let arr = [];
    if (!field) return arr;
    if (Array.isArray(field)) arr = field;
    else if (typeof field === "object" && field !== null) arr = Object.values(field);
    else {
        try {
            const parsed = JSON.parse(field);
            arr = Array.isArray(parsed) ? parsed : [];
        } catch {
            arr = [];
        }
    }
    // Normalise each string element: trim edges + collapse internal multiple spaces
    return arr.map(item =>
        typeof item === "string" ? item.trim().replace(/\s+/g, " ") : item
    ).filter(item => item !== "" && item !== null && item !== undefined);
}

function intersect(arr1, arr2) {
    if (!Array.isArray(arr1) || !Array.isArray(arr2)) return [];
    const cleanArr2 = arr2
        .filter(x => typeof x === "string" || typeof x === "number")
        .map(x => String(x).trim().toLowerCase());
    return arr1
        .filter(x => typeof x === "string" || typeof x === "number")
        .filter((x) => cleanArr2.includes(String(x).trim().toLowerCase()));
}

function isStringMatch(val1, val2) {
    if (val1 === undefined || val1 === null || val2 === undefined || val2 === null) return false;
    const s1 = String(val1).trim().toLowerCase();
    const s2 = String(val2).trim().toLowerCase();
    return s1 !== "" && s2 !== "" && s1 === s2;
}

/* ---------- Controller ---------- */

export const getUserMatches = async (req, res) => {
    const userId = req.params.userId;
    const TOP_N = 20; // Limit to top 20 matches

    // Verify that the requested userId matches the authenticated user's ID
    const authUserId = req.user?.user_id || req.user?.id;
    if (!authUserId || String(authUserId) !== String(userId)) {
        return res.status(403).json({ message: "Forbidden: You can only request matches for your own account." });
    }

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

        // 4️⃣ Filter by gender preference if set (case-insensitive, whitespace-safe)
        if (userPreferenceGender.length) {
            const normalizedPrefGenders = userPreferenceGender
                .map(g => String(g).trim().toLowerCase());
            allUsers = allUsers.filter(u =>
                u.gender && normalizedPrefGenders.includes(String(u.gender).trim().toLowerCase())
            );
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
            if (isStringMatch(user.country, u.country)) score += 2;
            if (isStringMatch(user.state, u.state)) score += 2;
            if (isStringMatch(user.city, u.city)) score += 2;

            // Profession / Education
            if (isStringMatch(user.profession, u.profession)) score += 3;
            if (isStringMatch(user.education, u.education)) score += 2;
            if (isStringMatch(user.company, u.company)) score += 1;
            if (intersect(userSkills, uSkills).length > 0) score += 2;

            // Interests / Hobbies / Languages
            if (intersect(userInterests, uInterests).length > 0) score += 3;
            if (intersect(userHobbies, uHobbies).length > 0) score += 2;
            if (intersect(userLanguages, uLanguages).length > 0) score += 1;
            if (intersect(userLoveLanguages, uLoveLanguages).length > 0) score += 1;

            // Relationship & Lifestyle
            if (isStringMatch(user.relationship_goal, u.relationship_goal)) score += 2;
            if (isStringMatch(user.relationship_values, u.relationship_values)) score += 2;
            if (isStringMatch(user.preference_of_closeness, u.preference_of_closeness)) score += 1;
            if (isStringMatch(user.approach_to_physical_closeness, u.approach_to_physical_closeness)) score += 1;
            if (isStringMatch(user.religious_belief, u.religious_belief)) score += 1;
            if (isStringMatch(user.pets_preference, u.pets_preference)) score += 1;
            if (isStringMatch(user.smoking, u.smoking)) score += 1;
            if (isStringMatch(user.drinking, u.drinking)) score += 1;

            // Personal Details
            if (isStringMatch(user.marital_status, u.marital_status)) score += 2;
            if (isStringMatch(user.gender, u.gender)) score += 2;
            if (isStringMatch(user.children_preference, u.children_preference)) score += 2;
            if (user.age && u.age) {
                const ageDiff = Math.abs(Number(user.age) - Number(u.age));
                if (!isNaN(ageDiff) && ageDiff <= 5) score += 2;
            }

            // Lifestyle / Personality
            if (isStringMatch(user.self_expression, u.self_expression)) score += 2;
            if (isStringMatch(user.freetime_style, u.freetime_style)) score += 2;
            if (isStringMatch(user.work_environment, u.work_environment)) score += 1;
            if (isStringMatch(user.interaction_style, u.interaction_style)) score += 1;
            if (isStringMatch(user.career_decision_style, u.career_decision_style)) score += 1;
            if (isStringMatch(user.work_demand_response, u.work_demand_response)) score += 1;
            if (isStringMatch(user.values_in_others, u.values_in_others)) score += 1;
            if (isStringMatch(user.relationship_pace, u.relationship_pace)) score += 1;
            if (user.height && u.height) {
                const heightDiff = Math.abs(Number(user.height) - Number(u.height));
                if (!isNaN(heightDiff) && heightDiff <= 5) score += 1;
            }
            if (isStringMatch(user.life_rhythms, u.life_rhythms)) score += 1;
            if (isStringMatch(user.ways_i_spend_time, u.ways_i_spend_time)) score += 1;
            if (isStringMatch(user.work_rhythm, u.work_rhythm)) score += 1;
            if (isStringMatch(user.about_me, u.about_me)) score += 1;

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