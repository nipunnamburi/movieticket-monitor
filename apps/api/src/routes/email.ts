import { FastifyInstance } from 'fastify';
import { prisma } from '@bms/db';
import { extractAuthSession } from '../auth.js';
import { sendTestEmail } from '../notifiers.js';

export async function emailRoutes(fastify: FastifyInstance) {
  // ── Notification Settings Endpoints (Gmail SMTP) ───────────────────────────
  fastify.get('/api/settings/notifications', async () => {
    const dbSettings = await prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of dbSettings) {
      map[s.key] = s.value;
    }

    const emailFrom = map['EMAIL_FROM'] || process.env.EMAIL_FROM || '';
    const emailAppPassword = map['EMAIL_APP_PASSWORD'] || process.env.EMAIL_APP_PASSWORD || '';
    const defaultEmailTo = map['DEFAULT_EMAIL_TO'] || process.env.DEFAULT_EMAIL_TO || emailFrom;
    const smtpHost = map['SMTP_HOST'] || process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = Number(map['SMTP_PORT'] || process.env.SMTP_PORT) || 465;

    return {
      emailFrom,
      hasAppPassword: Boolean(emailAppPassword),
      defaultEmailTo,
      smtpHost,
      smtpPort,
      isEmailConfigured: Boolean(emailFrom && emailAppPassword),
    };
  });

  fastify.post('/api/settings/notifications', async (request, reply) => {
    const body = (request.body as any) || {};

    const keysToUpdate: Record<string, string | undefined> = {
      EMAIL_FROM: body.emailFrom !== undefined ? String(body.emailFrom).trim() : undefined,
      EMAIL_APP_PASSWORD: body.emailAppPassword !== undefined ? String(body.emailAppPassword).trim().replace(/\s+/g, '') : undefined,
      DEFAULT_EMAIL_TO: body.defaultEmailTo !== undefined ? String(body.defaultEmailTo).trim() : undefined,
      SMTP_HOST: body.smtpHost !== undefined ? String(body.smtpHost).trim() : undefined,
      SMTP_PORT: body.smtpPort !== undefined ? String(body.smtpPort).trim() : undefined,
    };

    for (const [key, val] of Object.entries(keysToUpdate)) {
      if (val !== undefined && val !== '') {
        process.env[key] = val;
        await prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: val },
          update: { value: val },
        });
      }
    }

    return { ok: true, message: 'Gmail SMTP settings saved successfully' };
  });

  // ── Notification Test Endpoint (Gmail SMTP Direct Test) ─────────────────────
  const handleTestNotification = async (request: any, reply: any) => {
    const session = extractAuthSession(request);
    let { target } = (request.body as any) || {};
    if (!target && session.email) {
      target = session.email;
    }

    const dbSettings = await prisma.systemSetting.findMany();
    const map: Record<string, string> = {};
    for (const s of dbSettings) map[s.key] = s.value;

    const emailFrom = map['EMAIL_FROM'] || process.env.EMAIL_FROM || '';
    const emailPass = map['EMAIL_APP_PASSWORD'] || process.env.EMAIL_APP_PASSWORD || '';
    const finalTarget = target || map['DEFAULT_EMAIL_TO'] || process.env.DEFAULT_EMAIL_TO || emailFrom;

    if (!emailFrom || !emailPass) {
      return reply.badRequest(
        'Gmail credentials not configured! Please provide EMAIL_FROM and EMAIL_APP_PASSWORD in Notification Settings (⚙️).'
      );
    }

    if (!finalTarget) {
      return reply.badRequest('Recipient email address is required for test email.');
    }

    try {
      const result = await sendTestEmail(finalTarget);

      if (!result.success) {
        return reply.badRequest(
          `Failed to send email: ${result.error || 'Authentication or connection error'}`
        );
      }

      return { ok: true, message: `✅ Test email successfully delivered to ${finalTarget}!` };
    } catch (err: any) {
      fastify.log.error(err, 'Test email dispatch failed');
      return reply.badRequest(
        `Failed to send email: ${err.message || 'Check Gmail App Password and network connectivity'}`
      );
    }
  };

  fastify.post('/api/test-notification', handleTestNotification);
  fastify.post('/api/settings/test-alert', handleTestNotification);
}
