import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";
import { pool } from "./config/db.js"; // ✅ Use your existing DB connection
import bodyParser from 'body-parser';
import helmet from "helmet";
import { authRateLimiter, globalRateLimiter, paymentRateLimiter } from "./middleware/rateLimiter.js";

// ✅ Import routes
import authRoutes from "./routes/authRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
// Admin imports
import adminRoutes from "./routes/adminRoutes.js";
import searchRoutes from "./routes/searchRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import { testConnection } from "./config/db.js";
// Chat imports
import chatRoutes from "./routes/chatRoutes.js";
import cartRoutes from "./routes/cart.js";
// Plans imports
import customerPlansRoutes from "./routes/customerPlans.js";
import adminPlansRoutes from "./routes/adminPlans.js";

// Payment imports
import paymentRoutes from "./routes/paymentRoutes.js";
import { stripeWebhook } from "./controller/paymentController.js";

import userMatchesRoute from './routes/userMatchesRoute.js';
// Blog imports
import blogRoutes from "./routes/blog.routes.js";

import userProfileRoute from "./routes/usersRoute.js";
import recentActivitiesRoute from "./routes/recentAtivitiesRoute.js";

import adminConfigRoutes from "./routes/adminConfigRoutes.js";
//Importing configuration route
import configRoutes from "./routes/configRoutes.js";

import planRoutes from "./routes/planRoutes.js";
// Load environment variables
import reportRoutes from "./routes/reportRoutes.js";
import adminReportRoutes from "./routes/adminreportRoutes.js";
import privacyRoutes from "./routes/privacyRoutes.js";
//import { create } from "domain";

import linkedinRoutes from './routes/linkedinRoutes.js';
import googleRoutes from './routes/googleRoutes.js';
import matchRoutes from './routes/matchRoutes.js';
import healthRoutes from "./routes/healthRoutes.js";
import digitalTwinRoutes from "./routes/digitalTwinRoutes.js";
import handshakeRoutes from "./routes/handshakeRoutes.js";
import aiAgentRoutes from "./routes/aiAgentRoutes.js";
import { verifySentimentSchema } from "./utils/schemaValidator.js";
dotenv.config();

const app = express();
app.set("trust proxy", 1); // Trust first proxy (Render, Vercel, Cloudflare, etc.) to get correct client IPs for rate-limiting
app.disable("x-powered-by");

// -------------------- CORS Configuration ------------------------
const staticAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
  "http://127.0.0.1:3000",
  "https://intentionalconnections.app",
  "https://development-frontend-w65e.onrender.com",
  "https://frontend1-7fsg.onrender.com",
  "https://intentional-connection.onrender.com",
  "https://development-frontend-livid.vercel.app"
];

const getAllowedOrigins = () => {
  const list = [...staticAllowedOrigins];
  if (process.env.FRONTEND_URL) {
    list.push(process.env.FRONTEND_URL.replace(/\/+$/, ''));
  }
  if (process.env.CORS_ALLOWED_ORIGINS) {
    process.env.CORS_ALLOWED_ORIGINS.split(',').forEach((url) => {
      const trimmed = url.trim().replace(/\/+$/, '');
      if (trimmed) list.push(trimmed);
    });
  }
  return list;
};

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. server-to-server, curl, Postman, mobile apps)
    if (!origin) return callback(null, true);

    const normalized = origin.toLowerCase().replace(/\/+$/, '');
    const origins = getAllowedOrigins().map(o => o.toLowerCase());
    const isProd = process.env.NODE_ENV === "production";

    // 1. Direct match
    if (origins.includes(normalized)) {
      return callback(null, true);
    }

    // 2. Subdomain wildcard match for custom allowed origins (e.g. www.intentionalconnections.app)
    try {
      const originUrl = new URL(normalized);
      const originHostname = originUrl.hostname;

      const isAllowedSubdomain = origins.some(allowedOrigin => {
        try {
          const allowedUrl = new URL(allowedOrigin);
          const allowedHostname = allowedUrl.hostname;
          return (
            originHostname === allowedHostname ||
            originHostname.endsWith('.' + allowedHostname)
          );
        } catch (e) {
          return false;
        }
      });

      if (isAllowedSubdomain) {
        return callback(null, true);
      }
    } catch (e) {
      // Ignore URL parsing errors
    }

    // 3. Platform specific matches (Render / Vercel / localhost in non-prod)
    if (
      normalized.includes('onrender.com') ||
      normalized.includes('vercel.app') ||
      (!isProd && (normalized.includes('localhost') || normalized.includes('127.0.0.1')))
    ) {
      return callback(null, true);
    }

    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(null, false); // Return false instead of throwing Error to let express handle it gracefully
  },
  credentials: true,
  optionsSuccessStatus: 200
};

// Enable CORS early so it processes headers before rate limiters return error responses
app.use(cors(corsOptions));

// ---- Strict Security Headers (Helmet) ----
app.use(helmet({
  // Strict Content-Security-Policy — only allow resources from trusted origins
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://js.stripe.com", "https://accounts.google.com"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
      connectSrc: ["'self'", "https://api.stripe.com", "https://intentionalconnections.app"],
      imgSrc: ["'self'", "data:", "https://*.supabase.co"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Required for Stripe iframes
  hsts: {
    maxAge: 31536000, // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
}));

// -------------------- Stripe Webhook Route (Exempt from Rate Limiting) ------------------------
app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);

// Apply rate limiters
app.use("/api/register", authRateLimiter);
app.use("/api/login", authRateLimiter);
app.use("/api/forgotpassword", authRateLimiter);
app.use("/api/reset-password", authRateLimiter);
app.use("/payments/create-checkout-session", paymentRateLimiter);

// Protect ALL other server endpoints globally against DDoS attacks
app.use(globalRateLimiter);

testConnection();
verifySentimentSchema();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Serve static files from "uploads" directory
//app.use("/uploads", express.static("uploads"));

//  Create HTTP + Socket.IO server
const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  transports: ["websocket", "polling"],
});
console.log("✅ Socket connected");
//  Track online users (userId → connection count) for multi-tab/device presence
const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log(" User connected:", socket.id);

  // When frontend registers userId with socket
  socket.on("register_user", (userId) => {
    const key = String(userId);
    // Store userId on socket for O(1) reverse lookup on disconnect
    socket.userId = key;
    // Join a Socket.IO room named after the userId (for routing)
    socket.join(key);
    // Track connection count for presence
    const current = onlineUsers.get(key) || 0;
    onlineUsers.set(key, current + 1);
    console.log(` User ${userId} registered (socket: ${socket.id}, total connections: ${onlineUsers.get(key)})`);

    // If this is the user's first connection, broadcast they came online
    if (current === 0) {
      io.emit("user_status_change", { userId: key, isOnline: true });
    }

    // Send the current online users snapshot to THIS socket only
    socket.emit("online_users_list", Array.from(onlineUsers.keys()));
  });

  socket.on("disconnect", () => {
    const key = socket.userId;
    if (!key) return;
    const count = onlineUsers.get(key);
    if (!count) return;
    if (count <= 1) {
      onlineUsers.delete(key);
      const lastSeen = new Date().toISOString();
      // Persist last_seen timestamp in database asynchronously
      pool.query("UPDATE users SET last_seen = NOW() WHERE id = $1", [key]).catch((err) => {
        console.error(`❌ Failed to update last_seen for user ${key}:`, err.message);
      });
      // User's last connection gone — broadcast they went offline with lastSeen
      io.emit("user_status_change", { userId: key, isOnline: false, lastSeen });
    } else {
      onlineUsers.set(key, count - 1);
    }
    console.log(` User ${key} disconnected (socket: ${socket.id}, remaining: ${onlineUsers.get(key) ?? 0})`);
  });
});

//  Function to send notification
export const sendNotification = async (userId, title, message) => {
  try {
    // Save in notifications table
    const result = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, is_read, created_at, source) VALUES ($1, $2, $3, 'general', FALSE, NOW(), 'admin') RETURNING *`,
      [userId, title, message]
    );

    // Send via Socket.IO to all tabs/devices if user is online (room-based routing)
    if (result.rows.length > 0) {
      io.to(String(userId)).emit("new_notification", result.rows[0]);
    }

    console.log(` Notification sent to user ${userId}: ${title}`);
  } catch (err) {
    console.error(" Error sending notification:", err);
  }
};

//  Root endpoint health check
app.get("/", (req, res) => {
  res.json({ status: "healthy", message: "Intentional Connection API is running!" });
});

//  Existing routes — unchanged
app.use("/", authRoutes);
app.use("/", profileRoutes);
app.use("/", adminRoutes);
app.use("/", searchRoutes);
app.use("/", matchRoutes);

app.use("/api/notifications", notificationRoutes); // new route for fetching notifications
app.use("/api/health", healthRoutes);
app.use("/api/twin", digitalTwinRoutes); // Digital Twin route
app.use("/api/handshake", handshakeRoutes); // Structural Handshake Protocol route
app.use("/api/ai-agent", aiAgentRoutes); // AI Chat Agent config route


// Payment routes 
app.use("/payments", paymentRoutes);

app.use("/api", uploadRoutes);
app.use("/", chatRoutes); // new chat routes
app.use("/", privacyRoutes); // GDPR Privacy & Data routes

//Configuration Routes:-
app.use("/api/admin/configurations", configRoutes);
// Routes
app.use("/api/cart", cartRoutes);
app.use("/api/plans", customerPlansRoutes);
app.use("/api/admin/plans", adminPlansRoutes);
// User Matches Route
app.use('/api/my_matches', userMatchesRoute);

// Blog routes
app.use("/api/blogs", blogRoutes);

// User Profile Routes
app.use("/api/users", userProfileRoute);

app.use("/api/view", recentActivitiesRoute);

// COnfiguration setting for member_approval
app.use("/api/settings", adminConfigRoutes);

// Plan status route
app.use("/api", planRoutes);

// Admin Reports Route
app.use("/api/admin/reports", reportRoutes);

app.use("/api/admin/users/handle", adminReportRoutes);
// LinkedIn Auth Routes
app.use('/api/linkedin', linkedinRoutes);

// Google Auth Routes
app.use('/', googleRoutes);

// Global Error Handler for Multer & general exceptions
app.use((err, req, res, next) => {
  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large. Maximum size allowed is 5MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes("Unsupported file format")) {
    return res.status(400).json({ error: err.message });
  }
  console.error("❌ Unhandled Error:", err);
  return res.status(500).json({ error: "Internal Server Error" });
});

//app.use(express.urlencoded({ extended: true })); 
const port = process.env.PORT || 3435;
server.listen(port, () => console.log(`🚀 Server running on localhost:${port}`));

export { app, io, onlineUsers };

