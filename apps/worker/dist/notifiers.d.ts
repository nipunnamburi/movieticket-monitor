import { ShowOpening } from '@bms/shared';
export declare function sendTelegramAlert(chatId: string, monitorName: string, city: string, url: string, openings: ShowOpening[]): Promise<boolean>;
export declare function sendDiscordAlert(webhookUrl: string, monitorName: string, city: string, url: string, openings: ShowOpening[]): Promise<boolean>;
