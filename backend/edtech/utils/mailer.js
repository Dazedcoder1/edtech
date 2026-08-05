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
        console.error(
            `\n${"=".repeat(70)}\n` +
            `❌ EMAIL FAILED — ${to} did not receive anything.\n\n` +
            `${explainMailError(err)}\n\n` +
            `   Raw error: ${err.message}\n` +
            `${"=".repeat(70)}\n`
        );
        return { ok: false, error: err.message };
    }
}

/**
 * Turn an SMTP failure into something actionable.
 *
 * nodemailer surfaces the provider's raw response, which is accurate and
 * unhelpful: "535-5.7.8 Username and Password not accepted" does not tell a
 * first-time setup that Gmail wants an App Password rather than the account
 * password. Each of these is a mistake seen in practice.
 */
export function explainMailError(err) {
    const msg = String(err?.message || err);
    const code = err?.code;

    if (/535|Username and Password not accepted|BadCredentials/i.test(msg)) {
        return (
            "Gmail rejected the username or password.\n" +
            "  • SMTP_PASS must be a 16-character App Password, not your Gmail password.\n" +
            "  • Generate one at https://myaccount.google.com/apppasswords\n" +
            "    (2-Step Verification must be on, or that page will not exist).\n" +
            "  • Remove the spaces Google shows: 'abcd efgh ijkl mnop' -> 'abcdefghijklmnop'."
        );
    }
    if (/Missing credentials|No auth mechanism/i.test(msg)) {
        return "SMTP_USER or SMTP_PASS is empty. Both are required.";
    }
    if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(msg)) {
        return `Nothing is listening on ${HOST}:${PORT}. Check SMTP_HOST and SMTP_PORT.`;
    }
    if (code === "ETIMEDOUT" || /ETIMEDOUT|timed out/i.test(msg)) {
        return (
            `Timed out connecting to ${HOST}:${PORT}.\n` +
            "  Usually a firewall or ISP blocking outbound SMTP. Try port 465 instead of 587."
        );
    }
    if (code === "EDNS" || /ENOTFOUND|getaddrinfo/i.test(msg)) {
        return `Could not resolve SMTP_HOST ("${HOST}"). Check it for typos.`;
    }
    if (/self.signed|unable to verify|certificate/i.test(msg)) {
        return (
            "TLS certificate rejected.\n" +
            "  Check the port matches the mode: 587 is STARTTLS, 465 is implicit TLS."
        );
    }
    return msg;
}

/**
 * Check the credentials without sending anything.
 *
 * Called at boot so a wrong password is reported the moment the server starts,
 * rather than the first time a student cannot log in and asks why no code
 * arrived. verify() performs the full handshake and authentication, so it
 * catches exactly what a real send would.
 */
export async function verifyMail() {
    if (!transport) return { ok: false, configured: false };
    try {
        await transport.verify();
        return { ok: true, configured: true };
    } catch (err) {
        return { ok: false, configured: true, error: explainMailError(err), raw: err.message };
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

/**
 * The second-factor code sent on every sign-in.
 *
 * Separate from the confirmation message because the reader's situation is
 * different: they are mid-login and expecting this, and the sentence that
 * matters is the warning — an unexpected sign-in code means someone else has
 * their password, which is urgent in a way an unexpected signup email is not.
 */
export function loginCodeEmail({ name, code, minutes }) {
    const subject = `Your sign-in code: ${code}`;

    const text = [
        `Hi ${name || "there"},`,
        ``,
        `Your sign-in code is ${code}`,
        ``,
        `It expires in ${minutes} minutes and can be used once.`,
        ``,
        `If you are not trying to sign in, someone else may know your password.`,
        `Change it as soon as you can.`,
    ].join("\n");

    const html = `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px;">
          <p>Hi ${name || "there"},</p>
          <p>Your sign-in code is:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 24px 0;">
            ${code}
          </p>
          <p>It expires in ${minutes} minutes and can be used once.</p>
          <p style="color: #b3261e; font-size: 14px;">
            If you are not trying to sign in, someone else may know your password.
            Change it as soon as you can.
          </p>
        </div>
    `;

    return { subject, text, html };
}

/**
 * The address-confirmation message sent after signup.
 *
 * Worded differently from the reset email on purpose. "If you didn't request
 * this, ignore it" is right for a reset, where an unexpected message means
 * someone tried to get in. Here an unexpected message means someone typed the
 * wrong address, and the useful advice is different.
 */
export function verifyEmailMessage({ name, code, minutes }) {
    const subject = `Your verification code: ${code}`;

    const text = [
        `Hi ${name || "there"},`,
        ``,
        `Welcome. Your verification code is ${code}`,
        ``,
        `Enter it to confirm this email address. It expires in ${minutes} minutes.`,
        ``,
        `If you didn't create an account, someone may have typed this address by`,
        `mistake — you can ignore this email and nothing will happen.`,
    ].join("\n");

    const html = `
        <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px;">
          <p>Hi ${name || "there"},</p>
          <p>Welcome. Your verification code is:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; margin: 24px 0;">
            ${code}
          </p>
          <p>Enter it to confirm this email address. It expires in ${minutes} minutes.</p>
          <p style="color: #666; font-size: 14px;">
            If you didn't create an account, someone may have typed this address by
            mistake — you can ignore this email and nothing will happen.
          </p>
        </div>
    `;

    return { subject, text, html };
}
