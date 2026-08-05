import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

/*
 * NOTE: this directory is a dead copy of backend/edtech/.
 *
 * docker-compose.yml builds the backend from ./backend only, so nothing here
 * runs in development or production. It is kept in git purely by inertia.
 *
 * The hardcoded production connection string that used to live on the next
 * line has been removed — it was a full URL with the live password, and a dead
 * file leaks credentials exactly as well as a live one.
 *
 * This whole folder (config/, routes/, middleware/, utils/, server.js at the
 * repository root) should be deleted; keeping two copies of the backend means
 * fixes land in one and not the other, which has already caused confusion.
 */
if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL is not set. See .env.example.\n" +
        "  (Note: this root-level copy of the backend is unused — " +
        "the deployed code is in backend/edtech/.)"
    );
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

export default pool;
