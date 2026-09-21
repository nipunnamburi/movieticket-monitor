import nodemailer from 'nodemailer';
import { ShowOpening } from '@bms/shared';
import { prisma } from '@bms/db';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface NotificationConfig {
  emailFrom: string;
  emailAppPassword: string;
  defaultEmailTo: string;
  smtpHost: string;
  smtpPort: number;
  isEmailConfigured: boolean;
}

export async function getNotificationConfig(): Promise<NotificationConfig> {
  let settingsMap: Record<string, string> = {};
  try {
    const dbSettings = await prisma.systemSetting.findMany();
    for (const s of dbSettings) {
      settingsMap[s.key] = s.value;
    }
  } catch (err) {
    console.warn('[Notifier] Could not load system settings from DB:', err);
  }

  const emailFrom = settingsMap['EMAIL_FROM'] || process.env.EMAIL_FROM || '';
  const emailAppPassword = (settingsMap['EMAIL_APP_PASSWORD'] || process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const defaultEmailTo = settingsMap['DEFAULT_EMAIL_TO'] || process.env.DEFAULT_EMAIL_TO || emailFrom;
  const smtpHost = settingsMap['SMTP_HOST'] || process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(settingsMap['SMTP_PORT'] || process.env.SMTP_PORT) || 465;

  return {
    emailFrom,
    emailAppPassword,
    defaultEmailTo,
    smtpHost,
    smtpPort,
    isEmailConfigured: Boolean(emailFrom && emailAppPassword),
  };
}

function createGmailTransporter(cfg: NotificationConfig) {
  const isSecure = cfg.smtpPort === 465;
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: isSecure,
    auth: {
      user: cfg.emailFrom,
      pass: cfg.emailAppPassword,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    family: 4, // Force IPv4 to prevent cloud/mac IPv6 connection timeouts
  } as any);
}

// ── Send Ticket Drop Email Alert ──────────────────────────────────────────────
export async function sendEmailAlert(
  recipientEmail: string,
  monitorName: string,
  city: string,
  url: string,
  openings: ShowOpening[]
): Promise<{ success: boolean; error?: string }> {
  const cfg = await getNotificationConfig();
  const to = recipientEmail || cfg.defaultEmailTo || cfg.emailFrom;

  if (!cfg.emailFrom || !cfg.emailAppPassword) {
    const msg = 'Gmail SMTP credentials not configured (requires EMAIL_FROM + EMAIL_APP_PASSWORD)';
    console.warn(`[Notifier] ${msg}`);
    return { success: false, error: msg };
  }
  if (!to) {
    const msg = 'No recipient email address specified';
    console.warn(`[Notifier] ${msg}`);
    return { success: false, error: msg };
  }

  const subject = `🔔 BMS Alert: ${monitorName} (${city}) — ${openings.length} Show(s) Bookable Now!`;

  const rows = openings
    .slice(0, 20)
    .map(
      (op) => `
      <tr style="border-bottom: 1px solid #27272a;">
        <td style="padding: 10px 12px; font-weight: 600; color: #f4f4f5;">${op.theatre}</td>
        <td style="padding: 10px 12px; color: #a1a1aa;">${op.date}</td>
        <td style="padding: 10px 12px; font-weight: 700; color: #38bdf8;">${op.showtime}</td>
        <td style="padding: 10px 12px;">
          <span style="background: #10b98122; color: #34d399; padding: 3px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;">
            ${op.change}
          </span>
        </td>
      </tr>
    `
    )
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 24px; }
        .card { max-width: 600px; margin: 0 auto; background: #12121c; border: 1px solid #27272a; border-radius: 14px; overflow: hidden; }
        .hdr { background: #e50914; padding: 20px 24px; }
        .hdr h1 { margin: 0; font-size: 20px; color: #fff; }
        .body { padding: 24px; }
        .btn { display: inline-block; background: #e50914; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="hdr">
          <h1>🔔 New Shows Bookable!</h1>
          <p style="margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.85);">${monitorName} · ${city}</p>
        </div>
        <div class="body">
          <p style="font-size: 14px; color: #a1a1aa; margin-top: 0;">
            The monitor detected <strong>${openings.length} show opening(s)</strong>. Grab your tickets before they sell out!
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0;">
            <thead>
              <tr style="text-align: left; background: #181825; color: #71717a; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 8px 12px;">Theatre</th>
                <th style="padding: 8px 12px;">Date</th>
                <th style="padding: 8px 12px;">Time</th>
                <th style="padding: 8px 12px;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
          <div style="text-align: center;">
            <a href="${url}" class="btn" target="_blank">🎟️ Open BookMyShow to Book</a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const transporter = createGmailTransporter(cfg);
    await transporter.sendMail({
      from: `"BookMyShow Monitor" <${cfg.emailFrom}>`,
      to,
      subject,
      html,
    });
    console.log(`[Notifier] Ticket alert email sent successfully to ${to}`);
    return { success: true };
  } catch (err: any) {
    console.error('[Notifier] Gmail SMTP dispatch error:', err);
    let errMsg = err.message || String(err);
    if (errMsg.includes('535-5.7.8') || errMsg.includes('Username and Password not accepted')) {
      errMsg = 'Gmail App Password invalid or rejected. Please generate a 16-character App Password at myaccount.google.com/apppasswords';
    } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNREFUSED')) {
      errMsg = 'Connection to Gmail SMTP timed out. Check network or firewall settings.';
    }
    return { success: false, error: errMsg };
  }
}

// ── Send Test Email (Diagnostic) ──────────────────────────────────────────────
export async function sendTestEmail(recipientEmail?: string): Promise<{ success: boolean; error?: string; details?: any }> {
  const cfg = await getNotificationConfig();
  const to = recipientEmail || cfg.defaultEmailTo || cfg.emailFrom;

  if (!cfg.emailFrom || !cfg.emailAppPassword) {
    return {
      success: false,
      error: 'Gmail SMTP credentials missing. Please configure EMAIL_FROM and EMAIL_APP_PASSWORD.',
    };
  }

  if (!to) {
    return {
      success: false,
      error: 'No recipient email specified for test alert.',
    };
  }

  try {
    const transporter = createGmailTransporter(cfg);

    // Verify SMTP connection handshake first
    await transporter.verify();

    // Send test email
    await transporter.sendMail({
      from: `"BookMyShow Monitor" <${cfg.emailFrom}>`,
      to,
      subject: '✅ BookMyShow Monitor — Test Email Successful!',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #09090b; color: #f4f4f5; padding: 24px;">
          <div style="max-width: 500px; margin: 0 auto; background: #12121c; border: 1px solid #27272a; border-radius: 12px; padding: 24px;">
            <h2 style="color: #10b981; margin-top: 0;">🎉 Test Email Received!</h2>
            <p style="color: #a1a1aa; font-size: 14px;">
              Your Gmail SMTP notification pipeline is working correctly.
            </p>
            <div style="background: #181825; padding: 12px; border-radius: 8px; font-size: 13px; color: #71717a;">
              <div><strong>Sender:</strong> ${cfg.emailFrom}</div>
              <div><strong>Recipient:</strong> ${to}</div>
              <div><strong>Timestamp:</strong> ${new Date().toISOString()}</div>
            </div>
          </div>
        </div>
      `,
    });

    console.log(`[Notifier] Test email delivered successfully to ${to}`);
    return { success: true };
  } catch (err: any) {
    console.error('[Notifier] Test email failed:', err);
    let errMsg = err.message || String(err);
    if (errMsg.includes('535-5.7.8') || errMsg.includes('Username and Password not accepted')) {
      errMsg = 'Gmail App Password invalid. Ensure 2-Step Verification is active and generate a new 16-character App Password at myaccount.google.com/apppasswords';
    } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNREFUSED')) {
      errMsg = 'Connection to Gmail SMTP timed out. Check port (465/587) or network access.';
    }
    return { success: false, error: errMsg };
  }
}
