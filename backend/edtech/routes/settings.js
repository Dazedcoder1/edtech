/**
 * Platform appearance.
 *
 * These settings change what every user sees, so the split matters: reading is
 * open to anyone (the UI cannot render without knowing the theme, including on
 * the sign-in page before anyone is authenticated), while writing is limited
 * to educators.
 */
import express from "express";
import pool from "../config/database.js";
import { authOnly as authMiddleware } from "../middleware/auth.js";

const router = express.Router();

/*
 * Allowed values, enumerated rather than free text.
 *
 * These end up as `data-theme` attributes that CSS selects on. An unchecked
 * value would not be a security problem so much as a silent one: an
 * unrecognised theme matches no rule, and the site renders unstyled with no
 * error anywhere to explain why.
 */
export const THEMES = ["default", "eduverse", "ocean", "lagoon", "forest", "sunset", "mono"];
export const MODES = ["light", "dark"];
export const DENSITIES = ["comfortable", "compact"];

/**
 * The visual language, as distinct from the palette.
 *
 * "brutal" is what the app was built in: thick black borders and hard offset
 * shadows. "soft" is the rounded, shadow-blurred style — no heavy outlines,
 * gentle elevation, larger radii.
 *
 * Separate from `theme` because the two are genuinely independent: an Ocean
 * palette works in either language, and folding them together would mean ten
 * options where two axes will do.
 */
export const STYLES = ["brutal", "soft"];

/** Shown in the picker. Kept beside the values so the two cannot drift. */
const THEME_META = {
    default: { label: "Sharda", swatch: ["#C0451F", "#F9E076", "#A7E2D1"] },
    eduverse: { label: "Eduverse", swatch: ["#4F46E5", "#8B5CF6", "#F97316"] },
    ocean: { label: "Ocean", swatch: ["#2563EB", "#38BDF8", "#A5F3FC"] },
    lagoon: { label: "Lagoon", swatch: ["#005F73", "#0A9396", "#EE9B00"] },
    forest: { label: "Forest", swatch: ["#15803D", "#84CC16", "#BBF7D0"] },
    sunset: { label: "Sunset", swatch: ["#DB2777", "#FB923C", "#FDE68A"] },
    mono: { label: "Mono", swatch: ["#111111", "#686F7D", "#E5E7EB"] },
};

/**
 * GET /api/settings/appearance
 *
 * Deliberately unauthenticated. The login page needs the theme before anyone
 * has signed in, and there is nothing private here — it is the colour of the
 * buttons.
 */
router.get("/appearance", async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT theme, mode, density, style, updated_at FROM platform_settings WHERE id = 1`
        );

        // Falls back rather than 404s: a missing row should show the default
        // site, not a broken one.
        const settings = rows[0] ?? {
            theme: "eduverse", mode: "light", density: "comfortable", style: "soft",
        };

        res.json({
            success: true,
            ...settings,
            options: {
                themes: THEMES, modes: MODES, densities: DENSITIES,
                styles: STYLES, meta: THEME_META,
            },
        });
    } catch (err) {
        console.error("GET /settings/appearance:", err);
        // Still answer with something usable — the UI cannot render without it.
        res.json({
            success: false,
            theme: "eduverse",
            mode: "light",
            density: "comfortable",
            style: "soft",
            options: {
                themes: THEMES, modes: MODES, densities: DENSITIES,
                styles: STYLES, meta: THEME_META,
            },
        });
    }
});

/**
 * PUT /api/settings/appearance
 * Body: { theme?, mode?, density? }
 *
 * Educators only. This changes the platform for everyone, including students,
 * so it is not a personal preference and must not be writable by one.
 */
router.put("/appearance", authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== "educator" && req.user.role !== "admin") {
            return res.status(403).json({
                error: "Only educators can change how the platform looks.",
            });
        }

        const { theme, mode, density, style } = req.body;

        if (theme !== undefined && !THEMES.includes(theme)) {
            return res.status(400).json({ error: `theme must be one of: ${THEMES.join(", ")}` });
        }
        if (mode !== undefined && !MODES.includes(mode)) {
            return res.status(400).json({ error: `mode must be one of: ${MODES.join(", ")}` });
        }
        if (density !== undefined && !DENSITIES.includes(density)) {
            return res.status(400).json({ error: `density must be one of: ${DENSITIES.join(", ")}` });
        }
        if (style !== undefined && !STYLES.includes(style)) {
            return res.status(400).json({ error: `style must be one of: ${STYLES.join(", ")}` });
        }

        /*
         * COALESCE so a partial update leaves the rest alone — the picker sends
         * one field at a time as each control is touched, and a missing key
         * must not reset the others to their defaults.
         */
        const { rows } = await pool.query(`
            UPDATE platform_settings
               SET theme = COALESCE($1, theme),
                   mode = COALESCE($2, mode),
                   density = COALESCE($3, density),
                   style = COALESCE($5, style),
                   updated_by = $4,
                   updated_at = NOW()
             WHERE id = 1
            RETURNING theme, mode, density, style, updated_at
        `, [theme ?? null, mode ?? null, density ?? null, req.user.id, style ?? null]);

        res.json({ success: true, ...rows[0] });
    } catch (err) {
        console.error("PUT /settings/appearance:", err);
        res.status(500).json({ error: "Could not save the appearance settings" });
    }
});

/*
 * ---------------------------------------------------------------------------
 * Personal appearance
 *
 * Deliberately a different resource from /appearance above. That one is a
 * single row for the whole site and only educators may write it; this one is
 * per-account and every signed-in user owns their own.
 *
 * Keeping them apart is the whole safety property: there is no request a
 * student can make to this route that reaches platform_settings, because the
 * only row it can touch is WHERE id = req.user.id.
 * ---------------------------------------------------------------------------
 */

/** Validate one field, treating null and "" as "clear the override". */
function parsePref(value, allowed, name) {
    if (value === undefined) return { ok: true, value: undefined }; // absent: leave alone
    if (value === null || value === "") return { ok: true, value: null }; // explicit reset
    if (!allowed.includes(value)) {
        return { ok: false, error: `${name} must be one of: ${allowed.join(", ")}` };
    }
    return { ok: true, value };
}

/**
 * GET /api/settings/me
 *
 * The caller's own override. Null fields mean "follow the platform".
 */
router.get("/me", authMiddleware, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT pref_theme, pref_mode, pref_density, pref_style
               FROM users WHERE id = $1`,
            [req.user.id]
        );
        const r = rows[0] ?? {};
        res.json({
            success: true,
            theme: r.pref_theme ?? null,
            mode: r.pref_mode ?? null,
            density: r.pref_density ?? null,
            style: r.pref_style ?? null,
        });
    } catch (err) {
        console.error("GET /settings/me:", err);
        // Answer with "no override" rather than failing: the app must still
        // render, and no override simply means the platform default applies.
        res.json({ success: false, theme: null, mode: null, density: null, style: null });
    }
});

/**
 * PUT /api/settings/me
 * Body: { theme?, mode?, density?, style? }  — null on any field resets it.
 *
 * No role check, by design. Every signed-in user may change how the site
 * looks *to them*; that is the difference between this and the platform row.
 */
router.put("/me", authMiddleware, async (req, res) => {
    try {
        const fields = [
            ["theme", THEMES], ["mode", MODES],
            ["density", DENSITIES], ["style", STYLES],
        ];
        const parsed = {};
        for (const [name, allowed] of fields) {
            const r = parsePref(req.body[name], allowed, name);
            if (!r.ok) return res.status(400).json({ error: r.error });
            parsed[name] = r.value;
        }

        /*
         * Two parameters per column: the value, and whether it was present at
         * all. COALESCE alone cannot express this, because null here means
         * "reset to following the platform" rather than "leave unchanged" —
         * without the second flag there would be no way to undo a choice.
         */
        const { rows } = await pool.query(`
            UPDATE users
               SET pref_theme   = CASE WHEN $2::bool THEN $1 ELSE pref_theme END,
                   pref_mode    = CASE WHEN $4::bool THEN $3 ELSE pref_mode END,
                   pref_density = CASE WHEN $6::bool THEN $5 ELSE pref_density END,
                   pref_style   = CASE WHEN $8::bool THEN $7 ELSE pref_style END
             WHERE id = $9
            RETURNING pref_theme, pref_mode, pref_density, pref_style
        `, [
            parsed.theme ?? null, parsed.theme !== undefined,
            parsed.mode ?? null, parsed.mode !== undefined,
            parsed.density ?? null, parsed.density !== undefined,
            parsed.style ?? null, parsed.style !== undefined,
            req.user.id,
        ]);

        const r = rows[0] ?? {};
        res.json({
            success: true,
            theme: r.pref_theme ?? null,
            mode: r.pref_mode ?? null,
            density: r.pref_density ?? null,
            style: r.pref_style ?? null,
        });
    } catch (err) {
        console.error("PUT /settings/me:", err);
        res.status(500).json({ error: "Could not save your appearance" });
    }
});

export default router;
