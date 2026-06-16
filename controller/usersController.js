import { pool } from '../config/db.js';
import { generateAndCacheCompatibility } from './matchController.js';

//Get specific Users and Profile table:
export const userProfile = async (req, res) => {
    let { userId } = req.params;
    let q = `SELECT u.*, p.*
        FROM users AS u
        INNER JOIN profiles AS p
        ON u.id = p.user_id
        WHERE u.id = $1;
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