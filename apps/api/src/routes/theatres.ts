import { FastifyInstance } from 'fastify';
import { prisma } from '@bms/db';

export async function theatreRoutes(fastify: FastifyInstance) {
  fastify.get('/api/theatres', async () => {
    const monitors = await prisma.monitor.findMany({
      select: { snapshot: true },
    });

    const allTheatres: Set<string> = new Set([
      'Asian Lakshmikala Cinepride: Moosapet',
      'Miraj Cinemas: Cine Town, Miyapur',
      'Mallikarjuna 70mm A/C DTS: Kukatpally',
      'Bhramaramba 70MM A/C 4K Dolby: Kukatpally',
      'Cinepolis: Lulu Mall, Hyderabad',
      'Prasads Multiplex: Hyderabad',
      'AMB Cinemas: Gachibowli',
      'PVR: Forum Sujana Mall',
      'INOX: GVK One, Banjara Hills',
    ]);

    for (const m of monitors) {
      const snapshot = m.snapshot as Record<string, Record<string, any>> | null;
      if (snapshot && typeof snapshot === 'object') {
        for (const theatres of Object.values(snapshot)) {
          if (theatres && typeof theatres === 'object') {
            for (const theatreName of Object.keys(theatres)) {
              if (theatreName && theatreName !== '_page_hash') {
                allTheatres.add(theatreName);
              }
            }
          }
        }
      }
    }

    return Array.from(allTheatres).sort();
  });
}
