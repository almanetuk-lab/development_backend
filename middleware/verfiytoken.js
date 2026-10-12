import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { getActiveBan, suspendedResponse } from "../services/accountBanService.js";

dotenv.config();
export const validateAccessToken = async (req, res, next) => {
  try {
    // Read token from httpOnly cookie instead of Authorization header
    const accessToken = req.cookies?.accessToken;
    if (!accessToken) {
      return res.status(401).json({ message: "Access token not found" });
    }

    const access_secret_key = process.env.ACCESS_SECRET_KEY;
    
    const verifyAccessToken = jwt.verify(accessToken, access_secret_key);

    // Banned users are cut off on their next request, not when the token expires.
    // Fails open on a DB error so a lookup problem doesn't take the whole API down.
    try {
      const ban = await getActiveBan(verifyAccessToken.id);
      if (ban) return suspendedResponse(res, ban);
    } catch (banErr) {
      console.error("❌ Ban check failed:", banErr.message);
    }

    req.user = verifyAccessToken;
    next();
  } catch (err) {
    console.error("❌ Token validation failed:", err.message);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Access token expired" });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid access token" });
    }
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};



export const validateRefreshToken = async (req, res) => {
  try {
    // Read refresh token from httpOnly cookie
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        message: "Refresh token not provided",
      });
    }

    // ✅ Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.REFRESH_SECRET_KEY
    );

    // 🚫 Never mint a new access token for a banned user
    try {
      const ban = await getActiveBan(decoded.id);
      if (ban) return suspendedResponse(res, ban);
    } catch (banErr) {
      console.error("❌ Ban check failed during refresh:", banErr.message);
    }

    // ✅ Slim payload matching the new login format
    const payload = {
      id: decoded.id,
      email: decoded.email,
      status: decoded.status,
    };

    // ✅ Generate new access token
    const newAccessToken = jwt.sign(
      payload,
      process.env.ACCESS_SECRET_KEY,
      { expiresIn: "30m" }
    );

    // ✅ Set new access token as httpOnly cookie
    res.cookie('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 30 * 60 * 1000,
      path: '/',
    });

    // ✅ Single response — no token in body
    return res.status(200).json({
      status: "success",
      message: "Token refreshed successfully",
    });

  } catch (err) {
    console.error("Refresh token error:", err);
    return res.status(403).json({
      message: "Invalid or expired refresh token",
    });
  }
};
