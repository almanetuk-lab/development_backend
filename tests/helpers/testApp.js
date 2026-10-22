/**
 * testApp.js
 * Exports the BASE_URL of the running dev server.
 *
 * The real server (server.js) uses Socket.IO and circular imports that
 * make it difficult to re-instantiate in tests. Instead, we point supertest
 * at the already-running process on PORT (default 3435).
 *
 * ⚠️  The dev server must be running before executing any test suite:
 *      cd development_backend && node server.js
 */
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 3435;
export const BASE_URL = `http://localhost:${PORT}`;

