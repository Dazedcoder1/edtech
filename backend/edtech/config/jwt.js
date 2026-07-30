import "dotenv/config";

/**
 * One JWT secret for the whole app.
 *
 * This module exists because the secret was previously declared separately in
 * three files, and they drifted:
 *
 *   routes/auth.js       "your-secret-key-change-in-production"   <- signs
 *   middleware/auth.js   "your-secret-key-change-in-production"
 *   routes/courses.js    "your-secret-key"                        <- verifies
 *
 * With JWT_SECRET unset, GET /courses/:id could not verify the very token that
 * login had just issued. Its jwt.verify threw, an empty `catch {}` swallowed
 * the error, and isCreator/isEnrolled silently became false — so educators lost
 * every edit and delete control on their own courses, with nothing logged.
 *
 * A hardcoded fallback is what allowed that to go unnoticed, so in production
 * we refuse to start instead.
 */
const FALLBACK = "your-secret-key-change-in-production";

if (!process.env.JWT_SECRET) {
    if (process.env.NODE_ENV === "production") {
        throw new Error(
            "JWT_SECRET is not set. Refusing to start in production with a public default secret."
        );
    }
    console.warn(
        "⚠️  JWT_SECRET is not set — using the development fallback.\n" +
        "   Set it in backend/edtech/.env before deploying."
    );
}

export const JWT_SECRET = process.env.JWT_SECRET || FALLBACK;
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export default JWT_SECRET;
