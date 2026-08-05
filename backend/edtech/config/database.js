import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

/*
 * No fallback connection string.
 *
 * This used to default to a full production URL — host, database, username and
 * password — sitting in the source. Anyone who cloned the repo had working
 * credentials to the live database, and every push republished them.
 *
 * A default is worse than useless here even ignoring the leak: a misconfigured
 * staging box would silently connect to production and start writing to it.
 * Refusing to start is the only safe behaviour, and the error says exactly what
 * to do about it.
 */
if (!process.env.DATABASE_URL) {
    throw new Error(
        "DATABASE_URL is not set.\n" +
        "  Create backend/edtech/.env with:\n" +
        "    DATABASE_URL=postgresql://user:password@host:5432/dbname\n" +
        "  See .env.example for the full list of variables."
    );
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    /*
     * The database server rejects SSL outright, so it has to be off.
     *
     * That means the connection is unencrypted: acceptable only while the
     * database is reachable on a private network or from the app host alone.
     * If it ever becomes reachable from the internet, enable SSL there and
     * change this to { rejectUnauthorized: true }.
     */
    ssl: false,
});

export default pool;
