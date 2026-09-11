import { fastify } from '../apps/api/src/index.js';

export default async function handler(req: any, res: any) {
  await fastify.ready();
  fastify.server.emit('request', req, res);
}
