import { pool } from "../config/db.js";

export const getCartItems = async (req, res) => {
  try {
    const user_id = req.user.id;

    const q = `
       SELECT 
        c.id, -- This is the unique ID for the cart entry itself
        c.user_id,
        c.plan_id,
        c.created_at,
        json_build_object(
          'id', p.id,
          'name', p.name,
          'price', p.price,
          'duration', p.duration,
          'video_call_limit', p.video_call_limit,
          'people_search_limit', p.people_search_limit,
          'people_message_limit', p.people_message_limit,
          'audio_call_limit', p.audio_call_limit,
          'type', p.type,
          'description', p.description,
          'billing_info', p.billing_info,
          'created_at', p.created_at,
          'updated_at', p.updated_at
        ) AS plan
      FROM cart c
      JOIN plans p ON c.plan_id = p.id
      WHERE c.user_id = $1
      ORDER BY c.id ASC;
    `;

    const { rows } = await pool.query(q, [user_id]);
    res.json(rows);
  } catch (err) {
    console.error("Error fetching cart items:", err);
    res.status(500).json({ error: "Database error" });
  }
};
// ---------------------- Add Item to Cart ----------------------
export const addToCart = async (req, res) => {
  try {
    const { plan_id } = req.body;
    const user_id = req.user.id; // ⚡ logged-in user ka ID (abhi ke liye static 1)

    if (!plan_id) {
      return res.status(400).json({ message: "Please specify which plan you want to add." });
    }

    // ✅ check if plan exists in cart
    const checkQuery = "SELECT id FROM cart WHERE plan_id = $1 AND user_id = $2";
    const checkResult = await pool.query(checkQuery, [plan_id, user_id]);

    if (checkResult.rows.length > 0) {
      return res.status(400).json({ message: "This plan is already in your cart!" });
    }

    const insertQuery = `
            INSERT INTO cart (plan_id, user_id, created_at)
            VALUES ($1, $2, NOW())
            RETURNING id;
        `;
    const result = await pool.query(insertQuery, [plan_id, user_id]);

    res.json({ 
              message: "Success! The plan has been added to your individual cart.",
              cart_id: result.rows[0].id 
        });
  } catch (err) {
    console.error("Error adding to cart:", err);
    res.status(500).json({ error: "Failed to add the item to your cart. Please try again." });
  }
};

// --------------------  Delete Item from Cart  -------------------
export const deleteCartItem = async (req, res) => {
  try {
    const { id } = req.params;
    const user_id = req.user.id; // ⚡ logged-in user ka ID (abhi ke liye static 1)

    // 🧠 First check if item belongs to the logged-in user
    const checkQuery = `SELECT id FROM cart WHERE id = $1 AND user_id = $2;`;
    const { rows } = await pool.query(checkQuery, [id, user_id]);

    if (rows.length === 0) {
      return res
        .status(403)
        .json({ message: "Authentication Error: You do not have permission to remove this item." });
    }

        // ✅ PERFORM DELETION
        // We use both ID and user_id to be extra sure the correct record is removed.
        const deleteQuery = `DELETE FROM cart WHERE id = $1 AND user_id = $2;`;
        await pool.query(deleteQuery, [id, user_id]);

        res.json({ message: "Item successfully removed from your individual cart." });
    } catch (err) {
        console.error("❌ Error deleting cart item:", err);
        res.status(500).json({ error: "We encountered a problem while trying to remove the item." });
    }
};