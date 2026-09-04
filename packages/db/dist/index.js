import { PrismaClient } from '@prisma/client';
export const prisma = globalThis.prismaGlobal ??
    new PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
if (process.env.NODE_ENV !== 'production') {
    globalThis.prismaGlobal = prisma;
}
export * from '@prisma/client';
//# sourceMappingURL=index.js.map