/**
 * Read-only diagnostic for documents that will not open.
 *
 * The viewer decides what to do from the Content-Type the server sends, which
 * comes from content_items.mime_type (falling back to content_type). A row with
 * a missing or non-PDF mime_type is served as application/octet-stream, and the
 * viewer then offers a download instead of rendering it — which looks exactly
 * like "the PDF won't open".
 *
 * This prints, per non-video item, what the server would send and what the
 * viewer would therefore do.
 *
 *   node scripts/check-content.js
 *   node scripts/check-content.js "Chapter"
 *
 * Writes nothing.
 */
import pool from "../config/database.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET_NAME } from "../config/r2.js";

const [, , titleFilter] = process.argv;

/**
 * Read the first bytes of the stored object and report what they actually are.
 *
 * A row can claim application/pdf while the object behind it holds something
 * else entirely — an HTML error page saved during a failed upload, say. The
 * browser then opens its PDF viewer on bytes that are not a PDF and draws
 * nothing, which is indistinguishable from a broken viewer.
 */
async function sniff(r2Key) {
    if (!r2Key) return "no key";
    try {
        const res = await r2Client.send(
            new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: r2Key, Range: "bytes=0-7" })
        );
        const chunks = [];
        for await (const c of res.Body) chunks.push(c);
        const head = Buffer.concat(chunks);
        if (head.length === 0) return "EMPTY";
        if (head.slice(0, 5).toString("latin1") === "%PDF-") return "PDF";
        if (head.slice(0, 2).toString("latin1") === "PK") return "ZIP/docx";
        if (head.slice(0, 1).toString("latin1") === "<") return "HTML/XML (!)";
        return `? ${head.slice(0, 4).toString("hex")}`;
    } catch (err) {
        return `R2 ERROR: ${err.name || err.message}`;
    }
}
const pad = (s, n) => String(s ?? "—").padEnd(n);

try {
    const { rows } = await pool.query(`
        SELECT ci.id,
               ci.title,
               ci.file_name,
               ci.content_type,
               ci.mime_type,
               ci.status,
               ci.r2_key,
               ci.file_size_bytes,
               ci.is_active
          FROM content_items ci
         WHERE ci.content_type IS DISTINCT FROM 'video'
           AND ci.is_active = true
           AND ($1::text IS NULL OR ci.title ILIKE '%' || $1 || '%')
         ORDER BY ci.created_at DESC
         LIMIT 40
    `, [titleFilter ?? null]);

    if (rows.length === 0) {
        console.log("\nNo active non-video content found.\n");
    } else {
        console.log(`\n${pad("TITLE", 22)}${pad("FILE", 20)}${pad("content_type", 14)}${pad("mime_type", 26)}${pad("SERVED AS", 26)}${pad("VIEWER", 16)}ACTUAL BYTES`);
        console.log("-".repeat(140));

        let problems = 0;
        for (const r of rows) {
            // Mirrors the fallback in routes/content.js exactly.
            const servedAs =
                r.mime_type ||
                (r.content_type === "pdf" ? "application/pdf" : "application/octet-stream");

            const viewer =
                servedAs === "application/pdf"
                    ? "renders"
                    : "DOWNLOAD CARD";

            const actual = await sniff(r.r2_key);
            const broken =
                !r.r2_key || r.status !== "ready" || viewer !== "renders" || actual !== "PDF";
            if (broken) problems++;

            console.log(
                pad(r.title?.slice(0, 20), 22) +
                pad((r.file_name ?? "—").slice(0, 18), 20) +
                pad(r.content_type, 14) +
                pad(r.mime_type ?? "NULL", 26) +
                pad(servedAs.slice(0, 24), 26) +
                pad(viewer, 16) +
                actual +
                (!r.r2_key ? "  [no r2_key -> 404]" : "") +
                (r.status !== "ready" ? `  [status=${r.status}]` : "")
            );
        }

        console.log(`
${problems} of ${rows.length} item(s) would not render inline.

  DOWNLOAD CARD  -> mime_type is missing or not application/pdf, so the viewer
                    offers the file instead of displaying it.
  [no r2_key]    -> the row has no object in storage; the endpoint returns 404.
  [status=...]   -> anything other than 'ready' is hidden from students.

ACTUAL BYTES is what is really stored, read from R2:
  PDF          -> genuine PDF; if it still shows blank the fault is in the viewer
  ZIP/docx     -> a Word file mislabelled as a PDF
  HTML/XML (!) -> an error page was uploaded instead of the document
  EMPTY        -> zero-byte object
  R2 ERROR     -> the object is missing from the bucket entirely
`);
    }
} catch (err) {
    console.error("\nDiagnostic failed:", err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
