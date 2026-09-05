// middleware/verifyAdminToken.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
// Middleware to verify admin token — reads from httpOnly cookie
export const verifyAdminToken = (req, res, next) => {
  try {
    // Read admin token from httpOnly cookie instead of Authorization header
    const token = req.cookies?.adminAccessToken;
    if (!token)
      return res.status(401).json({ message: "Admin access token not found" });

    // verify using admin secret key
    const decoded = jwt.verify(token, process.env.ACCESS_SECRET_KEY);

    // check role
    if (decoded.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admins only." });
    }

    // attach admin info to request
    req.admin = decoded;
    next();
  } catch (err) {
    console.error("Admin token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
