/**
 * Read-only: why did a video fail to process?
 *
 * transcodeVideo stores the ffmpeg failure on the row itself, so the reason is
 * already recorded — it just is not shown anywhere in the UI beyond
 * "Processing failed — check the server log".
 *
 *   node scripts/check-videos.js
 *
 * Writes nothing.
 */
import pool from "../config/database.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_VIDEO_DIR = path.join(__dirname, "../temp_videos");
const pad = (s, n) => String(s ?? "—").padEnd(n);

try {
    const { rows } = await pool.query(`
        SELECT id, title, status, file_hash, file_size_bytes, duration_seconds,
               r2_key, metadata, created_at
          FROM content_items
         WHERE content_type = 'video' AND is_active = true
         ORDER BY created_at DESC
         LIMIT 15
    `);

    if (rows.length === 0) {
        console.log("\nNo videos found.\n");
    } else {
        console.log(`\n${pad("TITLE", 24)}${pad("STATUS", 12)}${pad("SIZE", 10)}${pad("RENDITIONS", 14)}SOURCE ON DISK`);
        console.log("-".repeat(86));

        for (const r of rows) {
            const size = r.file_size_bytes
                ? `${(Number(r.file_size_bytes) / 1024 / 1024).toFixed(0)}MB`
                : "—";
            const rends = r.metadata?.resolutions?.join(",") || "—";

            // The transcode reads this file; if it is gone the job cannot run.
            let onDisk = "—";
            if (r.file_hash) {
                const found = fs.existsSync(TEMP_VIDEO_DIR)
                    ? fs.readdirSync(TEMP_VIDEO_DIR).filter((f) => f.startsWith(r.file_hash))
                    : [];
                onDisk = found.length ? found[0] : "MISSING";
            }

            console.log(
                pad(r.title?.slice(0, 22), 24) +
                pad(r.status, 12) +
                pad(size, 10) +
                pad(rends, 14) +
                onDisk
            );

            const err = r.metadata?.error || r.metadata?.partial_error;
            if (err) {
                console.log(`    └─ ${String(err).slice(0, 300)}`);
            }
        }

        const failed = rows.filter((r) => r.status === "failed").length;
        console.log(`\n${failed} of ${rows.length} recent video(s) failed.`);
        console.log(`
The line under a failed row is ffmpeg's own message, captured from stderr.
  "No such file or directory"  -> the source was cleaned up before encoding
  "Invalid data found"         -> the assembled file is corrupt or truncated
  "Unknown encoder"            -> the bundled ffmpeg lacks libx264
  "spawn ... ENOENT"           -> ffmpeg binary could not be launched
`);
    }
} catch (err) {
    console.error("\nDiagnostic failed:", err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
