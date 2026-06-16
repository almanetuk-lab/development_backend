// config/env.js
//
// ─────────────────────────────────────────────────────────────────────────────
// CENTRAL ENVIRONMENT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
//
// This module is the single source of truth for all environment-driven config.
// Every value is read from process.env — never hardcoded here.
//
// HOW TO CONFIGURE FOR A NEW ENVIRONMENT:
//   1. Copy .env.example → .env
//   2. Fill in your values for that environment (local, Render, Railway, VPS, etc.)
//   3. Restart the server — no source code changes required.
//
// COMMA-SEPARATED VALUES:
//   CORS_ALLOWED_ORIGINS and ALLOWED_HOSTS support multiple values separated
//   by commas with no spaces:
//     CORS_ALLOWED_ORIGINS=http://localhost:5173,https://app.example.com
//     ALLOWED_HOSTS=localhost,127.0.0.1,api.example.com
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a comma-separated environment variable into a trimmed array.
 * Returns an empty array if the variable is not set.
 *
 * @param {string} key   - The environment variable name
 * @param {string[]} [fallback=[]] - Default value if not set
 * @returns {string[]}
 */
function parseList(key, fallback = []) {
  const raw = process.env[key];
  if (!raw || raw.trim() === '') return fallback;
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Read a required environment variable. Logs a warning if missing.
 *
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
function required(key, fallback) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    if (fallback !== undefined) {
      console.warn(
        `⚠️  [env] "${key}" is not set — using fallback: "${fallback}". ` +
        `Set it in .env for production deployments.`
      );
      return fallback;
    }
    console.error(`❌ [env] Required variable "${key}" is missing. Check your .env file.`);
    return '';
  }
  return val.trim();
}

// ── Server ────────────────────────────────────────────────────────────────────

export const port = parseInt(process.env.PORT || '3435', 10);

/**
 * NODE_ENV — controls SSL, logging verbosity, error detail.
 * Values: development | staging | production
 * Default: development
 */
export const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
export const isProduction = nodeEnv === 'production';
export const isDevelopment = nodeEnv === 'development';

// ── URLs ──────────────────────────────────────────────────────────────────────

/**
 * FRONTEND_URL — the public URL of the frontend application.
 * Used for: password reset links, email templates, redirects.
 *
 * Example: https://app.intentionalconnections.com
 * Local:   http://localhost:5173
 */
export const frontendUrl = required('FRONTEND_URL', 'http://localhost:5173');

/**
 * CLIENT_URL — alias for FRONTEND_URL used by some services/SDKs.
 * Defaults to FRONTEND_URL if not set separately.
 */
export const clientUrl = process.env.CLIENT_URL?.trim() || frontendUrl;

/**
 * BACKEND_URL — the public URL of this backend service.
 * Used for: self-referencing links, webhook callbacks, LinkedIn redirect URIs.
 *
 * Example: https://api.intentionalconnections.com
 * Local:   http://localhost:3435
 */
export const backendUrl = required('BACKEND_URL', `http://localhost:${port}`);

/**
 * API_BASE_URL — base path for all API routes.
 * Typically BACKEND_URL + /api
 *
 * Example: https://api.intentionalconnections.com/api
 */
export const apiBaseUrl =
  process.env.API_BASE_URL?.trim() || `${backendUrl}/api`;

// ── CORS ──────────────────────────────────────────────────────────────────────

/**
 * CORS_ALLOWED_ORIGINS — comma-separated list of frontend origins allowed
 * to make cross-origin requests to this backend.
 *
 * Applied to:
 *   - Express cors() middleware
 *   - Socket.IO CORS configuration
 *
 * Example .env value:
 *   CORS_ALLOWED_ORIGINS=http://localhost:5173,https://app.intentionalconnections.com
 *
 * To allow all origins during development, set:
 *   CORS_ALLOWED_ORIGINS=*
 */
export const corsOrigins = parseList('CORS_ALLOWED_ORIGINS', [
  'http://localhost:5173',
]);

/**
 * Socket.IO uses the same allowed origins as Express CORS.
 * If CORS_ALLOWED_ORIGINS=* we pass "*" directly to Socket.IO.
 */
export const socketCorsOrigins =
  corsOrigins.length === 1 && corsOrigins[0] === '*' ? '*' : corsOrigins;

// ── Allowed Hosts ─────────────────────────────────────────────────────────────

/**
 * ALLOWED_HOSTS — comma-separated list of valid Host header values.
 * Can be used by reverse-proxy validation middleware or host-based routing.
 *
 * Example: localhost,127.0.0.1,api.intentionalconnections.com
 */
export const allowedHosts = parseList('ALLOWED_HOSTS', [
  'localhost',
  '127.0.0.1',
]);

// ── Database ──────────────────────────────────────────────────────────────────

/**
 * DATABASE_URL — full PostgreSQL connection string.
 * SSL is enabled automatically when not connecting to localhost.
 */
export const databaseUrl = required('DATABASE_URL', '');

export const isLocalDb =
  databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1');

export const dbSslConfig = isLocalDb ? false : { rejectUnauthorized: false };

// ── Startup Log ───────────────────────────────────────────────────────────────

/**
 * Print a startup summary so operators can instantly verify the active config.
 * Secrets are never logged.
 */
export function logEnvSummary() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         ENVIRONMENT CONFIGURATION SUMMARY            ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  NODE_ENV        : ${nodeEnv.padEnd(33)}║`);
  console.log(`║  PORT            : ${String(port).padEnd(33)}║`);
  console.log(`║  FRONTEND_URL    : ${frontendUrl.slice(0, 33).padEnd(33)}║`);
  console.log(`║  BACKEND_URL     : ${backendUrl.slice(0, 33).padEnd(33)}║`);
  console.log(`║  API_BASE_URL    : ${apiBaseUrl.slice(0, 33).padEnd(33)}║`);
  console.log(`║  DB SSL          : ${String(!isLocalDb).padEnd(33)}║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  CORS_ALLOWED_ORIGINS:                               ║');
  corsOrigins.forEach((o) => {
    console.log(`║    • ${o.slice(0, 48).padEnd(48)}║`);
  });
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
}
