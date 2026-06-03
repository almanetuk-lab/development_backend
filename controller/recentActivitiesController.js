import { pool } from "../config/db.js";
// Recent Activities (Add New Viewer)

export const recentActivitiesAddNewViewer = async (req, res) => {
    try {
        
        const viewerId = req.user.id 
        const { viewedId } = req.params;

        // Insert or update if already exists
        const query = `
            INSERT INTO profile_views (viewer_id, viewed_id)
            VALUES ($1, $2)
            ON CONFLICT (viewer_id, viewed_id)
            DO UPDATE SET viewed_at = NOW()
            RETURNING *;`;

        const result = await pool.query(query, [viewerId, viewedId]);

        // Optional: log or return the new/updated record
        console.log("Profile view recorded:", result.rows[0]);
        res.json({ message: "Data inserted successfully user viewed profile", viewerId: viewerId, viewedId: viewedId });
        // res.redirect(`/api/users/${viewerId}`); //Redirect to the user's profile data
    } catch (err) {
        console.error("Error inserting profile view:", err.message,err);
        res.status(500).json({ message: err.message });
    }
}

export const recentViewers = async (req, res) => {
    let { userId } = req.params; // Current logged in user ID
    try {
        // Step 1: Fetch new viewers since last profile check
        const query = `
        SELECT 
        p.*,
        pv.viewed_at
        FROM profile_views pv
        JOIN profiles p ON pv.viewer_id = p.user_id
        WHERE pv.viewed_id = $1
        AND pv.viewer_id <> $1               -- exclude self-view
        AND pv.viewed_at > NOW() - INTERVAL '90 days'  
        ORDER BY pv.viewed_at DESC;` // It will take the viewers who see the profile of logged in user with in 24 hours viewers 

        const result = await pool.query(query, [userId]);

        res.json({
            newViewersCount: result.rows.length,
            newViewers: result.rows,
        });

    } catch (err) {
        console.error("Error fetching new profile viewers:", err);
        res.status(500).json({ message: "Server error" });
    }
}

//Recent activities (Unread messages):-
export const getUnreadMessagesCount = async (req, res) => {
    const userId = req.user.id; // logged-in user's ID

    try {
        const result = await pool.query(
            `SELECT COUNT(*) AS unread_count
            FROM messages
            WHERE receiver_id = $1
            AND is_read = false`,
            [userId]
        );

        const unreadCount = Number(result.rows[0].unread_count);

        res.status(200).json({ unreadCount });
    } catch (err) {
        console.error("Error fetching unread messages count:", err);
        res.status(500).json({ message: "Server error" });
    }
};
