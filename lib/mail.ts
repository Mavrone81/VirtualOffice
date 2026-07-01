import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";

// A single lazily-created transporter. When SMTP is not configured we return
// null and callers fall back to logging — so dev, CI and the Docker build all
// work without a relay, and mail simply becomes a no-op in those environments.
let cached: Transporter | null | undefined;

function transporter(): Transporter | null {
  if (cached !== undefined) return cached;
  if (!env.SMTP_HOST || !env.SMTP_PORT) {
    cached = null;
    return null;
  }
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true for 465, false for 587 (STARTTLS)
    auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return cached;
}

export type Mail = { to: string; subject: string; html: string; text?: string };

/**
 * Send a transactional email. Never throws — a mail failure must not roll back
 * the business action that triggered it (invite created, candidate approved).
 * Returns whether the message was actually handed to a relay.
 */
export async function sendMail(m: Mail): Promise<{ sent: boolean; error?: string }> {
  const t = transporter();
  if (!t) {
    console.info(`[mail] SMTP not configured — skipped "${m.subject}" → ${m.to}`);
    return { sent: false };
  }
  try {
    await t.sendMail({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      to: m.to,
      subject: m.subject,
      text: m.text ?? stripHtml(m.html),
      html: m.html,
    });
    return { sent: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[mail] failed to send "${m.subject}" → ${m.to}: ${error}`);
    return { sent: false, error };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Branded template shell + specific transactional emails
// ---------------------------------------------------------------------------
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f2ee;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2b2b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
      <tr><td style="padding:8px 4px 20px">
        <span style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;background:#1a1f2b;color:#fff;border-radius:8px;font-weight:600;vertical-align:middle">E</span>
        <span style="margin-left:10px;font-weight:600;font-size:16px;color:#1a1f2b;vertical-align:middle">Enshrine</span>
        <span style="margin-left:6px;font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:#9a968d;vertical-align:middle">Virtual Office</span>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e6e2d9;border-radius:14px;padding:28px 28px 24px">
        <h1 style="margin:0 0 14px;font-size:20px;color:#1a1f2b">${heading}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:16px 6px;color:#9a968d;font-size:11px;line-height:1.5">
        Enshrine Services · Enshrine Pets Paradise · Enshrine Afterlife Planner<br>
        This is an automated message from the Enshrine Virtual Office.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#c8a04a;color:#1a1f2b;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:14px">${label}</a>`;
}

export function onboardingInviteEmail(name: string, link: string): Mail {
  const first = name.split(" ")[0] || name;
  return {
    to: "", // set by caller
    subject: "Complete your Enshrine associate onboarding",
    html: layout(
      `Welcome, ${escapeHtml(first)}`,
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#5a564e">
        You've been invited to join Enshrine as an associate. Use the secure link below to complete your details and
        sign your Associate Agreement — it takes about 3 minutes and requires no login.</p>
       <p style="margin:0 0 22px">${button(link, "Start onboarding")}</p>
       <p style="margin:0;font-size:12px;color:#9a968d">This link is personal to you — please don't share it. If the
        button doesn't work, copy this URL into your browser:<br><span style="color:#5a564e;word-break:break-all">${escapeHtml(link)}</span></p>`,
    ),
  };
}

export function approvalEmail(name: string, loginUrl: string, email: string, tempPassword: string): Mail {
  const first = name.split(" ")[0] || name;
  return {
    to: "", // set by caller
    subject: "Your Enshrine Virtual Office account is ready",
    html: layout(
      `You're approved, ${escapeHtml(first)}`,
      `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#5a564e">
        Your application has been approved and your virtual-office account is now active. Sign in with the temporary
        credentials below and change your password after your first login.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:14px">
         <tr><td style="padding:4px 16px 4px 0;color:#9a968d">Email</td><td style="color:#1a1f2b;font-weight:600">${escapeHtml(email)}</td></tr>
         <tr><td style="padding:4px 16px 4px 0;color:#9a968d">Temporary password</td><td style="color:#1a1f2b;font-weight:600;font-family:monospace">${escapeHtml(tempPassword)}</td></tr>
       </table>
       <p style="margin:0 0 22px">${button(loginUrl, "Sign in")}</p>
       <p style="margin:0;font-size:12px;color:#9a968d">For your security, please change your password immediately after signing in.</p>`,
    ),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
