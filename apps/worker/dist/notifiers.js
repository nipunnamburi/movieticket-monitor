import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
export async function sendTelegramAlert(chatId, monitorName, city, url, openings) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !chatId) {
        console.warn('[Notifier] Telegram bot token or chat ID missing');
        return false;
    }
    const lines = [
        `🚨 *TICKETS OPENED UP!* 🎬`,
        `*Movie:* ${escapeMarkdown(monitorName)}`,
        `*City:* ${escapeMarkdown(city)}`,
        `*Shows Detected:* ${openings.length}`,
        '',
    ];
    for (const op of openings.slice(0, 10)) {
        lines.push(`• *${escapeMarkdown(op.theatre)}*`);
        lines.push(`  📅 ${escapeMarkdown(op.date)} | ⏰ \`${escapeMarkdown(op.showtime)}\``);
        lines.push(`  Status: *${escapeMarkdown(op.change)}*`);
        lines.push('');
    }
    if (openings.length > 10) {
        lines.push(`_...and ${openings.length - 10} more shows!_`);
    }
    const body = {
        chat_id: chatId,
        text: lines.join('\n'),
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: '🎟️ Book Now on BookMyShow',
                        url: url,
                    },
                ],
            ],
        },
    };
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const json = (await res.json());
        if (!json.ok) {
            console.error('[Notifier] Telegram error:', json);
            return false;
        }
        console.log(`[Notifier] Telegram alert delivered to ${chatId}`);
        return true;
    }
    catch (err) {
        console.error('[Notifier] Telegram dispatch exception:', err);
        return false;
    }
}
export async function sendDiscordAlert(webhookUrl, monitorName, city, url, openings) {
    if (!webhookUrl)
        return false;
    const fields = openings.slice(0, 10).map((op) => ({
        name: `${op.theatre} (${op.date})`,
        value: `⏰ **${op.showtime}** — ${op.change}`,
        inline: false,
    }));
    const embed = {
        title: `🚨 Tickets Open: ${monitorName}`,
        description: `New booking openings detected in **${city}**! Click below to secure tickets right away.`,
        url: url,
        color: 0xe50914, // BMS Red
        fields: fields,
        footer: {
            text: 'BookMyShow High-Speed Monitor',
        },
        timestamp: new Date().toISOString(),
    };
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `🔔 **${monitorName}** has new tickets available!`,
                embeds: [embed],
            }),
        });
        if (!res.ok) {
            console.error('[Notifier] Discord webhook error status:', res.status);
            return false;
        }
        console.log('[Notifier] Discord alert delivered');
        return true;
    }
    catch (err) {
        console.error('[Notifier] Discord dispatch exception:', err);
        return false;
    }
}
function escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
//# sourceMappingURL=notifiers.js.map