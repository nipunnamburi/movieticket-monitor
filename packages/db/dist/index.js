import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config();
export const prisma = globalThis.prismaGlobal ??
    new PrismaClient({
        datasources: process.env.DATABASE_URL
            ? {
                db: {
                    url: process.env.DATABASE_URL,
                },
            }
            : undefined,
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production') {
    globalThis.prismaGlobal = prisma;
}
export * from '@prisma/client';
//# sourceMappingURL=index.js.map