/**
 * Outgoing email.
 *
 * Configured entirely through environment variables so the provider can change
 * without touching code — Gmail, Brevo, Zoho and SendGrid all speak SMTP:
 *
 *   SMTP_HOST      smtp.gmail.com
 *   SMTP_PORT      587            (465 for implicit TLS)
 *   SMTP_USER      the login, usually the full address
 *   SMTP_PASS      an app password, not the account password
 *   SMTP_FROM      "Sharda Vidyapeeth <noreply@example.com>"  (optional)
 *
 * With none of those set, mail is written to the server log instead of being
 * sent. That is deliberate: the reset flow is then fully testable — including
 * reading the code — before anyone has signed up for a mail provider, and a
 * missing password cannot take the whole route down with a connection error.
 */
import nodemailer from "nodemailer";

const HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER;
const PASS = process.env.SMTP_PASS;

export const mailConfigured = Boolean(HOST && USER && PASS);

/*
 * Built once, at module load.
 *
 * nodemailer pools connections per transport, so creating one per message
 * would open a fresh TCP+TLS handshake for every email and, on providers that
 * rate-limit connections, start failing under very ordinary load.
 */
const transport = mailConfigured
    ? nodemailer.createTransport({
        host: HOST,
        port: PORT,
        // Port 465 is implicit TLS; 587 starts plaintext and upgrades via
        // STARTTLS. Getting this backwards produces a connection that hangs
        // rather than an error that explains itself.
        secure: PORT === 465,
        auth: { user: USER, pass: PASS },
    })
    : null;

const FROM = process.env.SMTP_FROM || USER || "no-reply@localhost";

/**
 * Send one message.
 *
 * Resolves `{ok: false}` rather than throwing: callers are routes that must
 * not 500 because a mail server was briefly unreachable, and the flow above
 * this deliberately reports the same thing to the user either way.
 */
export async function sendMail({ to, subject, text, html }) {
    if (!transport) {
        console.log(
            `\n${"=".repeat(70)}\n` +
            `📧 EMAIL NOT SENT — SMTP is not configured.\n` +
            `   Set SMTP_HOST, SMTP_USER and SMTP_PASS to send for real.\n` +
            `   To:      ${to}\n` +
            `   Subject: ${subject}\n` +
            `   ${text?.replace(/\n/g, "\n   ")}\n` +
            `${"=".repeat(70)}\n`
        );
        return { ok: true, delivered: false };
    }

    try {
        const info = await transport.sendMail({ from: FROM, to, subject, text, html });
        return { ok: true, delivered: true, id: info.messageId };
    } catch (err) {
        console.error("[mailer] send failed:", err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * The password reset message.
 *
 * Plain text as well as HTML: a mail client that shows only the text part
 * would otherwise display nothing, and the code is the entire point.
 */
export function passwordResetEmail({ name, code, minutes }) {
    const subject = `Your password reset code: ${code}`;

    const text = [
        `Hi ${name || "there"},`,
        ``,
        `Your password reset code is ${code}`,
        ``,
        `It expires in ${minutes} minutes and can be used once.`,
        ``,
        `If you didn't ask to reset your password, you can ignore this email —`,
        `your password has not changed.`,
    ].join("\n");

    const html = `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px;">
          <p>Hi ${name || "there"},</p>
          <p>Your password reset code is:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 24px 0;">
            ${code}
          </p>
          <p>It expires in ${minutes} minutes and can be used once.</p>
          <p style="color: #666; font-size: 14px;">
            If you didn't ask to reset your password, you can ignore this email —
            your password has not changed.
          </p>
        </div>
    `;

    return { subject, text, html };
}
