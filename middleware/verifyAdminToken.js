// middleware/verifyAdminToken.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();
// Middleware to verify admin token
export const verifyAdminToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res.status(401).json({ message: "Authorization header missing" });

    const token = authHeader.split(" ")[1];
    if (!token)
      return res.status(401).json({ message: "Token not found" });

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
