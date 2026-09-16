import { fastify } from '../apps/api/src/index.js';

export default async function handler(req: any, res: any) {
  try {
    await fastify.ready();
    fastify.server.emit('request', req, res);
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server initialization failed', message: err.message }));
  }
}
