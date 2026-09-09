import nodemailer from 'nodemailer';
import twilio from 'twilio';
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
  twilioSid: string;
  twilioToken: string;
  twilioFrom: string;
  callmebotKey: string;
  defaultWhatsappTo: string;
  isEmailConfigured: boolean;
  isWhatsappConfigured: boolean;
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
  const smtpPort = Number(settingsMap['SMTP_PORT'] || process.env.SMTP_PORT) || 587;

  const twilioSid = settingsMap['TWILIO_ACCOUNT_SID'] || process.env.TWILIO_ACCOUNT_SID || '';
  const twilioToken = settingsMap['TWILIO_AUTH_TOKEN'] || process.env.TWILIO_AUTH_TOKEN || '';
  const twilioFrom = settingsMap['TWILIO_WHATSAPP_FROM'] || process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const callmebotKey = settingsMap['CALLMEBOT_API_KEY'] || process.env.CALLMEBOT_API_KEY || '';
  const defaultWhatsappTo = settingsMap['DEFAULT_WHATSAPP_TO'] || process.env.DEFAULT_WHATSAPP_TO || '';

  return {
    emailFrom,
    emailAppPassword,
    defaultEmailTo,
    smtpHost,
    smtpPort,
    twilioSid,
    twilioToken,
    twilioFrom,
    callmebotKey,
    defaultWhatsappTo,
    isEmailConfigured: Boolean(emailFrom && emailAppPassword),
    isWhatsappConfigured: Boolean(callmebotKey || (twilioSid && twilioToken)),
  };
}

// ── Email Notifier (Gmail / SMTP) ─────────────────────────────────────────────
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
    const msg = 'Email sender credentials (EMAIL_FROM, EMAIL_APP_PASSWORD) not configured';
    console.warn(`[Notifier] ${msg}`);
    return { success: false, error: msg };
  }
  if (!to) {
    const msg = 'No recipient email address specified';
    console.warn(`[Notifier] ${msg}`);
    return { success: false, error: msg };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: {
      user: cfg.emailFrom,
      pass: cfg.emailAppPassword,
    },
  });

  const subject = `🔔 BMS Alert: ${monitorName} (${city}) — ${openings.length} Show(s) Bookable Now!`;

  const rows = openings
    .slice(0, 15)
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
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #09090b; color: #f4f4f5; margin: 0; padding: 24px; }
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
    await transporter.sendMail({
      from: `"BookMyShow Monitor" <${cfg.emailFrom}>`,
      to,
      subject,
      html,
    });
    console.log(`[Notifier] Email alert delivered to ${to}`);
    return { success: true };
  } catch (err: any) {
    console.error('[Notifier] Email dispatch error:', err);
    return { success: false, error: err.message || String(err) };
  }
}

// ── WhatsApp Notifier (Twilio & CallMeBot) ─────────────────────────────────────
export async function sendWhatsAppAlert(
  recipientPhone: string,
  monitorName: string,
  city: string,
  url: string,
  openings: ShowOpening[]
): Promise<{ success: boolean; error?: string }> {
  const cfg = await getNotificationConfig();
  const phone = recipientPhone || cfg.defaultWhatsappTo;
  if (!phone) {
    const msg = 'No recipient WhatsApp phone number specified';
    console.warn(`[Notifier] ${msg}`);
    return { success: false, error: msg };
  }

  if (!cfg.isWhatsappConfigured) {
    const msg = 'No WhatsApp credentials configured (requires CallMeBot API key or Twilio SID/Auth Token)';
    console.warn(`[Notifier] ${msg}`);
    return { success: false, error: msg };
  }

  // Format clean international phone number
  const formattedPhone = phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`;
  const messageBody = [
    `🚨 *BOOKMYSHOW TICKET ALERT!* 🎬`,
    `*Movie:* ${monitorName}`,
    `*City:* ${city}`,
    `*Openings:* ${openings.length} shows bookable right now!`,
    '',
    ...openings.slice(0, 5).map((op) => `• *${op.theatre}*\n  📅 ${op.date} | ⏰ ${op.showtime}\n  ${op.change}`),
    '',
    `🎟️ *Book Now:* ${url}`,
  ].join('\n');

  // Option 1: CallMeBot Free WhatsApp API (phone + apikey)
  if (cfg.callmebotKey) {
    try {
      const encodedMsg = encodeURIComponent(messageBody);
      const cleanPhoneDigits = formattedPhone.replace('+', '');
      const cmbUrl = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhoneDigits}&text=${encodedMsg}&apikey=${cfg.callmebotKey}`;
      const res = await fetch(cmbUrl);
      if (res.ok) {
        console.log(`[Notifier] WhatsApp alert sent via CallMeBot to ${formattedPhone}`);
        return { success: true };
      }
      const text = await res.text();
      return { success: false, error: `CallMeBot HTTP ${res.status}: ${text}` };
    } catch (err: any) {
      console.error('[Notifier] CallMeBot WhatsApp exception:', err);
      return { success: false, error: err.message };
    }
  }

  // Option 2: Twilio WhatsApp API
  if (cfg.twilioSid && cfg.twilioToken) {
    try {
      const client = twilio(cfg.twilioSid, cfg.twilioToken);
      await client.messages.create({
        from: cfg.twilioFrom,
        to: `whatsapp:${formattedPhone}`,
        body: messageBody,
      });
      console.log(`[Notifier] WhatsApp message sent via Twilio to ${formattedPhone}`);
      return { success: true };
    } catch (err: any) {
      console.error('[Notifier] Twilio WhatsApp error:', err);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'No active WhatsApp provider available' };
}
