/**
 * Test the email setup without going through the app.
 *
 *   node scripts/check-mail.js                 -> check the credentials only
 *   node scripts/check-mail.js you@example.com -> also send a real test message
 *
 * Reads the same .env the server does, so a pass here means the reset flow
 * will deliver. Sends nothing unless given an address.
 */
import "dotenv/config";
import { sendMail, verifyMail, mailConfigured } from "../utils/mailer.js";

const [, , recipient] = process.argv;

const line = "=".repeat(70);
console.log(`\n${line}`);
console.log("SMTP configuration");
console.log(line);

const shown = {
    SMTP_HOST: process.env.SMTP_HOST || "(not set)",
    SMTP_PORT: process.env.SMTP_PORT || "(not set, defaults to 587)",
    SMTP_USER: process.env.SMTP_USER || "(not set)",
    // Never print the password. Length and shape are enough to spot the
    // common mistakes — an empty value, or spaces left in from Google's UI.
    SMTP_PASS: process.env.SMTP_PASS
        ? `${process.env.SMTP_PASS.length} characters` +
          (/\s/.test(process.env.SMTP_PASS) ? "  ⚠️  CONTAINS SPACES — remove them" : "")
        : "(not set)",
    SMTP_FROM: process.env.SMTP_FROM || "(not set, will use SMTP_USER)",
};
for (const [k, v] of Object.entries(shown)) console.log(`  ${k.padEnd(12)} ${v}`);

if (!mailConfigured) {
    console.log(`\n${line}`);
    console.log("Email is NOT configured.");
    console.log("Reset codes will print to the server log instead of being sent.");
    console.log("Set SMTP_HOST, SMTP_USER and SMTP_PASS in backend/edtech/.env.");
    console.log(`${line}\n`);
    process.exit(1);
}

/*
 * A 16-character App Password is what Gmail issues. Flagging anything else is
 * a guess, not a rule — other providers use different lengths — so this warns
 * rather than fails.
 */
if (/gmail|google/i.test(process.env.SMTP_HOST || "") && process.env.SMTP_PASS.replace(/\s/g, "").length !== 16) {
    console.log(
        `\n  ⚠️  Gmail App Passwords are exactly 16 characters; yours is ` +
        `${process.env.SMTP_PASS.replace(/\s/g, "").length}.\n` +
        `      If you used your normal Gmail password, it will be rejected.\n` +
        `      Generate one at https://myaccount.google.com/apppasswords`
    );
}

console.log(`\n${line}`);
console.log("Authenticating...");
console.log(line);

const result = await verifyMail();

if (!result.ok) {
    console.log("\n❌ REJECTED\n");
    console.log(result.error);
    console.log(`\n   Raw error: ${result.raw}`);
    console.log(`\n${line}\n`);
    process.exit(1);
}

console.log("\n✅ Credentials accepted. The mail server will take messages from this account.");

if (!recipient) {
    console.log("\nTo send a real test message:");
    console.log("  node scripts/check-mail.js your.address@example.com");
    console.log(`${line}\n`);
    process.exit(0);
}

console.log(`\nSending a test message to ${recipient}...`);

const sent = await sendMail({
    to: recipient,
    subject: "Test message from your edtech platform",
    text:
        "If you are reading this, password reset codes will reach your students.\n\n" +
        "Nothing else to do — this message exists only to prove delivery works.",
    html:
        "<p>If you are reading this, password reset codes will reach your students.</p>" +
        "<p style='color:#666'>Nothing else to do — this message exists only to prove delivery works.</p>",
});

if (sent.ok && sent.delivered) {
    console.log(`\n✅ Sent. Check ${recipient} — including the spam folder on the first message.`);
    console.log(`   Message id: ${sent.id}`);
} else {
    console.log("\n❌ Send failed. See the error above.");
    process.exit(1);
}

console.log(`${line}\n`);
